import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { Wallet, WalletTx } from '../src/db/models';
import { dec, ZERO } from '../src/lib/money';
import { createMemberWithWallet, createDeposit, completeDeposit, getBalance } from './helpers/wallet-flows';

const app = createApp();

beforeAll(async () => {
  await sequelize.authenticate();
});

beforeEach(async () => {
  await sequelize.truncate({ cascade: true });
});

afterAll(async () => {
  await sequelize.close();
});

// These are the tests that matter: the same HTTP requests fired truly in parallel
// (each supertest call takes its own pool connection, so the DB sees genuinely
// concurrent transactions).

describe('concurrent PSP callbacks', () => {
  it('credits exactly once when the same callback arrives 5 times concurrently', async () => {
    const { memberId, walletId } = await createMemberWithWallet(app);
    const { pspRef } = await createDeposit(app, memberId, '100.50');

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post('/psp/callbacks').send({ pspRef, status: 'completed', amount: '100.50' }),
      ),
    );

    // Every delivery is acknowledged with 200 (original or duplicate) - the PSP
    // must stop retrying regardless of which request won the race.
    for (const res of responses) {
      expect(res.status).toBe(200);
    }
    expect(await getBalance(app, memberId)).toBe('100.500000000000000000');
    expect(await WalletTx.count({ where: { walletId } })).toBe(1);
  });
});

describe('concurrent wagers', () => {
  it('cannot overdraw the wallet when two wagers race for the same funds', async () => {
    const { memberId, walletId } = await createMemberWithWallet(app);
    await completeDeposit(app, memberId, '100.00');

    // 100 in the wallet, two concurrent 60s: only one can win.
    const [a, b] = await Promise.all([
      request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '60.00' }),
      request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '60.00' }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 422]);
    expect(await getBalance(app, memberId)).toBe('40.000000000000000000');

    const wallet = await Wallet.findByPk(walletId);
    expect(dec(wallet!.balance).isNegative()).toBe(false);
    expect(await WalletTx.count({ where: { walletId, type: 'wager_debit' } })).toBe(1);
  });
});

describe('concurrent wager and withdrawal', () => {
  it('cannot overdraw when a wager and a withdrawal race for the same funds', async () => {
    const { memberId, walletId } = await createMemberWithWallet(app);
    // Multiplier 0: no turnover requirement, so the withdrawal is unlocked and
    // the race is purely over the balance.
    await completeDeposit(app, memberId, '100.00', 0);

    const [wager, withdrawal] = await Promise.all([
      request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '60.00' }),
      request(app).post('/withdrawals').send({ memberId, amount: '60.00' }),
    ]);

    // Either request may win the wallet lock; exactly one debit must go through.
    const statuses = [wager.status, withdrawal.status].sort();
    expect(statuses).toEqual([201, 422]);
    expect(await getBalance(app, memberId)).toBe('40.000000000000000000');

    const wallet = await Wallet.findByPk(walletId);
    expect(dec(wallet!.balance).isNegative()).toBe(false);
    const debits = await WalletTx.count({
      where: { walletId, type: ['wager_debit', 'withdrawal_debit'] },
    });
    expect(debits).toBe(1);
  });
});

describe('ledger reconstruction invariant', () => {
  it('keeps the wallet balance equal to the sum of ledger entries through a mixed flow', async () => {
    const { memberId, walletId } = await createMemberWithWallet(app);

    await completeDeposit(app, memberId, '100.00', 1); // +100, requirement 100
    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '30.00' }); // -30
    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '70.00' }); // -70, turnover met
    await completeDeposit(app, memberId, '50.00', 0); // +50, no extra requirement
    await request(app).post('/withdrawals').send({ memberId, amount: '20.00' }); // -20

    const wallet = await Wallet.findByPk(walletId);
    const entries = await WalletTx.findAll({
      where: { walletId },
      order: [['createdAt', 'ASC']],
    });

    // The balance must be reconstructible from the append-only ledger alone.
    const ledgerSum = entries.reduce((sum, e) => sum.plus(dec(e.amount)), ZERO);
    expect(ledgerSum.isEqualTo(dec(wallet!.balance))).toBe(true);
    expect(dec(wallet!.balance).isEqualTo(dec('30'))).toBe(true);

    // Every entry's running snapshot is consistent with the entries before it.
    let running = ZERO;
    for (const entry of entries) {
      running = running.plus(dec(entry.amount));
      expect(dec(entry.balanceAfter).isEqualTo(running)).toBe(true);
    }
  });
});
