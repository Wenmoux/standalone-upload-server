const assert = require("assert/strict");
const test = require("node:test");
const {
    createPo18CrawlerService,
    parseBookDetailHtml,
    parseBookshelfHtml,
    parseChapterContentHtml,
    parseChapterListHtml,
    parseFindBooksHtml,
    parseCookieString,
    looksLikeAuthPage,
    bookFilterDecision,
    isCompleteCachedBook,
    sanitizeConfig,
    formatBookDetailLog,
    formatChapterListLog
} = require("../services/po18-crawler");

test("po18 crawler parses findbooks rows", () => {
    const rows = parseFindBooksHtml(`
      <div class="row">
        <a class="l_bookname" href="/books/123">第一本</a>
        <a class="l_author">作者A</a>
        <span class="tag">幻想</span>
        <span class="statu-b">完結</span>
      </div>
      <div class="row">
        <a class="l_bookname" href="https://www.po18.tw/books/456/articles">第二本</a>
        <a class="l_author">作者B</a>
      </div>
    `);

    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
        bookId: "123",
        title: "第一本",
        author: "作者A",
        tags: "幻想",
        status: "完结",
        platform: "po18",
        detailUrl: "https://www.po18.tw/books/123"
    });
    assert.equal(rows[1].bookId, "456");
});

test("po18 crawler parses book detail and chapter content", () => {
    const book = parseBookDetailHtml(`
      <html><body>
        <h1 class="book_name">測試書（限）</h1>
        <a class="book_author">某作者</a>
        <div class="book_cover"><img src="/cover.jpg"></div>
        <div class="B_I_content"><p>第一段</p><p>第二段</p></div>
        <div class="book_intro_tags"><a>甜文</a><a>幻想</a></div>
        <table class="book_data">
          <tr><th>總字數</th><td>12,345</td></tr>
          <tr><th>免費章回</th><td>10</td></tr>
          <tr><th>付費章回</th><td>20</td></tr>
          <tr><th>狀態</th><td>完結</td></tr>
          <tr><th>累積人氣</th><td>99</td></tr>
          <tr><th>收藏</th><td>7</td></tr>
        </table>
        <dd class="statu">共 3 頁</dd>
        <div class="new_chapter"><h4>最新章</h4><div class="date">2026-06-18 12:00</div></div>
      </body></html>
    `, "123");

    assert.equal(book.title, "測試書");
    assert.equal(book.author, "某作者");
    assert.equal(book.cover, "https://www.po18.tw/cover.jpg");
    assert.equal(book.tags, "甜文·幻想");
    assert.equal(book.wordCount, 12345);
    assert.equal(book.totalChapters, 30);
    assert.equal(book.status, "完结");
    assert.equal(book.pageNum, 3);
    assert.equal(book.latestChapterName, "最新章");

    const chapter = parseChapterContentHtml("<h1>章名</h1><p>這是一段足夠長的正文內容。</p>", "回退章名");
    assert.equal(chapter.title, "章名");
    assert.match(chapter.text, /足夠長/);
});

test("po18 crawler formats chapter logs with free and paid split", () => {
    const detail = {
        bookId: "855623",
        totalChapters: 83,
        freeChapters: 26,
        paidChapters: 57,
        status: "finished",
        pageNum: 1
    };
    const chapters = Array.from({ length: 26 }, (_, index) => ({ chapterId: String(index + 1) }));
    const candidates = chapters.slice();

    assert.equal(
        formatBookDetailLog(detail),
        "book 855623 detail loaded: chapters 83, free 26, paid 57, status finished, pages 1"
    );
    assert.equal(
        formatChapterListLog(detail, chapters, candidates, 0, 0, 5),
        "book 855623 chapter list: accessible 26, candidates 26, cached 0, locked 0, concurrency 5"
    );
});

test("po18 crawler reads detail status block and ignores comment pagination", () => {
    const book = parseBookDetailHtml(`
      <html><body>
        <h1 class="book_name">\u6545\u4e8b\u7ec6\u817b\uff081V1 \uff09</h1>
        <a class="book_author">\u897f\u51c9\u8352\u8349</a>
        <dl class="book_info_list">
          <dt>\u72c0\u614b</dt>
          <dd class="statu">\u5df2\u5b8c\u7d50<span>(\u76ee\u524d52\u7ae0\u56de)</span></dd>
        </dl>
        <table class="book_data">
          <tr><th>\u514d\u8cbb\u7ae0\u56de</th><td>52</td></tr>
          <tr><th>\u4ed8\u8cbb\u7ae0\u56de</th><td>0</td></tr>
        </table>
        <a class="num" href="/books/652799/view?page=155#Goreply">&gt;|</a>
        <div class="new_chapter"><h4>\u540e\u8bb0</h4><div class="date">\u516c\u958b 2019-01-15 12:32</div></div>
      </body></html>
    `, "652799");

    assert.equal(book.status, "\u5b8c\u7ed3");
    assert.equal(book.totalChapters, 52);
    assert.equal(book.pageNum, 1);
    assert.equal(book.latestChapterName, "\u540e\u8bb0");
});

test("po18 crawler calculates all chapter list pages like userscript", () => {
    const byChapterCount = parseBookDetailHtml(`
      <html><body>
        <h1 class="book_name">長篇測試</h1>
        <dd class="statu">250 chapters</dd>
      </body></html>
    `, "250001");
    assert.equal(byChapterCount.pageNum, 3);

    const byMetadataStats = parseBookDetailHtml(`
      <html><body>
        <h1 class="book_name">統計長篇</h1>
        <table class="book_data">
          <tr><th>免費章回</th><td>120</td></tr>
          <tr><th>付費章回</th><td>130</td></tr>
        </table>
      </body></html>
    `, "250002");
    assert.equal(byMetadataStats.totalChapters, 250);
    assert.equal(byMetadataStats.pageNum, 3);
});

test("po18 crawler parses chapter list and access status", () => {
    const parsed = parseChapterListHtml(`
      <div id="w0">
        <div><span class="l_counter">0001</span><a class="l_chaptname">免費章</a><span>免費</span><div class="l_btn"><a href="/books/123/articles/9001">讀</a></div></div>
        <div><span class="l_counter">0002</span><a class="l_chaptname">訂購章</a><span>訂購</span><div class="l_btn"><a href="/books/123/articles/9002">讀</a></div></div>
      </div>
    `, "123");

    assert.equal(parsed.chapters.length, 2);
    assert.equal(parsed.chapters[0].chapterId, "9001");
    assert.equal(parsed.chapters[0].order, 1);
    assert.equal(parsed.chapters[0].isPurchased, true);
    assert.equal(parsed.chapters[1].isPurchased, false);
});

test("po18 crawler parses current po18 chapter row structure", () => {
    const parsed = parseChapterListHtml(`
      <div data-key="1">
        <div class="c_l">
          <span class="l_counter">0001</span>
          <div class="l_chaptname"><a href="/books/123/articles/9001">第一章</a></div>
          <div class="l_btn"><a href="/books/123/articles/9001">免費</a></div>
        </div>
      </div>
    `, "123");

    assert.equal(parsed.chapters.length, 1);
    assert.equal(parsed.chapters[0].chapterId, "9001");
    assert.equal(parsed.chapters[0].title, "第一章");
    assert.equal(parsed.chapters[0].order, 1);
    assert.equal(parsed.chapters[0].isPurchased, true);
});

test("po18 crawler does not treat non-uploadable chapter rows as invalid cookie", () => {
    const parsed = parseChapterListHtml(`
      <div class="member_login">會員登入</div>
      <div data-key="1">
        <div class="c_l">
          <span class="l_counter">0001</span>
          <div class="l_chaptname">尚未購買章</div>
          <div class="l_btn">訂購</div>
        </div>
      </div>
    `, "123");

    assert.equal(parsed.chapters.length, 0);
    assert.equal(parsed.scanned, 1);
});

test("po18 crawler parses purchased bookshelf rows", () => {
    const rows = parseBookshelfHtml(`
      <table>
        <tr class="alt-row"><td><a href="/books/810001">书架书一</a></td><td class="T_author">作者甲</td></tr>
        <tr class="alt-row"><td><a href="https://www.po18.tw/books/810002/articles">书架书二</a></td><td class="T_author">作者乙</td></tr>
      </table>
    `);

    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.bookId), ["810001", "810002"]);
    assert.equal(rows[0].author, "作者甲");
});

test("po18 crawler preserves existing cookie when config save omits cookie", async () => {
    let saved = "";
    const service = createPo18CrawlerService({
        query: async () => ({ rows: [] }),
        configGet: async () => JSON.stringify({ cookie: "a=1; b=2", enabled: false }),
        configSet: async (key, value) => {
            saved = value;
        },
        upsertBook: async () => {},
        saveChapter: async () => {},
        createSystemJob: async () => ({ id: 1 }),
        updateSystemJob: async () => {},
        fetchImpl: async () => ({ ok: true, status: 200, url: "", text: async () => "" })
    });

    await service.loadConfig();
    const next = await service.saveConfig({ enabled: true, cookie: "", intervalMinutes: 30 });
    assert.equal(next.cookie, "a=1; b=2");
    assert.equal(JSON.parse(saved).cookie, "a=1; b=2");
    assert.equal(JSON.parse(saved).intervalMinutes, 30);
});

test("po18 crawler masks cookie profiles and keeps active profile", () => {
    const config = sanitizeConfig({
        cookieProfiles: [{ name: "main", cookie: "authtoken=secret; sid=1" }],
        activeCookieProfile: "main",
        subscriptionBookIds: "1, 2\n2 3",
        sourceMode: "subscription"
    });

    assert.equal(config.cookieProfiles.length, 1);
    assert.equal(config.activeCookieProfile, "main");
    assert.deepEqual(config.subscriptionBookIds, ["1", "2", "3"]);

    const service = createPo18CrawlerService({
        query: async () => ({ rows: [] }),
        upsertBook: async () => {},
        saveChapter: async () => {},
        createSystemJob: async () => ({ id: 1 }),
        updateSystemJob: async () => {},
        fetchImpl: async () => ({ ok: true, status: 200, url: "", text: async () => "" })
    });
    const masked = service.maskedConfig(config);
    assert.equal(masked.cookieProfiles[0].name, "main");
    assert.equal(masked.cookieProfiles[0].cookieConfigured, true);
    assert.equal(Object.prototype.hasOwnProperty.call(masked.cookieProfiles[0], "cookie"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(masked, "cookie"), false);
});

test("po18 crawler dedupes copied cookie headers with last value winning", () => {
    const cookies = parseCookieString("a=old; b=1; a=new; b=2");
    assert.deepEqual(cookies.map((cookie) => `${cookie.name}=${cookie.value}`), ["a=new", "b=2"]);

    const config = sanitizeConfig({
        cookieProfiles: [{ name: "main", cookie: "a=old; b=1; a=new; b=2" }],
        activeCookieProfile: "main"
    });
    assert.equal(config.cookieProfiles[0].cookie, "a=new; b=2");
});

test("po18 crawler sends one cookie value per name like document.cookie", () => {
    const config = sanitizeConfig({
        cookieProfiles: [{
            name: "main",
            cookies: [
                { name: "token", value: "old", domain: ".po18.tw", path: "/" },
                { name: "sid", value: "1", domain: ".po18.tw", path: "/" },
                { name: "token", value: "new", domain: "www.po18.tw", path: "/" }
            ]
        }],
        activeCookieProfile: "main"
    });

    assert.equal(config.cookieProfiles[0].cookie, "sid=1; token=new");
});

test("po18 crawler filters books by category, blocked tags, keywords and chapters", () => {
    const baseBook = {
        bookId: "123",
        title: "温柔故事",
        author: "作者",
        tags: "甜文·校园",
        category: "甜文",
        description: "普通简介",
        totalChapters: 60
    };

    assert.equal(bookFilterDecision(baseBook, { includeCategories: ["甜文"] }).skip, false);
    assert.equal(bookFilterDecision(baseBook, { includeCategories: ["玄幻"] }).skip, true);
    assert.equal(bookFilterDecision(baseBook, { blockedTags: ["校园"] }).skip, true);
    assert.equal(bookFilterDecision(baseBook, { blockedKeywords: ["温柔"] }).skip, true);
    assert.equal(bookFilterDecision(baseBook, { minChapters: 80 }).skip, true);
    assert.equal(bookFilterDecision(baseBook, { maxChapters: 20 }).skip, true);
});

test("po18 crawler applies chapter count range only to discover source", () => {
    const shortBook = {
        bookId: "900001",
        title: "short safe book",
        author: "author",
        tags: "safe",
        totalChapters: 16
    };

    assert.equal(bookFilterDecision(shortBook, { sourceMode: "discover", minChapters: 30 }).skip, true);
    assert.equal(bookFilterDecision(shortBook, { sourceMode: "cache", minChapters: 30 }).skip, false);
    assert.equal(bookFilterDecision(shortBook, { sourceMode: "cache", minChapters: 30, blockedKeywords: ["short"] }).skip, true);
});

test("po18 crawler detects finished books with full cache", () => {
    assert.equal(isCompleteCachedBook({
        status: "完结",
        totalChapters: 60,
        cacheCount: 60
    }), true);
    assert.equal(isCompleteCachedBook({
        status: "连载",
        totalChapters: 60,
        cacheCount: 60
    }), false);
    assert.equal(isCompleteCachedBook({
        status: "完結",
        total_chapters: 60,
        cache_count: 59
    }), false);
});

test("po18 crawler posts selected discover category parameters like the website form", async () => {
    const requests = [];
    const service = createPo18CrawlerService({
        query: async () => ({ rows: [] }),
        configGet: async () => JSON.stringify({ categoryTag: "romance", categoryTid: "12", status: "writing", sort: "popularity", words: "3" }),
        configSet: async () => {},
        upsertBook: async () => {},
        saveChapter: async () => {},
        createSystemJob: async () => ({ id: 1 }),
        updateSystemJob: async () => {},
        fetchImpl: async (url, options = {}) => {
            const method = String(options.method || "GET").toUpperCase();
            requests.push({ url: String(url), method, body: String(options.body || ""), headers: options.headers || {} });
            return {
                ok: true,
                status: 200,
                url: String(url),
                headers: { get: () => "", getSetCookie: () => [] },
                text: async () => method === "POST"
                    ? `<input name="_po18rf-tk001" value="next-token"><div class="row"><a class="l_bookname" href="/books/123">A</a></div>`
                    : `<input name="_po18rf-tk001" value="token">`
            };
        }
    });

    await service.loadConfig();
    const result = await service.testCookie({});
    assert.equal(result.ok, true);
    const post = requests.find((request) => request.method === "POST");
    assert.ok(post);
    assert.equal(new URL(post.url).pathname, "/findbooks/index");
    const body = new URLSearchParams(post.body);
    assert.equal(body.get("_po18rf-tk001"), "token");
    assert.equal(body.get("tag"), "romance");
    assert.equal(body.get("tid"), "12");
    assert.equal(body.get("status"), "1");
    assert.equal(body.get("sort"), "22");
    assert.equal(body.get("words"), "3");
    assert.equal(body.get("page"), "1");
    assert.equal(post.headers.Origin, "https://www.po18.tw");
    assert.equal(post.headers["Sec-Fetch-Mode"], "navigate");
});

test("po18 crawler does not treat a normal page login link as auth failure", () => {
    assert.equal(looksLikeAuthPage("<html><body><a>會員登入</a><div>正常列表內容</div></body></html>"), false);
    assert.equal(looksLikeAuthPage("<form action=\"/login\"><input type=\"password\" /></form><h1>會員登入</h1>"), true);
});

test("po18 crawler clamps unsafe config values", () => {
    const config = sanitizeConfig({
        startPage: -1,
        endPage: 0,
        bookConcurrency: 99,
        chapterConcurrency: 99,
        intervalMinutes: 1,
        requestRetries: 99,
        requestRetryDelayMs: 999999,
        categoryTag: "bad value",
        categoryTid: "12",
        includeCategories: "甜文,甜文,校园",
        blockedTags: "恐怖\n虐",
        blockedKeywords: "换妻；ntr",
        minChapters: 20,
        maxChapters: 10
    });
    assert.equal(config.startPage, 1);
    assert.equal(config.endPage, 1);
    assert.equal(config.bookConcurrency, 8);
    assert.equal(config.chapterConcurrency, 20);
    assert.equal(config.intervalMinutes, 5);
    assert.equal(config.requestRetries, 10);
    assert.equal(config.requestRetryDelayMs, 60000);
    assert.equal(config.categoryTag, "bad value");
    assert.equal(config.categoryTid, "12");
    assert.deepEqual(config.includeCategories, ["甜文", "校园"]);
    assert.deepEqual(config.blockedTags, ["恐怖", "虐"]);
    assert.deepEqual(config.blockedKeywords, ["换妻", "ntr"]);
    assert.equal(config.maxChapters, 20);
});
