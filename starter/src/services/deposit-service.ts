import { randomUUID } from 'node:crypto';
import { FundingTransaction, Wallet } from '../db/models';

export class WalletNotFoundError extends Error {
  constructor() {
    super('wallet not found');
    this.name = 'WalletNotFoundError';
  }
}

// Creates the funding transaction only. No money moves until the PSP confirms
// via callback (see psp-callback-service) - the wallet and ledger stay untouched.
export async function createDeposit(input: {
  memberId: string;
  amount: string;
  turnoverMultiplier: number;
}): Promise<{ transactionId: string; pspRef: string }> {
  const wallet = await Wallet.findOne({ where: { memberId: input.memberId } });
  if (!wallet) {
    throw new WalletNotFoundError();
  }

  // Opaque reference handed to the PSP; the callback echoes it back and it is
  // unique-indexed, so it doubles as the idempotency key for callbacks.
  const pspRef = randomUUID();

  const tx = await FundingTransaction.create({
    walletId: wallet.id,
    type: 'deposit',
    status: 'Pending',
    amount: input.amount,
    pspRef,
    turnoverMultiplier: input.turnoverMultiplier,
  });

  return { transactionId: tx.id, pspRef };
}
