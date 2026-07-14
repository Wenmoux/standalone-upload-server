/**
 * [INPUT]: 依赖 node:test、assert、Reader 账户领域服务及受控 PostgreSQL 事务替身
 * [OUTPUT]: 提供 CDK 原子消费、封禁登录、Telegram 注册幂等与奖励/邀请一致性回归断言
 * [POS]: tests 的 Reader 账户生命周期守卫，防止身份入口重新出现先查后写和越权初始状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createReaderAccountService } = require("../services/reader-account");

function serviceWith({ query, db }) {
    return createReaderAccountService({
        query,
        pool: { connect: async () => db },
        hashPassword: () => ({ salt: "salt", hash: "hash" }),
        verifyPassword: () => true,
        cdkDuration: (type) => (type === "7d" ? { type: "7d", days: 7 } : null),
        botUserSelect: () => "*",
        normalizeTelegramId: (value) => String(value || "").trim(),
        botUsernameForTelegram: (id) => `tg_${id}`,
        telegramLoginNickname: (payload) => payload.first_name || payload.username || `tg_${payload.id}`
    });
}

test("reader account registration locks and consumes its CDK in one transaction", async () => {
    const calls = [];
    const db = {
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (/SELECT \* FROM reader_cdks/.test(sql)) {
                return { rows: [{ id: 9, code: "CDK-ONE", cdk_type: "membership", duration_type: "7d" }] };
            }
            if (/SELECT id FROM reader_users/.test(sql)) return { rows: [] };
            if (/INSERT INTO reader_users/.test(sql)) return { rows: [{ id: 3, username: "reader", copper_coins: 0 }] };
            if (/UPDATE reader_cdks/.test(sql)) return { rows: [{ id: 9 }] };
            return { rows: [] };
        },
        release() {
            calls.push({ sql: "RELEASE", params: [] });
        }
    };
    const service = serviceWith({ query: db.query.bind(db), db });
    const user = await service.registerReaderWithCdk({
        username: "reader",
        password: "secret1",
        nickname: "Reader",
        cdkCode: "CDK-ONE"
    });

    assert.equal(user.id, 3);
    assert.ok(calls.some((call) => call.sql === "BEGIN"));
    assert.ok(calls.some((call) => /FOR UPDATE/.test(call.sql)));
    assert.ok(calls.some((call) => /used_by IS NULL AND used_at IS NULL/.test(call.sql)));
    assert.ok(calls.some((call) => call.sql === "COMMIT"));
    assert.ok(calls.some((call) => call.sql === "RELEASE"));
});

test("reader account registration rolls back when the locked CDK cannot be consumed", async () => {
    const calls = [];
    const db = {
        async query(sql) {
            calls.push(sql);
            if (/SELECT \* FROM reader_cdks/.test(sql)) {
                return { rows: [{ id: 9, code: "CDK-RACE", cdk_type: "membership", duration_type: "7d" }] };
            }
            if (/SELECT id FROM reader_users/.test(sql)) return { rows: [] };
            if (/INSERT INTO reader_users/.test(sql)) return { rows: [{ id: 4, username: "reader2" }] };
            if (/UPDATE reader_cdks/.test(sql)) return { rows: [] };
            return { rows: [] };
        },
        release() {}
    };
    const service = serviceWith({ query: db.query.bind(db), db });

    await assert.rejects(
        () => service.registerReaderWithCdk({ username: "reader2", password: "secret1", nickname: "R", cdkCode: "CDK-RACE" }),
        (error) => error.status === 409 && /CDK/.test(error.message)
    );
    assert.ok(calls.includes("ROLLBACK"));
    assert.equal(calls.includes("COMMIT"), false);
});

test("password login rejects banned users before refreshing the session projection", async () => {
    let updates = 0;
    const query = async (sql) => {
        if (/SELECT \*/.test(sql)) return { rows: [{ id: 5, username: "banned", is_banned: true, salt: "salt", password_hash: "hash" }] };
        updates += 1;
        return { rows: [] };
    };
    const db = { query, release() {} };
    const service = serviceWith({ query, db });

    await assert.rejects(
        () => service.loginReaderWithPassword({ username: "banned", password: "secret1" }),
        (error) => error.status === 403
    );
    assert.equal(updates, 0);
});

test("Telegram bot registration rewards and counts an invitation exactly once", async () => {
    const calls = [];
    let stored = null;
    const db = {
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (/INSERT INTO reader_users/.test(sql)) {
                if (stored) return { rows: [{ ...stored, account_inserted: false }] };
                stored = {
                    id: 11,
                    username: params[0],
                    nickname: params[3],
                    telegram_id: params[7],
                    telegram_username: params[8],
                    copper_coins: params[5],
                    silver_coins: params[6],
                    is_admin: false,
                    is_banned: false,
                    account_inserted: true
                };
                return { rows: [{ ...stored }] };
            }
            return { rows: [] };
        },
        release() {}
    };
    const service = serviceWith({ query: db.query.bind(db), db });
    const input = { telegramId: "42", telegramUsername: "reader42", nickname: "Reader", inviterTelegramId: "7" };

    const first = await service.registerBotUser(input);
    const repeated = await service.registerBotUser(input);

    assert.equal(first.existed, false);
    assert.equal(repeated.existed, true);
    assert.equal(first.user.copper_coins, 100);
    assert.equal(first.user.is_admin, false);
    assert.equal(calls.filter((call) => /INSERT INTO reader_transactions/.test(call.sql)).length, 1);
    assert.equal(calls.filter((call) => /invite_count/.test(call.sql)).length, 1);
});

test("Telegram user import is bounded, typed and committed as one batch", async () => {
    const calls = [];
    const db = {
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (/INSERT INTO reader_users/.test(sql)) return { rows: [{ inserted: true }] };
            return { rows: [] };
        },
        release() {}
    };
    const service = serviceWith({ query: db.query.bind(db), db });
    const result = await service.importBotUsers([
        {
            telegram_id: "81",
            username: "legacy_reader",
            copper_coins: "120",
            silver_coins: 5,
            sign_cycle_day: "3",
            is_admin: "false",
            is_banned: "0",
            created_at: "2026-07-01T01:02:03Z"
        },
        { nickname: "missing identity" }
    ]);

    assert.deepEqual(result, { imported: 1, updated: 0, skipped: 1 });
    const insert = calls.find((call) => /INSERT INTO reader_users/.test(call.sql));
    assert.equal(insert.params[6], 120);
    assert.equal(insert.params[12], false);
    assert.equal(insert.params[13], false);
    assert.ok(calls.some((call) => call.sql === "COMMIT"));

    await assert.rejects(
        () => service.importBotUsers([{ telegram_id: "82", copper_coins: "NaN" }]),
        (error) => error.status === 400 && /copper_coins/.test(error.message)
    );
    assert.ok(calls.some((call) => call.sql === "ROLLBACK"));
});
