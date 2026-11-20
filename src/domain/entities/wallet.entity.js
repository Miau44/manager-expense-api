export default class WalletEntity {
    constructor({ id, name, type = "OTHER", currency = "BOB", description = null, userId }) {
        this.id = id;
        this.name = name.trim();
        this.type = type;
        this.currency = currency.toUpperCase();
        this.description = description?.trim() || null;
        this.userId = userId;
    }
}
