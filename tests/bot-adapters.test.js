/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供 Bot 外部适配器的请求、PO18 会话/跨年书架/已购与缺失章筛选和错误规范化回归断言
 * [POS]: tests 的 Bot 外协议守卫，防止 PO18 页面改版、空年份或登录重定向被静默误判
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
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

test("po18 client parses current bookshelf links without legacy alt-row markup", () => {
    const { parseBookshelfHtml } = createPo18Client();
    const rows = parseBookshelfHtml(`
        <section class="purchase-card">
          <a href="https://www.po18.tw/books/810002/articles">书架书二</a>
          <span class="l_author">作者乙</span>
        </section>
    `);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].book_id, "810002");
    assert.equal(rows[0].author, "作者乙");
});

test("po18 client scans older purchased years after consecutive empty years", async () => {
    const currentYear = new Date().getFullYear();
    const requestedYears = [];
    const { fetchPo18Bookshelf } = createPo18Client({
        fetchImpl: async (url) => {
            const year = Number(new URL(url).searchParams.get("date_year"));
            requestedYears.push(year);
            const html = year === currentYear - 4 ? '<a href="/books/9001">旧年已购书</a><span class="l_author">作者</span>' : "";
            return {
                ok: true,
                status: 200,
                url,
                headers: { get: () => "", getSetCookie: () => [] },
                text: async () => html
            };
        }
    });

    const rows = await fetchPo18Bookshelf([{ name: "authtoken1", value: "ok" }], { minimumYear: currentYear - 4 });
    assert.deepEqual(requestedYears, [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4]);
    assert.equal(rows[0].book_id, "9001");
});

test("po18 client reports protected-page redirects as expired auth", async () => {
    const { validatePo18Session } = createPo18Client({
        fetchImpl: async () => ({
            ok: false,
            status: 302,
            url: "https://www.po18.tw/panel/stock_manage/buyed_lists",
            headers: {
                get: (name) => (String(name).toLowerCase() === "location" ? "https://www.po18.tw/panel/startup" : ""),
                getSetCookie: () => []
            },
            text: async () => ""
        })
    });

    await assert.rejects(
        validatePo18Session([{ name: "authtoken1", value: "stale" }]),
        (error) => error.code === "PO18_AUTH_EXPIRED" && error.retryable === false
    );
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
        is_purchased: true,
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
    assert.equal(rows[1].is_purchased, false);
});

test("po18 client fetches only missing free and readable purchased chapters", async () => {
    const requested = [];
    const response = (url, html) => ({
        ok: true,
        status: 200,
        url,
        headers: { get: () => "", getSetCookie: () => [] },
        text: async () => html
    });
    const { fetchPo18PurchasedChapters } = createPo18Client({
        fetchImpl: async (url) => {
            requested.push(url);
            if (url.includes("/panel/stock_manage/buyed_lists")) return response(url, "");
            if (url.includes("/articles?page=1")) {
                return response(
                    url,
                    `
                    <div data-key="1"><div class="c_l"><span class="l_counter">0001</span><div class="l_chaptname"><a href="/books/123/articles/1">免费章</a></div><span>免費</span></div></div>
                    <div data-key="2"><div class="c_l"><span class="l_counter">0002</span><div class="l_chaptname"><a href="/books/123/articles/2">已购章</a></div><span>閱讀</span></div></div>
                    <div data-key="3"><div class="c_l"><span class="l_counter">0003</span><div class="l_chaptname"><a href="/books/123/articles/3">未购章</a></div><span>訂購</span></div></div>
                    `
                );
            }
            if (url.includes("/articlescontent/2")) return response(url, "<h1>已购章</h1><p>这是账号已经购买并可以阅读的正文内容。</p>");
            throw new Error(`unexpected PO18 request: ${url}`);
        }
    });

    const chapters = await fetchPo18PurchasedChapters(
        "123",
        [{ name: "authtoken1", value: "ok" }],
        { maxPages: 1, skipChapterIds: new Set(["1"]), freeChapterCount: 1, includeMissingFree: true }
    );
    assert.deepEqual(chapters.map((chapter) => chapter.chapter_id), ["2"]);
    assert.equal(chapters[0].is_paid, true);
    assert.equal(requested.some((url) => url.includes("/articlescontent/1")), false);
    assert.equal(requested.some((url) => url.includes("/articlescontent/3")), false);
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
