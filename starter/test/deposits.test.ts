import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { FundingTransaction, WalletTx } from '../src/db/models';

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

async function createMember(username = 'alice01') {
  const res = await request(app).post('/members').send({ username });
  return { memberId: res.body.member.id as string, walletId: res.body.wallet.id as string };
}

describe('POST /deposits', () => {
  it('creates a pending funding transaction without moving money', async () => {
    const { memberId, walletId } = await createMember();

    const res = await request(app)
      .post('/deposits')
      .send({ memberId, amount: '100.50', turnoverMultiplier: 2 });

    expect(res.status).toBe(201);
    expect(res.body.transactionId).toBeDefined();
    expect(res.body.pspRef).toBeDefined();

    const tx = await FundingTransaction.findByPk(res.body.transactionId);
    expect(tx?.status).toBe('Pending');
    expect(tx?.type).toBe('deposit');
    expect(tx?.turnoverMultiplier).toBe(2);

    // No money moved: wallet untouched, ledger empty.
    const walletRes = await request(app).get(`/members/${memberId}/wallet`);
    expect(walletRes.body.balance).toBe('0.000000000000000000');
    expect(await WalletTx.count({ where: { walletId } })).toBe(0);
  });

  it('defaults turnoverMultiplier to 1', async () => {
    const { memberId } = await createMember();
    const res = await request(app).post('/deposits').send({ memberId, amount: '10.00' });
    expect(res.status).toBe(201);
    const tx = await FundingTransaction.findByPk(res.body.transactionId);
    expect(tx?.turnoverMultiplier).toBe(1);
  });

  it.each([
    ['zero amount', '0'],
    ['negative amount', '-5'],
    ['not a number', 'abc'],
    ['number instead of string', 100.5],
    ['magnitude beyond DECIMAL(36,18)', '1000000000000000000'],
    ['more than 18 decimal places', '1.0000000000000000001'],
  ])('rejects %s', async (_label, amount) => {
    const { memberId } = await createMember();
    const res = await request(app).post('/deposits').send({ memberId, amount });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown member', async () => {
    const res = await request(app)
      .post('/deposits')
      .send({ memberId: '00000000-0000-4000-8000-000000000000', amount: '10.00' });
    expect(res.status).toBe(404);
  });
});
