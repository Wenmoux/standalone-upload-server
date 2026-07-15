/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供 Bot API 账户、任务、红包、书评操作键、社交和书库路由契约的自动化回归断言
 * [POS]: tests 的 Bot API 组合与协议映射守卫，防止子域拆分、错误状态、可信来源或幂等键透传静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const http = require("http");
const test = require("node:test");
const { botJobPatch } = require("../routes/bot-api-system");
const express = require("express");
const { createBotApiRoutes } = require("../routes/bot-api");
const { createCredentialCrypto } = require("../services/credential-crypto");

async function withApp(router, fn) {
    const app = express();
    app.use(express.json());
    app.use(router);
    app.use((err, req, res, _next) => {
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

test("bot job updates require worker fencing after a lease claim", () => {
    assert.throws(
        () => botJobPatch({ status: "queued", progress: 0 }),
        (err) => err.status === 409
    );
    assert.throws(
        () => botJobPatch({ status: "running", started: true }),
        (err) => err.status === 409
    );
    assert.throws(
        () => botJobPatch({ status: "succeeded", finished: true, worker_id: "worker-a" }),
        (err) => err.status === 400
    );
    assert.deepEqual(botJobPatch({ status: "succeeded", progress: 100, finished: true, worker_id: "worker-a", attempt: 2 }), {
        status: "succeeded",
        progress: 100,
        finished: true,
        workerId: "worker-a",
        attempt: 2
    });
});

test("bot job update route reports lost lease ownership", async () => {
    const router = createBotApiRoutes({ requireBotApi: botOnly, updateSystemJob: async () => null });
    await withApp(router, async (base) => {
        const response = await fetch(`${base}/bot-api/jobs/7`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ status: "succeeded", finished: true, worker_id: "worker-a", attempt: 2 })
        });
        assert.equal(response.status, 409);
        assert.match((await response.json()).error, /ownership lost/);
    });
});

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

test("bot broadcast routes require a registered administrator and page eligible recipients", async () => {
    const jobs = [];
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        findBotUserByTelegramId: async (id) => ({ telegram_id: String(id), is_admin: String(id) === "42", is_banned: false }),
        createSystemJob: async (input) => {
            jobs.push(input);
            return { id: 9, status: "queued" };
        },
        registeredUserRecipients: async (input) => ({ rows: [{ id: 3, telegram_id: "300" }], has_more: false, input })
    });
    await withApp(router, async (base) => {
        const forbidden = await fetch(`${base}/bot-api/broadcasts`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ telegram_id: "7", message: "hello" })
        });
        assert.equal(forbidden.status, 403);
        const created = await fetch(`${base}/bot-api/broadcasts`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ telegram_id: "42", chat_id: "42", message: "hello" })
        });
        assert.equal(created.status, 200);
        assert.equal((await created.json()).job.id, 9);
        const recipients = await fetch(`${base}/bot-api/broadcasts/recipients?after_id=2&limit=50`, { headers: { "X-Test-Bot": "1" } });
        const payload = await recipients.json();
        assert.equal(payload.rows[0].telegram_id, "300");
        assert.equal(payload.input.afterId, "2");
    });
    assert.equal(jobs[0].type, "bot_registered_user_broadcast");
    assert.equal(jobs[0].maxAttempts, 1);
});

test("bot job routes list and cancel only the telegram user's own jobs", async () => {
    const calls = [];
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        listSystemJobs: async (filters) => {
            calls.push({ list: filters });
            return { rows: [{ id: 7, created_by: "telegram:42" }], total: 1, page: 1, limit: 8 };
        },
        getSystemJob: async () => ({ id: 7, status: "running", created_by: "telegram:42", input_json: { telegram_id: "42" } }),
        cancelSystemJob: async (id, options) => {
            calls.push({ cancel: { id, options } });
            return { id, status: "running", cancel_requested_at: "now" };
        }
    });

    await withApp(router, async (base) => {
        const listed = await fetch(`${base}/bot-api/jobs?telegram_id=42`, { headers: { "X-Test-Bot": "1" } });
        assert.equal(listed.status, 200);
        assert.equal((await listed.json()).rows[0].id, 7);
        assert.equal(calls[0].list.createdBy, "telegram:42");

        const forbidden = await fetch(`${base}/bot-api/jobs/7/cancel`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ telegram_id: "99" })
        });
        assert.equal(forbidden.status, 403);

        const canceled = await fetch(`${base}/bot-api/jobs/7/cancel`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ telegram_id: "42" })
        });
        assert.equal(canceled.status, 200);
        assert.equal((await canceled.json()).job.cancel_requested_at, "now");
    });
});

test("bot PO18 credential endpoint decrypts secrets without changing the status endpoint", async () => {
    const credentialCrypto = createCredentialCrypto({ fallbackSecret: "bot-credential-test" });
    const stored = {
        account: "reader-account",
        password: credentialCrypto.encryptString("reader-password"),
        cookies_json: credentialCrypto.encryptJson([{ name: "authtoken1", value: "cookie-value" }]),
        updated_at: "2026-07-11T00:00:00.000Z",
        last_login_at: null,
        last_status: "ok"
    };
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        credentialCrypto,
        findBotUserByTelegramId: async () => ({ id: 7, telegram_id: "42" }),
        query: async () => ({ rows: [stored] })
    });
    await withApp(router, async (base) => {
        const status = await fetch(`${base}/bot-api/users/42/po18`, { headers: { "X-Test-Bot": "1" } });
        const statusPayload = await status.json();
        assert.equal(Object.prototype.hasOwnProperty.call(statusPayload, "password"), false);
        assert.equal(statusPayload.cookies[0].value, "cookie-value");

        const credentials = await fetch(`${base}/bot-api/users/42/po18/credentials`, { headers: { "X-Test-Bot": "1" } });
        const credentialPayload = await credentials.json();
        assert.equal(credentialPayload.account, "reader-account");
        assert.equal(credentialPayload.password, "reader-password");
        assert.equal(credentialPayload.cookies[0].value, "cookie-value");
    });
});

test("bot api routes delegate user and hot keyword handlers", async () => {
    const calls = [];
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        findBotUserByTelegramId: async (telegramId) => ({ id: 7, telegram_id: telegramId, username: `tg_${telegramId}` }),
        botPublicUser: (user) => (user ? { id: user.id, telegram_id: user.telegram_id } : null),
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

    assert.deepEqual(calls, [{ getHotKeywords: 3 }, { addHotKeyword: "beta", type: "search", resultCount: 5 }, { getHotKeywords: 20 }]);
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

test("bot user registration and sign-in ignore client-controlled privilege and reward fields", async () => {
    const calls = [];
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        normalizeTelegramId: (value) => String(value || "").trim(),
        botUsernameForTelegram: (id) => `tg_${id}`,
        botPublicUser: (user) => user,
        registerBotUser: async (input) => {
            calls.push(["register", input]);
            return { existed: false, user: { id: 1, telegram_id: input.telegramId, copper_coins: 100, is_admin: false } };
        },
        checkInUser: async (input) => {
            calls.push(["sign", input]);
            return {
                user: { id: 1, telegram_id: input.telegramId, copper_coins: 200 },
                reward: { copper: 100, silver: 0, exp: 10, day: 1 }
            };
        }
    });

    await withApp(router, async (base) => {
        const registered = await fetch(`${base}/bot-api/users/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ telegram_id: "42", nickname: "Reader", is_admin: true, copper: 999999999, silver: 999999999 })
        });
        assert.equal(registered.status, 200);
        const registration = await registered.json();
        assert.equal(registration.user.is_admin, false);
        assert.equal(registration.user.copper_coins, 100);

        const signed = await fetch(`${base}/bot-api/users/42/sign`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ copper: 999999999, silver: 999999999, exp: 999999999 })
        });
        assert.equal(signed.status, 200);
        assert.equal((await signed.json()).reward.copper, 100);
    });

    assert.deepEqual(calls[0], ["register", { telegramId: "42", telegramUsername: "", nickname: "Reader", inviterTelegramId: "" }]);
    assert.deepEqual(calls[1], ["sign", { telegramId: "42", source: "telegram_bot" }]);
});

test("bot currency rewards require settlement identity and event rows cannot forge balances", async () => {
    const calls = [];
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        normalizeTelegramId: (value) => String(value || "").trim(),
        botPublicUser: (user) => user,
        botUserSelect: () => "id, telegram_id, copper_coins",
        findBotUserByTelegramId: async (telegramId) => ({ id: 1, telegram_id: telegramId, copper_coins: 300 }),
        adjustUserCurrency: async (input) => {
            calls.push(["currency", input]);
            return { user: { id: 1, telegram_id: input.telegramId, copper_coins: 400 }, transaction: null };
        },
        recordTransaction: async (input) => {
            calls.push(["event", input]);
            return { id: 9, ...input };
        }
    });

    await withApp(router, async (base) => {
        const reward = await fetch(`${base}/bot-api/users/42/currency`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ delta: 100, type: "po18_bookshelf_share_reward" })
        });
        assert.equal(reward.status, 400);
        assert.match((await reward.json()).error, /idempotency_key/);

        const forged = await fetch(`${base}/bot-api/users/42/transactions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ amount: 999, currency: "silver", source: "admin", type: "fake" })
        });
        assert.equal(forged.status, 400);

        const event = await fetch(`${base}/bot-api/users/42/transactions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ amount: 0, currency: "silver", source: "admin", type: "export_epub" })
        });
        assert.equal(event.status, 200);
    });

    assert.equal(
        calls.some((call) => call[0] === "currency"),
        false
    );
    const eventCall = calls.find((call) => call[0] === "event")[1];
    assert.equal(eventCall.amount, 0);
    assert.equal(eventCall.currency, "copper");
    assert.equal(eventCall.source, "telegram_bot");
});

test("bot api user routes claim extra export quota and redeem cdk", async () => {
    const calls = [];
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        botPublicUser: (user) => user,
        claimExtraExportQuota: async (payload) => {
            calls.push(["claim", payload]);
            return {
                user: { telegram_id: payload.telegramId, export_extra_quota: 1 },
                usage: { charge_type: "extra_quota", extra_remaining: 1 }
            };
        },
        redeemExportQuotaCdk: async (payload) => {
            calls.push(["redeem", payload]);
            return {
                user: { telegram_id: payload.telegramId, export_extra_quota: 6 },
                cdk: { code: String(payload.code).toUpperCase(), export_quota: 5 }
            };
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

    assert.deepEqual(
        calls.map((call) => call[0]),
        ["claim", "redeem"]
    );
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
            body: JSON.stringify({
                status: "succeeded",
                progress: 100,
                result: { ok: true },
                finished: true,
                worker_id: "worker-a",
                attempt: 1
            })
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
            patch: {
                status: "succeeded",
                progress: 100,
                result: { ok: true },
                finished: true,
                workerId: "worker-a",
                attempt: 1
            }
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

test("bot api domain routes map red-packet replay and expiry semantics", async () => {
    const createCalls = [];
    const claimCalls = [];
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        botPublicUser: (user) => (user ? { id: user.id } : null),
        createRedPacket: async (input) => {
            createCalls.push(input);
            if (input.totalAmount === "bad") {
                throw Object.assign(new Error("invalid total_amount"), { status: 400, code: "INVALID_AMOUNT" });
            }
            return { repeated: true, packet: { id: 9 }, sender: { id: 1 }, target: null, claim: null };
        },
        claimRedPacket: async (input) => {
            claimCalls.push(input);
            return { expired: true, refunded: 88, currency: "copper", packet: { id: 9, status: "expired" } };
        }
    });
    await withApp(router, async (base) => {
        const created = await fetch(`${base}/bot-api/red-packets`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({
                sender_telegram_id: "100",
                chat_id: "chat-a",
                total_amount: 10,
                total_count: 2,
                idempotency_key: "telegram:red-packet:chat-a:7"
            })
        });
        assert.equal(created.status, 200);
        assert.equal((await created.json()).repeated, true);
        assert.equal(createCalls[0].idempotencyKey, "telegram:red-packet:chat-a:7");

        const invalid = await fetch(`${base}/bot-api/red-packets`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ total_amount: "bad" })
        });
        assert.equal(invalid.status, 400);
        assert.equal((await invalid.json()).code, "INVALID_AMOUNT");

        const expired = await fetch(`${base}/bot-api/red-packets/claim`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ telegram_id: "200", chat_id: "chat-a", packet_id: 9 })
        });
        assert.equal(expired.status, 410);
        const payload = await expired.json();
        assert.equal(payload.code, "RED_PACKET_EXPIRED");
        assert.equal(payload.refunded, 88);
        assert.equal(claimCalls[0].packetId, 9);
    });
});

test("bot social routes force trusted review provenance", async () => {
    const reviews = [];
    const votes = [];
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        botPublicUser: (user) => user || null,
        createBookReview: async (input) => {
            reviews.push(input);
            return {
                cost: 100,
                review: { id: 7, content: input.content },
                book: { book_id: input.bookId },
                user: { id: 1 },
                transaction: { id: 2 }
            };
        },
        bookReviewById: async (id) => ({ id, content: "review" }),
        voteBookReview: async (input) => {
            votes.push(input);
            return {
                already_exists: false,
                vote: input.vote,
                previous_vote: "",
                reward_delta: 100,
                review: { id: input.reviewId },
                author: { id: 1 },
                voter: { id: 2 },
                transaction: { id: 3 }
            };
        },
        reviewMinLevel: 2,
        reviewPublishCost: 100,
        reviewMinLength: 6,
        reviewMaxLength: 1200
    });
    await withApp(router, async (base) => {
        const published = await fetch(`${base}/bot-api/books/book-1/reviews`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({
                telegram_id: "100",
                content: "这是一条足够长的书评",
                source: "forged_admin",
                idempotency_key: "telegram:book-review:chat:7"
            })
        });
        assert.equal(published.status, 200);
        const voted = await fetch(`${base}/bot-api/book-reviews/7/vote`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ telegram_id: "200", vote: "like", source: "forged_admin" })
        });
        assert.equal(voted.status, 200);
    });
    assert.equal(reviews[0].source, "telegram_bot");
    assert.equal(reviews[0].idempotencyKey, "telegram:book-review:chat:7");
    assert.equal(votes[0].source, "telegram_bot");
});

test("bot hot-keyword batch rejects oversized payloads before writes", async () => {
    let writes = 0;
    const router = createBotApiRoutes({
        requireBotApi: botOnly,
        getHotKeywords: async () => [],
        addHotKeyword: async () => {
            writes += 1;
        }
    });
    await withApp(router, async (base) => {
        const response = await fetch(`${base}/bot-api/hot-keywords`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Bot": "1" },
            body: JSON.stringify({ rows: Array.from({ length: 501 }, (_, index) => ({ keyword: `word-${index}` })) })
        });
        assert.equal(response.status, 413);
    });
    assert.equal(writes, 0);
});
