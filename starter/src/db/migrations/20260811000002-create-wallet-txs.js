'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('wallet_txs', {
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
      // Null for wagers; set for deposit credits and withdrawal debits.
      funding_tx_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'funding_transactions', key: 'id' },
      },
      type: { type: Sequelize.TEXT, allowNull: false },
      // Signed: credits positive, debits negative. The wallet balance is the sum of this column.
      amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      // Balance snapshot after applying this entry - makes audits and reconciliation O(1).
      balance_after: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE wallet_txs
        ADD CONSTRAINT wallet_txs_type_check
          CHECK (type IN ('deposit_credit', 'wager_debit', 'withdrawal_debit'));
    `);

    // Safety net against double-crediting a funding transaction: even if application
    // locking regresses, the DB refuses a second ledger entry of the same type for
    // the same funding transaction.
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX wallet_txs_funding_tx_type_unique
        ON wallet_txs (funding_tx_id, type)
        WHERE funding_tx_id IS NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('wallet_txs');
  },
};
