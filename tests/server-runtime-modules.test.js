/**
 * [INPUT]: 依赖 node:test/assert、拆分后的成长/值清洗/纠错/观测/频道防重/应用生命周期与 HTTP 管线模块
 * [OUTPUT]: 提供组合根下沉模块的纯规则、频道投递认领、重试和安全中间件顺序回归断言
 * [POS]: tests 的 server-pg 模块化守卫，确保入口减重不改变 Reader、Bot、上传、频道副作用和启动行为
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const { EventEmitter } = require("events");
const session = require("express-session");
const express = require("express");
const test = require("node:test");
const { markTelegramSystemPush, hasTelegramSystemPushMarker } = require("../telegram-push-contract");
const { createApplicationRuntime, readerRedirectUrl, requestHostWithoutPort } = require("../services/application-runtime");
const { createBookReviewChannelService, createLatestBookMetadataLookup } = require("../services/book-review-channel");
const { correctionCharLength, normalizeCorrectionText, replaceFirstText, replaceTextAtCharOffset } = require("../services/correction-text");
const { finiteNumber, installHttpPipeline } = require("../services/http-pipeline");
const { cleanPgObject, cleanPgText, safePgBool, safePgInt } = require("../services/postgres-values");
const {
    createCachedSystemStatusCollector,
    createSlowSearchLogger,
    getFreshCache,
    installProcessErrorHandlers,
    setFreshCache,
    slowSearchContext
} = require("../services/runtime-observability");
const { createScholarProgression, currencyLabel, positiveNumber } = require("../services/scholar-progression");

test("scholar progression keeps level, sign-in and red-packet rules stable", () => {
    const progression = createScholarProgression({
        expBase: 100,
        expGrowth: 2,
        signExpBase: 10,
        signExpStreakBonus: 3,
        randomInt: () => 20
    });
    assert.equal(progression.scholarExpForNextLevel(2), 200);
    assert.deepEqual(progression.scholarProfile(150), {
        level: 2,
        name: "青灯蒙学",
        exp: 150,
        level_exp: 50,
        next_level_exp: 200,
        exp_to_next: 150,
        progress: 0.25,
        next_level_name: "砚边童生",
        daily_free_exports: 1
    });
    assert.equal(progression.signExpReward(4), 19);
    assert.equal(progression.randomRedPacketAmount(100, 3), 20);
    assert.equal(progression.randomRedPacketAmount(7, 1), 7);
    assert.equal(positiveNumber("bad", 9, 1), 9);
    assert.equal(currencyLabel("silver"), "银币");
    assert.equal(currencyLabel("copper"), "铜币");
});

test("postgres value boundary cleans nested NUL bytes and clamps scalar types", () => {
    assert.equal(safePgInt("2147483647"), 2147483647);
    assert.equal(safePgInt("2147483648", 7), 7);
    assert.equal(safePgBool("volume"), true);
    assert.equal(safePgBool("off", true), false);
    assert.equal(safePgBool("unknown", true), true);
    assert.equal(cleanPgText("a\u0000b"), "ab");
    const date = new Date("2026-07-15T00:00:00Z");
    const buffer = Buffer.from("x");
    const value = cleanPgObject({ nested: { text: "x\u0000y" }, list: ["a\u0000b"], date, buffer });
    assert.equal(value.nested.text, "xy");
    assert.equal(value.list[0], "ab");
    assert.equal(value.date, date);
    assert.equal(value.buffer, buffer);
});

test("correction helpers preserve Unicode character offsets", () => {
    assert.equal(normalizeCorrectionText("a\r\nb\rc"), "a\nb\nc");
    assert.equal(correctionCharLength("A😀B"), 3);
    assert.deepEqual(replaceTextAtCharOffset("甲😀乙😀丙", "乙😀", "丁", 2), { changed: true, value: "甲😀丁丙" });
    assert.deepEqual(replaceTextAtCharOffset("甲😀乙", "乙", "丁", 1), { changed: false, value: "甲😀乙" });
    assert.deepEqual(replaceFirstText("前文前文", "前文", "正文"), { changed: true, value: "正文前文" });
});

test("runtime observability caches status and records only slow searches", async () => {
    let now = 1000;
    const cache = { at: 0, payload: null };
    assert.equal(
        getFreshCache(cache, 100, () => now),
        null
    );
    setFreshCache(cache, { ready: true }, () => now);
    assert.deepEqual(
        getFreshCache(cache, 100, () => now),
        { ready: true }
    );
    now = 1200;
    assert.equal(
        getFreshCache(cache, 100, () => now),
        null
    );
    let statusCalls = 0;
    const collect = createCachedSystemStatusCollector({
        cache: { at: 0, payload: null },
        ttlMs: 50,
        configFile: "app.env",
        now: () => now,
        collectStatus: async (file) => ({ file, calls: ++statusCalls })
    });
    assert.deepEqual(await collect(), { file: "app.env", calls: 1 });
    assert.deepEqual(await collect(), { file: "app.env", calls: 1 });
    const warnings = [];
    const events = [];
    const logSlowSearch = createSlowSearchLogger({
        thresholdMs: 100,
        now: () => 500,
        logger: { warn: (value) => warnings.push(value) },
        logEvent: (...args) => events.push(args)
    });
    logSlowSearch("books", 450, { q: "fast" });
    logSlowSearch("books", 350, { q: "slow" });
    assert.equal(warnings.length, 1);
    assert.equal(events[0][2], "slow-search");
    assert.deepEqual(slowSearchContext({ path: "/books", query: { q: "x", limit: "10" } }, { fast: true }), {
        path: "/books",
        q: "x",
        keyword: "",
        tag: "",
        author: "",
        platform: "",
        sort: "",
        page: "",
        limit: "10",
        fast: true
    });
});

test("process error handlers tolerate database outages but exit on unknown fatal errors", () => {
    const processRef = new EventEmitter();
    const exits = [];
    const warnings = [];
    const errors = [];
    processRef.exit = (code) => exits.push(code);
    installProcessErrorHandlers({
        processRef,
        isDatabaseError: (err) => err?.code === "57P03",
        logger: { warn: (value) => warnings.push(value), error: (value) => errors.push(value) }
    });
    processRef.emit("unhandledRejection", Object.assign(new Error("recovering"), { code: "57P03" }));
    processRef.emit("uncaughtException", new Error("boom"));
    assert.equal(warnings.length, 1);
    assert.equal(errors.length, 1);
    assert.deepEqual(exits, [1]);
});

test("book review channel publisher writes marked message and delivery state", async () => {
    const posts = [];
    const updates = [];
    const claims = [];
    const query = async (sql, params) => ({ rows: [{ book_id: params[0], title: "A&B", author: "作者" }] });
    const lookup = createLatestBookMetadataLookup(query);
    assert.equal((await lookup("9")).title, "A&B");
    const service = createBookReviewChannelService({
        latestBookMetadata: lookup,
        telegramPushConfig: async () => ({ enabled: true, pushTypes: ["review"] }),
        telegramLoginBotToken: async () => "token",
        configGet: async () => "chat",
        claimBookReviewChannelDelivery: async (id) => {
            claims.push(id);
            return { id, channel_status: "sending" };
        },
        updateBookReviewChannelMessage: async (id, patch) => updates.push({ id, patch }),
        postJson: async (url, body) => {
            posts.push({ url, body });
            return JSON.stringify({ result: { message_id: 88 } });
        },
        telegramApiUrl: (token, method) => `https://api.telegram.invalid/${token}/${method}`,
        telegramHtml: (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;"),
        markTelegramSystemPush
    });
    const book = await service.latestBookMetadata("9");
    const result = await service.pushBookReviewToChannel({ review: { id: 7, book_id: "9", content: "很好", like_count: 1 }, book });
    assert.deepEqual(result, { sent: true, chat_id: "chat", message_id: "88" });
    assert.equal(posts[0].url, "https://api.telegram.invalid/token/sendMessage");
    assert.equal(hasTelegramSystemPushMarker(posts[0].body.text), true);
    assert.equal(posts[0].body.reply_markup.inline_keyboard.length, 2);
    assert.deepEqual(claims, [7]);
    assert.equal(updates[0].patch.status, "sent");

    const repeated = await service.pushBookReviewToChannel({
        review: { id: 7, channel_status: "sent", channel_chat_id: "chat", channel_message_id: "88" },
        book
    });
    assert.deepEqual(repeated, { sent: true, repeated: true, chat_id: "chat", message_id: "88" });
    assert.equal(posts.length, 1);
});

test("book review channel publisher skips a concurrently claimed delivery", async () => {
    let posts = 0;
    const service = createBookReviewChannelService({
        latestBookMetadata: async () => null,
        telegramPushConfig: async () => ({ enabled: true, pushTypes: ["review"] }),
        telegramLoginBotToken: async () => "token",
        configGet: async () => "chat",
        claimBookReviewChannelDelivery: async () => null,
        updateBookReviewChannelMessage: async () => null,
        postJson: async () => {
            posts += 1;
            return "{}";
        },
        telegramApiUrl: () => "https://api.telegram.invalid",
        telegramHtml: String
    });
    assert.deepEqual(await service.pushBookReviewToChannel({ review: { id: 9 }, book: {} }), {
        skipped: "delivery_in_progress_or_sent"
    });
    assert.equal(posts, 0);
});

test("application runtime initializes once and schedules bounded database retry", async () => {
    const calls = [];
    const gate = {
        markWaiting: (value) => calls.push(["waiting", value]),
        markReady: () => calls.push(["ready"]),
        markFailed: (value) => calls.push(["failed", value])
    };
    const runtime = createApplicationRuntime({
        query: async (sql) => {
            calls.push(["query", sql]);
            return { rows: [] };
        },
        initPg: async () => calls.push(["pg"]),
        syncConfiguredTokens: async (value) => calls.push(["tokens", value]),
        configuredTokensProvider: () => ({ botToken: "configured" }),
        encryptStoredCredentials: async () => ({ updated: 0, scanned: 0 }),
        credentialCrypto: {},
        defaultAdmin: "admin",
        defaultPassword: "password",
        hashPassword: () => ({ salt: "salt", hash: "hash" }),
        startupGate: gate,
        schedulers: [["daily", () => calls.push(["scheduler"])]],
        logger: { log: (value) => calls.push(["log", value]), warn: () => {}, error: () => {} }
    });
    await runtime.bootApplicationWithRetry();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
        calls.some(([name]) => name === "ready"),
        true
    );
    assert.equal(
        calls.some(([name]) => name === "scheduler"),
        true
    );
    assert.equal(calls.filter(([name]) => name === "query").length, 2);

    const retries = [];
    const unavailable = Object.assign(new Error("recovering"), { code: "57P03" });
    const retrying = createApplicationRuntime({
        query: async () => ({ rows: [] }),
        initPg: async () => {
            throw unavailable;
        },
        syncConfiguredTokens: async () => {},
        defaultAdmin: "admin",
        defaultPassword: "password",
        hashPassword: () => ({ salt: "salt", hash: "hash" }),
        startupGate: gate,
        isDatabaseError: (err) => err?.code === "57P03",
        startupDbRetryMs: 1234,
        schedule: (fn, delay) => {
            retries.push({ fn, delay });
            return { unref() {} };
        },
        logger: { log() {}, warn() {}, error() {} }
    });
    await retrying.bootApplicationWithRetry();
    assert.equal(retries.length, 1);
    assert.equal(retries[0].delay, 1234);
});

test("application URL and HTTP pipeline helpers retain proxy and middleware contracts", () => {
    const req = {
        headers: { "x-forwarded-host": "reader.example:443", "x-forwarded-proto": "https" },
        protocol: "http",
        get: () => "internal:3100"
    };
    assert.equal(requestHostWithoutPort(req), "reader.example");
    assert.equal(readerRedirectUrl(req), "https://reader.example:3200/");
    assert.equal(readerRedirectUrl(req, "https://read.example/"), "https://read.example/");
    assert.equal(finiteNumber("", 9), 9);
    assert.equal(finiteNumber("12", 9), 12);

    const originalSetupToken = process.env.PO18_SETUP_TOKEN;
    process.env.PO18_SETUP_TOKEN = "test-setup-token-123456";
    try {
        const app = express();
        installHttpPipeline({
            app,
            express,
            pool: {},
            sessionStore: new session.MemoryStore(),
            startupGate: {
                middleware: function startupGateMiddleware(req, res, next) {
                    next();
                }
            },
            configFile: "./tmp/nonexistent-test.env",
            sessionSecret: "test-session-secret",
            requestSlowMs: 800,
            query: async () => ({ rows: [] }),
            logEvent() {},
            env: { NODE_ENV: "test" },
            logger: { warn() {} }
        });
        const names = app._router.stack.map((layer) => layer.name);
        assert.ok(names.indexOf("requestLogger") < names.indexOf("session"));
        assert.ok(names.indexOf("requestSchemaValidation") < names.indexOf("startupGateMiddleware"));
        assert.ok(names.indexOf("startupGateMiddleware") < names.indexOf("session"));
        assert.ok(names.indexOf("session") < names.indexOf("csrfProtection"));
        assert.ok(names.indexOf("csrfProtection") < names.indexOf("adminAudit"));
    } finally {
        if (originalSetupToken === undefined) delete process.env.PO18_SETUP_TOKEN;
        else process.env.PO18_SETUP_TOKEN = originalSetupToken;
    }
});
