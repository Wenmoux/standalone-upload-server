/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供货币、签到、兑换、红包与幂等账本的自动化回归断言
 * [POS]: tests 的货币、签到、兑换、红包与幂等账本守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
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
        export_extra_quota: 2,
        scholar_exp: 0,
        is_banned: false
    };
    const usage = new Map();
    const extraUsage = new Map();
    const operationLedger = new Map();
    const transactions = new Map();
    let usageSequence = 0;
    let transactionSequence = 0;
    const cdks = new Map([
        ["CDK-QUOTA", { id: 10, code: "CDK-QUOTA", cdk_type: "export_quota", export_quota: 3 }]
    ]);
    const db = {
        calls,
        user,
        usage,
        operationLedger,
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [] };
            if (/FROM reader_operation_ledger/.test(sql)) {
                const row = operationLedger.get(params[0]);
                return { rows: row ? [row] : [] };
            }
            if (/INSERT INTO reader_operation_ledger/.test(sql)) {
                const row = {
                    id: operationLedger.size + 1,
                    idempotency_key: params[0],
                    operation_scope: params[1],
                    operation_type: params[2],
                    user_id: params[3],
                    telegram_id: params[4],
                    result_json: JSON.parse(params[5]),
                    created_at: "now"
                };
                operationLedger.set(params[0], row);
                return { rows: [row] };
            }
            if (/SELECT \* FROM reader_transactions WHERE id/.test(sql)) {
                const row = transactions.get(Number(params[0]));
                return { rows: row ? [row] : [] };
            }
            if (/INSERT INTO reader_transactions/.test(sql)) {
                const row = {
                    id: ++transactionSequence,
                    amount: params[4],
                    balance: params[5],
                    currency: params[3],
                    type: params[2],
                    operation_key: params[8] || ""
                };
                transactions.set(row.id, row);
                return { rows: [row] };
            }
            if (/COUNT\(\*\)::int count FROM reader_transactions/.test(sql)) return { rows: [{ count: 1 }] };
            if (/FROM reader_transactions t/.test(sql)) return { rows: [{ id: 10, type: "spend" }] };
            if (/UPDATE reader_users/.test(sql) && /export_extra_quota = GREATEST/.test(sql)) {
                if (user.export_extra_quota <= 0) return { rows: [] };
                user.export_extra_quota -= 1;
                return { rows: [{ ...user }] };
            }
            if (/UPDATE reader_users/.test(sql) && /export_extra_quota = COALESCE/.test(sql)) {
                user.export_extra_quota += Number(params[0] || 0);
                return { rows: [{ ...user }] };
            }
            if (/UPDATE reader_users/.test(sql) && /SET\s+copper_coins/.test(sql)) {
                const amount = Number(params[0] || 0);
                if (/GREATEST\(0,[\s\S]*\+ \$1/.test(sql)) user.copper_coins = Math.max(0, user.copper_coins + amount);
                else {
                    if (user.copper_coins < amount) return { rows: [] };
                    user.copper_coins -= amount;
                }
                if (params[2]) user.export_unlocked_at = "now";
                return { rows: [{ ...user }] };
            }
            if (/FROM reader_cdks/.test(sql)) {
                const row = cdks.get(params[0]);
                return { rows: row ? [row] : [] };
            }
            if (/UPDATE reader_cdks SET used_by/.test(sql)) {
                for (const row of cdks.values()) {
                    if (row.id === params[1]) {
                        row.used_by = params[0];
                        row.used_at = "now";
                    }
                }
                return { rows: [] };
            }
            if (/SELECT id, telegram_id/.test(sql) || /SELECT \*/.test(sql) || /FROM reader_users WHERE telegram_id/.test(sql)) {
                return { rows: [user] };
            }
            if (/COUNT\(DISTINCT book_id\)::int count/.test(sql)) {
                return { rows: [{ count: usage.size }] };
            }
            if (/SELECT id FROM reader_export_usage/.test(sql)) {
                const store = /charge_type='extra_quota'|charge_type = 'extra_quota'/.test(sql) ? extraUsage : usage;
                return { rows: store.has(params[2]) ? [{ id: store.get(params[2]) }] : [] };
            }
            if (/FROM reader_export_usage/.test(sql) && /charge_type = 'extra_quota'/.test(sql)) {
                return { rows: extraUsage.has(params[2]) ? [{ id: extraUsage.get(params[2]), "?column?": 1 }] : [] };
            }
            if (/SELECT 1\s+FROM reader_export_usage/.test(sql)) {
                return { rows: usage.has(params[2]) ? [{ id: usage.get(params[2]), "?column?": 1 }] : [] };
            }
            if (/INSERT INTO reader_export_usage/.test(sql) && /'extra_quota'/.test(sql)) {
                if (!extraUsage.has(params[2])) extraUsage.set(params[2], ++usageSequence);
                return { rows: [{ id: extraUsage.get(params[2]) }] };
            }
            if (/INSERT INTO reader_export_usage/.test(sql)) {
                if (!usage.has(params[2])) usage.set(params[2], ++usageSequence);
                return { rows: [{ id: usage.get(params[2]) }] };
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
        botUserSelect: () => "id, telegram_id, copper_coins, silver_coins, export_extra_quota, scholar_exp, is_banned",
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
    assert.equal(status.limit, 2);
    assert.equal(status.remaining, 2);
    assert.equal(status.extra_remaining, 2);
});

test("user currency service claims extra export quota and redeems quota cdk", async () => {
    const db = createMockDb();
    const service = serviceWith(db);

    const claimed = await service.claimExtraExportQuota({ telegramId: "100", bookId: "b9", format: "epub" });
    assert.equal(claimed.usage.charge_type, "extra_quota");
    assert.equal(claimed.usage.repeated, false);
    assert.equal(claimed.user.export_extra_quota, 1);

    const repeated = await service.claimExtraExportQuota({ telegramId: "100", bookId: "b9", format: "epub" });
    assert.equal(repeated.usage.repeated, true);
    assert.equal(repeated.user.export_extra_quota, 1);

    const redeemed = await service.redeemExportQuotaCdk({ telegramId: "100", code: "cdk-quota" });
    assert.equal(redeemed.cdk.export_quota, 3);
    assert.equal(redeemed.user.export_extra_quota, 4);
});

test("currency settlement replays without charging twice after a worker retry", async () => {
    const db = createMockDb();
    const service = serviceWith(db);
    const input = {
        telegramId: "100",
        currency: "copper",
        amount: 120,
        type: "export_txt_fee",
        idempotencyKey: "system-job:42:export-settlement",
        idempotencyScope: "export-settlement",
        idempotencyData: { book_id: "b42", format: "txt" }
    };

    const first = await service.spendUserCurrency(input);
    const replayed = await service.spendUserCurrency(input);

    assert.equal(first.repeated, false);
    assert.equal(replayed.repeated, true);
    assert.equal(db.user.copper_coins, 180);
    assert.equal(db.calls.filter((call) => /INSERT INTO reader_transactions/.test(call.sql)).length, 1);
    assert.equal(db.operationLedger.size, 1);
});

test("share reward adjustment is exactly once for a persistent job operation", async () => {
    const db = createMockDb();
    const service = serviceWith(db);
    const input = {
        telegramId: "100",
        currency: "copper",
        delta: 1000,
        type: "po18_bookshelf_share_reward",
        idempotencyKey: "system-job:77:po18-share-reward:b77",
        idempotencyScope: "po18-share-reward",
        idempotencyData: { book_id: "b77" }
    };

    const first = await service.adjustUserCurrency(input);
    const replayed = await service.adjustUserCurrency(input);

    assert.equal(first.repeated, false);
    assert.equal(replayed.repeated, true);
    assert.equal(db.user.copper_coins, 1300);
    assert.equal(db.calls.filter((call) => /INSERT INTO reader_transactions/.test(call.sql)).length, 1);
});

test("a retry replays the settlement strategy already chosen by the first attempt", async () => {
    const db = createMockDb();
    db.usage.set("already-used", 1);
    const service = serviceWith(db);
    const common = {
        telegramId: "100",
        bookId: "b2",
        format: "epub",
        idempotencyKey: "system-job:88:export-settlement",
        idempotencyScope: "export-settlement"
    };

    await assert.rejects(() => service.claimDailyFreeExport(common), /daily free export quota used/);
    const extra = await service.claimExtraExportQuota(common);
    const replayed = await service.claimDailyFreeExport(common);

    assert.equal(extra.usage.kind, "extra_quota");
    assert.equal(replayed.usage.kind, "extra_quota");
    assert.equal(replayed.usage.settlement_replayed, true);
    assert.equal(db.user.export_extra_quota, 1);
});

test("idempotency keys cannot be reused for a different export format", async () => {
    const db = createMockDb();
    const service = serviceWith(db);
    const first = {
        telegramId: "100",
        bookId: "b1",
        format: "txt",
        idempotencyKey: "system-job:99:export-settlement",
        idempotencyScope: "export-settlement"
    };
    await service.claimDailyFreeExport(first);
    await assert.rejects(
        () => service.claimDailyFreeExport({ ...first, format: "epub" }),
        (error) => error?.status === 409 && error?.code === "IDEMPOTENCY_CONFLICT"
    );
});
