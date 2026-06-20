const assert = require("assert/strict");
const test = require("node:test");
const { createPo18Client } = require("../bot/po18-client");
const { createRemoteStorage } = require("../bot/remote-storage");
const { createTelegramClient } = require("../bot/telegram");

test("po18 client parses bookshelf rows and auth cookies", () => {
    const { parseBookshelfHtml, hasPo18Auth } = createPo18Client();
    const rows = parseBookshelfHtml(`
        <tr class="alt-row">
            <td><a href="/books/123">Book <b>Title</b></a></td>
            <td class="T_author">Author</td>
        </tr>
    `);

    assert.deepEqual(rows, [{
        bid: "123",
        book_id: "123",
        title: "Book Title",
        author: "Author",
        platform: "po18",
        detail_url: "https://www.po18.tw/books/123/articles"
    }]);
    assert.equal(hasPo18Auth([{ name: "authtoken_main", value: "abc" }]), true);
    assert.equal(hasPo18Auth([{ name: "authtoken_main", value: "deleted" }]), false);
});

test("po18 client parses all login input fields", () => {
    const { parseLoginFields } = createPo18Client();
    const fields = parseLoginFields(`
        <form>
          <input type="hidden" name="_po18rf-tk001" value="csrf&amp;token">
          <input value="https://www.po18.tw/site/alarm" name="u">
          <input type="checkbox" name="remember_me" value="1">
        </form>
    `);

    assert.equal(fields["_po18rf-tk001"], "csrf&token");
    assert.equal(fields.u, "https://www.po18.tw/site/alarm");
    assert.equal(fields.remember_me, "1");
    assert.equal(fields.account, "");
});

test("po18 client parses current chapter rows and displayed order", () => {
    const { parseChapterListHtml } = createPo18Client();
    const rows = parseChapterListHtml(`
        <div data-key="1">
          <div class="c_l">
            <span class="l_counter">0004</span>
            <div class="l_chaptname"><a href="/books/123/articles/9004">第四章</a></div>
            <div class="l_btn"><a href="/books/123/articles/9004">閱讀</a></div>
          </div>
        </div>
    `, "123");

    assert.deepEqual(rows, [{
        chapter_id: "9004",
        title: "第四章",
        chapter_order: 4,
        is_free: false,
        is_paid: false,
        access: "0004\n            第四章\n            閱讀"
    }]);
});

test("po18 client marks free and paid chapter rows", () => {
    const { parseChapterListHtml } = createPo18Client();
    const rows = parseChapterListHtml(`
        <div data-key="1"><div class="c_l"><span class="l_counter">0001</span><div class="l_chaptname"><a href="/books/123/articles/9001">免费章</a></div><span>免費</span></div></div>
        <div data-key="2"><div class="c_l"><span class="l_counter">0002</span><div class="l_chaptname"><a href="/books/123/articles/9002">订购章</a></div><span>訂購</span></div></div>
    `, "123");

    assert.equal(rows[0].is_free, true);
    assert.equal(rows[0].is_paid, false);
    assert.equal(rows[1].is_free, false);
    assert.equal(rows[1].is_paid, true);
});

test("po18 client follows redirects with a cookie jar", async () => {
    const seen = [];
    const { po18Fetch } = createPo18Client({
        fetchImpl: async (url, options) => {
            seen.push({ url, cookie: options.headers.Cookie || "" });
            if (seen.length === 1) {
                return {
                    ok: false,
                    status: 302,
                    headers: {
                        get: (name) => String(name).toLowerCase() === "location" ? "/captcha-final" : "",
                        getSetCookie: () => ["sid=first; Path=/"]
                    },
                    text: async () => ""
                };
            }
            return {
                ok: true,
                status: 200,
                headers: { get: () => "", getSetCookie: () => [] },
                text: async () => "ok"
            };
        }
    });

    const result = await po18Fetch("https://members.po18.tw/apps/images.php", { redirect: "follow" });
    assert.equal(result.response.status, 200);
    assert.equal(seen.length, 2);
    assert.equal(seen[1].url, "https://members.po18.tw/captcha-final");
    assert.equal(seen[1].cookie, "sid=first");
});

test("telegram photo sender rejects empty buffers before API call", async () => {
    const client = createTelegramClient({ token: "test-token" });
    await assert.rejects(() => client.sendPhoto(1, Buffer.alloc(0), "empty.jpg"), /photo is empty/);
});

test("remote storage builds encoded webdav urls", () => {
    const { webdavUrl } = createRemoteStorage({ fetchImpl: null });
    assert.equal(
        webdavUrl({ url: "https://dav.example/root" }, "/小说/Book 1.txt"),
        "https://dav.example/root/%E5%B0%8F%E8%AF%B4/Book%201.txt"
    );
});
