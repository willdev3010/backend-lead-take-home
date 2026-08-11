import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { FundingTransaction, Wallet, WalletTx } from '../src/db/models';
import { createMemberWithWallet, createDeposit, getBalance } from './helpers/wallet-flows';

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

describe('POST /psp/callbacks', () => {
  it('credits the wallet and writes a ledger entry on completed', async () => {
    const { memberId, walletId } = await createMemberWithWallet(app);
    const { transactionId, pspRef } = await createDeposit(app, memberId, '100.50', 2);

    const res = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef, status: 'completed', amount: '100.50' });

    expect(res.status).toBe(200);
    expect(await getBalance(app, memberId)).toBe('100.500000000000000000');

    const tx = await FundingTransaction.findByPk(transactionId);
    expect(tx?.status).toBe('Completed');
    expect(tx?.amountMismatch).toBe(false);
    // Turnover requirement accrued: 100.50 x 2.
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.turnoverRequired).toBe('201.000000000000000000');

    const entries = await WalletTx.findAll({ where: { walletId } });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('deposit_credit');
    expect(entries[0].balanceAfter).toBe('100.500000000000000000');
  });

  it('does not double-credit on sequential duplicate callbacks', async () => {
    const { memberId, walletId } = await createMemberWithWallet(app);
    const { pspRef } = await createDeposit(app, memberId, '100.50');

    const first = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef, status: 'completed', amount: '100.50' });
    const second = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef, status: 'completed', amount: '100.50' });

    // The retry gets the same 200 - PSPs only stop retrying on 2xx.
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await getBalance(app, memberId)).toBe('100.500000000000000000');
    expect(await WalletTx.count({ where: { walletId } })).toBe(1);
  });

  it('marks the transaction failed without moving money', async () => {
    const { memberId, walletId } = await createMemberWithWallet(app);
    const { transactionId, pspRef } = await createDeposit(app, memberId, '50.00');

    const res = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef, status: 'failed', amount: '50.00' });

    expect(res.status).toBe(200);
    const tx = await FundingTransaction.findByPk(transactionId);
    expect(tx?.status).toBe('Failed');
    expect(await getBalance(app, memberId)).toBe('0.000000000000000000');
    expect(await WalletTx.count({ where: { walletId } })).toBe(0);
  });

  it('rejects a conflicting status after a terminal state with 409', async () => {
    const { memberId } = await createMemberWithWallet(app);
    const { transactionId, pspRef } = await createDeposit(app, memberId, '50.00');

    await request(app).post('/psp/callbacks').send({ pspRef, status: 'completed', amount: '50.00' });
    const conflicting = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef, status: 'failed', amount: '50.00' });

    expect(conflicting.status).toBe(409);
    // The terminal state and the money are untouched.
    const tx = await FundingTransaction.findByPk(transactionId);
    expect(tx?.status).toBe('Completed');
    expect(await getBalance(app, memberId)).toBe('50.000000000000000000');
  });

  it('acknowledges an unknown pspRef with 202 and moves no money', async () => {
    const { memberId } = await createMemberWithWallet(app);

    const res = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef: 'never-issued-ref', status: 'completed', amount: '10.00' });

    expect(res.status).toBe(202);
    expect(await getBalance(app, memberId)).toBe('0.000000000000000000');
  });

  it('credits the actual callback amount on mismatch and flags the transaction', async () => {
    const { memberId } = await createMemberWithWallet(app);
    // Requested 100, but only 98.50 arrived (e.g. PSP fee deducted).
    const { transactionId, pspRef } = await createDeposit(app, memberId, '100.00', 1);

    const res = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef, status: 'completed', amount: '98.50' });

    expect(res.status).toBe(200);
    expect(await getBalance(app, memberId)).toBe('98.500000000000000000');

    const tx = await FundingTransaction.findByPk(transactionId);
    expect(tx?.amountMismatch).toBe(true);
    expect(tx?.creditedAmount).toBe('98.500000000000000000');
  });
});
