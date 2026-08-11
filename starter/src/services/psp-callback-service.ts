import { sequelize } from '../db/sequelize';
import { FundingTransaction, Wallet, WalletTx } from '../db/models';
import { dec } from '../lib/money';

export type CallbackOutcome =
  | { outcome: 'completed' }
  | { outcome: 'failed' }
  | { outcome: 'duplicate' } // same terminal status delivered again - idempotent no-op
  | { outcome: 'conflict' } // contradicts an already-terminal status - rejected
  | { outcome: 'unknown_ref' }; // pspRef we never issued - acknowledged, not processed

// Handles a PSP callback with exactly-once semantics.
//
// Concurrency: the whole handler runs in one DB transaction that takes a row lock
// (SELECT ... FOR UPDATE) on the funding transaction. Two concurrent deliveries of
// the same callback serialize on that lock; the second one observes the terminal
// status and no-ops. Lock order is always funding transaction -> wallet, in every
// service that touches both, so deadlocks are impossible.
//
// Even if this locking ever regresses, the partial unique index on
// wallet_txs (funding_tx_id, type) makes the DB reject a second credit.
export async function handleCallback(input: {
  pspRef: string;
  status: 'completed' | 'failed';
  amount: string;
}): Promise<CallbackOutcome> {
  return sequelize.transaction(async (t) => {
    const fundingTx = await FundingTransaction.findOne({
      where: { pspRef: input.pspRef },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!fundingTx) {
      // A ref we never issued: misrouted, forged, or a systems mismatch. We acknowledge
      // (2xx at the route) so the PSP stops retrying, but never move money. Logged so
      // ops can investigate - a spike here is an incident signal.
      // eslint-disable-next-line no-console
      console.warn(`psp callback for unknown pspRef: ${input.pspRef}`);
      return { outcome: 'unknown_ref' };
    }

    if (fundingTx.type !== 'deposit') {
      // Unreachable today (withdrawals carry no pspRef yet), but if they ever do,
      // a 'completed' callback must not run the deposit path and credit the wallet.
      return { outcome: 'conflict' };
    }

    if (fundingTx.status !== 'Pending') {
      // Explicit state machine: Pending is the only state that accepts a transition.
      const sameOutcome =
        (fundingTx.status === 'Completed' && input.status === 'completed') ||
        (fundingTx.status === 'Failed' && input.status === 'failed');
      return sameOutcome ? { outcome: 'duplicate' } : { outcome: 'conflict' };
    }

    if (input.status === 'failed') {
      await fundingTx.update({ status: 'Failed' }, { transaction: t });
      return { outcome: 'failed' };
    }

    // Completed path. The callback amount is what actually arrived, so it is what we
    // credit; a difference from the requested amount is flagged for reconciliation
    // rather than rejected (PSP fees and short transfers are routine, and failing the
    // deposit would strand real money).
    const credited = dec(input.amount);
    const requested = dec(fundingTx.amount);

    const wallet = await Wallet.findByPk(fundingTx.walletId, {
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (!wallet) {
      throw new Error(`wallet ${fundingTx.walletId} missing for funding tx ${fundingTx.id}`);
    }

    const newBalance = dec(wallet.balance).plus(credited);
    const newTurnoverRequired = dec(wallet.turnoverRequired).plus(
      credited.times(fundingTx.turnoverMultiplier),
    );

    await fundingTx.update(
      {
        status: 'Completed',
        creditedAmount: credited.toString(),
        amountMismatch: !credited.isEqualTo(requested),
      },
      { transaction: t },
    );
    await wallet.update(
      {
        balance: newBalance.toString(),
        turnoverRequired: newTurnoverRequired.toString(),
      },
      { transaction: t },
    );
    await WalletTx.create(
      {
        walletId: wallet.id,
        fundingTxId: fundingTx.id,
        type: 'deposit_credit',
        amount: credited.toString(),
        balanceAfter: newBalance.toString(),
      },
      { transaction: t },
    );

    return { outcome: 'completed' };
  });
}
