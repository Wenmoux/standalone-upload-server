const assert = require("assert/strict");
const http = require("http");
const test = require("node:test");
const express = require("express");
const { createReviewGovernanceService } = require("../services/review-governance");
const { createReviewGovernanceRoutes } = require("../routes/review-governance");

function governanceDb() {
    const state = {
        users: new Map([
            [1, { id: 1, telegram_id: "100", is_banned: false }],
            [2, { id: 2, telegram_id: "200", is_banned: false }]
        ]),
        review: { id: 10, user_id: 1, book_id: "b1", content: "review", status: "published" },
        reports: [],
        appeals: []
    };
    const db = {
        async query(sql, params = []) {
            if (/^BEGIN|^COMMIT|^ROLLBACK/.test(sql)) return { rows: [] };
            if (/FROM reader_users WHERE id=/.test(sql)) return { rows: [state.users.get(Number(params[0]))].filter(Boolean) };
            if (/FROM reader_users WHERE telegram_id=/.test(sql)) return { rows: [...state.users.values()].filter((user) => user.telegram_id === String(params[0])) };
            if (/SELECT id, user_id, status FROM reader_book_reviews/.test(sql)) return { rows: Number(params[0]) === state.review.id ? [{ ...state.review }] : [] };
            if (/COUNT\(\*\)::int count FROM reader_book_review_reports WHERE reporter_user_id/.test(sql)) return { rows: [{ count: 0 }] };
            if (/INSERT INTO reader_book_review_reports/.test(sql)) {
                const row = { id: state.reports.length + 1, review_id: Number(params[0]), reporter_user_id: Number(params[1]), telegram_id: params[2], reason: params[3], details: params[4], status: "pending" };
                const existing = state.reports.find((item) => item.review_id === row.review_id && item.reporter_user_id === row.reporter_user_id);
                if (existing) Object.assign(existing, row, { id: existing.id });
                else state.reports.push(row);
                return { rows: [{ ...(existing || row) }] };
            }
            if (/COUNT\(DISTINCT reporter_user_id\)/.test(sql)) return { rows: [{ count: state.reports.filter((item) => item.review_id === Number(params[0]) && item.status === "pending").length }] };
            if (/UPDATE reader_book_reviews SET status='under_review'/.test(sql)) {
                state.review.status = "under_review";
                return { rows: [{ status: state.review.status }] };
            }
            if (/INSERT INTO reader_book_review_appeals/.test(sql)) {
                const row = { id: state.appeals.length + 1, review_id: Number(params[0]), appellant_user_id: Number(params[1]), telegram_id: params[2], content: params[3], status: "pending" };
                state.appeals.push(row);
                return { rows: [{ ...row }] };
            }
            throw new Error(`unexpected SQL: ${sql}`);
        },
        release() {}
    };
    return { state, db };
}

test("review reports are deduplicated and thresholded into automatic review", async () => {
    const { state, db } = governanceDb();
    const service = createReviewGovernanceService({ query: db.query.bind(db), pool: { connect: async () => db }, autoReviewThreshold: 1 });
    const result = await service.reportReview({ telegramId: "200", reviewId: 10, reason: "spam", details: "duplicate links" });
    assert.equal(result.report_count, 1);
    assert.equal(result.review_status, "under_review");
    assert.equal(state.review.status, "under_review");
    assert.equal(state.reports.length, 1);

    await assert.rejects(
        service.reportReview({ telegramId: "100", reviewId: 10, reason: "other" }),
        (error) => error.code === "REVIEW_SELF_REPORT" && error.status === 409
    );
});

test("only the author can appeal a hidden or under-review review", async () => {
    const { state, db } = governanceDb();
    state.review.status = "hidden";
    const service = createReviewGovernanceService({ query: db.query.bind(db), pool: { connect: async () => db } });
    const result = await service.appealReview({ telegramId: "100", reviewId: 10, content: "这是误判，请重新审核。" });
    assert.equal(result.appeal.status, "pending");
    await assert.rejects(
        service.appealReview({ telegramId: "200", reviewId: 10, content: "我想替作者申诉。" }),
        (error) => error.code === "REVIEW_APPEAL_NOT_AUTHOR" && error.status === 403
    );
});

async function withApp(router, callback) {
    const app = express();
    app.use(express.json());
    app.use(router);
    app.use((error, req, res, _next) => res.status(error.status || 500).json({ code: error.code, error: error.message }));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        await callback(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test("review governance routes preserve reader, bot and admin authorization boundaries", async () => {
    const calls = [];
    const service = {
        reportReview: async (input) => (calls.push(["report", input]), { success: true }),
        appealReview: async (input) => (calls.push(["appeal", input]), { success: true }),
        listUserAppeals: async (id) => ({ user_id: id, rows: [] }),
        listModeration: async (input) => ({ query: input, rows: [] }),
        resolveReport: async (input) => (calls.push(["resolve", input]), { success: true }),
        resolveAppeal: async () => ({ success: true })
    };
    const router = createReviewGovernanceRoutes({
        requireReader: (req, res, next) => req.get("X-Reader") === "1" ? next() : res.status(401).json({ error: "reader required" }),
        requireBotApi: (req, res, next) => req.get("X-Bot") === "1" ? next() : res.status(401).json({ error: "bot required" }),
        requireAdmin: (req, res, next) => req.get("X-Admin") === "1" ? (req.session = { admin: { id: 9 } }, next()) : res.status(401).json({ error: "admin required" }),
        currentReaderUser: async () => ({ id: 1 }),
        service
    });
    await withApp(router, async (base) => {
        assert.equal((await fetch(`${base}/reader-api/book-reviews/10/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "spam" }) })).status, 401);
        const reader = await fetch(`${base}/reader-api/book-reviews/10/report`, { method: "POST", headers: { "Content-Type": "application/json", "X-Reader": "1" }, body: JSON.stringify({ reason: "spam" }) });
        assert.equal(reader.status, 200);
        const admin = await fetch(`${base}/admin-api/review-moderation?kind=appeals`, { headers: { "X-Admin": "1" } });
        assert.equal(admin.status, 200);
        assert.equal((await admin.json()).query.kind, "appeals");
        assert.equal(calls[0][1].userId, 1);
    });
});
