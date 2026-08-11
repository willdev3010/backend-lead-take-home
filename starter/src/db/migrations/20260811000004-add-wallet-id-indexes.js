'use strict';

// Per-wallet scans (ledger reconciliation, transaction history) should not
// seq-scan; index the wallet_id foreign keys.
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('wallet_txs', ['wallet_id'], {
      name: 'wallet_txs_wallet_id_idx',
    });
    await queryInterface.addIndex('funding_transactions', ['wallet_id'], {
      name: 'funding_transactions_wallet_id_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('wallet_txs', 'wallet_txs_wallet_id_idx');
    await queryInterface.removeIndex('funding_transactions', 'funding_transactions_wallet_id_idx');
  },
};
