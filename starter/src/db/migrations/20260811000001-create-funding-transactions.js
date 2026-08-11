'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('funding_transactions', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      wallet_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'wallets', key: 'id' },
      },
      type: { type: Sequelize.TEXT, allowNull: false },
      status: { type: Sequelize.TEXT, allowNull: false, defaultValue: 'Pending' },
      // Amount the member asked for. What actually arrived may differ; see credited_amount.
      amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      // Amount actually credited to the wallet on completion (source of truth: the PSP callback).
      credited_amount: { type: Sequelize.DECIMAL(36, 18), allowNull: true },
      // Opaque reference we hand to the PSP; the callback echoes it back. Null for withdrawals.
      psp_ref: { type: Sequelize.TEXT, allowNull: true, unique: true },
      turnover_multiplier: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      // Set when the callback amount differed from the requested amount - ops reconciliation flag.
      amount_mismatch: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    // The DB is the last line of defense for money: reject values the app should never write.
    await queryInterface.sequelize.query(`
      ALTER TABLE funding_transactions
        ADD CONSTRAINT funding_transactions_type_check
          CHECK (type IN ('deposit', 'withdrawal')),
        ADD CONSTRAINT funding_transactions_status_check
          CHECK (status IN ('Pending', 'Completed', 'Failed')),
        ADD CONSTRAINT funding_transactions_amount_positive_check
          CHECK (amount > 0),
        ADD CONSTRAINT funding_transactions_turnover_multiplier_check
          CHECK (turnover_multiplier >= 0);
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('funding_transactions');
  },
};
