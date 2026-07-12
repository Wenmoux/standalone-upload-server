/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供Bot 运行模块装配与依赖边界的自动化回归断言
 * [POS]: tests 的Bot 运行模块装配与依赖边界守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const fs = require("fs/promises");
const path = require("path");
const test = require("node:test");
const { createReviewDraftStore, createSearchCache, helpLinesFromCommands } = require("../bot/bot-session");
const { meText, registerText, signSuccessText, startHelpText, walletText } = require("../bot/account-formatters");
const { botHealthPayload } = require("../bot/health-server");
const { createTelegramPollingRuntime } = require("../bot/polling-runtime");
const { automaticPushUnpinTarget, createAutomaticPushUnpinHandler } = require("../bot/automatic-push-unpin");
const { createSearchQueryParser, parseBookId } = require("../bot/search-query");
const { createTaskSchedulers } = require("../bot/task-schedulers");
const { markTelegramSystemPush } = require("../telegram-push-contract");

test("bot entrypoint initializes PO18 account handlers before task schedulers", async () => {
    const source = await fs.readFile(path.join(__dirname, "..", "bot", "telegram-bot.js"), "utf8");
    const accountHandlers = source.indexOf("} = createPo18AccountHandlers({");
    const taskSchedulers = source.indexOf("} = createTaskSchedulers({");
    assert.ok(accountHandlers >= 0, "PO18 account handler initialization is missing");
    assert.ok(taskSchedulers > accountHandlers, "task schedulers must not read handleMyBookshelf before initialization");
});

test("bot health payload reports readiness from injected state", () => {
    const now = Date.now();
    const payload = botHealthPayload({
        startedAt: now - 1000,
        staleMs: 5000,
        telegramApiBase: "https://api.telegram.org",
        client: { baseUrl: "http://server", stats: () => ({ ok: true }) },
        botTaskQueue: { stats: () => ({ queued: 0 }) },
        rateLimiter: { stats: () => ({ keys: 1 }) },
        stateProvider: () => ({
            botUser: { username: "reader_bot" },
            lastStartupOkAt: now - 900,
            lastPollOkAt: now - 100,
            lastStartupError: "",
            lastPollError: ""
        })
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.bot_username, "reader_bot");
    assert.deepEqual(payload.background_tasks, { queued: 0 });
});

test("bot search query parser normalizes tags and book ids", () => {
    const { parseSearchQuery } = createSearchQueryParser({ searchLimit: 7 });
    const parsed = parseSearchQuery("#甜文 -qd");
    assert.equal(parsed.type, "tag");
    assert.equal(parsed.keyword, "甜文");
    assert.equal(parsed.params.limit, 7);
    assert.equal(parsed.params.platform, "qidian");
    assert.equal(parsed.params.cache_min, 1);
    assert.equal(parsed.params.fast, 1);

    const allPlatforms = parseSearchQuery("狐魅");
    assert.equal(allPlatforms.type, "search");
    assert.equal(allPlatforms.keyword, "狐魅");
    assert.equal(allPlatforms.platform, "");
    assert.equal(Object.prototype.hasOwnProperty.call(allPlatforms.params, "platform"), false);
    assert.equal(allPlatforms.params.sort, "cache_desc");
    assert.equal(allPlatforms.params.cache_min, 1);
    assert.equal(allPlatforms.params.fast, 1);

    assert.equal(parseBookId("https://www.po18.tw/books/123/articles"), "123");
    assert.equal(parseBookId("/info_abc-123"), "abc-123");
});

test("bot search cache evicts old keys and help lines follow command groups", () => {
    const cache = createSearchCache({ maxSize: 2 });
    const a = cache.remember("alpha");
    const b = cache.remember("beta");
    const c = cache.remember("gamma");

    assert.equal(cache.get(a), undefined);
    assert.equal(cache.get(b), "beta");
    assert.equal(cache.get(c), "gamma");
    assert.equal(cache.size(), 2);

    const registry = {
        configuredCommands: () => [
            { enabled: true, group: "导出", help: "/exporttxt 书号" },
            { enabled: false, group: "导出", help: "/disabled" },
            { enabled: true, group: "搜书", command: "/search" }
        ]
    };
    assert.deepEqual(helpLinesFromCommands(registry, (value) => `[${value}]`), [
        "",
        "<b>[搜书]</b>",
        "[/search]",
        "",
        "<b>[导出]</b>",
        "[/exporttxt 书号]",
        "大书会进入后台队列，群里不会卡住其它消息。"
    ]);
});

test("review draft store isolates users, validates Unicode length and expires bounded state", () => {
    let currentTime = 1000;
    const drafts = createReviewDraftStore({
        ttlMs: 1000,
        maxSize: 2,
        now: () => currentTime
    });
    drafts.begin({
        chatId: "group-1",
        userId: "user-1",
        bookId: "667518",
        promptMessageId: 42,
        rules: { min_length: 3, max_length: 5 }
    });

    assert.equal(drafts.get({ chatId: "group-1", userId: "user-2" }), null);
    assert.equal(drafts.get({ chatId: "group-1", userId: "user-1" }).promptMessageId, "42");
    assert.equal(drafts.validate({ chatId: "group-1", userId: "user-1", content: "好看" }).status, "too_short");
    assert.equal(drafts.validate({ chatId: "group-1", userId: "user-1", content: "真好看" }).status, "ready");
    assert.equal(drafts.cancel({ chatId: "group-1", userId: "user-1", bookId: "other" }), false);
    assert.equal(drafts.complete({ chatId: "group-1", userId: "user-1", bookId: "667518" }), true);
    assert.equal(drafts.size(), 0);

    drafts.begin({ chatId: "group-1", userId: "user-1", bookId: "667518" });
    currentTime += 1001;
    assert.equal(drafts.get({ chatId: "group-1", userId: "user-1" }), null);
});

test("bot account formatters keep wallet and status copy stable", () => {
    const escapeHtml = (value) => String(value).replace(/</g, "&lt;");
    const scholarText = () => "Lv2";
    const freeExportText = () => "今日免费导出可用";
    const user = {
        telegram_id: "42",
        username: "alice",
        nickname: "Alice<",
        copper_coins: 120,
        silver_coins: 9,
        daily_free_exports: 2,
        sign_cycle_day: 3,
        last_sign_date: "2026-06-06T01:02:03.000Z"
    };

    assert.match(startHelpText({ user, payload: "INV", helpLines: ["/search"], escapeHtml, scholarText }), /邀请码：<code>INV<\/code>/);
    assert.match(registerText({ existed: false, user }, { escapeHtml, scholarText }), /注册成功/);
    assert.match(walletText(user, { escapeHtml, scholarText }), /Alice&lt;/);
    assert.match(meText({
        user,
        stats: { free_export: { available: true }, download_count: 1, bookshelf_count: 2, share_count: 3 },
        telegramId: "42",
        escapeHtml,
        scholarText,
        freeExportText
    }), /权限：未开通导出（今日可免费）/);
    assert.match(signSuccessText({
        reward: { copper: 10, silver: 1, exp: 5, day: 3, level_up: true },
        user
    }, { escapeHtml, scholarText }), /已升级/);
});

test("telegram polling runtime advances offset and reports handler errors", async () => {
    const calls = [];
    const messages = [];
    const runtime = createTelegramPollingRuntime({
        pollTimeout: 9,
        telegram: async (method, payload) => {
            calls.push({ method, payload });
            if (method === "getUpdates") {
                return [
                    { update_id: 10, message: { chat: { id: "c1" } } },
                    { update_id: 11, message: { chat: { id: "c2" } } }
                ];
            }
            return { username: "bot" };
        },
        handleUpdate: async (update) => {
            if (update.update_id === 11) throw new Error("boom");
        },
        sendMessage: async (chatId, text) => {
            messages.push({ chatId, text });
        },
        escapeHtml: (value) => String(value).replace(/</g, "&lt;"),
        logger: { error: () => {} }
    });

    const updates = await runtime.pollOnce();
    const second = await runtime.pollOnce();

    assert.equal(updates.length, 2);
    assert.equal(second.length, 2);
    assert.deepEqual(calls.map((call) => call.payload.offset), [0, 12]);
    assert.deepEqual(messages, [
        { chatId: "c2", text: "处理失败：boom" },
        { chatId: "c2", text: "处理失败：boom" }
    ]);
    assert.ok(runtime.state().lastPollOkAt > 0);
    assert.equal(runtime.state().lastPollError, "");
});

test("automatic push unpin only targets marked automatic forwards", async () => {
    const calls = [];
    const warnings = [];
    const maybeUnpin = createAutomaticPushUnpinHandler({
        telegram: async (method, payload) => calls.push({ method, payload }),
        logger: { warn: (message) => warnings.push(message) }
    });
    const manualGroupPin = {
        chat: { id: -1001 },
        pinned_message: { message_id: 10, text: markTelegramSystemPush("人工消息") }
    };
    const humanChannelPost = {
        chat: { id: -1001 },
        pinned_message: { message_id: 11, text: "人工频道帖", is_automatic_forward: true }
    };
    const systemPush = {
        chat: { id: -1001 },
        pinned_message: { message_id: 12, caption: markTelegramSystemPush("系统推送"), is_automatic_forward: true }
    };

    assert.equal(automaticPushUnpinTarget(manualGroupPin), null);
    assert.equal(automaticPushUnpinTarget(humanChannelPost), null);
    assert.deepEqual(automaticPushUnpinTarget(systemPush), { chatId: -1001, messageId: 12 });
    assert.equal(await maybeUnpin(manualGroupPin), false);
    assert.equal(await maybeUnpin(humanChannelPost), false);
    assert.equal(await maybeUnpin(systemPush), true);
    assert.deepEqual(calls, [{
        method: "unpinChatMessage",
        payload: { chat_id: -1001, message_id: 12 }
    }]);
    assert.deepEqual(warnings, []);
});

test("automatic push unpin failures stay internal", async () => {
    const warnings = [];
    const maybeUnpin = createAutomaticPushUnpinHandler({
        telegram: async () => {
            throw new Error("missing can_pin_messages");
        },
        logger: { warn: (message) => warnings.push(message) }
    });
    const handled = await maybeUnpin({
        chat: { id: -1002 },
        pinned_message: {
            message_id: 20,
            text: markTelegramSystemPush("系统推送"),
            is_automatic_forward: true
        }
    });

    assert.equal(handled, true);
    assert.match(warnings[0], /missing can_pin_messages/);
});

test("bot task schedulers enqueue export jobs with system job metadata", () => {
    const jobs = [];
    const exports = [];
    const schedulers = createTaskSchedulers({
        botTaskQueue: {
            enqueue(job) {
                jobs.push(job);
                return true;
            }
        },
        sendMessage: () => {},
        isGroup: (chat) => chat.type === "group",
        sendExport: async (...args) => { exports.push(args); },
        handleMyBookshelf: async () => {},
        handleShare: async () => {},
        handleShareBookshelf: async () => {}
    });

    assert.equal(schedulers.scheduleExport({ id: "c1", type: "group" }, { id: 42 }, "b1", "txt"), true);
    assert.equal(jobs[0].systemJobType, "bot_export_txt");
    assert.deepEqual(jobs[0].systemJobInput, {
        telegram_id: "42",
        chat_id: "c1",
        book_id: "b1",
        format: "txt",
        group_chat: true
    });
    assert.equal(schedulers.scheduleExport({ id: "c1", type: "group" }, { id: 42 }, "b1", "epub", { epubStyleId: "style2" }), true);
    assert.equal(jobs[1].systemJobInput.epub_style_id, "style2");
    assert.match(jobs[1].idempotencyKey, /style2$/);
    jobs[1].task(null, { systemJobId: 88 });
    assert.equal(exports[0][5].epubStyleId, "style2");
    assert.equal(exports[0][5].settlementKey, "system-job:88:export-settlement");

    assert.equal(schedulers.scheduleShareBookshelf({ chat: { id: "c2" }, from: { id: 99 } }), true);
    assert.equal(jobs[2].systemJobType, "bot_po18_bookshelf_share");
    assert.equal(jobs[2].lockKey, "sharebookshelf:99");
    assert.deepEqual(jobs[2].systemJobInput, {
        telegram_id: "99",
        chat_id: "c2"
    });
});
