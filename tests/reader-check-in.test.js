/**
 * [INPUT]: 依赖 node:test、assert、Reader 签到领域服务及受控 PostgreSQL 事务替身
 * [OUTPUT]: 提供签到奖励、周期、重复防护与流水回滚边界的自动化回归断言
 * [POS]: tests 的 Reader 签到原子性守卫，确保余额、经验、日期和流水不会部分提交
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createReaderCheckInService } = require("../services/reader-check-in");

function createDb({ signedToday = false, failTransaction = false } = {}) {
    const calls = [];
    let transactionCount = 0;
    const current = {
        id: 3,
        telegram_id: "42",
        copper_coins: 500,
        silver_coins: 20,
        scholar_exp: 90,
        sign_cycle_day: 6,
        is_banned: false
    };
    return {
        calls,
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (/SELECT[\s\S]*signed_today/.test(sql)) return { rows: [{ ...current, signed_today: signedToday }] };
            if (/UPDATE reader_users/.test(sql)) {
                return {
                    rows: [
                        {
                            ...current,
                            copper_coins: current.copper_coins + params[0],
                            silver_coins: current.silver_coins + params[1],
                            scholar_exp: current.scholar_exp + params[2],
                            sign_cycle_day: params[3]
                        }
                    ]
                };
            }
            if (/INSERT INTO reader_transactions/.test(sql)) {
                transactionCount += 1;
                if (failTransaction && transactionCount === 2) throw new Error("ledger unavailable");
            }
            return { rows: [] };
        },
        release() {
            calls.push({ sql: "RELEASE", params: [] });
        }
    };
}

function serviceWith(db) {
    return createReaderCheckInService({
        pool: { connect: async () => db },
        botUserSelect: () => "*",
        todayDateKey: () => "2026-07-15",
        signExpReward: () => 25,
        scholarProfile: (exp) => ({ level: Number(exp || 0) >= 100 ? 2 : 1, exp: Number(exp || 0) })
    });
}

test("Reader check-in settles seventh-day rewards and every ledger row in one transaction", async () => {
    const db = createDb();
    const result = await serviceWith(db).checkInUser({ telegramId: "42", source: "telegram_bot" });

    assert.deepEqual(result.reward, {
        copper: 100,
        silver: 100,
        exp: 25,
        day: 7,
        scholar: { level: 2, exp: 115 },
        level_up: true
    });
    assert.equal(db.calls.filter((call) => /INSERT INTO reader_transactions/.test(call.sql)).length, 3);
    assert.ok(db.calls.some((call) => /FOR UPDATE/.test(call.sql)));
    assert.ok(db.calls.some((call) => call.sql === "COMMIT"));
});

test("Reader check-in rejects an already signed day without changing balances", async () => {
    const db = createDb({ signedToday: true });
    await assert.rejects(
        () => serviceWith(db).checkInUser({ userId: 3, source: "reader" }),
        (error) => error.status === 409
    );
    assert.equal(
        db.calls.some((call) => /UPDATE reader_users/.test(call.sql)),
        false
    );
    assert.ok(db.calls.some((call) => call.sql === "ROLLBACK"));
});

test("Reader check-in rolls back the reward when any ledger insert fails", async () => {
    const db = createDb({ failTransaction: true });
    await assert.rejects(() => serviceWith(db).checkInUser({ telegramId: "42", source: "telegram_bot" }), /ledger unavailable/);
    assert.ok(db.calls.some((call) => call.sql === "ROLLBACK"));
    assert.equal(
        db.calls.some((call) => call.sql === "COMMIT"),
        false
    );
});
