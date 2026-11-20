import { DataTypes } from "sequelize";
import sequelize from "./connection.js";

export const WalletModel = sequelize.define("Wallet", {
    name: { type: DataTypes.STRING(100), allowNull: false },
    type: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "OTHER" },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "BOB" },
    description: { type: DataTypes.STRING(255), allowNull: true },
    userId: { type: DataTypes.STRING, allowNull: false }
}, { timestamps: true });

export default class WalletMySQLRepository {
    async save(wallet) { return (await WalletModel.create(wallet)).toJSON(); }
    async findByUserId(userId) { return WalletModel.findAll({ where: { userId }, order: [["id", "DESC"]] }); }
    async findById(id) { const row = await WalletModel.findByPk(id); return row?.toJSON() || null; }
    async countTransactions(walletId) {
        const { TransactionModel } = await import("./transaction.mysql.repository.js");
        return TransactionModel.count({ where: { walletId } });
    }
    async delete(id) { const row = await WalletModel.findByPk(id); if (!row) return false; await row.destroy(); return true; }
}
