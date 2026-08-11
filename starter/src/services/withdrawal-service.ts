import { sequelize } from '../db/sequelize';
import { FundingTransaction, Wallet, WalletTx } from '../db/models';
import { dec, toMoneyString } from '../lib/money';

export class WalletNotFoundError extends Error {
  constructor() {
    super('wallet not found');
    this.name = 'WalletNotFoundError';
  }
}

export class InsufficientBalanceError extends Error {
  constructor(
    public readonly balance: string,
    public readonly requested: string,
  ) {
    super('insufficient balance');
    this.name = 'InsufficientBalanceError';
  }
}

export class TurnoverNotMetError extends Error {
  constructor(
    public readonly requiredTurnover: string,
    public readonly accruedTurnover: string,
    public readonly outstanding: string,
  ) {
    super('turnover requirement not met');
    this.name = 'TurnoverNotMetError';
  }
}

// Anti-abuse control: a member may only withdraw once their accrued turnover
// (sum of wagers) covers the requirement created by their deposits
// (sum of credited amount x multiplier). The check and the debit run under the
// same wallet lock, so a concurrent wager cannot slip between them.
//
// A valid withdrawal debits the wallet immediately and leaves a Pending funding
// transaction for human approval - approval itself is out of scope.
export async function requestWithdrawal(input: {
  memberId: string;
  amount: string;
}): Promise<{ transactionId: string; balance: string }> {
  return sequelize.transaction(async (t) => {
    const unlocked = await Wallet.findOne({ where: { memberId: input.memberId }, transaction: t });
    if (!unlocked) {
      throw new WalletNotFoundError();
    }
    // Re-fetch under lock by PK: FOR UPDATE + the member unique index is fine,
    // but locking by primary key keeps the lock acquisition explicit and ordered.
    const wallet = await Wallet.findByPk(unlocked.id, { lock: t.LOCK.UPDATE, transaction: t });
    if (!wallet) {
      throw new WalletNotFoundError();
    }

    const required = dec(wallet.turnoverRequired);
    const accrued = dec(wallet.turnoverAccrued);
    if (accrued.isLessThan(required)) {
      // Tell the client exactly how much turnover is still outstanding so the
      // player sees progress instead of a bare rejection.
      throw new TurnoverNotMetError(
        required.toString(),
        accrued.toString(),
        required.minus(accrued).toString(),
      );
    }

    const amount = dec(input.amount);
    const balance = dec(wallet.balance);
    if (balance.isLessThan(amount)) {
      throw new InsufficientBalanceError(wallet.balance, input.amount);
    }

    const newBalance = balance.minus(amount);
    const fundingTx = await FundingTransaction.create(
      {
        walletId: wallet.id,
        type: 'withdrawal',
        status: 'Pending',
        amount: amount.toString(),
        // No pspRef yet - it would be assigned when the approved withdrawal is
        // actually sent to a PSP, which is out of scope here.
        pspRef: null,
      },
      { transaction: t },
    );

    await wallet.update({ balance: newBalance.toString() }, { transaction: t });
    await WalletTx.create(
      {
        walletId: wallet.id,
        fundingTxId: fundingTx.id,
        type: 'withdrawal_debit',
        amount: amount.negated().toString(),
        balanceAfter: newBalance.toString(),
      },
      { transaction: t },
    );

    return { transactionId: fundingTx.id, balance: toMoneyString(newBalance) };
  });
}
