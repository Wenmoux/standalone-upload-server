/**
 * [INPUT]: 依赖 node-html-parser 与 PO18 发现页、书架、详情、目录和正文 HTML
 * [OUTPUT]: 对外提供 PO18 URL/表单构造、HTML 解析、文本规范化、登录失效识别及 CookieInvalidError
 * [POS]: services 的 PO18 协议解析边界，把易变页面结构收敛为爬虫编排层使用的稳定领域数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { parse } = require("node-html-parser");

const PO18_BASE = "https://www.po18.tw";
const FIND_BOOKS_PATH = "/findbooks/index";

class CookieInvalidError extends Error {
    constructor(message) {
        super(message || "PO18 Cookie invalid or login required");
        this.name = "CookieInvalidError";
        this.code = "PO18_COOKIE_INVALID";
    }
}

function normalizeDigits(value = "") {
    return String(value || "").replace(/[\uFF10-\uFF19]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function normalizeText(value = "") {
    return normalizeDigits(value).replace(/\s+/g, " ").trim();
}

function parseCount(value = "") {
    const textValue = normalizeDigits(value).replace(/,/g, "");
    const match = textValue.match(/\d+/);
    return match ? Number.parseInt(match[0], 10) || 0 : 0;
}

function normalizeList(value = [], { maxItems = 80, maxLength = 40 } = {}) {
    const list = Array.isArray(value) ? value : String(value || "").split(/[\n\r,;|/、，；]+/);
    return [...new Set(list
        .map((item) => normalizeText(item).slice(0, maxLength))
        .filter(Boolean))]
        .slice(0, maxItems);
}

function attr(el, name) {
    return el?.getAttribute?.(name) || "";
}

function text(el) {
    return normalizeText(el?.textContent || "");
}

function first(root, selector) {
    if (!root || !selector) return null;
    if (Array.isArray(selector)) {
        for (const item of selector) {
            const found = root.querySelector(item);
            if (found) return found;
        }
        return null;
    }
    return root.querySelector(selector);
}

function all(root, selector) {
    if (!root || !selector) return [];
    if (Array.isArray(selector)) {
        for (const item of selector) {
            const rows = root.querySelectorAll(item);
            if (rows.length) return rows;
        }
        return [];
    }
    return root.querySelectorAll(selector);
}

function absoluteUrl(value = "", base = PO18_BASE) {
    try {
        return new URL(value, base).toString();
    } catch {
        return "";
    }
}

function bookDetailUrl(bookId) {
    return `${PO18_BASE}/books/${encodeURIComponent(String(bookId))}`;
}

function findBooksBaseUrl() {
    return `${PO18_BASE}${FIND_BOOKS_PATH}`;
}

function normalizePo18FindBooksStatus(value = "") {
    const textValue = String(value || "").trim().toLowerCase();
    if (!textValue || textValue === "-1" || textValue === "all") return "all";
    if (["writing", "ongoing", "serializing", "1", "连载", "連載"].includes(textValue)) return "1";
    if (["finish", "finished", "complete", "completed", "2", "完结", "完結"].includes(textValue)) return "2";
    return "all";
}

function normalizePo18FindBooksSort(value = "") {
    const textValue = String(value || "").trim().toLowerCase();
    const map = {
        time: "time",
        newest: "time",
        update: "time",
        popularity: "22",
        hot: "22",
        readers: "22",
        subscribe: "32",
        subscription: "32",
        collect: "42",
        favorite: "42",
        favorites: "42",
        comment: "52",
        comments: "52",
        gift: "62",
        reward: "62",
        pearl: "12"
    };
    if (["time", "12", "22", "32", "42", "52", "62"].includes(textValue)) return textValue;
    if (textValue === "words") return "time";
    return map[textValue] || "time";
}

function normalizePo18FindBooksWords(value = "") {
    const textValue = String(value || "").trim().toLowerCase();
    return ["1", "2", "3", "4", "5", "6"].includes(textValue) ? textValue : "all";
}

function normalizePo18FindBooksNew(value = "") {
    const textValue = String(value || "").trim().toLowerCase();
    return textValue === "new" ? "new" : "all";
}

function findBooksFormParams(page = 1, config = {}, token = "") {
    return {
        ...(token ? { "_po18rf-tk001": token } : {}),
        tag: config.categoryTag || "all",
        words: normalizePo18FindBooksWords(config.words),
        status: normalizePo18FindBooksStatus(config.status),
        sort: normalizePo18FindBooksSort(config.sort),
        new: normalizePo18FindBooksNew(config.newBook),
        tid: config.categoryTid || "",
        page: String(page)
    };
}

function findBooksFormBody(page = 1, config = {}, token = "") {
    const form = new URLSearchParams();
    Object.entries(findBooksFormParams(page, config, token)).forEach(([key, value]) => form.set(key, value));
    return form.toString();
}

function findBooksFilterLog(page = 1, config = {}) {
    const params = findBooksFormParams(page, config, "");
    return `tag=${params.tag || "all"} words=${params.words} status=${params.status} sort=${params.sort} new=${params.new} tid=${params.tid || "-"} page=${params.page}`;
}

function bookArticlesUrl(bookId, page = 1) {
    return `${PO18_BASE}/books/${encodeURIComponent(String(bookId))}/articles?page=${encodeURIComponent(String(page))}`;
}

function chapterContentUrl(bookId, chapterId) {
    return `${PO18_BASE}/books/${encodeURIComponent(String(bookId))}/articlescontent/${encodeURIComponent(String(chapterId))}`;
}

function chapterRefererUrl(bookId, chapterId) {
    return `${PO18_BASE}/books/${encodeURIComponent(String(bookId))}/articles/${encodeURIComponent(String(chapterId))}`;
}

function extractBookIdFromHref(href = "") {
    return String(href || "").match(/\/books\/(\d+)/)?.[1] || "";
}

function extractChapterIdFromHref(href = "") {
    const match = String(href || "").match(/\/books\/\d+\/articles\/(\d+)/);
    return match?.[1] || "";
}

function parseStatus(value = "") {
    const textValue = normalizeText(value);
    if (/完結|完结|完本|已完成/.test(textValue)) return "完结";
    if (!textValue) return "连载";
    return textValue.slice(0, 30);
}

function parseStatRows(root) {
    const out = {};
    const rows = all(root, "table.book_data tr");
    const mappings = [
        ["wordCount", ["總字數", "总字数"]],
        ["freeChapters", ["免費章回", "免费章回"]],
        ["paidChapters", ["付費章回", "付费章回"]],
        ["statusText", ["狀態", "状态"]],
        ["totalPopularity", ["累積人氣", "累积人气", "總人氣", "总人气"]],
        ["monthlyPopularity", ["本月人氣", "月人氣", "本月人气", "月人气"]],
        ["weeklyPopularity", ["週人氣", "周人氣", "周人气"]],
        ["dailyPopularity", ["本日人氣", "日人氣", "本日人气", "日人气"]],
        ["favoritesCount", ["收藏"]],
        ["purchaseCount", ["訂購數", "订购数", "訂閱數", "订阅数"]],
        ["commentsCount", ["留言", "評論", "评论"]],
        ["readersCount", ["閱讀人數", "阅读人数"]]
    ];
    for (const row of rows) {
        const label = text(first(row, "th") || row);
        const value = text(first(row, "td") || row);
        for (const [field, labels] of mappings) {
            if (out[field] !== undefined) continue;
            if (labels.some((item) => label.includes(item))) {
                out[field] = field === "statusText" ? value : parseCount(value);
            }
        }
    }
    return out;
}

function parseBookInfoList(root) {
    const out = {};
    for (const labelEl of all(root, ".book_info_list dt")) {
        const label = text(labelEl);
        const valueEl = labelEl.nextElementSibling;
        if (!valueEl || String(valueEl.rawTagName || "").toLowerCase() !== "dd") continue;
        const value = text(valueEl);
        if (!out.statusText && (label.includes("\u72c0\u614b") || label.includes("\u72b6\u6001"))) {
            out.statusText = value;
        }
    }
    return out;
}

function positiveNumbers(value = "") {
    return [...normalizeDigits(value).matchAll(/\d{1,8}/g)]
        .map((match) => Number.parseInt(match[0], 10))
        .filter((num) => Number.isFinite(num) && num > 0);
}

function parsePageCount(root, totalChapters = 0) {
    const pageSize = 100;
    const pages = [];
    const addPage = (value) => {
        const page = Number.parseInt(value, 10);
        if (Number.isFinite(page) && page > 0 && page < 100000) pages.push(page);
    };
    const addChapterCount = (value) => {
        const count = Number.parseInt(value, 10);
        if (Number.isFinite(count) && count > 0) addPage(Math.ceil(count / pageSize));
    };

    addChapterCount(totalChapters);

    for (const source of [text(first(root, "dd.statu")), text(first(root, "dd.b_statu"))].filter(Boolean)) {
        const value = normalizeDigits(source);
        const pageMatches = [...value.matchAll(/(?:\/\s*)?(\d{1,5})\s*(?:頁|页|pages?\b)/gi)];
        if (pageMatches.length) {
            pageMatches.forEach((match) => addPage(match[1]));
            continue;
        }
        const firstNumber = positiveNumbers(value)[0];
        if (firstNumber) addChapterCount(firstNumber);
    }

    for (const source of [text(first(root, ".pagination"))].filter(Boolean)) {
        const value = normalizeDigits(source);
        [...value.matchAll(/(?:\/\s*)?(\d{1,5})\s*(?:頁|页|pages?\b)/gi)].forEach((match) => addPage(match[1]));
    }

    for (const link of all(root, "a")) {
        const href = attr(link, "href");
        const onclick = attr(link, "onclick");
        const target = `${href} ${onclick}`;
        if (!/\/books\/\d+\/articles(?:[?#]|$)/i.test(target)) continue;
        const raw = normalizeDigits([href, onclick, text(link)].join(" "));
        const match = raw.match(/(?:[?&]page=|page\s*[,=]\s*['"]?)(\d{1,5})/i);
        if (match) addPage(match[1]);
    }

    return Math.max(1, ...pages);
}

function cleanDescriptionText(value = "") {
    return String(value || "")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t\f\v]+\n/g, "\n")
        .replace(/\n[ \t\f\v]+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function parseBookDetailHtml(html, bookId) {
    const root = parse(html || "");
    const titleEl = first(root, "h1.book_name");
    const title = text(titleEl).split(/[（(]/)[0].trim();
    if (!title && looksLikeAuthPage(html)) {
        throw new CookieInvalidError("PO18 page requires login or cookie refresh");
    }
    if (!title) throw new Error(`book ${bookId} title not found`);
    const authorEl = first(root, "a.book_author");
    const coverEl = first(root, ".book_cover img");
    const descEl = first(root, ".B_I_content");
    const tags = all(root, ".book_intro_tags a").map(text).filter(Boolean).join("·");
    const tagList = normalizeList(tags.replace(/·/g, "\n"));
    const info = parseBookInfoList(root);
    const stats = parseStatRows(root);
    const latest = first(root, ".new_chapter");
    const latestChapterName = latest ? text(first(latest, "h4")) : "";
    const latestChapterDate = latest ? (text(first(latest, ".date")).match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?/)?.[0] || "") : "";
    const freeChapters = Number(stats.freeChapters || 0);
    const paidChapters = Number(stats.paidChapters || 0);
    const totalChapters = freeChapters + paidChapters;

    return {
        bookId: String(bookId),
        title,
        author: text(authorEl),
        cover: absoluteUrl(attr(coverEl, "src")),
        description: cleanDescriptionText(descEl?.textContent || ""),
        descriptionHTML: descEl?.innerHTML?.trim?.() || "",
        tags,
        category: tagList[0] || "",
        wordCount: Number(stats.wordCount || 0),
        freeChapters,
        paidChapters,
        totalChapters,
        status: parseStatus(stats.statusText || info.statusText || text(first(root, ".statu-b"))),
        latestChapterName,
        latestChapterDate,
        totalPopularity: Number(stats.totalPopularity || 0),
        monthlyPopularity: Number(stats.monthlyPopularity || 0),
        weeklyPopularity: Number(stats.weeklyPopularity || 0),
        dailyPopularity: Number(stats.dailyPopularity || 0),
        favoritesCount: Number(stats.favoritesCount || 0),
        commentsCount: Number(stats.commentsCount || 0),
        purchaseCount: Number(stats.purchaseCount || 0),
        readersCount: Number(stats.readersCount || 0),
        platform: "po18",
        detailUrl: bookDetailUrl(bookId),
        pageNum: parsePageCount(root, totalChapters)
    };
}

function parseFindBooksHtml(html) {
    const root = parse(html || "");
    const rows = all(root, ".row");
    const books = [];
    const seen = new Set();
    for (const row of rows) {
        const link = first(row, ".l_bookname") || first(row, "a[href*='/books/']");
        const bookId = extractBookIdFromHref(attr(link, "href"));
        const title = text(link);
        if (!bookId || !title || seen.has(bookId)) continue;
        seen.add(bookId);
        const author = text(first(row, ".l_author"));
        const tags = all(row, ".tag").map(text).filter(Boolean).join("·");
        const status = parseStatus(text(first(row, ".statu-b")));
        books.push({
            bookId,
            title,
            author,
            tags,
            status,
            platform: "po18",
            detailUrl: bookDetailUrl(bookId)
        });
    }
    if (!books.length && looksLikeAuthPage(html)) throw new CookieInvalidError("PO18 findbooks requires login or cookie refresh");
    return books;
}

function parseCrefToken(html) {
    const root = parse(html || "");
    return attr(first(root, "input[name='_po18rf-tk001']"), "value");
}

function parseDisplayedChapterOrder(row) {
    const value = text(first(row, ".l_counter"));
    const match = value.match(/^0*(\d{1,6})$/);
    const parsed = match ? Number.parseInt(match[1], 10) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseBookshelfHtml(html) {
    const root = parse(html || "");
    const books = [];
    const seen = new Set();
    for (const link of all(root, "a[href*='/books/']")) {
        const bookId = extractBookIdFromHref(attr(link, "href"));
        const title = text(link);
        if (!bookId || !title || seen.has(bookId)) continue;
        seen.add(bookId);
        const row = link.closest?.("tr") || link.parentNode || root;
        const author = text(first(row, ".T_author") || first(row, ".l_author"));
        books.push({
            bookId,
            book_id: bookId,
            title,
            author,
            platform: "po18",
            detailUrl: bookDetailUrl(bookId)
        });
    }
    if (!books.length && looksLikeAuthPage(html)) throw new CookieInvalidError("PO18 bookshelf requires login or cookie refresh");
    return books;
}

function parseChapterAccess(value = "") {
    const textValue = normalizeText(value);
    const isFree = /免費|免费/.test(textValue);
    const hasPaidMark = /訂購|订购|購買|购买|訂閱|订阅/.test(textValue);
    return {
        isFree,
        isPurchased: isFree || !hasPaidMark
    };
}

function parseChapterListHtml(html, bookId, startIndex = 0) {
    const root = parse(html || "");
    const rows = all(root, [
        "#w0 > div[data-key] > div.c_l",
        "div[data-key] > div.c_l",
        "#w0 > div.c_l",
        "#w0 div.c_l",
        "#w0>div",
        "div.c_l"
    ]);
    const chapters = [];
    let index = startIndex;
    for (const row of rows) {
        const titleEl = first(row, ".l_chaptname");
        const link = first(row, [".l_chaptname a", ".l_btn>a", "a[href*='/articles/']"]);
        const chapterId = extractChapterIdFromHref(attr(link, "href"));
        const title = text(titleEl || link);
        if (!chapterId || !title) {
            index += 1;
            continue;
        }
        const displayed = parseDisplayedChapterOrder(row);
        const access = parseChapterAccess(text(row));
        const currentIndex = displayed ? displayed - 1 : index;
        index += 1;
        chapters.push({
            bookId: String(bookId),
            chapterId,
            title,
            index: currentIndex,
            order: displayed || currentIndex + 1,
            isFree: access.isFree,
            isPurchased: access.isPurchased
        });
    }
    if (!rows.length && looksLikeAuthPage(html)) throw new CookieInvalidError("PO18 chapter list requires login or cookie refresh");
    return { chapters, scanned: rows.length || chapters.length };
}

function htmlToText(html = "") {
    return parse(String(html || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(?:p|div|section|article|li|tr|h[1-6])>/gi, "\n")).textContent
        .replace(/\u00a0/g, " ")
        .replace(/[ \t\f\v]+\n/g, "\n")
        .replace(/\n[ \t\f\v]+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function parseChapterContentHtml(html, fallbackTitle = "") {
    const root = parse(String(html || "").replace(/&nbsp;/g, " "));
    const title = text(first(root, "h1")) || fallbackTitle;
    for (const selector of ["blockquote", "h1", "script", "style"]) {
        for (const node of root.querySelectorAll(selector)) node.remove();
    }
    const body = root.querySelector("body") || root;
    const contentHtml = body.innerHTML.trim();
    const contentText = htmlToText(contentHtml);
    if (/本章為付費章節|本章为付费章节|請先登入|请先登录|會員登入|会员登录/.test(contentText)) {
        throw new CookieInvalidError("PO18 chapter content requires a refreshed or authorized cookie");
    }
    if (!contentText || contentText.length < 10) throw new Error("chapter content is empty or too short");
    return { html: contentHtml, text: contentText, title };
}

function looksLikeAuthPage(value = "") {
    const raw = String(value || "");
    const textValue = normalizeText(raw).toLowerCase();
    if (!textValue) return false;
    if (/請先登入|请先登录|本章為付費章節|本章为付费章节/.test(textValue)) return true;
    if (/captcha|驗證碼|验证码|cf-challenge|turnstile/.test(textValue)) return true;
    const hasLoginCopy = /會員登入|会员登录|登入會員|登录会员|登錄會員|登录会员|login|signin/.test(textValue);
    const hasPasswordField = /type\s*=\s*["']password["']|name\s*=\s*["'](?:password|passwd|pwd)["']|id\s*=\s*["'](?:password|passwd|pwd)["']/i.test(raw);
    const hasLoginForm = /<form\b[^>]*(?:login|signin|member|auth)|(?:login|signin|member|auth)[^<]*<form\b/i.test(raw);
    return hasLoginCopy && (hasPasswordField || hasLoginForm);
}

function authErrorFromResponse(response) {
    const status = Number(response?.status || 0);
    const finalUrl = String(response?.url || "");
    if (status === 401 || status === 403) return new CookieInvalidError(`PO18 returned HTTP ${status}; cookie may be invalid`);
    if (/\/login|\/signin|member/i.test(finalUrl)) return new CookieInvalidError("PO18 redirected to login; cookie may be invalid");
    return null;
}

module.exports = {
    PO18_BASE,
    CookieInvalidError,
    normalizeDigits,
    normalizeText,
    normalizeList,
    bookDetailUrl,
    findBooksBaseUrl,
    findBooksFormBody,
    findBooksFilterLog,
    bookArticlesUrl,
    chapterContentUrl,
    chapterRefererUrl,
    parseBookDetailHtml,
    parseFindBooksHtml,
    parseCrefToken,
    parseBookshelfHtml,
    parseChapterListHtml,
    parseChapterContentHtml,
    looksLikeAuthPage,
    authErrorFromResponse
};
