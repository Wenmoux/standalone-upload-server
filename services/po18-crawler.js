const { parse } = require("node-html-parser");

const CONFIG_KEY = "po18_crawler_config";
const JOB_TYPE = "po18_crawler_run";
const PO18_BASE = "https://www.po18.tw";
const FIND_BOOKS_PATH = "/findbooks/index";
const MAX_LOGS = 120;

const DEFAULT_CONFIG = Object.freeze({
    enabled: false,
    startPage: 1,
    endPage: 20,
    maxBooksPerRun: 200,
    categoryTag: "all",
    categoryTid: "",
    includeCategories: [],
    blockedTags: [],
    blockedKeywords: [],
    minChapters: 0,
    maxChapters: 0,
    sort: "time",
    status: "all",
    words: "all",
    newBook: "all",
    bookConcurrency: 1,
    chapterConcurrency: 3,
    delayMs: 800,
    requestIntervalMs: 250,
    timeoutMs: 20000,
    requestRetries: 2,
    requestRetryDelayMs: 1200,
    uploadMetadata: true,
    uploadChapters: true,
    skipCached: true,
    overwrite: false,
    intervalMinutes: 360,
    sourceMode: "discover",
    subscriptionBookIds: [],
    cacheIdLimit: 500,
    bookshelfStartYear: 2010,
    bookshelfEmptyYearStop: 3,
    cookie: "",
    cookieProfiles: [],
    activeCookieProfile: "",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
});

class CookieInvalidError extends Error {
    constructor(message) {
        super(message || "PO18 Cookie invalid or login required");
        this.name = "CookieInvalidError";
        this.code = "PO18_COOKIE_INVALID";
    }
}

class CrawlerStoppedError extends Error {
    constructor(message = "crawler stopped") {
        super(message);
        this.name = "CrawlerStoppedError";
        this.code = "PO18_CRAWLER_STOPPED";
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function intValue(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    const safe = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(min, Math.min(max, safe));
}

function boolValue(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    return ["1", "true", "yes", "on", "enabled"].includes(String(value).trim().toLowerCase());
}

function normalizeDigits(value = "") {
    return String(value || "").replace(/[\uFF10-\uFF19]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function normalizeText(value = "") {
    return normalizeDigits(value).replace(/\s+/g, " ").trim();
}

function parseCount(value = "") {
    const text = normalizeDigits(value).replace(/,/g, "");
    const match = text.match(/\d+/);
    return match ? Number.parseInt(match[0], 10) || 0 : 0;
}

function safeJsonParse(value, fallback = {}) {
    try {
        const parsed = JSON.parse(String(value || ""));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function normalizeBookIds(value = []) {
    const list = Array.isArray(value) ? value : String(value || "").split(/[\s,;，；]+/);
    return [...new Set(list.map((item) => String(item || "").trim()).filter((item) => /^\d+$/.test(item)))];
}

function normalizeList(value = [], { maxItems = 80, maxLength = 40 } = {}) {
    const list = Array.isArray(value) ? value : String(value || "").split(/[\n\r,;|/、，；]+/);
    return [...new Set(list
        .map((item) => normalizeText(item).slice(0, maxLength))
        .filter(Boolean))]
        .slice(0, maxItems);
}

function normalizeSmallToken(value = "", fallback = "") {
    const textValue = normalizeText(value).replace(/[<>"'`&]/g, "").slice(0, 40);
    if (!textValue) return fallback;
    return textValue;
}

function parseCookieString(cookieString = "") {
    const cookies = String(cookieString || "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const index = part.indexOf("=");
            if (index <= 0) return null;
            const name = part.slice(0, index).trim();
            const value = part.slice(index + 1).trim();
            return name ? { name, value, domain: ".po18.tw", path: "/" } : null;
        })
        .filter(Boolean);
    return mergeCookies([], cookies);
}

function cookieHeader(cookies = []) {
    const byName = new Map();
    for (const cookie of mergeCookies([], cookies)) {
        if (!cookie?.name || !cookie.value || cookie.value === "deleted") continue;
        byName.delete(cookie.name);
        byName.set(cookie.name, cookie);
    }
    return [...byName.values()]
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");
}

function cookieProfileToHeader(profile = {}) {
    if (Array.isArray(profile.cookies) && profile.cookies.length) return cookieHeader(profile.cookies);
    const cookie = String(profile.cookie || "").trim();
    if (cookie) return cookie;
    return cookieHeader(Array.isArray(profile.cookies) ? profile.cookies : []);
}

function parseSetCookieHeaders(headers) {
    if (!headers) return [];
    const raw = typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : String(headers.get?.("set-cookie") || "").split(/,(?=\s*[^;,\s]+=)/);
    return raw.map((line) => {
        const parts = String(line || "").split(";").map((part) => part.trim()).filter(Boolean);
        const first = parts.shift() || "";
        const index = first.indexOf("=");
        if (index <= 0) return null;
        const cookie = { name: first.slice(0, index).trim(), value: first.slice(index + 1), domain: ".po18.tw", path: "/" };
        for (const part of parts) {
            const [rawKey, ...rest] = part.split("=");
            const key = String(rawKey || "").toLowerCase();
            if (key === "domain") cookie.domain = rest.join("=") || cookie.domain;
            if (key === "path") cookie.path = rest.join("=") || cookie.path;
        }
        return cookie.name ? cookie : null;
    }).filter(Boolean);
}

function mergeCookies(current = [], incoming = []) {
    const map = new Map();
    for (const cookie of current || []) {
        if (!cookie?.name) continue;
        map.set(`${cookie.name}|${cookie.domain || ""}|${cookie.path || "/"}`, cookie);
    }
    for (const cookie of incoming || []) {
        if (!cookie?.name) continue;
        map.set(`${cookie.name}|${cookie.domain || ""}|${cookie.path || "/"}`, cookie);
    }
    return [...map.values()].filter((cookie) => cookie.value && cookie.value !== "deleted");
}

function normalizeCookieProfile(profile = {}, index = 0) {
    const name = String(profile.name || profile.label || profile.id || `cookie-${index + 1}`).trim().slice(0, 80) || `cookie-${index + 1}`;
    const rawCookie = String(profile.cookie || "").trim();
    const cookies = mergeCookies([], Array.isArray(profile.cookies) ? profile.cookies : parseCookieString(rawCookie));
    const cookie = cookieHeader(cookies) || rawCookie;
    return {
        id: String(profile.id || name).trim().slice(0, 100) || name,
        name,
        cookie,
        cookies,
        enabled: boolValue(profile.enabled, true),
        lastStatus: String(profile.lastStatus || "").slice(0, 160),
        lastUsedAt: profile.lastUsedAt || null,
        updatedAt: profile.updatedAt || new Date().toISOString()
    };
}

function normalizeCookieProfiles(value = [], legacyCookie = "") {
    const input = Array.isArray(value) ? value : [];
    const profiles = input.map(normalizeCookieProfile).filter((profile) => cookieProfileToHeader(profile));
    const legacy = String(legacyCookie || "").trim();
    if (legacy && !profiles.some((profile) => cookieProfileToHeader(profile) === legacy)) {
        profiles.unshift(normalizeCookieProfile({ id: "default", name: "default", cookie: legacy, enabled: true }, 0));
    }
    return profiles.slice(0, 20);
}

function maskCookieProfiles(profiles = []) {
    return profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        enabled: profile.enabled !== false,
        cookieConfigured: !!cookieProfileToHeader(profile),
        cookieLength: cookieProfileToHeader(profile).length,
        cookieCount: parseCookieString(cookieProfileToHeader(profile)).length,
        lastStatus: profile.lastStatus || "",
        lastUsedAt: profile.lastUsedAt || null,
        updatedAt: profile.updatedAt || null
    }));
}

function profileKey(profile = {}) {
    return String(profile.id || profile.name || "").trim();
}

function sanitizeConfig(input = {}, current = {}) {
    const merged = { ...DEFAULT_CONFIG, ...current, ...(input || {}) };
    const startPage = intValue(merged.startPage, DEFAULT_CONFIG.startPage, 1, 100000);
    const endPage = Math.max(startPage, intValue(merged.endPage, DEFAULT_CONFIG.endPage, 1, 100000));
    const sourceMode = ["discover", "bookshelf", "cache", "subscription"].includes(String(merged.sourceMode || "").trim())
        ? String(merged.sourceMode).trim()
        : DEFAULT_CONFIG.sourceMode;
    const rawCookie = String(merged.cookie || "").trim();
    const cookie = cookieHeader(parseCookieString(rawCookie)) || rawCookie;
    const cookieProfiles = normalizeCookieProfiles(merged.cookieProfiles, cookie);
    const activeCookieProfile = String(merged.activeCookieProfile || profileKey(cookieProfiles[0]) || "").trim();
    const minChapters = intValue(merged.minChapters, DEFAULT_CONFIG.minChapters, 0, 100000);
    const rawMaxChapters = intValue(merged.maxChapters, DEFAULT_CONFIG.maxChapters, 0, 100000);
    const maxChapters = rawMaxChapters > 0 && rawMaxChapters < minChapters ? minChapters : rawMaxChapters;
    return {
        enabled: boolValue(merged.enabled, DEFAULT_CONFIG.enabled),
        startPage,
        endPage,
        maxBooksPerRun: intValue(merged.maxBooksPerRun, DEFAULT_CONFIG.maxBooksPerRun, 1, 5000),
        categoryTag: normalizeSmallToken(merged.categoryTag, DEFAULT_CONFIG.categoryTag),
        categoryTid: normalizeSmallToken(merged.categoryTid, DEFAULT_CONFIG.categoryTid),
        includeCategories: normalizeList(merged.includeCategories),
        blockedTags: normalizeList(merged.blockedTags),
        blockedKeywords: normalizeList(merged.blockedKeywords, { maxItems: 120, maxLength: 60 }),
        minChapters,
        maxChapters,
        sort: String(merged.sort || DEFAULT_CONFIG.sort).trim() || DEFAULT_CONFIG.sort,
        status: String(merged.status || DEFAULT_CONFIG.status).trim() || DEFAULT_CONFIG.status,
        words: String(merged.words || DEFAULT_CONFIG.words).trim() || DEFAULT_CONFIG.words,
        newBook: String(merged.newBook || DEFAULT_CONFIG.newBook).trim() || DEFAULT_CONFIG.newBook,
        bookConcurrency: intValue(merged.bookConcurrency, DEFAULT_CONFIG.bookConcurrency, 1, 8),
        chapterConcurrency: intValue(merged.chapterConcurrency, DEFAULT_CONFIG.chapterConcurrency, 1, 20),
        delayMs: intValue(merged.delayMs, DEFAULT_CONFIG.delayMs, 0, 60000),
        requestIntervalMs: intValue(merged.requestIntervalMs, DEFAULT_CONFIG.requestIntervalMs, 0, 30000),
        timeoutMs: intValue(merged.timeoutMs, DEFAULT_CONFIG.timeoutMs, 5000, 120000),
        requestRetries: intValue(merged.requestRetries, DEFAULT_CONFIG.requestRetries, 0, 10),
        requestRetryDelayMs: intValue(merged.requestRetryDelayMs, DEFAULT_CONFIG.requestRetryDelayMs, 0, 60000),
        uploadMetadata: boolValue(merged.uploadMetadata, true),
        uploadChapters: boolValue(merged.uploadChapters, true),
        skipCached: boolValue(merged.skipCached, true),
        overwrite: boolValue(merged.overwrite, false),
        intervalMinutes: intValue(merged.intervalMinutes, DEFAULT_CONFIG.intervalMinutes, 5, 10080),
        sourceMode,
        subscriptionBookIds: normalizeBookIds(merged.subscriptionBookIds),
        cacheIdLimit: intValue(merged.cacheIdLimit, DEFAULT_CONFIG.cacheIdLimit, 1, 10000),
        bookshelfStartYear: intValue(merged.bookshelfStartYear, DEFAULT_CONFIG.bookshelfStartYear, 2008, new Date().getFullYear()),
        bookshelfEmptyYearStop: intValue(merged.bookshelfEmptyYearStop, DEFAULT_CONFIG.bookshelfEmptyYearStop, 1, 12),
        cookie,
        cookieProfiles,
        activeCookieProfile,
        userAgent: String(merged.userAgent || DEFAULT_CONFIG.userAgent).trim() || DEFAULT_CONFIG.userAgent
    };
}

function publicConfig(config = {}) {
    const profiles = normalizeCookieProfiles(config.cookieProfiles, config.cookie);
    return {
        ...config,
        cookieConfigured: !!String(config.cookie || "").trim() || profiles.some((profile) => !!cookieProfileToHeader(profile)),
        cookieLength: String(config.cookie || "").length || (profiles[0] ? cookieProfileToHeader(profiles[0]).length : 0),
        cookieProfileCount: profiles.length,
        cookieProfiles: maskCookieProfiles(profiles)
    };
}

function maskedConfig(config = {}) {
    const out = publicConfig(config);
    delete out.cookie;
    return out;
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
    const pageText = text(root);
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

function normalizedHaystack(...parts) {
    return normalizeText(parts.filter(Boolean).join(" ")).toLowerCase();
}

function bookTagList(book = {}) {
    return normalizeList([
        book.category,
        String(book.tags || "").replace(/[·]/g, "\n")
    ].filter(Boolean).join("\n")).map((item) => item.toLowerCase());
}

function includesAnyToken(haystack = "", tokens = []) {
    const value = String(haystack || "").toLowerCase();
    return tokens.some((token) => token && value.includes(String(token).toLowerCase()));
}

function hasTagMatch(tags = [], tokens = []) {
    const needles = tokens.map((item) => String(item || "").toLowerCase()).filter(Boolean);
    if (!needles.length) return false;
    return tags.some((tag) => needles.some((needle) => tag === needle || tag.includes(needle) || needle.includes(tag)));
}

function bookChapterCount(book = {}) {
    return Math.max(
        Number(book.totalChapters || book.total_chapters || 0),
        Number(book.subscribedChapters || book.subscribed_chapters || 0),
        Number(book.chapterCount || book.chapter_count || 0),
        Number(book.freeChapters || book.free_chapters || 0) + Number(book.paidChapters || book.paid_chapters || 0)
    ) || 0;
}

function formatBookDetailLog(detail = {}) {
    const total = bookChapterCount(detail) || 0;
    const free = Number(detail.freeChapters || detail.free_chapters || 0) || 0;
    const paid = Number(detail.paidChapters || detail.paid_chapters || 0) || 0;
    const split = free || paid ? `, free ${free}, paid ${paid}` : "";
    return `book ${detail.bookId || detail.book_id || ""} detail loaded: chapters ${total}${split}, status ${detail.status || "-"}, pages ${detail.pageNum || detail.page_num || 1}`.trim();
}

function formatChapterListLog(detail = {}, chapters = [], candidates = [], skippedCached = 0, skippedLocked = 0, concurrency = 1) {
    return `book ${detail.bookId || detail.book_id || ""} chapter list: accessible ${chapters.length}, candidates ${candidates.length}, cached ${skippedCached}, locked ${skippedLocked}, concurrency ${concurrency}`.trim();
}

function isFinishedStatus(value = "") {
    return /完结|完結|完本|已完成/.test(normalizeText(value));
}

function isCompleteCachedBook(book = {}) {
    const expected = bookChapterCount(book);
    const cached = Number(book.cacheCount || book.cache_count || 0) || 0;
    return expected > 0 && cached >= expected && isFinishedStatus(book.status || "");
}

function bookFilterDecision(book = {}, config = {}) {
    const includeCategories = normalizeList(config.includeCategories);
    const blockedTags = normalizeList(config.blockedTags);
    const blockedKeywords = normalizeList(config.blockedKeywords, { maxItems: 120, maxLength: 60 });
    const sourceMode = String(config.sourceMode || "discover").trim();
    const tags = bookTagList(book);
    if (includeCategories.length && !hasTagMatch(tags, includeCategories)) {
        return { skip: true, reason: `category not selected: ${includeCategories.join("/")}` };
    }
    if (blockedTags.length && hasTagMatch(tags, blockedTags)) {
        return { skip: true, reason: `blocked tag: ${blockedTags.join("/")}` };
    }
    const chapters = bookChapterCount(book);
    const minChapters = Number(config.minChapters || 0);
    const maxChapters = Number(config.maxChapters || 0);
    if (sourceMode === "discover") {
        if (minChapters > 0 && chapters > 0 && chapters < minChapters) {
            return { skip: true, reason: `chapters ${chapters} < ${minChapters}` };
        }
        if (maxChapters > 0 && chapters > maxChapters) {
            return { skip: true, reason: `chapters ${chapters} > ${maxChapters}` };
        }
    }
    const haystack = normalizedHaystack(book.bookId, book.title, book.author, book.tags, book.category, book.status, book.description);
    if (blockedKeywords.length && includesAnyToken(haystack, blockedKeywords)) {
        return { skip: true, reason: `blocked keyword: ${blockedKeywords.find((keyword) => haystack.includes(String(keyword).toLowerCase())) || blockedKeywords[0]}` };
    }
    return { skip: false, reason: "" };
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

function authErrorFromResponse(response, body = "") {
    const status = Number(response?.status || 0);
    const finalUrl = String(response?.url || "");
    if (status === 401 || status === 403) return new CookieInvalidError(`PO18 returned HTTP ${status}; cookie may be invalid`);
    if (/\/login|\/signin|member/i.test(finalUrl)) return new CookieInvalidError("PO18 redirected to login; cookie may be invalid");
    return null;
}

function createPo18CrawlerService(options = {}) {
    const {
        query,
        configGet = async () => "",
        configSet = async () => {},
        upsertBook,
        saveChapter,
        createSystemJob,
        updateSystemJob,
        recordEvent = async () => {},
        fetchImpl = globalThis.fetch,
        logger = console
    } = options;

    if (typeof fetchImpl !== "function") throw new Error("fetch is not available for po18 crawler");

    const state = {
        config: { ...DEFAULT_CONFIG },
        loaded: false,
        running: false,
        paused: false,
        pauseReason: "",
        stopRequested: false,
        activeJobId: null,
        startedAt: null,
        finishedAt: null,
        nextRunAt: null,
        lastRunAt: null,
        lastResult: null,
        lastError: "",
        findBooksToken: "",
        logs: [],
        stats: freshStats(),
        timer: null,
        requestChain: Promise.resolve(),
        lastRequestAt: 0
    };

    function freshStats() {
        return {
            pagesScanned: 0,
            booksFound: 0,
            booksProcessed: 0,
            booksSkippedFiltered: 0,
            booksSkippedComplete: 0,
            metadataUploaded: 0,
            chaptersFound: 0,
            chaptersUploaded: 0,
            chaptersSkippedCached: 0,
            chaptersSkippedPaid: 0,
            chaptersFailed: 0,
            errors: 0,
            activeBooks: 0,
            activeChapters: 0,
            chapterCandidates: 0,
            requestRetries: 0,
            cookieRefreshes: 0,
            currentPage: 0,
            currentBookId: "",
            currentBookTitle: "",
            currentChapterId: "",
            currentChapterTitle: "",
            lastMessage: ""
        };
    }

    function log(level, message, extra = {}) {
        const item = {
            at: new Date().toISOString(),
            level,
            message: String(message || ""),
            ...extra
        };
        state.logs.push(item);
        if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS);
        state.stats.lastMessage = item.message;
        if (level === "error") logger.warn?.(`[po18-crawler] ${item.message}`);
        else logger.log?.(`[po18-crawler] ${item.message}`);
    }

    async function loadConfig() {
        if (state.loaded) return state.config;
        const raw = await configGet(CONFIG_KEY).catch(() => "");
        state.config = sanitizeConfig(safeJsonParse(raw, {}));
        state.loaded = true;
        return state.config;
    }

    async function saveConfig(input = {}) {
        const current = await loadConfig();
        const patch = { ...(input || {}) };
        const incomingCookie = String(patch.cookie || "").trim();
        if (incomingCookie) {
            const name = String(patch.cookieName || patch.activeCookieProfile || "default").trim().slice(0, 80) || "default";
            const profiles = normalizeCookieProfiles(current.cookieProfiles, current.cookie);
            const index = profiles.findIndex((profile) => profileKey(profile) === name || profile.name === name);
            const nextProfile = normalizeCookieProfile({
                id: index >= 0 ? profiles[index].id : name,
                name,
                cookie: incomingCookie,
                enabled: true,
                lastStatus: "saved",
                lastUsedAt: new Date().toISOString()
            }, Math.max(index, 0));
            if (index >= 0) profiles[index] = nextProfile;
            else profiles.unshift(nextProfile);
            patch.cookieProfiles = profiles;
            patch.activeCookieProfile = profileKey(nextProfile);
        }
        if (!incomingCookie && current.cookie && !patch.clearCookie) delete patch.cookie;
        if (patch.cookieProfiles === undefined && current.cookieProfiles) delete patch.cookieProfiles;
        delete patch.cookieName;
        delete patch.clearCookie;
        const next = sanitizeConfig(patch, current);
        await persistConfig(next);
        scheduleNext();
        return next;
    }

    async function persistConfig(next) {
        const config = sanitizeConfig(next || state.config);
        await configSet(CONFIG_KEY, JSON.stringify(config));
        state.config = config;
        state.loaded = true;
        return config;
    }

    function activeCookieProfile(config = state.config) {
        const profiles = normalizeCookieProfiles(config.cookieProfiles, config.cookie)
            .filter((profile) => profile.enabled !== false && cookieProfileToHeader(profile));
        if (!profiles.length) return null;
        const active = String(config.activeCookieProfile || "").trim();
        return profiles.find((profile) => profileKey(profile) === active || profile.name === active) || profiles[0];
    }

    async function saveActiveCookieProfile(profilePatch = {}) {
        const target = activeCookieProfile(state.config);
        if (!target) return;
        const key = profileKey(target);
        const profiles = normalizeCookieProfiles(state.config.cookieProfiles, state.config.cookie).map((profile) => {
            if (profileKey(profile) !== key && profile.name !== target.name) return profile;
            return normalizeCookieProfile({ ...profile, ...profilePatch, updatedAt: new Date().toISOString() });
        });
        await persistConfig({
            ...state.config,
            cookieProfiles: profiles,
            cookie: profiles[0] ? cookieProfileToHeader(profiles[0]) : state.config.cookie
        });
    }

    function isRetriableRequestError(err) {
        if (!err) return false;
        if (err instanceof CookieInvalidError || err?.code === "PO18_COOKIE_INVALID") return false;
        if (err instanceof CrawlerStoppedError || err?.code === "PO18_CRAWLER_STOPPED") return false;
        const status = Number(err.status || err.statusCode || 0);
        if (status === 408 || status === 429 || status >= 500) return true;
        const message = String(err.message || err.code || err.name || err || "").toLowerCase();
        return /abort|timeout|timed out|fetch failed|network|econnreset|etimedout|eai_again|socket|terminated/.test(message);
    }

    async function requestText(url, options = {}) {
        const config = state.config;
        const maxRetries = Math.max(0, Number(config.requestRetries ?? DEFAULT_CONFIG.requestRetries));
        let lastError = null;
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
            checkStopped();
            await waitWhilePaused();
            await waitForRequestSlot();
            const profile = activeCookieProfile(config);
            const headers = {
                "User-Agent": config.userAgent || DEFAULT_CONFIG.userAgent,
                Accept: options.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-TW,zh-CN;q=0.9,zh;q=0.8,en;q=0.6",
                ...(options.headers || {})
            };
            const cookie = profile ? cookieProfileToHeader(profile) : String(config.cookie || "").trim();
            if (cookie) headers.Cookie = cookie;
            if (options.referer) headers.Referer = options.referer;

            const controller = new AbortController();
            let timeout = setTimeout(() => controller.abort(), config.timeoutMs || DEFAULT_CONFIG.timeoutMs);
            try {
                const response = await fetchImpl(url, {
                    method: options.method || "GET",
                    headers,
                    body: options.body,
                    redirect: "follow",
                    signal: controller.signal
                });
                const body = await response.text();
                const incoming = parseSetCookieHeaders(response.headers);
                if (profile && incoming.length) {
                    const currentCookies = profile.cookies?.length ? profile.cookies : parseCookieString(cookie);
                    const mergedCookies = mergeCookies(currentCookies, incoming);
                    await saveActiveCookieProfile({
                        cookies: mergedCookies,
                        cookie: cookieHeader(mergedCookies),
                        lastStatus: `HTTP ${response.status}`,
                        lastUsedAt: new Date().toISOString()
                    }).catch(() => {});
                }
                const authError = authErrorFromResponse(response, body);
                if (authError) {
                    if (profile) {
                        await saveActiveCookieProfile({
                            lastStatus: authError.message || "cookie invalid",
                            lastUsedAt: new Date().toISOString()
                        }).catch(() => {});
                    }
                    throw authError;
                }
                if (!response.ok) {
                    const err = new Error(`PO18 HTTP ${response.status} for ${url}`);
                    err.status = response.status;
                    throw err;
                }
                return body;
            } catch (err) {
                lastError = err;
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                if (attempt >= maxRetries || !isRetriableRequestError(err)) throw err;
                const delay = Math.min(60000, Math.max(0, Number(config.requestRetryDelayMs || DEFAULT_CONFIG.requestRetryDelayMs)) * (attempt + 1));
                state.stats.requestRetries += 1;
                log("warn", `request retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${err.message || err}`);
                if (delay > 0) await sleep(delay);
            } finally {
                if (timeout) clearTimeout(timeout);
            }
        }
        throw lastError || new Error(`PO18 request failed for ${url}`);
    }

    async function waitForRequestSlot() {
        state.requestChain = state.requestChain.catch(() => {}).then(async () => {
            const interval = Number(state.config.requestIntervalMs || 0);
            const waitMs = Math.max(0, interval - (Date.now() - state.lastRequestAt));
            if (waitMs > 0) await sleep(waitMs);
            state.lastRequestAt = Date.now();
        });
        return state.requestChain;
    }

    function isCookieInvalid(err) {
        return err instanceof CookieInvalidError || err?.code === "PO18_COOKIE_INVALID";
    }

    async function refreshCookieSession({ bookId = "", reason = "" } = {}) {
        const targets = [
            { url: PO18_BASE, referer: PO18_BASE, label: "home" },
            ...(bookId ? [{ url: bookDetailUrl(bookId), referer: PO18_BASE, label: `book ${bookId}` }] : []),
            { url: findBooksBaseUrl(), referer: PO18_BASE, label: "findbooks" }
        ];
        log("warn", `refreshing PO18 cookie session${reason ? ` after ${reason}` : ""}`);
        for (const target of targets) {
            try {
                await requestText(target.url, { referer: target.referer });
                state.stats.cookieRefreshes = Number(state.stats.cookieRefreshes || 0) + 1;
                log("info", `PO18 cookie session refreshed via ${target.label}`);
                return true;
            } catch (err) {
                log("warn", `PO18 cookie refresh via ${target.label} failed: ${err.message || err}`);
            }
        }
        return false;
    }

    async function withCookiePause(operation, context = {}) {
        let refreshed = false;
        for (;;) {
            checkStopped();
            await waitWhilePaused();
            try {
                return await operation();
            } catch (err) {
                if (!isCookieInvalid(err)) throw err;
                if (!state.running) throw err;
                if (!refreshed) {
                    refreshed = await refreshCookieSession({
                        ...context,
                        reason: err.message || "cookie check"
                    });
                    if (refreshed) {
                        log("info", "retrying PO18 request after cookie refresh");
                        continue;
                    }
                }
                await pauseForCookie(err.message || "PO18 Cookie invalid");
            }
        }
    }

    async function pauseForCookie(reason) {
        state.paused = true;
        state.pauseReason = reason || "PO18 Cookie invalid";
        log("warn", `${state.pauseReason}; update cookie then resume`);
        if (state.activeJobId) {
            await updateSystemJob(state.activeJobId, {
                status: "running",
                progress: Math.max(1, currentProgress()),
                error: state.pauseReason
            }).catch(() => {});
        }
        await waitWhilePaused();
    }

    async function waitWhilePaused() {
        while (state.paused) {
            checkStopped();
            await sleep(1000);
        }
    }

    function checkStopped() {
        if (state.stopRequested) throw new CrawlerStoppedError();
    }

    async function ensureFindBooksToken() {
        if (state.findBooksToken) return state.findBooksToken;
        const html = await withCookiePause(() => requestText(findBooksBaseUrl(), { referer: PO18_BASE }), { label: "findbooks token" });
        state.findBooksToken = parseCrefToken(html) || "";
        return state.findBooksToken;
    }

    async function postFindBooksPage(page, config) {
        const token = await ensureFindBooksToken();
        const body = findBooksFormBody(page, config, token);
        const html = await requestText(findBooksBaseUrl(), {
            method: "POST",
            referer: findBooksBaseUrl(),
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Origin: PO18_BASE,
                "Cache-Control": "max-age=0",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Site": "same-origin",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-User": "?1",
                "Sec-Fetch-Dest": "document"
            },
            body
        });
        state.findBooksToken = parseCrefToken(html) || state.findBooksToken;
        parseFindBooksHtml(html);
        return html;
    }

    async function fetchFindBooksPage(page, config) {
        return withCookiePause(async () => {
            try {
                return await postFindBooksPage(page, config);
            } catch (err) {
                if (Number(err?.status || 0) !== 404) throw err;
                state.findBooksToken = "";
                log("warn", `findbooks POST returned 404 (${findBooksFilterLog(page, config)}); refreshing form token and retrying once`);
                await ensureFindBooksToken();
                return postFindBooksPage(page, config);
            }
        }, { label: "findbooks" });
    }

    async function fetchBookDetail(bookId) {
        return withCookiePause(async () => {
            const html = await requestText(bookDetailUrl(bookId), { referer: PO18_BASE });
            return parseBookDetailHtml(html, bookId);
        }, { bookId });
    }

    async function fetchChapterList(bookId, pageCount) {
        const chapters = [];
        let startIndex = 0;
        for (let page = 1; page <= Math.max(1, Number(pageCount || 1)); page++) {
            checkStopped();
            await waitWhilePaused();
            const parsed = await withCookiePause(async () => {
                const html = await requestText(bookArticlesUrl(bookId, page), { referer: bookDetailUrl(bookId) });
                return parseChapterListHtml(html, bookId, startIndex);
            }, { bookId });
            chapters.push(...parsed.chapters);
            startIndex += parsed.scanned;
            if (page < pageCount) await sleep(200);
        }
        return chapters;
    }

    async function fetchChapterContent(bookId, chapter) {
        return withCookiePause(async () => {
            const html = await requestText(chapterContentUrl(bookId, chapter.chapterId), {
                referer: chapterRefererUrl(bookId, chapter.chapterId),
                headers: { "X-Requested-With": "XMLHttpRequest" }
            });
            return parseChapterContentHtml(html, chapter.title);
        }, { bookId });
    }

    async function cachedChapterIds(bookId) {
        const result = await query("SELECT chapter_id FROM chapter_cache WHERE book_id = $1", [String(bookId)]);
        return new Set((result.rows || []).map((row) => String(row.chapter_id)));
    }

    async function cacheBookIds(limit) {
        const cappedLimit = Math.max(1, Number(limit || DEFAULT_CONFIG.cacheIdLimit));
        const result = await query(
            `WITH latest AS (
                SELECT DISTINCT ON (m.book_id)
                    m.book_id,
                    m.title,
                    m.author,
                    m.tags,
                    m.category,
                    m.status,
                    m.platform,
                    m.detail_url,
                    m.total_chapters,
                    m.subscribed_chapters,
                    m.chapter_count,
                    m.free_chapters,
                    m.paid_chapters,
                    COALESCE(m.updated_at, m.created_at) AS metadata_at
                FROM book_metadata m
                WHERE LOWER(TRIM(COALESCE(m.platform, ''))) = 'po18'
                  AND TRIM(COALESCE(m.book_id, '')) <> ''
                ORDER BY m.book_id, COALESCE(m.updated_at, m.created_at) DESC NULLS LAST, m.id DESC
             ),
             ranked AS (
                SELECT
                    latest.*,
                    COALESCE(s.cache_count, 0)::int AS cache_count,
                    GREATEST(
                        COALESCE(latest.total_chapters, 0),
                        COALESCE(latest.subscribed_chapters, 0),
                        COALESCE(latest.chapter_count, 0),
                        COALESCE(latest.free_chapters, 0) + COALESCE(latest.paid_chapters, 0)
                    )::int AS expected_chapters
                FROM latest
                LEFT JOIN book_stats s ON s.book_id = latest.book_id
             )
             SELECT *
             FROM ranked
             WHERE NOT (
                expected_chapters > 0
                AND cache_count >= expected_chapters
                AND COALESCE(status, '') ~ '(完结|完結|完本|已完成)'
             )
             ORDER BY metadata_at DESC NULLS LAST, book_id DESC
             LIMIT $1`,
            [cappedLimit]
        );
        const skipped = await query(
            `WITH latest AS (
                SELECT DISTINCT ON (m.book_id)
                    m.book_id,
                    m.status,
                    m.total_chapters,
                    m.subscribed_chapters,
                    m.chapter_count,
                    m.free_chapters,
                    m.paid_chapters,
                    COALESCE(m.updated_at, m.created_at) AS metadata_at
                FROM book_metadata m
                WHERE LOWER(TRIM(COALESCE(m.platform, ''))) = 'po18'
                  AND TRIM(COALESCE(m.book_id, '')) <> ''
                ORDER BY m.book_id, COALESCE(m.updated_at, m.created_at) DESC NULLS LAST, m.id DESC
             )
             SELECT COUNT(*)::int count
             FROM latest
             LEFT JOIN book_stats s ON s.book_id = latest.book_id
             WHERE GREATEST(
                    COALESCE(latest.total_chapters, 0),
                    COALESCE(latest.subscribed_chapters, 0),
                    COALESCE(latest.chapter_count, 0),
                    COALESCE(latest.free_chapters, 0) + COALESCE(latest.paid_chapters, 0)
                ) > 0
               AND COALESCE(s.cache_count, 0) >= GREATEST(
                    COALESCE(latest.total_chapters, 0),
                    COALESCE(latest.subscribed_chapters, 0),
                    COALESCE(latest.chapter_count, 0),
                    COALESCE(latest.free_chapters, 0) + COALESCE(latest.paid_chapters, 0)
                )
               AND COALESCE(latest.status, '') ~ '(完结|完結|完本|已完成)'`
        ).catch(() => ({ rows: [] }));
        const skippedComplete = Number(skipped.rows?.[0]?.count || 0);
        state.stats.booksSkippedComplete += skippedComplete;
        if (skippedComplete) log("info", `metadata source skipped ${skippedComplete} finished books with 100% cache`);
        return (result.rows || []).map((row) => ({
            bookId: String(row.book_id),
            book_id: String(row.book_id),
            title: row.title || "",
            author: row.author || "",
            tags: row.tags || "",
            category: row.category || "",
            status: row.status || "",
            totalChapters: Number(row.total_chapters || 0),
            subscribedChapters: Number(row.subscribed_chapters || 0),
            chapterCount: Number(row.chapter_count || 0),
            freeChapters: Number(row.free_chapters || 0),
            paidChapters: Number(row.paid_chapters || 0),
            cacheCount: Number(row.cache_count || 0),
            expectedChapters: Number(row.expected_chapters || 0),
            platform: "po18",
            detailUrl: row.detail_url || bookDetailUrl(row.book_id)
        }));
    }

    async function fetchBookshelfBooks(config) {
        const books = [];
        const seen = new Set();
        let empty = 0;
        const startYear = new Date().getFullYear();
        const endYear = Math.min(startYear, Number(config.bookshelfStartYear || DEFAULT_CONFIG.bookshelfStartYear));
        for (let year = startYear; year >= endYear; year -= 1) {
            checkStopped();
            await waitWhilePaused();
            log("info", `scanning PO18 bookshelf year ${year}`);
            const rows = await withCookiePause(async () => {
                const html = await requestText(`${PO18_BASE}/panel/stock_manage/buyed_lists?sort=order&date_year=${year}`, {
                    referer: `${PO18_BASE}/panel/stock_manage/buyed_lists`
                });
                return parseBookshelfHtml(html);
            }, { label: `bookshelf ${year}` });
            if (!rows.length) {
                empty += 1;
                if (empty >= Number(config.bookshelfEmptyYearStop || DEFAULT_CONFIG.bookshelfEmptyYearStop)) break;
                continue;
            }
            empty = 0;
            for (const book of rows) {
                if (seen.has(book.bookId)) continue;
                seen.add(book.bookId);
                books.push({ ...book, year });
                if (books.length >= config.maxBooksPerRun) return books;
            }
            await sleep(config.delayMs);
        }
        return books;
    }

    function subscriptionBooks(config) {
        return normalizeBookIds(config.subscriptionBookIds).slice(0, config.maxBooksPerRun).map((bookId) => ({
            bookId,
            book_id: bookId,
            title: "",
            author: "",
            platform: "po18",
            detailUrl: bookDetailUrl(bookId)
        }));
    }

    async function sourceBooks(config) {
        if (config.sourceMode === "cache") return cacheBookIds(config.cacheIdLimit);
        if (config.sourceMode === "subscription") return subscriptionBooks(config);
        if (config.sourceMode === "bookshelf") return fetchBookshelfBooks(config);
        return null;
    }

    async function processBooks(books, config, options = {}) {
        const limited = Array.from(books || []).slice(0, config.maxBooksPerRun);
        if (options.countFound !== false) state.stats.booksFound += limited.length;
        log("info", `processing ${limited.length} books with book concurrency ${config.bookConcurrency}`);
        await updateJobProgress();
        await processConcurrently(limited, config.bookConcurrency, async (book) => {
            state.stats.activeBooks += 1;
            await updateJobProgress();
            try {
                return await processBook(book, config);
            } catch (err) {
                if (err instanceof CookieInvalidError || err?.code === "PO18_COOKIE_INVALID") throw err;
                if (err instanceof CrawlerStoppedError || err?.code === "PO18_CRAWLER_STOPPED") throw err;
                state.stats.errors += 1;
                log("error", `book failed ${book.bookId}: ${err.message || err}`);
                return { success: false, error: err.message || String(err) };
            } finally {
                state.stats.activeBooks = Math.max(0, Number(state.stats.activeBooks || 0) - 1);
                await updateJobProgress();
            }
        });
    }

    async function processConcurrently(items, concurrency, processor) {
        const list = Array.from(items || []);
        const results = new Array(list.length);
        let cursor = 0;
        const workers = Array.from({ length: Math.min(Math.max(1, concurrency), list.length || 1) }, async () => {
            for (;;) {
                const index = cursor++;
                if (index >= list.length) return;
                results[index] = await processor(list[index], index);
            }
        });
        await Promise.all(workers);
        return results;
    }

    async function processBook(book, config) {
        checkStopped();
        await waitWhilePaused();
        state.stats.currentBookId = String(book.bookId || "");
        state.stats.currentBookTitle = book.title || "";
        log("info", `processing book ${book.bookId} ${book.title || ""}`.trim());

        const detail = await fetchBookDetail(book.bookId);
        state.stats.currentBookTitle = detail.title || book.title || "";
        const filter = bookFilterDecision(detail, config);
        log("info", formatBookDetailLog(detail));
        if (filter.skip) {
            state.stats.booksSkippedFiltered += 1;
            log("info", `skipped book ${detail.bookId} ${detail.title || ""}: ${filter.reason}`.trim());
            await updateJobProgress();
            return { success: true, bookId: detail.bookId, skipped: true, reason: filter.reason };
        }
        if (config.uploadMetadata) {
            await upsertBook({
                ...detail,
                uploader: "po18_crawler",
                uploaderId: "po18_crawler"
            });
            state.stats.metadataUploaded += 1;
            log("info", `book ${detail.bookId} metadata saved`);
        }

        if (!config.uploadChapters) {
            state.stats.booksProcessed += 1;
            log("info", `book ${detail.bookId} finished: metadata only`);
            return { success: true, bookId: book.bookId, metadataOnly: true };
        }

        const chapters = await fetchChapterList(detail.bookId, detail.pageNum);
        state.stats.chaptersFound += chapters.length;
        const cached = config.skipCached && !config.overwrite ? await cachedChapterIds(detail.bookId) : new Set();
        const candidates = [];
        let skippedPaid = 0;
        let skippedCached = 0;
        for (const chapter of chapters) {
            if (!chapter.isPurchased && !chapter.isFree) {
                skippedPaid += 1;
                state.stats.chaptersSkippedPaid += 1;
                continue;
            }
            if (cached.has(String(chapter.chapterId))) {
                skippedCached += 1;
                state.stats.chaptersSkippedCached += 1;
                continue;
            }
            candidates.push(chapter);
        }
        state.stats.chapterCandidates += candidates.length;
        log("info", formatChapterListLog(detail, chapters, candidates, skippedCached, skippedPaid, config.chapterConcurrency));

        const beforeUploaded = Number(state.stats.chaptersUploaded || 0);
        const beforeFailed = Number(state.stats.chaptersFailed || 0);
        await processConcurrently(candidates, config.chapterConcurrency, async (chapter) => {
            state.stats.activeChapters += 1;
            state.stats.currentChapterId = String(chapter.chapterId || "");
            state.stats.currentChapterTitle = chapter.title || "";
            await updateJobProgress();
            try {
                checkStopped();
                await waitWhilePaused();
                const content = await fetchChapterContent(detail.bookId, chapter);
                await saveChapter({
                    bookId: detail.bookId,
                    chapterId: chapter.chapterId,
                    title: content.title || chapter.title,
                    html: content.html,
                    text: content.text,
                    chapterOrder: chapter.order || chapter.displayedOrder || chapter.index + 1,
                    isvolume: false,
                    fromUserScript: true,
                    platform: "po18",
                    uploader: "po18_crawler",
                    uploaderId: "po18_crawler"
                });
                state.stats.chaptersUploaded += 1;
                await updateJobProgress();
                return { success: true };
            } catch (err) {
                if (err instanceof CookieInvalidError || err?.code === "PO18_COOKIE_INVALID") throw err;
                if (err instanceof CrawlerStoppedError || err?.code === "PO18_CRAWLER_STOPPED") throw err;
                state.stats.chaptersFailed += 1;
                state.stats.errors += 1;
                log("error", `chapter failed ${detail.bookId}/${chapter.chapterId}: ${err.message || err}`);
                return { success: false, error: err.message || String(err) };
            } finally {
                state.stats.activeChapters = Math.max(0, Number(state.stats.activeChapters || 0) - 1);
                await updateJobProgress();
            }
        });

        const uploaded = Number(state.stats.chaptersUploaded || 0) - beforeUploaded;
        const failed = Number(state.stats.chaptersFailed || 0) - beforeFailed;
        state.stats.booksProcessed += 1;
        log("info", `book ${detail.bookId} finished: uploaded ${uploaded}, cached ${skippedCached}, locked ${skippedPaid}, failed ${failed}`);
        await updateJobProgress();
        return { success: true, bookId: detail.bookId, title: detail.title, chapters: candidates.length };
    }

    function currentProgress() {
        const totalPages = Math.max(1, state.config.endPage - state.config.startPage + 1);
        const pageProgress = Math.max(0, Math.min(totalPages, state.stats.pagesScanned));
        return Math.max(1, Math.min(95, Math.floor((pageProgress / totalPages) * 90) + 5));
    }

    async function updateJobProgress() {
        if (!state.activeJobId) return;
        await updateSystemJob(state.activeJobId, {
            status: "running",
            progress: currentProgress(),
            result: { ...state.stats, paused: state.paused, pauseReason: state.pauseReason }
        }).catch(() => {});
    }

    async function runCrawler(jobInput = {}) {
        const config = sanitizeConfig({ ...state.config, ...(jobInput.config || {}) });
        state.config = config;
        state.findBooksToken = "";
        const directBooks = await sourceBooks(config);
        if (directBooks) {
            log("info", `scanning PO18 source ${config.sourceMode}`);
            await processBooks(directBooks, config);
            return { success: true, ...state.stats };
        }
        let processedThisRun = 0;
        for (let page = config.startPage; page <= config.endPage; page++) {
            checkStopped();
            await waitWhilePaused();
            if (processedThisRun >= config.maxBooksPerRun) break;
            state.stats.currentPage = page;
            log("info", `scanning PO18 findbooks page ${page}`);
            const html = await fetchFindBooksPage(page, config);
            const books = parseFindBooksHtml(html);
            state.stats.pagesScanned += 1;
            state.stats.booksFound += books.length;
            await updateJobProgress();
            const remaining = Math.max(0, config.maxBooksPerRun - processedThisRun);
            const pageBooks = books.slice(0, remaining);
            processedThisRun += pageBooks.length;
            await processBooks(pageBooks, config, { countFound: false });
            if (page < config.endPage) await sleep(config.delayMs);
        }
        return { success: true, ...state.stats };
    }

    async function executeJob(job, input = {}) {
        state.running = true;
        state.paused = false;
        state.pauseReason = "";
        state.stopRequested = false;
        state.activeJobId = job.id;
        state.startedAt = new Date().toISOString();
        state.finishedAt = null;
        state.lastError = "";
        state.stats = freshStats();
        await updateSystemJob(job.id, { status: "running", progress: 1, started: true });
        await recordEvent({
            eventType: "system",
            action: "po18_crawler_started",
            platform: "po18",
            source: "admin",
            details: maskedConfig(state.config)
        }).catch(() => {});
        try {
            const result = await runCrawler(input);
            state.lastResult = result;
            state.lastRunAt = new Date().toISOString();
            state.finishedAt = state.lastRunAt;
            await updateSystemJob(job.id, { status: "succeeded", progress: 100, result, finished: true });
            log("info", `crawler finished: books ${result.booksProcessed}, chapters ${result.chaptersUploaded}`);
            await recordEvent({
                eventType: "system",
                action: "po18_crawler_finished",
                platform: "po18",
                source: "admin",
                details: result
            }).catch(() => {});
        } catch (err) {
            state.finishedAt = new Date().toISOString();
            state.lastError = err.message || String(err);
            if (err instanceof CrawlerStoppedError || err?.code === "PO18_CRAWLER_STOPPED") {
                await updateSystemJob(job.id, { status: "canceled", progress: currentProgress(), error: state.lastError, finished: true }).catch(() => {});
                log("warn", "crawler stopped");
            } else {
                await updateSystemJob(job.id, { status: "failed", progress: 100, error: state.lastError, result: state.stats, finished: true }).catch(() => {});
                log("error", `crawler failed: ${state.lastError}`);
            }
        } finally {
            state.running = false;
            state.paused = false;
            state.pauseReason = "";
            state.stopRequested = false;
            state.activeJobId = null;
            scheduleNext();
        }
    }

    async function runNow(input = {}, actor = "admin") {
        await loadConfig();
        if (state.running) {
            const err = new Error("po18 crawler is already running");
            err.status = 409;
            throw err;
        }
        const jobInput = { ...(input || {}) };
        if (jobInput.config) jobInput.config = maskedConfig(sanitizeConfig(jobInput.config, state.config));
        delete jobInput.cookie;
        delete jobInput.cookieProfiles;
        const job = await createSystemJob({
            type: JOB_TYPE,
            input: { ...maskedConfig(state.config), ...jobInput },
            createdBy: actor || "admin"
        });
        setImmediate(() => executeJob(job, input || {}).catch((err) => logger.error?.(`[po18-crawler] ${err.message || err}`)));
        return job;
    }

    function pause(reason = "paused by admin") {
        if (!state.running) return false;
        state.paused = true;
        state.pauseReason = String(reason || "paused by admin").slice(0, 500);
        log("warn", state.pauseReason);
        return true;
    }

    function resume() {
        if (!state.running) return false;
        state.paused = false;
        state.pauseReason = "";
        log("info", "crawler resumed");
        return true;
    }

    function stop() {
        if (!state.running) return false;
        state.stopRequested = true;
        state.paused = false;
        state.pauseReason = "";
        log("warn", "crawler stop requested");
        return true;
    }

    async function testCookie(input = {}) {
        const previous = state.config;
        const patch = { ...(input || {}) };
        if (!String(patch.cookie || "").trim() && previous.cookie) delete patch.cookie;
        state.config = sanitizeConfig({ ...previous, ...patch });
        state.findBooksToken = "";
        try {
            const html = await requestText(findBooksBaseUrl(), { referer: PO18_BASE });
            const token = parseCrefToken(html);
            state.findBooksToken = token || "";
            const books = parseFindBooksHtml(await fetchFindBooksPage(1, state.config)).slice(0, 3);
            const profile = activeCookieProfile(state.config);
            return { ok: true, token: !!token, activeCookieProfile: profile ? { id: profile.id, name: profile.name } : null, sampleBooks: books.map((book) => ({ bookId: book.bookId, title: book.title })) };
        } finally {
            state.config = previous;
            state.findBooksToken = "";
        }
    }

    function snapshot() {
        return {
            running: state.running,
            paused: state.paused,
            pauseReason: state.pauseReason,
            activeJobId: state.activeJobId,
            startedAt: state.startedAt,
            finishedAt: state.finishedAt,
            nextRunAt: state.nextRunAt,
            lastRunAt: state.lastRunAt,
            lastError: state.lastError,
            lastResult: state.lastResult,
            stats: state.stats,
            logs: state.logs.slice(-MAX_LOGS)
        };
    }

    function scheduleNext() {
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        const config = state.config;
        if (!config.enabled) {
            state.nextRunAt = null;
            return;
        }
        const delay = Math.max(60_000, Number(config.intervalMinutes || DEFAULT_CONFIG.intervalMinutes) * 60_000);
        state.nextRunAt = new Date(Date.now() + delay).toISOString();
        state.timer = setTimeout(() => {
            runNow({ scheduled: true }, "scheduler").catch((err) => {
                log("error", `scheduled run skipped: ${err.message || err}`);
                scheduleNext();
            });
        }, delay);
        state.timer.unref?.();
    }

    async function startScheduler() {
        await loadConfig();
        scheduleNext();
    }

    return {
        CONFIG_KEY,
        JOB_TYPE,
        loadConfig,
        saveConfig,
        publicConfig,
        maskedConfig,
        runNow,
        pause,
        resume,
        stop,
        testCookie,
        snapshot,
        startScheduler,
        _internals: {
            parseBookDetailHtml,
            parseFindBooksHtml,
            parseBookshelfHtml,
            parseCookieString,
            mergeCookies,
            looksLikeAuthPage,
            parseChapterListHtml,
            parseChapterContentHtml,
            bookFilterDecision,
            isCompleteCachedBook,
            sanitizeConfig,
            formatBookDetailLog,
            formatChapterListLog
        }
    };
}

module.exports = {
    CONFIG_KEY,
    JOB_TYPE,
    CookieInvalidError,
    CrawlerStoppedError,
    createPo18CrawlerService,
    parseBookDetailHtml,
    parseFindBooksHtml,
    parseBookshelfHtml,
    parseCookieString,
    mergeCookies,
    looksLikeAuthPage,
    parseChapterListHtml,
    parseChapterContentHtml,
    bookFilterDecision,
    isCompleteCachedBook,
    sanitizeConfig,
    formatBookDetailLog,
    formatChapterListLog
};
