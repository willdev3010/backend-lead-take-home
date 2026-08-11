import request from 'supertest';
import { Express } from 'express';

// Shared flows for wallet tests: member -> deposit -> completed callback.

export async function createMemberWithWallet(app: Express, username = 'alice01') {
  const res = await request(app).post('/members').send({ username });
  return { memberId: res.body.member.id as string, walletId: res.body.wallet.id as string };
}

export async function createDeposit(
  app: Express,
  memberId: string,
  amount: string,
  turnoverMultiplier = 1,
) {
  const res = await request(app)
    .post('/deposits')
    .send({ memberId, amount, turnoverMultiplier });
  return { transactionId: res.body.transactionId as string, pspRef: res.body.pspRef as string };
}

export async function completeDeposit(
  app: Express,
  memberId: string,
  amount: string,
  turnoverMultiplier = 1,
) {
  const deposit = await createDeposit(app, memberId, amount, turnoverMultiplier);
  await request(app)
    .post('/psp/callbacks')
    .send({ pspRef: deposit.pspRef, status: 'completed', amount });
  return deposit;
}

export async function getBalance(app: Express, memberId: string): Promise<string> {
  const res = await request(app).get(`/members/${memberId}/wallet`);
  return res.body.balance as string;
}
