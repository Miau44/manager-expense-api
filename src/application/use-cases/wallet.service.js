import WalletEntity from "../../domain/entities/wallet.entity.js";

export default class WalletService {
    constructor(walletRepository) { this.walletRepository = walletRepository; }
    async create(data, userId) {
        if (typeof data.name !== "string" || !data.name.trim() || data.name.trim().length > 100) throw new Error("Name is required and must be at most 100 characters");
        const type = data.type || "OTHER";
        if (!["CASH", "BANK", "CARD", "OTHER"].includes(type)) throw new Error("Invalid wallet type");
        const currency = (data.currency || "BOB").toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a 3-letter code");
        return this.walletRepository.save(new WalletEntity({ ...data, type, currency, userId }));
    }
    list(userId) { return this.walletRepository.findByUserId(userId); }
    async delete(id, userId) {
        const wallet = await this.walletRepository.findById(id);
        if (!wallet) throw new Error("Wallet not found");
        if (String(wallet.userId) !== String(userId)) throw new Error("Forbidden: wallet belongs to another user");
        if (await this.walletRepository.countTransactions(id)) throw new Error("Wallet has transactions and cannot be deleted");
        await this.walletRepository.delete(id);
        return { message: "Wallet deleted successfully" };
    }
}
