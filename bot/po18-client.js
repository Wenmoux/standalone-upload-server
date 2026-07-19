/**
 * [INPUT]: 依赖 Fetch、node-html-parser、PO18 登录重定向/Cookie/页面语义及调用方注入的文本清洗能力
 * [OUTPUT]: 对外提供 PO18 登录字段、受保护会话验证、跳过已缓存/未购章的已购正文和跨年书架请求/解析能力
 * [POS]: bot 外部集成的 PO18 网页防腐层，把页面改版、登录失效和真空书架收敛为可区分的稳定结果
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
class Po18AuthError extends Error {
    constructor(message = "PO18 登录已失效") {
        super(message);
        this.name = "Po18AuthError";
        this.code = "PO18_AUTH_EXPIRED";
        this.retryable = false;
    }
}

function createPo18Client(deps = {}) {
    const cleanText = deps.cleanText || ((value = "") => String(value || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim());
    const { parse } = require("node-html-parser");
    const fetchImpl = deps.fetchImpl === undefined ? globalThis.fetch : deps.fetchImpl;
    const requestTimeoutMs = Math.max(1000, Number(deps.requestTimeoutMs || 20000));

function po18Headers(extra = {}) {
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        ...extra
    };
}

function cookieHeader(cookies = []) {
    const byName = new Map();
    for (const cookie of cookies) {
        if (!cookie?.name || !cookie.value || cookie.value === "deleted") continue;
        byName.delete(cookie.name);
        byName.set(cookie.name, cookie);
    }
    return [...byName.values()].map((c) => `${c.name}=${c.value}`).join("; ");
}

function parseSetCookies(headers) {
    const raw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : String(headers.get("set-cookie") || "").split(/,(?=\s*[^;,\s]+=)/);
    return raw.map((line) => {
        const parts = String(line || "").split(";").map((part) => part.trim()).filter(Boolean);
        const [name, ...valueParts] = (parts.shift() || "").split("=");
        if (!name || !valueParts.length) return null;
        const cookie = { name, value: valueParts.join("="), domain: ".po18.tw", path: "/" };
        for (const part of parts) {
            const [key, ...rest] = part.split("=");
            if (/^domain$/i.test(key)) cookie.domain = rest.join("=") || cookie.domain;
            if (/^path$/i.test(key)) cookie.path = rest.join("=") || cookie.path;
        }
        return cookie;
    }).filter(Boolean);
}

function mergeCookies(current = [], incoming = []) {
    const map = new Map(current.map((c) => [`${c.name}|${c.domain || ""}|${c.path || "/"}`, c]));
    for (const cookie of incoming) map.set(`${cookie.name}|${cookie.domain || ""}|${cookie.path || "/"}`, cookie);
    return [...map.values()].filter((c) => c.value && c.value !== "deleted");
}

function hasPo18Auth(cookies = []) {
    return cookies.some((cookie) => String(cookie.name || "").startsWith("authtoken") && cookie.value && cookie.value !== "deleted");
}

function htmlAttr(tag = "", name = "") {
    const match = String(tag || "").match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
    if (!match) return "";
    return match[2]
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">");
}

function parseLoginFields(html = "") {
    const fields = {};
    for (const match of String(html || "").matchAll(/<input\b[^>]*>/gi)) {
        const tag = match[0];
        const name = htmlAttr(tag, "name");
        if (!name) continue;
        fields[name] = htmlAttr(tag, "value");
    }
    for (const name of ["account", "pwd", "captcha", "remember_me", "comefrom_id", "owner", "front_events_id", "front_events_name", "client_ip", "url", "u"]) {
        if (!Object.prototype.hasOwnProperty.call(fields, name)) fields[name] = "";
    }
    return fields;
}

async function po18Fetch(url, options = {}, cookies = []) {
    if (!fetchImpl) throw new Error("fetch is not available");
    const redirectMode = options.redirect || "manual";
    const maxRedirects = redirectMode === "follow" ? Math.max(0, Number(options.maxRedirects ?? 5)) : 0;
    let currentUrl = String(url);
    let currentCookies = cookies;
    let requestOptions = { ...options };
    delete requestOptions.maxRedirects;
    const timeoutMs = Math.max(1000, Number(requestOptions.timeoutMs || requestTimeoutMs));
    delete requestOptions.timeoutMs;
    if (!requestOptions.signal && typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
        requestOptions.signal = AbortSignal.timeout(timeoutMs);
    }
    let response = null;

    for (let redirectCount = 0; ; redirectCount += 1) {
        const headers = po18Headers(requestOptions.headers || {});
        if (currentCookies.length) headers.Cookie = cookieHeader(currentCookies);
        response = await fetchImpl(currentUrl, { ...requestOptions, headers, redirect: "manual" });
        currentCookies = mergeCookies(currentCookies, parseSetCookies(response.headers));

        const location = response.headers.get("location");
        const shouldFollow = redirectMode === "follow"
            && [301, 302, 303, 307, 308].includes(Number(response.status))
            && location
            && redirectCount < maxRedirects;
        if (!shouldFollow) break;

        currentUrl = new URL(location, currentUrl).toString();
        const method = String(requestOptions.method || "GET").toUpperCase();
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method !== "GET" && method !== "HEAD")) {
            const { body: _body, ...rest } = requestOptions;
            requestOptions = { ...rest, method: "GET" };
        }
    }

    return { response, cookies: currentCookies, url: currentUrl };
}

function looksLikePo18AuthPage(value = "") {
    const raw = String(value || "");
    const plain = cleanText(raw).toLowerCase();
    if (/請先登入|请先登录|會員登入|会员登录/.test(plain)) return true;
    const loginCopy = /登入|login|signin/.test(plain);
    const passwordField = /type\s*=\s*["']password["']|name\s*=\s*["'](?:password|passwd|pwd)["']/i.test(raw);
    return loginCopy && passwordField;
}

function assertAuthenticatedResponse(response, html = "") {
    const status = Number(response?.status || 0);
    const location = String(response?.headers?.get?.("location") || "");
    const finalUrl = String(response?.url || "");
    if ([401, 403].includes(status)) throw new Po18AuthError(`PO18 返回 HTTP ${status}，登录已失效`);
    if (
        ([301, 302, 303, 307, 308].includes(status) && /\/panel\/startup|members\.po18\.tw\/apps\/login\.php/i.test(location)) ||
        /members\.po18\.tw\/apps\/login\.php/i.test(finalUrl) ||
        looksLikePo18AuthPage(html)
    ) {
        throw new Po18AuthError();
    }
    if (!response?.ok) throw Object.assign(new Error(`PO18 返回 HTTP ${status || "unknown"}`), { code: "PO18_UPSTREAM_ERROR" });
}

function parseBookshelfHtml(html = "") {
    const rows = [];
    const seen = new Set();
    const root = parse(String(html || ""));
    for (const link of root.querySelectorAll("a[href*='/books/']")) {
        const href = String(link.getAttribute("href") || "");
        const bookId = href.match(/\/books\/(\d+)/)?.[1] || "";
        const title = cleanText(link.textContent || "");
        if (!bookId || !title || seen.has(bookId)) continue;
        const row = link.closest?.("tr") || link.parentNode || root;
        const author = cleanText(row.querySelector?.(".T_author, .l_author, [class*='author']")?.textContent || "") || "未知作者";
        seen.add(bookId);
        rows.push({
            bid: bookId,
            book_id: bookId,
            title,
            author,
            platform: "po18",
            detail_url: `https://www.po18.tw/books/${bookId}/articles`
        });
    }
    if (!rows.length && looksLikePo18AuthPage(html)) throw new Po18AuthError();
    return rows;
}

function first(root, selectors = []) {
    for (const selector of selectors) {
        const found = root?.querySelector?.(selector);
        if (found) return found;
    }
    return null;
}

function firstRows(root, selectors = []) {
    for (const selector of selectors) {
        const rows = root?.querySelectorAll?.(selector) || [];
        if (rows.length) return rows;
    }
    return [];
}

function attr(el, name) {
    return el?.getAttribute?.(name) || "";
}

function extractChapterId(href = "", bookId = "") {
    const pattern = bookId ? new RegExp(`/books/${String(bookId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/articles/(\\d+)`) : /\/books\/\d+\/articles\/(\d+)/;
    return String(href || "").match(pattern)?.[1] || "";
}

function parseDisplayedChapterOrder(row) {
    const value = cleanText(first(row, [".l_counter"])?.textContent || "");
    const match = value.match(/^0*(\d{1,6})$/);
    const parsed = match ? Number.parseInt(match[1], 10) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseChapterAccessText(value = "") {
    const textValue = cleanText(value || "");
    const isFree = /免费|免費/.test(textValue);
    const isPaid = !isFree && /付费|付費|收费|收費|订阅|訂閱|订购|訂購|购买|購買|vip/i.test(textValue);
    return { isFree, isPaid, accessText: textValue };
}

function parseChapterListHtml(html = "", bookId = "", startIndex = 0) {
    const rows = [];
    const seen = new Set();
    const root = parse(html || "");
    const blocks = firstRows(root, [
        "#w0 > div[data-key] > div.c_l",
        "div[data-key] > div.c_l",
        "#w0 > div.c_l",
        "#w0 div.c_l",
        "#w0>div",
        "div.c_l"
    ]);
    for (const row of blocks) {
        const link = first(row, [".l_chaptname a", ".l_btn>a", "a[href*='/articles/']"]);
        const chapterId = extractChapterId(attr(link, "href"), bookId);
        if (!chapterId || seen.has(chapterId)) continue;
        seen.add(chapterId);
        const titleEl = first(row, [".l_chaptname"]);
        const title = cleanText((titleEl || link)?.textContent || "") || `章节${startIndex + rows.length + 1}`;
        const displayed = parseDisplayedChapterOrder(row);
        const access = parseChapterAccessText(row.textContent || "");
        rows.push({
            chapter_id: chapterId,
            title,
            chapter_order: displayed || startIndex + rows.length + 1,
            is_free: access.isFree,
            is_paid: access.isPaid,
            is_purchased: !access.isPaid,
            access: access.accessText
        });
    }
    if (rows.length) return rows;

    const re = new RegExp(`<a[^>]*href=["']/books/${String(bookId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/articles/(\\d+)["'][^>]*>([\\s\\S]*?)<\\/a>`, "gi");
    for (const match of String(html || "").matchAll(re)) {
        const chapterId = match[1];
        if (seen.has(chapterId)) continue;
        seen.add(chapterId);
        rows.push({
            chapter_id: chapterId,
            title: cleanText(match[2]) || `章节${startIndex + rows.length + 1}`,
            chapter_order: startIndex + rows.length + 1,
            is_free: false,
            is_paid: false,
            is_purchased: true,
            access: ""
        });
    }
    return rows;
}

async function fetchPo18PurchasedChapters(bookId, cookies = [], maxPages = 50, options = {}) {
    if (maxPages && typeof maxPages === "object") {
        options = maxPages;
        maxPages = options.maxPages || 50;
    }
    const pageLimit = Math.max(1, Math.min(100, Number(maxPages || 50)));
    const skipChapterIds = new Set(
        [...(options.skipChapterIds || [])].map((value) => String(value || "").trim()).filter(Boolean)
    );
    const freeChapterCount = Math.max(0, Number(options.freeChapterCount || 0));
    const includeMissingFree = options.includeMissingFree !== false;
    const validated = await validatePo18Session(cookies);
    cookies = validated.cookies;
    const list = [];
    const seen = new Set();
    for (let page = 1; page <= pageLimit; page += 1) {
        const { response, cookies: nextCookies } = await po18Fetch(`https://www.po18.tw/books/${bookId}/articles?page=${page}`, {}, cookies);
        cookies = nextCookies;
        assertAuthenticatedResponse(response);
        const html = await response.text();
        assertAuthenticatedResponse(response, html);
        const rows = parseChapterListHtml(html, bookId, list.length);
        if (!rows.length) break;
        for (const item of rows) {
            if (seen.has(item.chapter_id)) continue;
            seen.add(item.chapter_id);
            list.push(item);
        }
    }
    const chapters = [];
    for (let i = 0; i < list.length; i += 1) {
        const item = list[i];
        if (skipChapterIds.has(String(item.chapter_id))) continue;
        const isFree = item.is_free === true || (freeChapterCount > 0 && Number(item.chapter_order || 0) <= freeChapterCount);
        if (isFree && !includeMissingFree) continue;
        if (!isFree && item.is_paid === true) continue;
        const url = `https://www.po18.tw/books/${bookId}/articlescontent/${item.chapter_id}`;
        const { response, cookies: nextCookies } = await po18Fetch(url, {
            headers: {
                Referer: `https://www.po18.tw/books/${bookId}/articles/${item.chapter_id}`,
                "X-Requested-With": "XMLHttpRequest"
            }
        }, cookies);
        cookies = nextCookies;
        assertAuthenticatedResponse(response);
        let html = (await response.text()).replace(/&nbsp;/g, " ");
        assertAuthenticatedResponse(response, html);
        if (/本章為付費章節|本章为付费章节|請先訂購|请先订购/.test(cleanText(html))) continue;
        const pageTitle = cleanText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
        html = html.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "").replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, "").trim();
        const text = cleanText(html);
        if (text.length < 10) continue;
        chapters.push({
            chapter_id: item.chapter_id,
            title: pageTitle || item.title,
            html,
            text,
            chapter_order: item.chapter_order || i + 1,
            is_free: isFree,
            is_paid: !isFree,
            is_purchased: true,
            access: item.access || ""
        });
    }
    return chapters;
}

async function validatePo18Session(cookies = []) {
    if (!hasPo18Auth(cookies)) throw new Po18AuthError("未找到 PO18 登录 Cookie");
    const year = new Date().getFullYear();
    const { response, cookies: nextCookies } = await po18Fetch(
        `https://www.po18.tw/panel/stock_manage/buyed_lists?sort=order&date_year=${year}`,
        { headers: { Referer: "https://www.po18.tw/panel/stock_manage/buyed_lists" } },
        cookies
    );
    assertAuthenticatedResponse(response);
    const html = await response.text();
    assertAuthenticatedResponse(response, html);
    return { valid: true, cookies: nextCookies, html, year };
}

async function fetchPo18Bookshelf(cookies = [], options = {}) {
    const books = [];
    const seen = new Set();
    const startYear = new Date().getFullYear();
    const minimumYear = Math.max(2008, Math.min(startYear, Number(options.minimumYear || 2008)));
    let currentCookies = cookies;
    for (let year = startYear; year >= minimumYear; year -= 1) {
        const url = `https://www.po18.tw/panel/stock_manage/buyed_lists?sort=order&date_year=${year}`;
        const { response, cookies: nextCookies } = await po18Fetch(url, {
            headers: { Referer: "https://www.po18.tw/panel/stock_manage/buyed_lists" }
        }, currentCookies);
        currentCookies = nextCookies;
        assertAuthenticatedResponse(response);
        const html = await response.text();
        assertAuthenticatedResponse(response, html);
        const rows = parseBookshelfHtml(html);
        for (const book of rows) {
            if (seen.has(book.book_id)) continue;
            seen.add(book.book_id);
            books.push({ ...book, year });
        }
    }
    return books;
}

    return {
        po18Headers,
        cookieHeader,
        parseSetCookies,
        mergeCookies,
        hasPo18Auth,
        parseLoginFields,
        po18Fetch,
        looksLikePo18AuthPage,
        assertAuthenticatedResponse,
        parseBookshelfHtml,
        parseChapterListHtml,
        validatePo18Session,
        fetchPo18PurchasedChapters,
        fetchPo18Bookshelf
    };
}

module.exports = { Po18AuthError, createPo18Client };
