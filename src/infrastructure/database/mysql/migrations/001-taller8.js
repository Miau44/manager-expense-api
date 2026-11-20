import sequelize from "../connection.js";

// Idempotent additive migration. Existing transactions become private by default.
const addColumnIfMissing = async (table, column, definition) => {
    const [rows] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE '${column}'`);
    if (rows.length === 0) await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
};

export async function up() {
    await sequelize.query(`CREATE TABLE IF NOT EXISTS Wallets (
        id INTEGER NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL, type VARCHAR(30) NOT NULL DEFAULT 'OTHER',
        currency VARCHAR(3) NOT NULL DEFAULT 'BOB', description VARCHAR(255) NULL,
        userId VARCHAR(255) NOT NULL, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL,
        INDEX wallets_user_id (userId)
    ) ENGINE=InnoDB`);
    await addColumnIfMissing("Transactions", "walletId", "INTEGER NULL");
    await addColumnIfMissing("Transactions", "isPrivate", "BOOLEAN NOT NULL DEFAULT TRUE");
    const [constraints] = await sequelize.query("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Transactions' AND COLUMN_NAME = 'walletId' AND REFERENCED_TABLE_NAME = 'Wallets'");
    if (constraints.length === 0) await sequelize.query("ALTER TABLE Transactions ADD CONSTRAINT transactions_wallet_fk FOREIGN KEY (walletId) REFERENCES Wallets(id) ON DELETE RESTRICT ON UPDATE CASCADE");
    const [indexes] = await sequelize.query("SHOW INDEX FROM Transactions WHERE Key_name = 'transactions_wallet_id'");
    if (indexes.length === 0) await sequelize.query("CREATE INDEX transactions_wallet_id ON Transactions (walletId)");
}

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
    await up();
    console.log("Taller 8 migration completed");
    await sequelize.close();
}
