import test from "node:test";
import assert from "node:assert/strict";
import WalletService from "../src/application/use-cases/wallet.service.js";
import TransactionService from "../src/application/use-cases/transaction.service.js";
import { roleMiddleware } from "../src/presentation/middlewares/role.middleware.js";
import { authMiddleware } from "../src/presentation/middlewares/auth.middleware.js";
import JwtService from "../src/infrastructure/security/jwt.service.js";

const walletRows = new Map();
let referencedTransactions = 0;
const walletRepository = {
    async save(wallet) { const row = { ...wallet, id: walletRows.size + 1 }; walletRows.set(row.id, row); return row; },
    async findByUserId(userId) { return [...walletRows.values()].filter((w) => w.userId === userId); },
    async findById(id) { return walletRows.get(Number(id)) || null; },
    async countTransactions() { return referencedTransactions; },
    async delete(id) { walletRows.delete(Number(id)); }
};

test("wallets are validated, scoped to owner, and deletable only by owner", async () => {
    walletRows.clear();
    const service = new WalletService(walletRepository);
    const wallet = await service.create({ name: "Efectivo", type: "CASH" }, "alice");
    assert.equal(wallet.userId, "alice");
    assert.equal((await service.list("bob")).length, 0);
    await assert.rejects(() => service.delete(wallet.id, "bob"), /Forbidden/);
    await service.delete(wallet.id, "alice");
    assert.equal(walletRows.size, 0);
    await assert.rejects(() => service.create({ name: " " }, "alice"), /Name is required/);
});

test("a wallet referenced by transactions cannot be deleted", async () => {
    walletRows.clear();
    referencedTransactions = 1;
    const service = new WalletService(walletRepository);
    const wallet = await service.create({ name: "Cuenta vinculada" }, "alice");
    await assert.rejects(() => service.delete(wallet.id, "alice"), /cannot be deleted/);
    assert.equal(walletRows.has(wallet.id), true);
    referencedTransactions = 0;
});

function transactionService({ transaction, walletById = new Map() }) {
    const transactionRepository = {
        saved: null,
        async save(value) { this.saved = { ...value, id: 9 }; return this.saved; },
        async findById() { return transaction; },
        async findByUserId() { return []; }
    };
    const service = new TransactionService(
        transactionRepository,
        { async findByCodeAndDate(code, date) { return { _id: "rate", code, date, exchangeRate: 1 }; } },
        { async findById() { return { id: 2, type: "EXPENSE" }; } }, null, null,
        { async findById(id) { return walletById.get(Number(id)) || null; } }
    );
    return { service, transactionRepository };
}

test("old transaction payload without walletId remains valid and defaults private", async () => {
    const { service, transactionRepository } = transactionService({ walletById: new Map() });
    const result = await service.createTransaction({ type: "EXPENSE", amount: 10, categoryId: 2, userId: "alice", date: "2026-01-01" });
    assert.equal(result.walletId, null);
    assert.equal(transactionRepository.saved.isPrivate, true);
});

test("transaction accepts an owned wallet and rejects missing or foreign wallets", async () => {
    const wallets = new Map([[1, { id: 1, userId: "alice" }], [2, { id: 2, userId: "bob" }]]);
    const { service } = transactionService({ walletById: wallets });
    const base = { type: "EXPENSE", amount: 10, categoryId: 2, userId: "alice", date: "2026-01-01" };
    assert.equal((await service.createTransaction({ ...base, walletId: 1 })).walletId, 1);
    await assert.rejects(() => service.createTransaction({ ...base, walletId: 999 }), /Wallet not found/);
    await assert.rejects(() => service.createTransaction({ ...base, walletId: 2 }), /Wallet not found/);
});

test("public receipt hides private transactions and only returns permitted fields", async () => {
    const privateCase = transactionService({ transaction: { id: 1, isPrivate: true } });
    await assert.rejects(() => privateCase.service.getPublicReceipt(1), /private/);
    const publicCase = transactionService({ transaction: {
        id: 2, isPrivate: false, type: "INCOME", amount: 42, currency: "BOB", convertedAmount: 42,
        description: "Pago", date: "2026-01-01", categoryId: 3, walletId: null,
        userId: "secret-user", email: "private@example.test", password: "secret", token: "secret"
    } });
    const receipt = await publicCase.service.getPublicReceipt(2);
    assert.equal(receipt.id, 2);
    assert.equal("userId" in receipt, false);
    assert.equal("email" in receipt, false);
    assert.equal("password" in receipt, false);
    assert.equal("token" in receipt, false);
});

test("currency write middleware chain returns 401, 403, and admits admin", () => {
    process.env.JWT_SECRET = "test-only-secret";
    const run = (token) => {
        let status; let passed = false;
        const res = { status(code) { status = code; return this; }, json(body) { this.body = body; return this; } };
        const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
        authMiddleware(req, res, () => roleMiddleware(["admin"])(req, res, () => { passed = true; }));
        return { status, passed };
    };
    assert.deepEqual(run(undefined), { status: 401, passed: false });
    assert.deepEqual(run(JwtService.generateToken({ id: "user-1", role: "user" })), { status: 403, passed: false });
    assert.deepEqual(run(JwtService.generateToken({ id: "admin-1", role: "admin" })), { status: undefined, passed: true });
});

test("private route authentication returns 401 when token is absent", () => {
    process.env.JWT_SECRET = "test-only-secret";
    let status;
    const res = { status(code) { status = code; return this; }, json() { return this; } };
    authMiddleware({ headers: {} }, res, () => assert.fail("next must not run"));
    assert.equal(status, 401);
});
