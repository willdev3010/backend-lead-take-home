import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { Wallet, WalletTx } from '../src/db/models';
import { createMemberWithWallet, completeDeposit, getBalance } from './helpers/wallet-flows';

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

describe('POST /wallets/:walletId/wagers', () => {
  it('debits the wallet, accrues turnover, and writes a ledger entry', async () => {
    const { memberId, walletId } = await createMemberWithWallet(app);
    await completeDeposit(app, memberId, '100.00');

    const res = await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '10.00' });

    expect(res.status).toBe(201);
    expect(res.body.balance).toBe('90.000000000000000000');
    expect(await getBalance(app, memberId)).toBe('90.000000000000000000');

    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.turnoverAccrued).toBe('10.000000000000000000');

    const entries = await WalletTx.findAll({ where: { walletId, type: 'wager_debit' } });
    expect(entries).toHaveLength(1);
    expect(entries[0].amount).toBe('-10.000000000000000000');
    expect(entries[0].balanceAfter).toBe('90.000000000000000000');
  });

  it('rejects a wager exceeding the balance with 422 and no side effects', async () => {
    const { memberId, walletId } = await createMemberWithWallet(app);
    await completeDeposit(app, memberId, '20.00');

    const res = await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '20.01' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('insufficient_balance');
    expect(await getBalance(app, memberId)).toBe('20.000000000000000000');
    expect(await WalletTx.count({ where: { walletId, type: 'wager_debit' } })).toBe(0);
  });

  it('returns 404 for an unknown wallet', async () => {
    const res = await request(app)
      .post('/wallets/00000000-0000-4000-8000-000000000000/wagers')
      .send({ amount: '5.00' });
    expect(res.status).toBe(404);
  });
});
