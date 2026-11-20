import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import mongoose from "mongoose";
import mysql from "mysql2/promise";
import UserModel from "../src/infrastructure/database/mongo/user.model.js";
import CurrencyModel from "../src/infrastructure/database/mongo/currency.model.js";
import HashService from "../src/infrastructure/security/hash.service.js";

const host = process.env.MYSQL_HOST;
const mongoUri = process.env.MONGO_URI || "";
const baseUrl = `http://127.0.0.1:${process.env.PORT || 3000}`;
if (!/^(localhost|127\.0\.0\.1)$/i.test(host || "") || !mongoUri.startsWith("mongodb://127.0.0.1:")) {
    throw new Error("Live verification only runs against explicitly local MySQL and MongoDB targets");
}
if (process.env.MYSQL_DB !== "bd_gastos") throw new Error("Live verification requires MYSQL_DB=bd_gastos");

const mysqlConfig = {
    host, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DB
};
const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const testEmails = [`taller8-user-${suffix}@example.test`, `taller8-admin-${suffix}@example.test`];
const rawPassword = randomBytes(24).toString("base64url");
let currencyCode;
const statuses = {};
let user1;
let admin;
let sql;
let currencyCreated = false;
let report;
let safeTestEmailSet = false;
let testDate;

async function call(path, { method = "GET", token, body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { "Content-Type": "application/json" } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: response.status, json };
}

async function expect(label, result, expected) {
    statuses[label] = result.status;
    assert.equal(result.status, expected, `${label}: expected HTTP ${expected}, got ${result.status}`);
    return result.json;
}

try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 3000 });
    sql = await mysql.createConnection({ ...mysqlConfig, connectTimeout: 3000 });

    assert.equal(await UserModel.countDocuments({ email: { $in: [...testEmails, `${testEmails[0]}-other`] } }), 0, "generated test emails must be unused");
    safeTestEmailSet = true;
    testDate = new Date().toISOString().slice(0, 10);
    do { currencyCode = `QZ${randomBytes(1).toString("hex").slice(0, 1).toUpperCase()}`; }
    while (await CurrencyModel.exists({ code: currencyCode, date: testDate }));

    const [mysqlVersion] = await sql.query("SELECT VERSION() AS version, DATABASE() AS databaseName");
    const mongoVersion = await mongoose.connection.db.admin().command({ buildInfo: 1 });
    assert.equal(mysqlVersion[0].databaseName, "bd_gastos");
    assert.equal(mongoose.connection.host, "127.0.0.1");

    await expect("health", await call("/api/v1/health"), 200);
    await expect("swagger", await call("/api-docs"), 200);

    await expect("register_user", await call("/api/v1/auth/register", {
        method: "POST", body: { name: "Taller8 test user", email: testEmails[0], password: rawPassword, role: "admin" }
    }), 201);
    user1 = await UserModel.findOne({ email: testEmails[0] });
    assert.ok(user1);
    assert.equal(user1.role, "user", "public registration must ignore an admin role request");

    await expect("register_second_user", await call("/api/v1/auth/register", {
        method: "POST", body: { name: "Taller8 second user", email: `${testEmails[0]}-other`, password: rawPassword }
    }), 201);
    const user2 = await UserModel.findOne({ email: `${testEmails[0]}-other` });
    assert.ok(user2);

    admin = await UserModel.create({
        name: "Taller8 local admin test", email: testEmails[1],
        password: await HashService.hash(rawPassword), role: "admin", baseCurrency: "BOB"
    });

    const userLogin = await expect("login_user", await call("/api/v1/auth/login", {
        method: "POST", body: { email: testEmails[0], password: rawPassword }
    }), 200);
    const user2Login = await expect("login_second_user", await call("/api/v1/auth/login", {
        method: "POST", body: { email: `${testEmails[0]}-other`, password: rawPassword }
    }), 200);
    const adminLogin = await expect("login_admin", await call("/api/v1/auth/login", {
        method: "POST", body: { email: testEmails[1], password: rawPassword }
    }), 200);
    const userToken = userLogin.token;
    const user2Token = user2Login.token;
    const adminToken = adminLogin.token;
    assert.ok(userToken && user2Token && adminToken);

    const [categories] = await sql.query("SELECT id FROM Categories WHERE type='EXPENSE' AND isDefault=1 ORDER BY id LIMIT 1");
    assert.ok(categories[0], "seeded expense category should exist");
    const categoryId = categories[0].id;

    const wallet = await expect("wallet_create", await call("/api/v1/wallets", {
        method: "POST", token: userToken, body: { name: "Taller 8 test wallet", type: "CASH", currency: "BOB" }
    }), 201);
    const userWallets = await expect("wallet_list_owner", await call("/api/v1/wallets", { token: userToken }), 200);
    const otherWallets = await expect("wallet_list_other_user", await call("/api/v1/wallets", { token: user2Token }), 200);
    assert.ok(userWallets.some((row) => row.id === wallet.id));
    assert.ok(!otherWallets.some((row) => row.id === wallet.id));
    await expect("wallet_delete_other_owner", await call(`/api/v1/wallets/${wallet.id}`, { method: "DELETE", token: user2Token }), 403);

    const txBase = { type: "EXPENSE", amount: 17.25, currency: "BOB", date: testDate, categoryId, description: "Taller 8 HTTP verification" };
    const noWalletTx = await expect("transaction_without_wallet", await call("/api/v1/transactions", {
        method: "POST", token: userToken, body: txBase
    }), 201);
    assert.equal(noWalletTx.walletId, null);

    const linkedPublicTx = await expect("transaction_with_wallet", await call("/api/v1/transactions", {
        method: "POST", token: userToken, body: { ...txBase, walletId: wallet.id, isPrivate: false }
    }), 201);
    assert.equal(Number(linkedPublicTx.walletId), Number(wallet.id));
    const privateTx = await expect("private_transaction", await call("/api/v1/transactions", {
        method: "POST", token: userToken, body: { ...txBase, description: "Private test receipt", isPrivate: true }
    }), 201);

    await expect("transaction_nonexistent_wallet", await call("/api/v1/transactions", {
        method: "POST", token: userToken, body: { ...txBase, walletId: 2147483000 }
    }), 400);
    const foreignWallet = await expect("second_wallet_create", await call("/api/v1/wallets", {
        method: "POST", token: user2Token, body: { name: "Second user's wallet", type: "BANK" }
    }), 201);
    await expect("transaction_foreign_wallet", await call("/api/v1/transactions", {
        method: "POST", token: userToken, body: { ...txBase, walletId: foreignWallet.id }
    }), 400);

    const updatedTx = await expect("transaction_update_wallet", await call(`/api/v1/transactions/${noWalletTx.id}`, {
        method: "PUT", token: userToken, body: { walletId: wallet.id }
    }), 200);
    assert.equal(Number(updatedTx.walletId), Number(wallet.id));
    const detachedTx = await expect("transaction_detach_wallet", await call(`/api/v1/transactions/${noWalletTx.id}`, {
        method: "PUT", token: userToken, body: { walletId: null }
    }), 200);
    assert.equal(detachedTx.walletId, null);

    const receipt = await expect("public_receipt", await call(`/api/v1/transactions/${linkedPublicTx.id}/public`), 200);
    assert.equal(receipt.id, linkedPublicTx.id);
    for (const forbidden of ["userId", "email", "password", "token"]) assert.equal(forbidden in receipt, false);
    await expect("private_receipt", await call(`/api/v1/transactions/${privateTx.id}/public`), 403);
    await expect("missing_receipt", await call("/api/v1/transactions/2147483000/public"), 404);
    await expect("private_transactions_without_jwt", await call("/api/v1/transactions"), 401);
    await expect("private_transactions_with_jwt", await call("/api/v1/transactions", { token: userToken }), 200);

    const currencyPayload = { code: currencyCode, name: "Temporary Taller 8 test currency", symbol: "T", exchangeRate: 1.25, date: testDate };
    await expect("currency_without_token", await call("/api/v1/currencies", { method: "POST", body: currencyPayload }), 401);
    await expect("currency_as_user", await call("/api/v1/currencies", { method: "POST", token: userToken, body: currencyPayload }), 403);
    await expect("currency_as_admin", await call("/api/v1/currencies", { method: "POST", token: adminToken, body: currencyPayload }), 201);
    currencyCreated = true;
    assert.ok(await CurrencyModel.findOne({ code: currencyCode, date: testDate }));

    const testIds = [String(user1._id), String(user2._id)];
    const [persisted] = await sql.query(
        "SELECT (SELECT COUNT(*) FROM Wallets WHERE userId IN (?,?)) AS wallets, (SELECT COUNT(*) FROM Transactions WHERE userId IN (?,?)) AS transactions",
        [...testIds, ...testIds]
    );
    assert.ok(persisted[0].wallets >= 2);
    assert.ok(persisted[0].transactions >= 3);

    const [schema] = await sql.query("SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Transactions' AND COLUMN_NAME IN ('walletId','isPrivate') ORDER BY COLUMN_NAME");
    assert.deepEqual(schema.map((row) => row.COLUMN_NAME).sort(), ["isPrivate", "walletId"]);
    assert.equal(schema.find((row) => row.COLUMN_NAME === "walletId").IS_NULLABLE, "YES");
    assert.equal(String(schema.find((row) => row.COLUMN_NAME === "isPrivate").COLUMN_DEFAULT).toLowerCase(), "1");
    const [fk] = await sql.query("SELECT rc.DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS rc JOIN information_schema.KEY_COLUMN_USAGE k ON rc.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE rc.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME='Transactions' AND k.COLUMN_NAME='walletId'");
    assert.ok(fk.some((row) => row.DELETE_RULE === "RESTRICT"));
    await expect("wallet_delete_with_transaction", await call(`/api/v1/wallets/${wallet.id}`, { method: "DELETE", token: userToken }), 409);

    const unusedWallet = await expect("unused_wallet_create", await call("/api/v1/wallets", {
        method: "POST", token: userToken, body: { name: "Unused temporary wallet" }
    }), 201);
    await expect("wallet_delete_owner", await call(`/api/v1/wallets/${unusedWallet.id}`, { method: "DELETE", token: userToken }), 200);

    report = {
        passed: true, httpChecks: Object.keys(statuses).length, statuses, mysqlVersion: mysqlVersion[0].version,
        mongoVersion: mongoVersion.version, database: "bd_gastos",
        persistedRowsBeforeCleanup: persisted[0], migrationColumns: schema,
        walletForeignKeyDeleteRule: fk[0].DELETE_RULE,
        publicReceiptKeys: Object.keys(receipt).sort(),
        registrationRoleEscalationPrevented: user1.role === "user"
    };
} finally {
    if (sql && (user1 || admin)) {
        const ids = [user1?._id, (await UserModel.findOne({ email: `${testEmails[0]}-other` }))?._id, admin?._id].filter(Boolean).map(String);
        if (ids.length) {
            await sql.query("DELETE FROM Audits WHERE userId IN (?)", [ids]);
            await sql.query("DELETE FROM Transactions WHERE userId IN (?)", [ids]);
            await sql.query("DELETE FROM Wallets WHERE userId IN (?)", [ids]);
        }
    }
    if (currencyCreated) await CurrencyModel.deleteOne({ code: currencyCode, date: testDate });
    if (safeTestEmailSet) await UserModel.deleteMany({ email: { $in: testEmails.concat(`${testEmails[0]}-other`) } });
    if (sql) await sql.end();
    if (mongoose.connection.readyState) await mongoose.disconnect();
    if (report) {
        report.recordedAt = new Date().toISOString();
        report.temporaryRecordsCleaned = true;
        const evidenceDir = resolve("docs/evidencias");
        await mkdir(evidenceDir, { recursive: true });
        await writeFile(resolve(evidenceDir, "verificacion-local.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
        console.log("LIVE_VERIFICATION_RESULT", JSON.stringify(report));
    }
}
