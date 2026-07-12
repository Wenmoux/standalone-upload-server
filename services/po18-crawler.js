/**
 * [INPUT]: 依赖 source-health 熔断器、po18-crawler HTTP/Cookie/Parser 边界及注入的配置、缓存和 system_jobs 能力
 * [OUTPUT]: 对外提供 PO18 爬虫服务、任务/配置常量、状态机错误、解析兼容导出及书籍过滤/完整性辅助函数
 * [POS]: services 的 PO18 抓取编排核心，协调来源访问、断点持久化、缓存写入和暂停恢复而不重实现协议细节
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const CONFIG_KEY = "po18_crawler_config";
const JOB_TYPE = "po18_crawler_run";
const { createSourceHealthCircuit } = require("./source-health");
const { createPo18HttpClient } = require("./po18-crawler-http");
const {
    PO18_BASE,
    CookieInvalidError,
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
    looksLikeAuthPage
} = require("./po18-crawler-parsers");
const {
    cookieHeader,
    cookieProfileToHeader,
    maskCookieProfiles,
    mergeCookies,
    normalizeCookieProfile,
    normalizeCookieProfiles,
    parseCookieString,
    profileKey
} = require("./po18-crawler-cookies");
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
    const textValue = normalizeText(value).replace(/[<>"'`&]/g, "").slice(0, 40);
    if (!textValue) return fallback;
    return textValue;
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
        credentialCrypto = null,
        fetchImpl = globalThis.fetch,
        logger = console
    } = options;

    if (typeof fetchImpl !== "function") throw new Error("fetch is not available for po18 crawler");

    const sourceHealth = createSourceHealthCircuit({
        source: "po18",
        failureThreshold: process.env.PO18_CRAWLER_CIRCUIT_FAILURES,
        cooldownMs: process.env.PO18_CRAWLER_CIRCUIT_COOLDOWN_MS
    });

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
        timer: null
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
        const stored = safeJsonParse(raw, {});
        const decrypted = { ...stored };
        if (credentialCrypto?.configured) {
            decrypted.cookie = credentialCrypto.decryptString(stored.cookie || "");
            decrypted.cookieProfiles = credentialCrypto.decryptJson(stored.cookieProfiles, []);
        }
        state.config = sanitizeConfig(decrypted);
        state.loaded = true;
        if (credentialCrypto?.configured && (
            credentialCrypto.needsStringRotation(stored.cookie)
            || credentialCrypto.needsJsonRotation(stored.cookieProfiles)
        )) {
            await configSet(CONFIG_KEY, JSON.stringify(storedConfig(state.config)));
        }
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
        await configSet(CONFIG_KEY, JSON.stringify(storedConfig(config)));
        state.config = config;
        state.loaded = true;
        return config;
    }

    function storedConfig(config) {
        if (!credentialCrypto?.configured) return config;
        return {
            ...config,
            cookie: credentialCrypto.encryptString(config.cookie || ""),
            cookieProfiles: credentialCrypto.encryptJson(config.cookieProfiles || [])
        };
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

    const { requestText } = createPo18HttpClient({
        fetchImpl,
        sourceHealth,
        configProvider: () => state.config,
        activeCookieProfile,
        saveActiveCookieProfile,
        checkStopped,
        waitWhilePaused,
        defaults: DEFAULT_CONFIG,
        onRetry: ({ attempt, maxRetries, delay, error }) => {
            state.stats.requestRetries += 1;
            log("warn", `request retry ${attempt}/${maxRetries} after ${delay}ms: ${error.message || error}`);
        }
    });

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
            sourceHealth: sourceHealth.snapshot(),
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
