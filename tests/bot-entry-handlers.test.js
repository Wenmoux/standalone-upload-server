/**
 * [INPUT]: 依赖 node:test/assert 与 Bot 账户、经济、EPUB 自定义、导出投递和 PikPak 处理器的受控客户端/Telegram 替身
 * [OUTPUT]: 提供 EPUB 自定义回调、私聊续接/PEER_ID_INVALID 降级、发送后结算、账户状态、管理员发币、红包幂等键和外部存储交互回归断言
 * [POS]: tests 的 Bot 组合根减重守卫，确保领域处理器拆分不改变命令权限、文案和副作用顺序
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createAccountHandlers } = require("../bot/account-handlers");
const { createEconomyHandlers } = require("../bot/economy-handlers");
const { createEpubCustomHandler } = require("../bot/epub-custom-handlers");
const { createEpubStudioHandler } = require("../bot/epub-studio-handlers");
const { createExportDelivery } = require("../bot/export-delivery");
const { isPrivateChatUnavailableError } = require("../bot/export-errors");
const { createPikpakHandler } = require("../bot/pikpak-handler");

function exportError(code, message, cause) {
    const err = new Error(message);
    err.code = code;
    err.cause = cause;
    return err;
}

function exportDeliveryWith(overrides = {}) {
    return createExportDelivery({
        client: {},
        telegram: async () => true,
        sendMessage: async () => ({ message_id: 1 }),
        editMessage: async () => ({}),
        sendDocument: async () => ({}),
        isGroup: (chat) => chat?.type === "group",
        escapeHtml: (value) => String(value),
        asExportError: exportError,
        formatExportFailure: (err) => ({ code: err.code, message: err.message, raw: err.message }),
        isPrivateChatUnavailableError,
        normalizeEpubStyleChoice: (value) => String(value || ""),
        epubStyleChoices: [{ id: "style1", label: "江湖纸卷" }],
        epubStyleSelectionMarkup: (id) => ({ id }),
        callback: (parts) => parts.join("|"),
        ensureRegistered: async () => ({}),
        buildExport: async () => ({}),
        normalizeExportPricing: (value) => ({ unlockCost: 100, ...value }),
        exportQuote: () => ({ amount: 0, currency: "copper", paidChapters: 0 }),
        exportQuoteText: (quote) => `${quote.amount}`,
        freeExportText: () => "quota",
        botUserProvider: () => ({ username: "po18book_bot" }),
        privateExportStartTtlMs: 1000,
        ...overrides
    });
}

test("private export continuation is user-scoped, expiring and style-aware", () => {
    let now = 1000;
    const flow = exportDeliveryWith({ now: () => now, random: () => 0.5 });
    const key = flow.rememberPrivateExportStart({ id: 7 }, { id: -1 }, "book-9", "epub", { epubStyleId: "style1" });
    assert.match(key, /^ex_/);
    assert.equal(flow.takePrivateExportStart(key, "8"), null);
    assert.deepEqual(flow.takePrivateExportStart(key, "7"), {
        userId: "7",
        chatId: "-1",
        bookId: "book-9",
        format: "epub",
        epubStyleId: "style1",
        createdAt: 1000
    });
    const expired = flow.rememberPrivateExportStart({ id: 7 }, -1, "book-10", "txt");
    now = 2501;
    assert.equal(flow.takePrivateExportStart(expired, "7"), null);
    assert.equal(flow.privateExportStartMarkup("payload").inline_keyboard[0][0].url, "https://t.me/po18book_bot?start=payload");
});

test("EPUB custom options override saved defaults before the build starts", async () => {
    let buildOptions = null;
    const flow = exportDeliveryWith({
        client: {
            exportPermission: async () => ({ unlocked: true, free_export: {}, user: { copper_coins: 100 } }),
            exportPricing: async () => ({ pricing: { epub: { styleId: "style1", includeColophon: true, showTopImage: true } } }),
            getBook: async () => ({ book: { book_id: "9", title: "Book" } }),
            recordUserEvent: async () => {},
            spendCurrency: async () => {}
        },
        normalizeEpubCustomConfig: (value) => ({ ...value }),
        buildExport: async (_book, _format, _from, options) => {
            buildOptions = options;
            return { book: { book_id: "9", title: "Book" }, chapters: 1, filePath: "C:\\tmp\\po18\\book.epub" };
        },
        sendDocument: async () => {},
        removeDirectory: async () => {}
    });
    await flow.sendExport({ id: 7, type: "private" }, { id: 11 }, "9", "epub", null, {
        epubStyleId: "style2",
        epubConfig: { styleId: "style2", includeColophon: false, showTopImage: false }
    });
    assert.deepEqual(buildOptions.epub, { styleId: "style2", includeColophon: false, showTopImage: false });
});

test("Telegram EPUB custom handler previews, returns and schedules normalized state", async () => {
    const calls = [];
    const handler = createEpubCustomHandler({
        parseEpubCustomState: (styleId, flags) => ({
            styleId,
            includeColophon: flags[0] === "1",
            showTopImage: flags[1] === "1"
        }),
        requestEpubCustomization: async (...args) => calls.push(["custom", ...args]),
        requestEpubStyle: async (...args) => calls.push(["library", ...args]),
        scheduleExport: async (...args) => calls.push(["export", ...args]),
        sendMessage: async (...args) => calls.push(["message", ...args]),
        withBotAudit: async (_message, _command, _action, _details, task) => task(),
        withCooldown: async (_message, _key, _ms, _label, task) => task(),
        exportCooldownMs: 1000
    });
    const input = {
        operation: "base",
        state: ["style2", "01", "book-9"],
        message: { chat: { id: 7 }, message_id: 8 },
        from: { id: 11 },
        callbackMessage: { chat: { id: 7 }, from: { id: 11 } }
    };
    await handler(input);
    assert.equal(calls[0][0], "custom");
    assert.deepEqual(calls[0][3], { styleId: "style2", includeColophon: false, showTopImage: true });
    await handler({ ...input, operation: "back" });
    assert.equal(calls[1][0], "library");
    await handler({ ...input, operation: "export" });
    assert.equal(calls[2][0], "export");
    assert.deepEqual(calls[2][5], {
        epubStyleId: "style2",
        epubConfig: { styleId: "style2", includeColophon: false, showTopImage: true }
    });
});

test("Telegram EPUB studio handler preserves the selected component combination", async () => {
    const calls = [];
    const epubConfig = {
        styleId: "studio",
        includeColophon: true,
        showTopImage: false,
        studio: { chapter: "zhuti", volume: "shuanglan", intro: "xuanhe", ornament: "zhuqian" }
    };
    const handler = createEpubStudioHandler({
        parseEpubStudioState: () => epubConfig,
        requestEpubStudio: async (...args) => calls.push(["studio", ...args]),
        requestEpubStyle: async (...args) => calls.push(["library", ...args]),
        scheduleExport: async (...args) => calls.push(["export", ...args]),
        sendMessage: async (...args) => calls.push(["message", ...args]),
        withBotAudit: async (_message, _command, _action, _details, task) => task(),
        withCooldown: async (_message, _key, _ms, _label, task) => task(),
        exportCooldownMs: 1000
    });
    const input = {
        operation: "chapter",
        state: ["zsxz", "book-9"],
        message: { chat: { id: 7 }, message_id: 8 },
        from: { id: 11 },
        callbackMessage: { chat: { id: 7 }, from: { id: 11 } }
    };
    await handler(input);
    assert.deepEqual(calls[0][3], epubConfig.studio);
    await handler({ ...input, operation: "export" });
    assert.deepEqual(calls[1][5], { epubStyleId: "studio", epubConfig });
});

test("export delivery sends the file before idempotent currency settlement and cleans temp files", async () => {
    const order = [];
    const edits = [];
    const client = {
        exportPermission: async () => ({ unlocked: true, free_export: {}, user: { copper_coins: 100 } }),
        exportPricing: async () => ({ pricing: {} }),
        getBook: async () => ({ book: { book_id: "9", title: "Book" } }),
        recordUserEvent: async () => order.push("event"),
        spendCurrency: async (...args) => order.push(["spend", ...args])
    };
    const flow = exportDeliveryWith({
        client,
        buildExport: async () => ({ book: { book_id: "9", title: "Book" }, chapters: 3, filePath: "C:\\tmp\\po18\\book.txt" }),
        exportQuote: () => ({ amount: 10, currency: "copper", paidChapters: 0 }),
        sendMessage: async () => ({ message_id: 5 }),
        sendDocument: async () => order.push("document"),
        editMessage: async (...args) => edits.push(args),
        removeDirectory: async (dir) => order.push(["cleanup", dir])
    });
    await flow.sendExport({ id: 7, type: "private" }, { id: 11 }, "9", "txt", null, { settlementKey: "job:1" });
    assert.equal(order[0], "document");
    assert.equal(order[1], "event");
    assert.equal(order[2][0], "spend");
    assert.deepEqual(order[2][7], { idempotencyKey: "job:1", idempotencyScope: "export-settlement", bookId: "9" });
    assert.equal(order[3][0], "cleanup");
    assert.match(edits.at(-1)[2], /导出完成/);
});

test("group export that cannot open a private chat produces a resumable start button", async () => {
    const messages = [];
    const client = {
        exportPermission: async () => ({ free_export: {}, user: {} }),
        exportPricing: async () => ({}),
        getBook: async () => ({ book: { book_id: "9" } })
    };
    const flow = exportDeliveryWith({
        client,
        telegram: async () => {
            throw new Error("Forbidden: bot can't initiate conversation");
        },
        sendMessage: async (...args) => {
            messages.push(args);
            return { message_id: 1 };
        },
        now: () => 1000,
        random: () => 0.25
    });
    await flow.sendExport({ id: -10, type: "group" }, { id: 77 }, "9", "txt");
    assert.match(messages[0][1], /打开私聊/);
    const url = messages[0][2].reply_markup.inline_keyboard[0][0].url;
    assert.match(url, /^https:\/\/t\.me\/po18book_bot\?start=ex_/);
});

test("group export treats Telegram PEER_ID_INVALID as a resumable private-chat requirement", async () => {
    const messages = [];
    let builds = 0;
    const flow = exportDeliveryWith({
        client: {
            exportPermission: async () => ({ free_export: {}, user: {} }),
            exportPricing: async () => ({}),
            getBook: async () => ({ book: { book_id: "9" } })
        },
        telegram: async () => {
            throw new Error("Bad Request: PEER_ID_INVALID");
        },
        sendMessage: async (...args) => {
            messages.push(args);
            return { message_id: 1 };
        },
        buildExport: async () => {
            builds += 1;
        }
    });

    await flow.sendExport({ id: -10, type: "group" }, { id: 8024576205 }, "9", "epub", null, {
        epubStyleId: "style1"
    });
    assert.equal(builds, 0);
    assert.match(messages[0][1], /EXPORT_PRIVATE_CHAT_REQUIRED/);
    assert.match(messages[0][2].reply_markup.inline_keyboard[0][0].url, /start=ex_/);
});

test("account handlers resume pending exports and preserve already-signed response", async () => {
    const messages = [];
    const schedules = [];
    const client = {
        getUser: async () => ({ id: 1 }),
        registerUser: async () => ({ user: { id: 1 } }),
        sign: async () => {
            throw Object.assign(new Error("duplicate"), { status: 409 });
        }
    };
    const handlers = createAccountHandlers({
        client,
        sendMessage: async (...args) => {
            messages.push(args);
            return {};
        },
        deliverLongGroupResult: async () => {},
        escapeHtml: (value) => String(value),
        scholarText: () => "",
        freeExportText: () => "",
        startHelpText: () => "help",
        registerText: () => "registered",
        meText: () => "me",
        signSuccessText: () => "signed",
        takePrivateExportStart: () => ({ bookId: "9", format: "epub", epubStyleId: "style1" }),
        scheduleExport: async (...args) => schedules.push(args),
        epubStyleChoices: [{ id: "style1", label: "江湖纸卷" }]
    });
    const message = { chat: { id: 5 }, from: { id: 7 } };
    await handlers.handleStart(message, "payload");
    assert.equal(schedules[0][2], "9");
    assert.deepEqual(schedules[0][4], { epubStyleId: "style1" });
    assert.match(messages[0][1], /江湖纸卷/);
    await handlers.handleSign(message);
    assert.equal(messages.at(-1)[1], "今天已经签到过了。");
});

test("economy handlers enforce administrator give and keep red-packet payloads", async () => {
    const sent = [];
    const currencyCalls = [];
    const packetCalls = [];
    let admin = false;
    const handlers = createEconomyHandlers({
        client: {
            addCurrency: async (...args) => {
                currencyCalls.push(args);
                return { user: { copper_coins: 123, silver_coins: 4 } };
            },
            createRedPacket: async (payload) => {
                packetCalls.push(payload);
                return { packet: { id: 99 } };
            },
            getUserByTelegramUsername: async () => null
        },
        ensureRegistered: async () => ({ is_admin: admin, copper_coins: 500, silver_coins: 0, nickname: "Admin" }),
        sendMessage: async (...args) => {
            sent.push(args);
            return {};
        },
        deliverLongGroupResult: async () => {},
        escapeHtml: (value) => String(value),
        currencyLabel: (value) => (value === "silver" ? "银币" : "铜币"),
        transactionLine: () => "",
        parseRedPacketArgs: () => ({ currency: "copper", totalAmount: 100, totalCount: 5, note: "测试", target: "" }),
        redPacketMarkup: (id) => ({ id }),
        mentionUser: () => "user"
    });
    const message = { chat: { id: -1 }, from: { id: 7 }, message_id: 42 };
    await handlers.handleGive(message, "8 铜币 100");
    assert.match(sent.at(-1)[1], /只有管理员/);
    admin = true;
    await handlers.handleGive(message, "8 铜币 100");
    assert.deepEqual(currencyCalls[0], ["8", "copper", 100]);
    await handlers.handleRedPacket(message, "100 5");
    assert.equal(packetCalls[0].total_amount, 100);
    assert.equal(packetCalls[0].idempotency_key, "telegram:red-packet:-1:42");
    assert.equal(sent.at(-1)[2].reply_markup.id, 99);
    await handlers.handleRedPacket({ ...message, message_id: undefined }, "100 5");
    assert.equal(packetCalls[1].idempotency_key, "");
});

test("PikPak handler reports missing configuration and renders bounded search results", async () => {
    const sent = [];
    const edits = [];
    let configured = false;
    const handler = createPikpakHandler({
        ensureRegistered: async () => ({}),
        pikpakConfig: () => (configured ? { url: "https://dav", username: "u", password: "p", root: "/" } : {}),
        webdavRequest: async () => ({}),
        pikpakList: async () => [],
        pikpakSearch: async () => [{ name: "book.epub", size: 1024, path: "/book.epub" }],
        sendMessage: async (...args) => {
            sent.push(args);
            return { message_id: 3 };
        },
        editMessage: async (...args) => {
            edits.push(args);
            return {};
        },
        sendDocument: async () => {},
        deliverLongGroupResult: async (...args) => {
            sent.push(args);
            return {};
        },
        escapeHtml: (value) => String(value),
        bytes: () => "1 KiB",
        safeFileName: (value) => value,
        isGroup: () => false
    });
    const message = { chat: { id: 1 }, from: { id: 2 } };
    await handler(message, "search book");
    assert.match(sent.at(-1)[1], /尚未配置/);
    configured = true;
    await handler(message, "search book");
    assert.match(sent.at(-1)[1], /book\.epub/);
    assert.equal(edits.length, 0);
});
