const assert = require("assert/strict");
const http = require("http");
const test = require("node:test");
const express = require("express");
const { createBotApiRoutes } = require("../routes/bot-api");

async function withApp(router, fn) {
    const app = express();
    app.use(express.json());
    app.use(router);
    app.use((err, req, res, next) => {
        res.status(err.status || 500).json({ error: err.message || String(err) });
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function botOnly(req, res, next) {
    if (req.get("X-Test-Bot") !== "1") return res.status(401).json({ error: "bot token required" });
    next();
}

test("bot api routes expose health behind bot middleware", async () => {
    const router = createBotApiRoutes({ requireBotApi: botOnly });

    await withApp(router, async (base) => {
        const blocked = await fetch(`${base}/bot-api/health`);
        assert.equal(blocked.status, 401);

        const ok = await fetch(`${base}/bot-api/health`, { headers: { "X-Test-Bot": "1" } });
        assert.equal(ok.status, 200);
        assert.deepEqual(await ok.json(), { ok: true });
    });
});

test("bot api routes delegate user and hot keyword handlers", async () => {
    const calls = [];
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        findBotUserByTelegramId: async (telegramId) => ({ id: 7, telegram_id: telegramId, username: `tg_${telegramId}` }),
        botPublicUser: (user) => user ? ({ id: user.id, telegram_id: user.telegram_id }) : null,
        getHotKeywords: async (limit) => {
            calls.push({ getHotKeywords: Number(limit) });
            return [{ keyword: "alpha", count: 2 }];
        },
        addHotKeyword: async (keyword, type, resultCount) => {
            calls.push({ addHotKeyword: keyword, type, resultCount });
            return { keyword, type, result_count: resultCount };
        }
    });

    await withApp(router, async (base) => {
        const user = await fetch(`${base}/bot-api/users/42`, { headers: { "X-Test-Bot": "1" } });
        assert.deepEqual(await user.json(), { user: { id: 7, telegram_id: "42" } });

        const keywords = await fetch(`${base}/bot-api/hot-keywords?limit=3`, { headers: { "X-Test-Bot": "1" } });
        assert.deepEqual((await keywords.json()).rows, [{ keyword: "alpha", count: 2 }]);

        const added = await fetch(`${base}/bot-api/hot-keywords`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ keyword: "beta", type: "search", resultCount: 5 })
        });
        assert.equal(added.status, 200);
        assert.equal((await added.json()).row.keyword, "beta");
    });

    assert.deepEqual(calls, [
        { getHotKeywords: 3 },
        { addHotKeyword: "beta", type: "search", resultCount: 5 },
        { getHotKeywords: 20 }
    ]);
});

test("bot api routes expose word cloud payload behind bot middleware", async () => {
    const calls = [];
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        wordCloudPayload: async (options) => {
            calls.push(options);
            return { rows: [{ text: "修仙", weight: 100 }], sources: { hot_keywords: 1, tags: 1 } };
        }
    });

    await withApp(router, async (base) => {
        const blocked = await fetch(`${base}/bot-api/word-cloud?limit=3`);
        assert.equal(blocked.status, 401);

        const ok = await fetch(`${base}/bot-api/word-cloud?limit=3&sourceLimit=50&platform=qidian`, {
            headers: { "X-Test-Bot": "1" }
        });
        assert.equal(ok.status, 200);
        assert.deepEqual((await ok.json()).rows, [{ text: "修仙", weight: 100 }]);
    });

    assert.deepEqual(calls, [{ limit: "3", hotLimit: undefined, sourceLimit: "50", platform: "qidian" }]);
});

test("bot api routes record no-result search requests", async () => {
    const calls = [];
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        normalizeTelegramId: (value) => String(value || ""),
        findBotUserByTelegramId: async (telegramId) => ({ id: 7, telegram_id: telegramId, username: `tg_${telegramId}` }),
        query: async (sql, params) => {
            calls.push({ sql, params });
            if (/INSERT INTO reader_search_requests/.test(sql)) {
                return { rows: [{ id: 3, user_id: params[0], telegram_id: params[1], query: params[4], platform: params[7] }] };
            }
            return { rows: [] };
        }
    });

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/bot-api/search-requests`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ telegram_id: 42, query: "不存在的书", platform: "po18", type: "search" })
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.success, true);
        assert.equal(body.already_exists, false);
        assert.equal(body.request.query, "不存在的书");
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].params[0], 7);
    assert.equal(calls[0].params[7], "po18");
});

test("bot api user routes validate currency mutation input", async () => {
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        normalizeTelegramId: (value) => String(value || ""),
        botUserSelect: () => "id, telegram_id, copper_coins, silver_coins",
        botPublicUser: (user) => user,
        query: async () => {
            throw new Error("query should not run for invalid input");
        },
        recordTransaction: async () => null
    });

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/bot-api/users/42/currency`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ delta: "abc" })
        });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: "delta must be a finite integer" });
    });
});

test("bot api user routes claim extra export quota and redeem cdk", async () => {
    const calls = [];
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        botPublicUser: (user) => user,
        claimExtraExportQuota: async (payload) => {
            calls.push(["claim", payload]);
            return { user: { telegram_id: payload.telegramId, export_extra_quota: 1 }, usage: { charge_type: "extra_quota", extra_remaining: 1 } };
        },
        redeemExportQuotaCdk: async (payload) => {
            calls.push(["redeem", payload]);
            return { user: { telegram_id: payload.telegramId, export_extra_quota: 6 }, cdk: { code: String(payload.code).toUpperCase(), export_quota: 5 } };
        }
    });

    await withApp(router, async (base) => {
        const claim = await fetch(`${base}/bot-api/users/42/export-extra-claim`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ book_id: "b1", format: "txt" })
        });
        assert.equal(claim.status, 200);
        assert.equal((await claim.json()).usage.charge_type, "extra_quota");

        const redeem = await fetch(`${base}/bot-api/users/42/redeem-cdk`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ code: "cdk-quota" })
        });
        assert.equal(redeem.status, 200);
        const body = await redeem.json();
        assert.equal(body.cdk.export_quota, 5);
        assert.equal(body.user.export_extra_quota, 6);
    });

    assert.deepEqual(calls.map((call) => call[0]), ["claim", "redeem"]);
    assert.equal(calls[0][1].bookId, "b1");
    assert.equal(calls[1][1].code, "cdk-quota");
});

test("bot api routes let bot tasks create and update system jobs", async () => {
    const calls = [];
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        createSystemJob: async (payload) => {
            calls.push({ create: payload });
            return { id: 9, type: payload.type, status: "queued", progress: 0 };
        },
        getSystemJob: async (id) => ({ id, type: "bot_export_txt", status: "queued", progress: 0 }),
        updateSystemJob: async (id, patch) => {
            calls.push({ update: id, patch });
            return { id, type: "bot_export_txt", status: patch.status || "running", progress: patch.progress ?? 0 };
        }
    });

    await withApp(router, async (base) => {
        const blocked = await fetch(`${base}/bot-api/jobs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "bot_export_txt" })
        });
        assert.equal(blocked.status, 401);

        const created = await fetch(`${base}/bot-api/jobs`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({
                type: "bot_export_txt",
                input: { telegram_id: "42", book_id: "b1" },
                created_by: "telegram:42"
            })
        });
        assert.equal(created.status, 200);
        assert.equal((await created.json()).job.id, 9);

        const found = await fetch(`${base}/bot-api/jobs/9`, { headers: { "X-Test-Bot": "1" } });
        assert.equal(found.status, 200);
        assert.equal((await found.json()).job.status, "queued");

        const updated = await fetch(`${base}/bot-api/jobs/9`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ status: "succeeded", progress: 100, result: { ok: true }, finished: true })
        });
        assert.equal(updated.status, 200);
        assert.equal((await updated.json()).job.status, "succeeded");

        const invalid = await fetch(`${base}/bot-api/jobs/9`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ status: "done" })
        });
        assert.equal(invalid.status, 400);
    });

    assert.deepEqual(calls, [
        {
            create: {
                type: "bot_export_txt",
                input: { telegram_id: "42", book_id: "b1" },
                createdBy: "telegram:42"
            }
        },
        {
            update: 9,
            patch: { status: "succeeded", progress: 100, result: { ok: true }, finished: true }
        }
    ]);
});

test("bot api routes expose audit writer behind bot middleware", async () => {
    const rows = [];
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        recordBotAuditLog: async (payload) => {
            rows.push(payload);
            return { id: 12, command: payload.command, status: payload.status };
        }
    });

    await withApp(router, async (base) => {
        const blocked = await fetch(`${base}/bot-api/audit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: "/search" })
        });
        assert.equal(blocked.status, 401);

        const ok = await fetch(`${base}/bot-api/audit`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ command: "/search", status: "succeeded" })
        });
        assert.equal(ok.status, 200);
        assert.deepEqual(await ok.json(), { success: true, row: { id: 12, command: "/search", status: "succeeded" } });
    });

    assert.deepEqual(rows, [{ command: "/search", status: "succeeded" }]);
});
