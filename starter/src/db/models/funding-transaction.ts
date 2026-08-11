import { DataTypes, Model, Sequelize } from 'sequelize';

export type FundingTransactionType = 'deposit' | 'withdrawal';
export type FundingTransactionStatus = 'Pending' | 'Completed' | 'Failed';

export class FundingTransaction extends Model {
  declare id: string;
  declare walletId: string;
  declare type: FundingTransactionType;
  declare status: FundingTransactionStatus;
  // DECIMAL comes back from the pg driver as a string. Keep it that way; see src/lib/money.ts.
  declare amount: string;
  declare creditedAmount: string | null;
  declare pspRef: string | null;
  declare turnoverMultiplier: number;
  declare amountMismatch: boolean;
}

export function initFundingTransaction(sequelize: Sequelize): void {
  FundingTransaction.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      walletId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.TEXT, allowNull: false },
      status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'Pending' },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      creditedAmount: { type: DataTypes.DECIMAL(36, 18), allowNull: true },
      pspRef: { type: DataTypes.TEXT, allowNull: true, unique: true },
      turnoverMultiplier: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      amountMismatch: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    { sequelize, tableName: 'funding_transactions', underscored: true },
  );
}
