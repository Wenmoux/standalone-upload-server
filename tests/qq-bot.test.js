/**
 * [INPUT]: 依赖 node:test、QQ 配置策略/API/Gateway/展示模块及受控 Fetch/配置存储替身
 * [OUTPUT]: 提供密钥不回显、平台标签/缓存范围、QQ 安全 Markdown/纯文本降级、内嵌按钮和可重试富媒体分片上传契约回归断言
 * [POS]: tests 的 QQ Bot 安全与官方协议守卫，防止凭据、访问范围或文件投递在后续修改中退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { createCredentialCrypto } = require("../services/credential-crypto");
const {
    createQqBotConfigService,
    filterQqBooks,
    normalizeQqPolicy,
    qqBookAccess
} = require("../services/qq-bot-config");
const { commandKeyboard, createQqApiClient, isRetryableQqUploadError, markdownToPlainText, requestAppAccessToken } = require("../qq-bot/qq-api");
const { normalizeQqEvent } = require("../qq-bot/gateway");
const {
    bookButtonLabel,
    detailText,
    emptySearchText,
    exportStatusText,
    helpText,
    menuText,
    searchText,
    signText,
    styleText
} = require("../qq-bot/formatters");
const { createQqMessageRuntime } = require("../qq-bot/message-runtime");

test("QQ config encrypts AppSecret and never exposes it through the public projection", async () => {
    const stored = {};
    const crypto = createCredentialCrypto({ env: { PO18_CREDENTIAL_ENCRYPTION_KEY: "test-key" } });
    const service = createQqBotConfigService({
        configGet: async (key) => stored[key] || "",
        configSet: async (key, value) => {
            stored[key] = value;
        },
        credentialCrypto: crypto,
        query: async () => ({ rows: [] })
    });
    await service.updateConfig({
        enabled: true,
        appId: "10001",
        appSecret: "local-test-secret",
        allowedPlatforms: ["QD"],
        blockedPlatforms: ["FanQie"],
        blockedTags: ["限制级", "AB"]
    });
    assert.equal(stored.qq_bot_app_secret.includes("local-test-secret"), false);
    assert.equal(crypto.isEncrypted(stored.qq_bot_app_secret), true);
    const publicConfig = await service.publicConfig();
    assert.equal(Object.prototype.hasOwnProperty.call(publicConfig, "appSecret"), false);
    assert.equal(JSON.stringify(publicConfig).includes("local-test-secret"), false);
    const runtime = await service.runtimeConfig();
    assert.equal(runtime.appSecret, "local-test-secret");
    assert.deepEqual(runtime.allowedPlatforms, ["qidian"]);
    assert.deepEqual(runtime.blockedPlatforms, ["fanqie"]);
});

test("QQ search policy uses platform aliases and exact normalized tag matches", () => {
    const policy = normalizeQqPolicy({ blockedPlatforms: ["fq"], blockedTags: ["古代", "AB"] });
    assert.equal(qqBookAccess({ platform: "tomato", tags: "现代·甜文" }, policy).allowed, false);
    assert.equal(qqBookAccess({ platform: "po18", tags: "古代,甜文" }, policy).allowed, false);
    assert.equal(qqBookAccess({ platform: "po18", tags: "古代言情,甜文" }, policy).allowed, true);
    assert.deepEqual(
        filterQqBooks(
            [
                { book_id: "1", platform: "po18", tags: "甜文" },
                { book_id: "2", platform: "fanqie", tags: "甜文" },
                { book_id: "3", platform: "po18", tags: "AB" }
            ],
            policy
        ).map((book) => book.book_id),
        ["1"]
    );
});

test("QQ access projection joins current cache and feedback statistics", async () => {
    let sql = "";
    const service = createQqBotConfigService({
        configGet: async () => "",
        configSet: async () => {},
        query: async (statement) => {
            sql = statement;
            return {
                rows: [{ book_id: "101", platform: "qidian", cache_count: 12, like_count: 3, dislike_count: 1 }]
            };
        }
    });
    const access = await service.bookAccessById("101");
    assert.match(sql, /LEFT JOIN book_stats bs ON bs\.book_id = m\.book_id/);
    assert.equal(access.allowed, true);
    assert.equal(access.book.cache_count, 12);
    assert.equal(access.book.like_count, 3);
});

test("QQ Gateway normalizes C2C and group mentions into namespaced identities", () => {
    const direct = normalizeQqEvent({
        t: "C2C_MESSAGE_CREATE",
        d: { id: "m1", content: "测试", author: { user_openid: "user-open" } }
    });
    assert.equal(direct.identity, "qq:user-open");
    assert.equal(direct.targetKey, "user:user-open");
    const group = normalizeQqEvent({
        t: "GROUP_AT_MESSAGE_CREATE",
        d: { id: "m2", group_openid: "group-open", content: "<@!bot> 搜索 罗生门", author: { member_openid: "member-open" } }
    });
    assert.equal(group.identity, "qq:member-open");
    assert.equal(group.targetKey, "group:group-open");
    assert.equal(group.content, "搜索 罗生门");
});

test("QQ App Access Token uses the official clientSecret payload", async () => {
    let request = null;
    const token = await requestAppAccessToken({
        appId: "10001",
        appSecret: "test-secret",
        tokenUrl: "https://token.example/app/getAppAccessToken",
        fetchImpl: async (url, options) => {
            request = { url, options, body: JSON.parse(options.body) };
            return new Response(JSON.stringify({ access_token: "access", expires_in: 7200 }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
    });
    assert.equal(token.accessToken, "access");
    assert.deepEqual(request.body, { appId: "10001", clientSecret: "test-secret" });
});

test("QQ command keyboard emits the official long-form command button payload", () => {
    const keyboard = commandKeyboard([
        [
            { label: "搜索", data: "搜索 ", enter: false, style: 0 },
            { label: "下一页", data: "下一页" }
        ]
    ]);
    assert.equal(keyboard.content.rows[0].buttons[0].action.type, 2);
    assert.equal(keyboard.content.rows[0].buttons[0].action.permission.type, 2);
    assert.equal(keyboard.content.rows[0].buttons[0].action.enter, false);
    assert.equal(keyboard.content.rows[0].buttons[0].render_data.style, 0);
    assert.equal(keyboard.content.rows[0].buttons[1].render_data.label, "下一页");
});

test("QQ Markdown fallback removes formatting escapes without damaging copy", async () => {
    const messageBodies = [];
    const api = createQqApiClient({
        credentials: () => ({ appId: "10001", appSecret: "test-secret" }),
        tokenUrl: "https://token.example/app/getAppAccessToken",
        fetchImpl: async (url, options = {}) => {
            if (String(url).includes("getAppAccessToken")) {
                return new Response(JSON.stringify({ access_token: "access", expires_in: 7200 }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
            const body = JSON.parse(options.body);
            messageBodies.push(body);
            if (body.msg_type === 2) {
                return new Response(JSON.stringify({ code: 304036, message: "no markdown permission" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                });
            }
            return new Response(JSON.stringify({ id: "plain-reply" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
    });
    await api.sendMarkdown({ kind: "user", id: "openid" }, "# 账户\n卷首书童 Lv\\.1\n#标签\n书名：A-B", { msgId: "message-1", seq: 0 });
    assert.equal(messageBodies.length, 2);
    assert.match(messageBodies[1].content, /Lv\.1/);
    assert.match(messageBodies[1].content, /#标签/);
    assert.match(messageBodies[1].content, /A-B/);
    assert.doesNotMatch(messageBodies[1].content, /\\\./);
    assert.equal(markdownToPlainText("# 标题\n---\n#标签\n书名：A-B"), "标题\n\n#标签\n书名：A-B");
});

test("QQ Markdown cards use compact mobile hierarchy and shared book facts", () => {
    const book = {
        book_id: "1047414337",
        title: "顶流手记",
        author: "油炸大金",
        platform: "qidian",
        tags: "都市 娱乐明星",
        cache_count: 92,
        total_chapters: 633,
        total_popularity: 1039,
        favorites_count: 8,
        comments_count: 3,
        like_count: 5,
        dislike_count: 1,
        description: "第一行\n第二行"
    };
    const search = searchText("顶流", [book], 1, true);
    assert.match(search, /作者：油炸大金/);
    assert.match(search, /平台：起点/);
    assert.match(search, /缓存：92\/633/);
    assert.match(search, /人气：1,039/);
    assert.doesNotMatch(search, /\*\*|`|^> /m);
    const detail = detailText(book);
    assert.match(detail, /喜欢 5　·　不喜欢 1/);
    assert.match(detail, /## 简介\n第一行\n第二行/);
    assert.doesNotMatch(detail, /\*\*|`|^> /m);
    assert.match(detailText({ ...book, cache_count: 0 }), /尚无正文缓存/);
    assert.match(styleText([{ id: "style1", label: "江湖纸卷" }], "style1", book), /顶流手记/);
    assert.match(signText({ reward: { copper: 100, exp: 60, day: 2 }, user: { copper_coins: 300 } }), /连续签到：2 天/);
    assert.equal(bookButtonLabel({ title: "一个非常非常长的书名" }, 1), "1｜一个非常非常长…");
});

test("QQ menu stays focused while help and export states carry secondary detail", () => {
    const menu = menuText({ nickname: "书友", copper_coins: 1200, silver_coins: 8 });
    assert.match(menu, /铜币 1,200/);
    assert.doesNotMatch(menu, /TXT 书号/);
    assert.match(helpText(), /TXT 书号/);
    assert.match(emptySearchText("不存在"), /暂无结果/);
    assert.match(exportStatusText("正在生成 EPUB（江湖纸卷）：1047414337"), /正在生成 EPUB/);
    assert.match(exportStatusText("TXT 导出完成：顶流手记\n已导出 633 章"), /导出完成/);
});

test("QQ search requests only downloadable cached books", async () => {
    let searchParams = null;
    const messages = [];
    const runtime = createQqMessageRuntime({
        client: {
            searchPlatforms: async () => ({ platforms: [] }),
            searchBooks: async (params) => {
                searchParams = params;
                return {
                    rows: [{ book_id: "101", title: "可下载", platform: "qidian", cache_count: 2 }],
                    page: 1,
                    limit: 30,
                    total: 1
                };
            },
            recordSearch: async () => {}
        },
        api: {
            sendMarkdown: async (_target, content, _reply, keyboard) => messages.push({ content, keyboard }),
            sendText: async () => {}
        },
        configProvider: async () => ({}),
        exportRuntime: { epubStyles: [] }
    });
    await runtime.handle({
        content: "搜索 可下载",
        identity: "qq:user-open",
        kind: "user",
        messageId: "message-search-1",
        raw: {},
        reply: { msgId: "message-search-1", seq: 0 },
        target: { kind: "user", id: "user-open" },
        targetKey: "user:user-open",
        userOpenId: "user-open"
    });
    assert.equal(searchParams.cache_min, 1);
    assert.match(messages[0].content, /可下载/);
    assert.equal(messages[0].keyboard[0][0].label, "1｜可下载");
});

test("QQ detail and export suppress false download actions without cached chapters", async () => {
    const messages = [];
    let exports = 0;
    const runtime = createQqMessageRuntime({
        client: {
            qqBookAccess: async () => ({
                allowed: true,
                book: { book_id: "101", title: "只有元信息", platform: "qidian", cache_count: 0 }
            })
        },
        api: {
            sendMarkdown: async (_target, content, _reply, keyboard) => messages.push({ content, keyboard }),
            sendText: async (_target, content) => messages.push({ content, keyboard: [] })
        },
        configProvider: async () => ({}),
        exportRuntime: {
            epubStyles: [],
            exportBook: async () => {
                exports += 1;
            }
        }
    });
    const event = (content, messageId) => ({
        content,
        identity: "qq:user-open",
        kind: "user",
        messageId,
        raw: {},
        reply: { msgId: messageId, seq: 0 },
        target: { kind: "user", id: "user-open" },
        targetKey: "user:user-open",
        userOpenId: "user-open"
    });
    await runtime.handle(event("详情 101", "message-detail-1"));
    assert.match(messages[0].content, /尚无正文缓存/);
    assert.equal(messages[0].keyboard.length, 1);
    assert.equal(messages[0].keyboard[0][0].label, "🔎 重新搜索");
    await runtime.handle(event("TXT", "message-export-1"));
    assert.equal(exports, 0);
    assert.match(messages[1].content, /暂不可下载/);
});

test("QQ daily sign-in reuses the shared account and source-aware check-in contract", async () => {
    const calls = [];
    const messages = [];
    const runtime = createQqMessageRuntime({
        client: {
            sign: async (...args) => {
                calls.push(["sign", ...args]);
                return { reward: { copper: 100, exp: 60, day: 1 }, user: { copper_coins: 200 } };
            }
        },
        api: {
            sendMarkdown: async (_target, content, _reply, keyboard) => messages.push({ content, keyboard }),
            sendText: async () => {}
        },
        configProvider: async () => ({}),
        exportRuntime: {
            ensureRegistered: async (profile) => {
                calls.push(["register", profile]);
                return { nickname: "QQ 书友", copper_coins: 100 };
            },
            epubStyles: []
        }
    });
    await runtime.handle({
        content: "签到",
        identity: "qq:user-open",
        kind: "user",
        messageId: "message-sign-1",
        raw: { author: { nickname: "QQ 书友" } },
        reply: { msgId: "message-sign-1", seq: 0 },
        target: { kind: "user", id: "user-open" },
        targetKey: "user:user-open",
        userOpenId: "user-open"
    });
    assert.equal(calls[0][0], "register");
    assert.equal(calls[0][1].id, "qq:user-open");
    assert.deepEqual(calls[1], ["sign", "qq:user-open", "qq_bot"]);
    assert.match(messages[0].content, /签到成功/);
    assert.equal(messages[0].keyboard[0][1].data, "菜单");
    await runtime.sendStatus("user:user-open", "TXT 导出完成：顶流手记\n已导出 633 章");
    assert.match(messages[1].content, /导出完成/);
    assert.equal(messages[1].keyboard[0][0].data, "搜索 ");
});

test("QQ file delivery prepares, uploads, confirms, merges and replies with file_info", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qq-bot-test-"));
    const filePath = path.join(dir, "book.epub");
    await fs.writeFile(filePath, Buffer.from("epub-content"));
    const requests = [];
    let prepareAttempts = 0;
    const fetchImpl = async (url, options = {}) => {
        requests.push({ url: String(url), method: options.method || "GET", body: options.body });
        if (String(url).includes("getAppAccessToken")) {
            return new Response(JSON.stringify({ access_token: "access", expires_in: 7200 }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (String(url).endsWith("/upload_prepare")) {
            prepareAttempts += 1;
            if (prepareAttempts === 1) {
                return new Response(JSON.stringify({ code: 40093001, message: "call inner proxy error" }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
            return new Response(
                JSON.stringify({
                    upload_id: "upload-1",
                    block_size: "100",
                    parts: [{ index: 3, block_size: "100", presigned_url: "https://upload.example/part-1" }]
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }
        if (String(url) === "https://upload.example/part-1") return new Response("", { status: 200 });
        if (String(url).endsWith("/upload_part_finish")) {
            assert.equal(JSON.parse(options.body).part_index, 3);
            return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (String(url).endsWith("/files")) {
            assert.equal(JSON.parse(options.body).file_name, "book.epub");
            return new Response(JSON.stringify({ file_info: "opaque-file-info" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (String(url).endsWith("/messages")) {
            const body = JSON.parse(options.body);
            assert.equal(body.msg_type, 7);
            assert.equal(body.media.file_info, "opaque-file-info");
            assert.equal(body.msg_id, "message-1");
            return new Response(JSON.stringify({ id: "reply-1" }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        throw new Error(`unexpected URL: ${url}`);
    };
    try {
        const api = createQqApiClient({
            fetchImpl,
            retryDelayMs: 0,
            tokenUrl: "https://token.example/app/getAppAccessToken",
            credentials: () => ({ appId: "10001", appSecret: "test-secret" })
        });
        await api.sendFile({ kind: "user", id: "openid" }, filePath, { msgId: "message-1", seq: 0 });
        assert.equal(prepareAttempts, 2);
        assert.equal(isRetryableQqUploadError(Object.assign(new Error("call inner proxy error"), { code: 40093001 })), true);
        assert.ok(requests.some((item) => item.url.endsWith("/v2/users/openid/upload_prepare")));
        assert.ok(requests.some((item) => item.url.endsWith("/v2/users/openid/upload_part_finish")));
        assert.ok(requests.some((item) => item.url.endsWith("/v2/users/openid/files")));
        assert.ok(requests.some((item) => item.url.endsWith("/v2/users/openid/messages")));
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});
