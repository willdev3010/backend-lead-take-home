import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { FundingTransaction, WalletTx } from '../src/db/models';
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

async function wager(walletId: string, amount: string) {
  return request(app).post(`/wallets/${walletId}/wagers`).send({ amount });
}

describe('POST /withdrawals', () => {
  it('blocks withdrawal while turnover is outstanding, with an informative body', async () => {
    const { memberId } = await createMemberWithWallet(app);
    // Deposit 100 with x2 multiplier: 200 turnover required, 0 accrued.
    await completeDeposit(app, memberId, '100.00', 2);

    const res = await request(app).post('/withdrawals').send({ memberId, amount: '50.00' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('turnover_not_met');
    expect(res.body.requiredTurnover).toBe('200');
    expect(res.body.accruedTurnover).toBe('0');
    expect(res.body.outstanding).toBe('200');
    expect(await getBalance(app, memberId)).toBe('100.000000000000000000');
  });

  it('unblocks once wagers cover the requirement, debits immediately, creates pending withdrawal', async () => {
    const { memberId, walletId } = await createMemberWithWallet(app);
    // 100 deposited at x1: requirement 100.
    await completeDeposit(app, memberId, '100.00', 1);
    await wager(walletId, '60.00');
    await wager(walletId, '40.00');
    // Balance 0 now; deposit another 50 (x0 - adds no requirement) to have funds.
    await completeDeposit(app, memberId, '50.00', 0);

    const res = await request(app).post('/withdrawals').send({ memberId, amount: '30.00' });

    expect(res.status).toBe(201);
    expect(await getBalance(app, memberId)).toBe('20.000000000000000000');

    const tx = await FundingTransaction.findByPk(res.body.transactionId);
    expect(tx?.type).toBe('withdrawal');
    expect(tx?.status).toBe('Pending');

    const entry = await WalletTx.findOne({ where: { walletId, type: 'withdrawal_debit' } });
    expect(entry?.amount).toBe('-30.000000000000000000');
    expect(entry?.balanceAfter).toBe('20.000000000000000000');
  });

  it('rejects a withdrawal exceeding the balance even when turnover is met', async () => {
    const { memberId, walletId } = await createMemberWithWallet(app);
    await completeDeposit(app, memberId, '50.00', 1);
    await wager(walletId, '50.00'); // meets turnover, balance now 0
    await completeDeposit(app, memberId, '10.00', 0);

    const res = await request(app).post('/withdrawals').send({ memberId, amount: '10.01' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('insufficient_balance');
    expect(await getBalance(app, memberId)).toBe('10.000000000000000000');
  });

  it('returns 404 for an unknown member', async () => {
    const res = await request(app)
      .post('/withdrawals')
      .send({ memberId: '00000000-0000-4000-8000-000000000000', amount: '10.00' });
    expect(res.status).toBe(404);
  });
});
