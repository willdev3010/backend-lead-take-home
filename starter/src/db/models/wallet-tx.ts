import { DataTypes, Model, Sequelize } from 'sequelize';

export type WalletTxType = 'deposit_credit' | 'wager_debit' | 'withdrawal_debit';

// Append-only ledger. Rows are only ever inserted - never updated or deleted.
// The wallet balance must always equal the sum of `amount` for its entries.
export class WalletTx extends Model {
  declare id: string;
  declare walletId: string;
  declare fundingTxId: string | null;
  declare type: WalletTxType;
  // Signed: credits positive, debits negative. String per src/lib/money.ts convention.
  declare amount: string;
  declare balanceAfter: string;
}

export function initWalletTx(sequelize: Sequelize): void {
  WalletTx.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      walletId: { type: DataTypes.UUID, allowNull: false },
      fundingTxId: { type: DataTypes.UUID, allowNull: true },
      type: { type: DataTypes.TEXT, allowNull: false },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      balanceAfter: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
    },
    { sequelize, tableName: 'wallet_txs', underscored: true, updatedAt: false },
  );
}
