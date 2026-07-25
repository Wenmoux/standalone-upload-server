/**
 * [INPUT]: 依赖 node:test、QQ 配置策略/API/Gateway 模块及受控 Fetch/配置存储替身
 * [OUTPUT]: 提供密钥不回显、平台标签范围、事件归一化和富媒体分片上传契约回归断言
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
const { commandKeyboard, createQqApiClient, requestAppAccessToken } = require("../qq-bot/qq-api");
const { normalizeQqEvent } = require("../qq-bot/gateway");

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
            { label: "搜索", data: "搜索 ", enter: false },
            { label: "下一页", data: "下一页" }
        ]
    ]);
    assert.equal(keyboard.content.rows[0].buttons[0].action.type, 2);
    assert.equal(keyboard.content.rows[0].buttons[0].action.permission.type, 2);
    assert.equal(keyboard.content.rows[0].buttons[0].action.enter, false);
    assert.equal(keyboard.content.rows[0].buttons[1].render_data.label, "下一页");
});

test("QQ file delivery prepares, uploads, confirms, merges and replies with file_info", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qq-bot-test-"));
    const filePath = path.join(dir, "book.epub");
    await fs.writeFile(filePath, Buffer.from("epub-content"));
    const requests = [];
    const fetchImpl = async (url, options = {}) => {
        requests.push({ url: String(url), method: options.method || "GET", body: options.body });
        if (String(url).includes("getAppAccessToken")) {
            return new Response(JSON.stringify({ access_token: "access", expires_in: 7200 }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (String(url).endsWith("/upload_prepare")) {
            return new Response(
                JSON.stringify({
                    upload_id: "upload-1",
                    block_size: "100",
                    parts: [{ part_index: 0, block_size: "100", presigned_url: "https://upload.example/part-1" }]
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }
        if (String(url) === "https://upload.example/part-1") return new Response("", { status: 200 });
        if (String(url).endsWith("/upload_part_finish")) return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
        if (String(url).endsWith("/files")) {
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
            tokenUrl: "https://token.example/app/getAppAccessToken",
            credentials: () => ({ appId: "10001", appSecret: "test-secret" })
        });
        await api.sendFile({ kind: "user", id: "openid" }, filePath, { msgId: "message-1", seq: 0 });
        assert.ok(requests.some((item) => item.url.endsWith("/v2/users/openid/upload_prepare")));
        assert.ok(requests.some((item) => item.url.endsWith("/v2/users/openid/upload_part_finish")));
        assert.ok(requests.some((item) => item.url.endsWith("/v2/users/openid/files")));
        assert.ok(requests.some((item) => item.url.endsWith("/v2/users/openid/messages")));
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});
