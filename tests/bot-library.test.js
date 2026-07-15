/**
 * [INPUT]: 依赖 node:test/assert、Bot 书库服务、凭据加密器及受控 PostgreSQL 查询替身
 * [OUTPUT]: 提供 PO18 凭据、书架、缺书请求与分享事实持久化用例的自动化回归断言
 * [POS]: tests 的 Bot 书库领域边界守卫，确保 routes 下沉后凭据保密、字段清洗与 SQL 语义不退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createBotLibraryService } = require("../services/bot-library");
const { createCredentialCrypto } = require("../services/credential-crypto");

test("bot library service preserves encrypted PO18 credentials and bookshelf state", async () => {
    const crypto = createCredentialCrypto({ fallbackSecret: "bot-library-test" });
    const calls = [];
    const account = {
        account: "reader-account",
        password: crypto.encryptString("reader-password"),
        cookies_json: crypto.encryptJson([{ name: "token", value: "old" }]),
        updated_at: "2026-07-15T00:00:00.000Z",
        last_login_at: null,
        last_status: "ok"
    };
    const query = async (sql, params = []) => {
        calls.push({ sql, params });
        if (/SELECT account, password, cookies_json/.test(sql)) return { rows: [{ ...account }] };
        if (/INSERT INTO reader_po18_accounts/.test(sql)) {
            account.account = params[2];
            account.password = params[3];
            account.cookies_json = JSON.parse(params[4]);
            account.updated_at = "2026-07-15T01:00:00.000Z";
            return { rows: [{ account: account.account, updated_at: account.updated_at }] };
        }
        if (/FROM reader_bookshelf rb/.test(sql)) return { rows: [{ book_id: "book-1", title: "Book", cache_count: 3 }] };
        return { rows: [] };
    };
    const service = createBotLibraryService({
        query,
        findBotUserByTelegramId: async (telegramId) => ({ id: 7, telegram_id: telegramId }),
        normalizeTelegramId: (value) => String(value || "").trim(),
        credentialCrypto: crypto
    });

    const status = await service.getPo18Account("42");
    assert.equal(Object.prototype.hasOwnProperty.call(status, "password"), false);
    assert.equal(status.cookies[0].value, "old");
    const credentials = await service.getPo18Account("42", { includePassword: true });
    assert.equal(credentials.password, "reader-password");

    const saved = await service.savePo18Account("42", { cookies: [{ name: "token", value: "new" }], last_status: " refreshed " });
    assert.equal(saved.has_cookies, true);
    assert.equal(crypto.decryptString(account.password), "reader-password");
    assert.equal(crypto.decryptJson(account.cookies_json)[0].value, "new");
    await service.addBookshelfBook("42", "book-1");
    assert.deepEqual(await service.listBookshelfBooks("42"), [{ book_id: "book-1", title: "Book", cache_count: 3 }]);
    await service.removeBookshelfBook("42", "book-1");
    await service.deletePo18Account("42");
    assert.ok(calls.some((call) => /INSERT INTO reader_bookshelf/.test(call.sql)));
    assert.ok(calls.some((call) => /DELETE FROM reader_bookshelf/.test(call.sql)));
    assert.ok(calls.some((call) => /DELETE FROM reader_po18_accounts/.test(call.sql)));
});

test("bot library service upserts normalized requests and records share facts", async () => {
    const calls = [];
    const events = [];
    let insertSearch = true;
    const query = async (sql, params = []) => {
        calls.push({ sql, params });
        if (/INSERT INTO reader_search_requests/.test(sql)) {
            if (!insertSearch) return { rows: [] };
            insertSearch = false;
            return { rows: [{ id: 1, query: params[4], platform: params[7], result_count: params[8] }] };
        }
        if (/UPDATE reader_search_requests/.test(sql)) return { rows: [{ id: 1, query: params[7], platform: params[8] }] };
        if (/FROM book_metadata m/.test(sql)) {
            return { rows: [{ book_id: params[0], title: "Shared Book", platform: "po18", cache_count: 4 }] };
        }
        return { rows: [] };
    };
    const service = createBotLibraryService({
        query,
        findBotUserByTelegramId: async (telegramId) => ({ id: 9, telegram_id: telegramId }),
        normalizeTelegramId: (value) => String(value || "").trim(),
        recordEvent: async (event) => events.push(event)
    });
    const input = {
        telegram_id: " 99 ",
        query: "  不存在   的书  ",
        clean_query: "不存在的书",
        platform: "PO18",
        type: "search",
        result_count: 7,
        telegram_username: "@reader",
        nickname: "  Reader  "
    };
    const inserted = await service.upsertSearchRequest(input);
    assert.equal(inserted.already_exists, false);
    assert.equal(inserted.request.query, "不存在 的书");
    assert.equal(inserted.request.platform, "po18");
    const updated = await service.upsertSearchRequest(input);
    assert.equal(updated.already_exists, true);

    const shared = await service.recordBookShare(" book-1 ", { telegram_id: "99", telegram_username: "reader" });
    assert.equal(shared.cached_chapters, 4);
    assert.equal(events[0].eventType, "bot_share");
    assert.equal(events[0].details.alreadyInLibrary, true);
    await assert.rejects(service.upsertSearchRequest({ telegram_id: "99", query: "" }), (error) => error.status === 400);
});
