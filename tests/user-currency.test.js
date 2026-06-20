const assert = require("assert/strict");
const test = require("node:test");
const { createUserCurrencyService } = require("../services/user-currency");

function createMockDb() {
    const calls = [];
    const user = {
        id: 1,
        telegram_id: "100",
        copper_coins: 300,
        silver_coins: 50,
        scholar_exp: 0,
        is_banned: false
    };
    const usage = new Set();
    const db = {
        calls,
        user,
        usage,
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [] };
            if (/INSERT INTO reader_transactions/.test(sql)) {
                return { rows: [{ id: calls.length, amount: params[4], balance: params[5], currency: params[3], type: params[2] }] };
            }
            if (/COUNT\(\*\)::int count FROM reader_transactions/.test(sql)) return { rows: [{ count: 1 }] };
            if (/FROM reader_transactions t/.test(sql)) return { rows: [{ id: 10, type: "spend" }] };
            if (/UPDATE reader_users/.test(sql) && /copper_coins/.test(sql)) {
                const cost = Number(params[0] || 0);
                if (user.copper_coins < cost) return { rows: [] };
                user.copper_coins -= cost;
                if (params[2]) user.export_unlocked_at = "now";
                return { rows: [{ ...user }] };
            }
            if (/SELECT id, telegram_id/.test(sql) || /SELECT \*/.test(sql) || /FROM reader_users WHERE telegram_id/.test(sql)) {
                return { rows: [user] };
            }
            if (/COUNT\(DISTINCT book_id\)::int count/.test(sql)) {
                return { rows: [{ count: usage.size }] };
            }
            if (/SELECT 1\s+FROM reader_export_usage/.test(sql)) {
                return { rows: usage.has(params[2]) ? [{ "?column?": 1 }] : [] };
            }
            if (/INSERT INTO reader_export_usage/.test(sql)) {
                usage.add(params[2]);
                return { rows: [] };
            }
            return { rows: [] };
        },
        release() {
            calls.push({ sql: "RELEASE", params: [] });
        }
    };
    return db;
}

function serviceWith(db, scholarProfile = () => ({ level: 2, name: "L2", daily_free_exports: 2 })) {
    return createUserCurrencyService({
        query: db.query.bind(db),
        pool: { connect: async () => db },
        normalizeTelegramId: (value) => String(value || "").trim(),
        botUserSelect: () => "id, telegram_id, copper_coins, silver_coins, scholar_exp, is_banned",
        todayDateKey: () => "2026-06-05",
        scholarProfile,
        currencyLabel: (currency) => currency
    });
}

test("user currency service records and lists transactions", async () => {
    const db = createMockDb();
    const service = serviceWith(db);

    const tx = await service.recordTransaction({
        userId: 1,
        telegramId: " 100 ",
        type: "bonus",
        currency: "silver",
        amount: 12,
        balance: 62,
        detail: "detail",
        source: "test"
    });
    assert.equal(tx.currency, "silver");
    assert.equal(tx.amount, 12);

    const list = await service.listTransactions({ telegramId: "100", limit: 20, offset: 0, currency: "silver" });
    assert.equal(list.total, 1);
    assert.deepEqual(list.rows, [{ id: 10, type: "spend" }]);
    assert.ok(db.calls.some((call) => /t.currency =/.test(call.sql)));
});

test("user currency service spends currency in a transaction", async () => {
    const db = createMockDb();
    const service = serviceWith(db);

    const result = await service.spendUserCurrency({
        telegramId: "100",
        currency: "copper",
        amount: 120,
        type: "export",
        detail: "export test"
    });

    assert.equal(result.amount, 120);
    assert.equal(result.user.copper_coins, 180);
    assert.equal(result.transaction.amount, -120);
    assert.ok(db.calls.some((call) => call.sql === "COMMIT"));
    assert.ok(db.calls.some((call) => call.sql === "RELEASE"));
});

test("user currency service reports and claims daily free export quota", async () => {
    const db = createMockDb();
    const service = serviceWith(db);

    const before = await service.dailyFreeExportStatus(db.user, db, "b1");
    assert.equal(before.limit, 1);
    assert.equal(before.used, 0);
    assert.equal(before.available, true);

    const claimed = await service.claimDailyFreeExport({ telegramId: "100", bookId: "b1", format: "txt" });
    assert.equal(claimed.usage.book_id, "b1");
    assert.equal(claimed.usage.repeated, false);
    assert.equal(claimed.usage.used, 1);

    const repeated = await service.claimDailyFreeExport({ telegramId: "100", bookId: "b1", format: "txt" });
    assert.equal(repeated.usage.repeated, true);
    assert.equal(repeated.usage.used, 1);

    await assert.rejects(
        () => service.claimDailyFreeExport({ telegramId: "100", bookId: "b2", format: "epub" }),
        /daily free export quota used: 1\/1/
    );
});

test("user currency service keeps higher level free export quota", async () => {
    const db = createMockDb();
    const service = serviceWith(db, () => ({ level: 3, name: "L3", daily_free_exports: 3 }));

    const status = await service.dailyFreeExportStatus(db.user, db, "b1");
    assert.equal(status.limit, 3);
    assert.equal(status.remaining, 3);
});
