const assert = require("assert/strict");
const http = require("http");
const test = require("node:test");
const express = require("express");
const { createRankRoutes } = require("../routes/rank");

async function withApp(router, fn) {
    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function adminOnly(req, res, next) {
    if (req.get("X-Test-Admin") !== "1") return res.status(401).json({ error: "admin required" });
    next();
}

test("rank routes expose reader payload", async () => {
    const calls = [];
    const router = createRankRoutes({
        rankService: {
            readerPayload: async (query) => {
                calls.push(query);
                return { success: true, active: { sort: query.sort }, rows: [] };
            }
        },
        requireAdmin: adminOnly
    });

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/reader-api/rank?sort=cache&limit=5`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.success, true);
        assert.equal(body.active.sort, "cache");
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].limit, "5");
});

test("rank routes protect and warm admin status", async () => {
    const calls = [];
    const router = createRankRoutes({
        rankService: {
            cache: { payload: null, loading: null },
            getPayload: async (input) => {
                calls.push(input);
                return {};
            },
            statusPayload: () => ({ ready: true, sourceLimit: 10 })
        },
        requireAdmin: adminOnly
    });

    await withApp(router, async (base) => {
        const denied = await fetch(`${base}/admin-api/rank/status`);
        assert.equal(denied.status, 401);

        const response = await fetch(`${base}/admin-api/rank/status?limit=123`, { headers: { "X-Test-Admin": "1" } });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.ready, true);
        assert.equal(body.sourceLimit, 10);
    });

    assert.deepEqual(calls, [{ limit: "123" }]);
});

test("rank refresh route forces refresh and returns success", async () => {
    const calls = [];
    const router = createRankRoutes({
        rankService: {
            cache: { payload: {}, loading: null },
            getPayload: async (input) => {
                calls.push(input);
                return {};
            },
            statusPayload: () => ({ ready: true, sourceLimit: 20 })
        },
        requireAdmin: adminOnly
    });

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/admin-api/rank/refresh?limit=10`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ limit: 77 })
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.success, true);
        assert.equal(body.ready, true);
    });

    assert.deepEqual(calls, [{ refresh: true, limit: 77 }]);
});

test("rank refresh route can be tracked as a system job", async () => {
    const calls = [];
    const jobs = [];
    const router = createRankRoutes({
        rankService: {
            cache: { payload: {}, loading: null },
            getPayload: async (input) => {
                calls.push(input);
                return {};
            },
            statusPayload: () => ({ ready: true, sourceLimit: 30, bookCount: 12, at: "2026-06-05T00:00:00.000Z" })
        },
        requireAdmin: adminOnly,
        runTrackedJob: async (req, type, input, worker) => {
            jobs.push({ type, input });
            const payload = await worker({ id: 9 });
            return { ...payload, job: { id: 9, type, status: "succeeded" } };
        }
    });

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/admin-api/rank/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ limit: 33 })
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.success, true);
        assert.equal(body.job.id, 9);
        assert.deepEqual(body.jobResult, {
            success: true,
            ready: true,
            sourceLimit: 30,
            bookCount: 12,
            refreshedAt: "2026-06-05T00:00:00.000Z"
        });
    });

    assert.deepEqual(calls, [{ refresh: true, limit: 33 }]);
    assert.deepEqual(jobs, [{ type: "rank_refresh", input: { limit: 33 } }]);
});
