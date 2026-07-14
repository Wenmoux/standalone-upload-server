/**
 * [INPUT]: 依赖 po18-crawler Parser 的文本归一化与 Cookie 模块的配置头/多档案规范化能力
 * [OUTPUT]: 对外提供爬虫配置常量、持久化键、类型收敛、公开/脱敏投影及订阅书号规范化函数
 * [POS]: services 的 PO18 爬虫配置边界，把不可信后台输入收敛为稳定运行契约，避免编排器混入字段兼容细节
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const {
    cookieHeader,
    cookieProfileToHeader,
    maskCookieProfiles,
    normalizeCookieProfiles,
    parseCookieString,
    profileKey
} = require("./po18-crawler-cookies");
const { normalizeList, normalizeText } = require("./po18-crawler-parsers");

const CONFIG_KEY = "po18_crawler_config";
const JOB_TYPE = "po18_crawler_run";

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

function normalizeSmallToken(value = "", fallback = "") {
    const textValue = normalizeText(value)
        .replace(/[<>"'`&]/g, "")
        .slice(0, 40);
    return textValue || fallback;
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

module.exports = {
    CONFIG_KEY,
    DEFAULT_CONFIG,
    JOB_TYPE,
    boolValue,
    intValue,
    maskedConfig,
    normalizeBookIds,
    publicConfig,
    safeJsonParse,
    sanitizeConfig
};
