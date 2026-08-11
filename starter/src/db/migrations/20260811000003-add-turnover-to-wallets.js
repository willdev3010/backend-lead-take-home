'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Denormalized turnover counters. Both are updated in the same transaction as the
    // balance change that causes them, so they stay reconstructible from the ledger
    // and funding_transactions. Kept on the wallet row for an O(1) withdrawal check.
    await queryInterface.addColumn('wallets', 'turnover_required', {
      type: Sequelize.DECIMAL(36, 18),
      allowNull: false,
      defaultValue: '0',
    });
    await queryInterface.addColumn('wallets', 'turnover_accrued', {
      type: Sequelize.DECIMAL(36, 18),
      allowNull: false,
      defaultValue: '0',
    });

    // A wallet must never go negative, no matter what the application does.
    await queryInterface.sequelize.query(`
      ALTER TABLE wallets
        ADD CONSTRAINT wallets_balance_non_negative_check CHECK (balance >= 0);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE wallets DROP CONSTRAINT wallets_balance_non_negative_check;
    `);
    await queryInterface.removeColumn('wallets', 'turnover_accrued');
    await queryInterface.removeColumn('wallets', 'turnover_required');
  },
};
