/**
 * [INPUT]: 依赖 node:test、assert 与 book-crowd 领域服务及受控 PostgreSQL 替身
 * [OUTPUT]: 提供书籍反馈、众筹榜单、服务端成本、重复支持与事务回滚自动化回归断言
 * [POS]: tests 的轻互动与众筹聚合根守卫，锁定银币扣款、流水和支持记录的原子一致性
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createBookCrowdService } = require("../services/book-crowd");

const normalizeTelegramId = (value) => String(value || "").trim();
const botUserSelect = () => "id, telegram_id, silver_coins, is_banned";

test("book crowd service normalizes feedback and reads counters", async () => {
    const calls = [];
    const service = createBookCrowdService({
        normalizeTelegramId,
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            if (/reader_book_feedback/.test(sql)) return { rows: [{ like_count: 2, dislike_count: 1, feedback_users: 3 }] };
            return { rows: [] };
        }
    });

    assert.equal(service.normalizeFeedback("LIKE"), "like");
    assert.equal(service.normalizeFeedback("不喜欢"), "dislike");
    assert.equal(service.normalizeFeedback("other"), "");
    assert.deepEqual(await service.bookFeedbackCounts("b1"), { like_count: 2, dislike_count: 1, feedback_users: 3 });
    assert.equal(calls[0].params[0], "b1");
});

test("book crowd service builds bounded summaries and falls back from an invalid configured cost", async () => {
    const calls = [];
    const service = createBookCrowdService({
        normalizeTelegramId,
        crowdVoteCost: Number.NaN,
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            if (/SELECT m\.book_id/.test(sql)) return { rows: [{ book_id: params[0], supporter_count: 4, supported_by_me: true }] };
            if (/COUNT\(DISTINCT book_id\)::int book_count/.test(sql)) {
                return { rows: [{ book_count: 2, vote_count: 5, total_silver: "99" }] };
            }
            return { rows: [{ book_id: "b2", rank: 1, supporter_count: 4 }] };
        }
    });

    assert.equal(service.crowdVoteCost, 100);
    const summary = await service.bookCrowdSummary("b1", " 100 ");
    assert.equal(summary.book_id, "b1");
    assert.equal(calls[0].params[1], "100");
    const leaderboard = await service.crowdLeaderboard(500, " 100 ");
    assert.equal(calls[1].params[0], 50);
    assert.equal(calls[1].params[1], "100");
    assert.equal(leaderboard.rows[0].book_id, "b2");
    assert.deepEqual(
        { books: leaderboard.total_books, votes: leaderboard.total_votes, silver: leaderboard.total_silver },
        { books: 2, votes: 5, silver: 99 }
    );
});

test("book feedback rejects banned users before writing interaction data", async () => {
    let writes = 0;
    const service = createBookCrowdService({
        normalizeTelegramId,
        botUserSelect,
        query: async (sql) => {
            if (/FROM reader_users/.test(sql)) return { rows: [{ id: 1, telegram_id: "100", is_banned: true }] };
            if (/INSERT/.test(sql)) writes += 1;
            return { rows: [] };
        }
    });
    await assert.rejects(
        service.createBookFeedback({ telegramId: "100", bookId: "b1", feedback: "like" }),
        (error) => error.status === 403 && /banned/.test(error.message)
    );
    assert.equal(writes, 0);
});

function crowdDatabase({ silver = 150, failTransaction = false } = {}) {
    const state = {
        user: { id: 1, telegram_id: "100", silver_coins: silver, is_banned: false },
        vote: null,
        transactions: []
    };
    let snapshot = null;
    const client = {
        async query(sql, params = []) {
            if (sql === "BEGIN") {
                snapshot = structuredClone(state);
                return { rows: [] };
            }
            if (sql === "COMMIT") {
                snapshot = null;
                return { rows: [] };
            }
            if (sql === "ROLLBACK") {
                if (snapshot) Object.assign(state, structuredClone(snapshot));
                snapshot = null;
                return { rows: [] };
            }
            if (/FROM reader_users WHERE telegram_id/.test(sql)) return { rows: [{ ...state.user }] };
            if (/FROM book_metadata/.test(sql)) return { rows: [{ book_id: "b1", title: "Book One" }] };
            if (/SELECT id, vote_cost\s+FROM reader_book_crowd_votes/.test(sql)) {
                return { rows: state.vote ? [{ ...state.vote }] : [] };
            }
            if (/UPDATE reader_users/.test(sql)) {
                const cost = Number(params[0]);
                if (state.user.silver_coins < cost) return { rows: [] };
                state.user.silver_coins -= cost;
                return { rows: [{ ...state.user }] };
            }
            if (/INSERT INTO reader_book_crowd_votes/.test(sql)) {
                state.vote = { id: 1, user_id: state.user.id, book_id: params[2], vote_cost: Number(params[3]) };
                return { rows: [] };
            }
            if (/INSERT INTO reader_transactions/.test(sql)) {
                if (failTransaction) throw new Error("transaction insert failed");
                state.transactions.push({ amount: Number(params[2]), balance: Number(params[3]) });
                return { rows: [] };
            }
            if (/SELECT m\.book_id/.test(sql)) {
                return { rows: [{ book_id: "b1", supporter_count: state.vote ? 1 : 0, supported_by_me: !!state.vote }] };
            }
            if (/SELECT r\.rank/.test(sql)) return { rows: state.vote ? [{ rank: 1, book_id: "b1" }] : [] };
            if (/COUNT\(DISTINCT book_id\)::int book_count/.test(sql)) {
                return {
                    rows: [{ book_count: state.vote ? 1 : 0, vote_count: state.vote ? 1 : 0, total_silver: state.vote?.vote_cost || 0 }]
                };
            }
            throw new Error(`unexpected query: ${sql}`);
        },
        release() {}
    };
    return { state, pool: { connect: async () => client }, query: client.query.bind(client) };
}

test("crowd support charges once and duplicate requests preserve the settled balance", async () => {
    const database = crowdDatabase();
    const service = createBookCrowdService({ ...database, normalizeTelegramId, botUserSelect, crowdVoteCost: 100 });
    const first = await service.createCrowdVote({ telegramId: "100", bookId: "b1" });
    assert.equal(first.already_exists, false);
    assert.equal(database.state.user.silver_coins, 50);
    assert.equal(database.state.transactions.length, 1);
    const repeated = await service.createCrowdVote({ telegramId: "100", bookId: "b1" });
    assert.equal(repeated.already_exists, true);
    assert.equal(database.state.user.silver_coins, 50);
    assert.equal(database.state.transactions.length, 1);
});

test("crowd support rolls back balance and vote when the transaction ledger fails", async () => {
    const database = crowdDatabase({ failTransaction: true });
    const service = createBookCrowdService({ ...database, normalizeTelegramId, botUserSelect, crowdVoteCost: 100 });
    await assert.rejects(service.createCrowdVote({ telegramId: "100", bookId: "b1" }), /transaction insert failed/);
    assert.equal(database.state.user.silver_coins, 150);
    assert.equal(database.state.vote, null);
    assert.equal(database.state.transactions.length, 0);
});

test("crowd support rejects insufficient silver without leaving a vote", async () => {
    const database = crowdDatabase({ silver: 99 });
    const service = createBookCrowdService({ ...database, normalizeTelegramId, botUserSelect, crowdVoteCost: 100 });
    await assert.rejects(
        service.createCrowdVote({ telegramId: "100", bookId: "b1" }),
        (error) => error.status === 409 && /银币不足/.test(error.message)
    );
    assert.equal(database.state.user.silver_coins, 99);
    assert.equal(database.state.vote, null);
});
