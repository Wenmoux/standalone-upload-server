/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供PO18 账号绑定、验证码与书架命令的自动化回归断言
 * [POS]: tests 的PO18 账号绑定、验证码与书架命令守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createPo18AccountHandlers } = require("../bot/po18-account-handlers");

function message() {
    return { from: { id: 42 }, chat: { id: 42 } };
}

function handlers(overrides = {}) {
    const sent = [];
    const client = {
        po18Account: async () => ({ account: "reader", password: "secret", cookies: [] }),
        savePo18Account: async () => {},
        clearPo18Account: async () => {},
        addBookshelf: async () => {},
        ...(overrides.client || {})
    };
    const instance = createPo18AccountHandlers({
        client,
        ensureRegistered: async () => {},
        sendMessage: async (chatId, text) => { sent.push({ type: "message", chatId, text }); return { message_id: 1 }; },
        sendPhoto: async (chatId, image, fileName, caption) => { sent.push({ type: "photo", chatId, image, fileName, caption }); },
        editMessage: async (chatId, messageId, text) => { sent.push({ type: "edit", chatId, messageId, text }); },
        deliverLongGroupResult: async () => {},
        escapeHtml: (value) => String(value),
        callback: (parts) => parts.join(":"),
        parseLoginFields: () => ({ token: "x" }),
        hasPo18Auth: (cookies) => cookies.some((cookie) => cookie.name === "authtoken1"),
        fetchPo18Bookshelf: async () => [],
        ...(overrides.options || {})
    });
    return { ...instance, client, sent };
}

test("PO18 login handler rejects empty captcha images instead of sending empty files", async () => {
    let calls = 0;
    const runtime = handlers({
        options: {
            po18Fetch: async () => {
                calls += 1;
                if (calls === 1) return { response: { ok: true, text: async () => "<form></form>" }, cookies: [] };
                return {
                    response: { ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => new ArrayBuffer(0) },
                    cookies: []
                };
            }
        }
    });

    await runtime.handleLoginPo18(message());
    assert.equal(runtime.sent.some((item) => item.type === "photo"), false);
    assert.match(runtime.sent.at(-1).text, /验证码图片为空/);
});

test("PO18 code handler persists authenticated cookies", async () => {
    const saved = [];
    let calls = 0;
    const runtime = handlers({
        client: { savePo18Account: async (telegramId, payload) => saved.push({ telegramId, payload }) },
        options: {
            po18Fetch: async (url) => {
                calls += 1;
                if (calls === 1) return { response: { ok: true, text: async () => "<form></form>" }, cookies: [] };
                if (calls === 2) {
                    return {
                        response: { ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => Buffer.from("png") },
                        cookies: [{ name: "session", value: "1" }]
                    };
                }
                assert.match(url, /login\.php$/);
                return { cookies: [{ name: "authtoken1", value: "ok" }] };
            }
        }
    });

    await runtime.handleLoginPo18(message());
    await runtime.handlePo18Code(message(), "1234");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].telegramId, 42);
    assert.equal(saved[0].payload.last_status, "login_ok");
    assert.match(runtime.sent.at(-1).text, /登录成功/);
});
