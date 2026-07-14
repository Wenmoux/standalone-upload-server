/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供密码、会话用户和管理员鉴权服务的自动化回归断言
 * [POS]: tests 的密码、会话用户和管理员鉴权服务守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const test = require("node:test");
const { adminRoleAllows, createAuthService, cdkDuration, normalizeAdminRole, todayDateKey } = require("../services/auth");

function mockRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

function mockReq(headers = {}, session = {}) {
    return {
        session,
        get(name) {
            return headers[name] || headers[name.toLowerCase()] || "";
        }
    };
}

test("auth service hashes passwords and builds public reader payloads", () => {
    const service = createAuthService({
        crypto,
        scholarProfile: (exp) => ({ exp: Number(exp || 0), level: 3, name: "Lv3", daily_free_exports: 3 })
    });
    const password = service.hashPassword("secret", "0123456789abcdef");
    assert.equal(service.verifyPassword("secret", { salt: password.salt, password_hash: password.hash }), true);
    assert.equal(service.verifyPassword("bad", { salt: password.salt, password_hash: password.hash }), false);

    const user = service.publicReaderUser({
        id: 1,
        username: "reader",
        scholar_exp: 99,
        copper_coins: "5",
        silver_coins: "7",
        library_access: true
    });
    assert.equal(user.nickname, "reader");
    assert.equal(user.scholar_level, 3);
    assert.equal(user.daily_free_exports, 3);
});

test("auth service protects upload, bot and reader access", async () => {
    const service = createAuthService({
        crypto,
        uploadApiTokenProvider: () => "upload-token",
        botApiTokenProvider: () => "bot-token",
        query: async () => ({
            rows: [
                {
                    id: 10,
                    username: "reader",
                    membership_expires_at: new Date(Date.now() + 86400000).toISOString(),
                    membership_permanent: false,
                    library_access: true
                }
            ]
        })
    });

    let nextCalled = false;
    service.requireUploadApi(mockReq({ "X-Upload-Token": "upload-token" }), mockRes(), () => {
        nextCalled = true;
    });
    assert.equal(nextCalled, true);

    const badUpload = mockRes();
    service.requireUploadApi(mockReq({ "X-Upload-Token": "bad" }), badUpload, () => {});
    assert.equal(badUpload.statusCode, 401);

    const noBotToken = mockRes();
    createAuthService({ botApiTokenProvider: () => "" }).requireBotApi(mockReq(), noBotToken, () => {});
    assert.equal(noBotToken.statusCode, 503);

    nextCalled = false;
    service.requireBotApi(mockReq({ "X-Bot-Token": "bot-token" }), mockRes(), () => {
        nextCalled = true;
    });
    assert.equal(nextCalled, true);

    const readerReq = mockReq({}, { readerUser: { id: 10 } });
    nextCalled = false;
    await service.requireReaderContentAccess(readerReq, mockRes(), () => {
        nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(readerReq.readerUser.id, 10);
});

test("auth helpers cover CDK and telegram login signatures", () => {
    const service = createAuthService({ crypto, botUsernameForTelegram: (id) => `tg_${id}` });
    assert.equal(cdkDuration("30d").days, 30);
    assert.match(service.generateCdkCode(), /^CDK-[0-9A-F]{8}-[0-9A-F]{8}$/);
    assert.match(todayDateKey(), /^\d{4}-\d{2}-\d{2}$/);

    const botToken = "123456:abcdef";
    const authDate = Math.floor(Date.now() / 1000);
    const payload = { id: "42", first_name: "A", username: "alice", auth_date: String(authDate) };
    const checkString = Object.keys(payload)
        .sort()
        .map((key) => `${key}=${payload[key]}`)
        .join("\n");
    const secretKey = crypto.createHash("sha256").update(botToken).digest();
    payload.hash = crypto.createHmac("sha256", secretKey).update(checkString).digest("hex");

    const verified = service.verifyTelegramLoginPayload(payload, botToken);
    assert.equal(verified.ok, true);
    assert.equal(service.telegramLoginBotIdFromToken(botToken), "123456");
    assert.equal(service.telegramLoginNickname({ id: "42" }), "tg_42");
});

test("auth service exposes telegram identity helpers and bot user lookup", async () => {
    const calls = [];
    const service = createAuthService({
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            return { rows: [{ id: 1, telegram_id: params[0] }] };
        }
    });

    assert.equal(service.normalizeTelegramId(" 100 "), "100");
    assert.equal(service.normalizeChatId(" -100 "), "-100");
    assert.equal(service.botUsernameForTelegram("12 3"), "tg_12_3");

    const user = await service.findBotUserByTelegramId(" 100 ");
    assert.equal(user.telegram_id, "100");
    assert.match(calls[0].sql, /FROM reader_users WHERE telegram_id = \$1/);
});

test("admin roles enforce the documented access matrix", () => {
    const request = (method, path) => ({ method, path });

    assert.equal(normalizeAdminRole("OPERATOR"), "operator");
    assert.equal(normalizeAdminRole("unknown"), "viewer");
    assert.equal(adminRoleAllows("owner", request("DELETE", "/admin-api/auth/admins/2")), true);
    assert.equal(adminRoleAllows("owner", request("PATCH", "/admin-api/users/42/admin")), true);

    assert.equal(adminRoleAllows("operator", request("GET", "/admin-api/books")), true);
    assert.equal(adminRoleAllows("operator", request("POST", "/admin-api/books")), true);
    assert.equal(adminRoleAllows("operator", request("POST", "/admin-api/backup")), true);
    assert.equal(adminRoleAllows("operator", request("POST", "/admin-api/backup/restore")), false);
    assert.equal(adminRoleAllows("operator", request("PUT", "/admin-api/config/telegram")), false);
    assert.equal(adminRoleAllows("operator", request("PATCH", "/admin-api/users/42/admin")), false);

    assert.equal(adminRoleAllows("moderator", request("GET", "/admin-api/corrections")), true);
    assert.equal(adminRoleAllows("moderator", request("POST", "/admin-api/corrections/1/approve")), true);
    assert.equal(adminRoleAllows("moderator", request("DELETE", "/admin-api/books/1")), false);

    assert.equal(adminRoleAllows("viewer", request("GET", "/admin-api/books")), true);
    assert.equal(adminRoleAllows("viewer", request("GET", "/admin-api/config/telegram")), false);
    assert.equal(adminRoleAllows("viewer", request("GET", "/admin-api/system/api-tokens")), false);
    assert.equal(adminRoleAllows("viewer", request("POST", "/admin-api/auth/logout")), true);
    assert.equal(adminRoleAllows("viewer", request("POST", "/admin-api/jobs/1/cancel")), false);

    for (const role of ["operator", "moderator", "viewer"]) {
        assert.equal(adminRoleAllows(role, request("GET", "/admin-api/auth/admins")), false);
    }
});
