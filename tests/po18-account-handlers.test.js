/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供 PO18 私聊账号绑定、受保护会话验证、保留绑定登出与已购书架的自动化回归断言
 * [POS]: tests 的 PO18 账户交互守卫，防止过期 Cookie 被报为已登录、登出误删凭据或同步统计失真
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createPo18AccountHandlers } = require("../bot/po18-account-handlers");

function message() {
    return { from: { id: 42 }, chat: { id: 42, type: "private" } };
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
        validatePo18Session: async (cookies) => ({ valid: true, cookies }),
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

test("PO18 status validates the protected page and clears an expired session", async () => {
    const saved = [];
    const runtime = handlers({
        client: {
            po18Account: async () => ({ account: "reader", cookies: [{ name: "authtoken1", value: "expired" }] }),
            savePo18Account: async (_telegramId, payload) => saved.push(payload)
        },
        options: {
            validatePo18Session: async () => {
                throw Object.assign(new Error("expired"), { code: "PO18_AUTH_EXPIRED" });
            }
        }
    });

    await runtime.handlePo18Status(message());
    assert.deepEqual(saved, [{ cookies: [], last_status: "session_expired" }]);
    assert.match(runtime.sent.at(-1).text, /登录已失效/);
});

test("PO18 logout preserves bound credentials and only clears cookies", async () => {
    const saved = [];
    let deleted = 0;
    const runtime = handlers({
        client: {
            po18Account: async () => ({ account: "reader", password: "secret", cookies: [{ name: "authtoken1", value: "ok" }] }),
            savePo18Account: async (_telegramId, payload) => saved.push(payload),
            clearPo18Account: async () => {
                deleted += 1;
            }
        }
    });

    await runtime.handlePo18Logout(message());
    assert.equal(deleted, 0);
    assert.deepEqual(saved, [{ cookies: [], last_status: "logged_out" }]);
    assert.match(runtime.sent.at(-1).text, /账号密码已保留/);
});

test("PO18 bookshelf reports only successful favorite syncs", async () => {
    let calls = 0;
    const runtime = handlers({
        client: {
            po18Account: async () => ({ account: "reader", cookies: [{ name: "authtoken1", value: "ok" }] }),
            addBookshelf: async () => {
                calls += 1;
                if (calls === 2) throw new Error("backend unavailable");
            }
        },
        options: {
            fetchPo18Bookshelf: async () => [
                { book_id: "1", title: "书一", author: "甲" },
                { book_id: "2", title: "书二", author: "乙" }
            ],
            deliverLongGroupResult: async (_message, text) => {
                runtime.sent.push({ type: "delivered", text });
            }
        }
    });

    await runtime.handleMyBookshelf(message());
    assert.match(runtime.sent.find((item) => item.type === "delivered").text, /同步收藏 1 本，失败 1 本/);
});

test("PO18 credential commands refuse group chats", async () => {
    const runtime = handlers();
    await runtime.handlePo18Set({ from: { id: 42 }, chat: { id: -100, type: "group" } }, "reader secret");
    assert.match(runtime.sent.at(-1).text, /只能在 Bot 私聊/);
});
