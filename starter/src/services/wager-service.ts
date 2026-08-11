import { sequelize } from '../db/sequelize';
import { Wallet, WalletTx } from '../db/models';
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

// Debits the wallet and accrues turnover, all under the wallet row lock.
// Two concurrent wagers serialize on the lock, so the balance check always sees
// the latest balance and the wallet can never be overdrawn. The DB-level
// CHECK (balance >= 0) is the backstop if this ever regresses.
export async function placeWager(input: {
  walletId: string;
  amount: string;
}): Promise<{ balance: string }> {
  return sequelize.transaction(async (t) => {
    const wallet = await Wallet.findByPk(input.walletId, {
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (!wallet) {
      throw new WalletNotFoundError();
    }

    const amount = dec(input.amount);
    const balance = dec(wallet.balance);
    if (balance.isLessThan(amount)) {
      throw new InsufficientBalanceError(wallet.balance, input.amount);
    }

    const newBalance = balance.minus(amount);
    // Every wager counts toward the turnover requirement created by deposits.
    const newTurnoverAccrued = dec(wallet.turnoverAccrued).plus(amount);

    await wallet.update(
      {
        balance: newBalance.toString(),
        turnoverAccrued: newTurnoverAccrued.toString(),
      },
      { transaction: t },
    );
    await WalletTx.create(
      {
        walletId: wallet.id,
        fundingTxId: null,
        type: 'wager_debit',
        amount: amount.negated().toString(),
        balanceAfter: newBalance.toString(),
      },
      { transaction: t },
    );

    return { balance: toMoneyString(newBalance) };
  });
}
