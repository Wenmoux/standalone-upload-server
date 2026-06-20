const express = require("express");
const cors = require("cors");
const compression = require("compression");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");
const { initPg, query, pool, bookColumns, chapterColumns, pick } = require("./pg-store");
const {
    attachExpressPanel,
    collectDiagnostics,
    collectStatus,
    filterLogText,
    readLogTail,
    versionPayload
} = require("./docker/control-panel");
const {
    EVENT_LOG_FILE,
    REQUEST_LOG_FILE,
    SLOW_LOG_FILE,
    createRequestLogger,
    logEvent,
    readJsonLinesTail,
    topSlowRequests
} = require("./docker/structured-log");
const {
    collectSystemJobInfo,
    cancelSystemJob,
    createSystemJob,
    getSystemJob,
    listSystemJobs,
    runTrackedJob,
    updateSystemJob
} = require("./services/system-jobs");
const {
    DEFAULT_BACKUP_DIR,
    backupListPayload,
    createBackupPayload,
    restoreBackupPayload
} = require("./services/backups");
const { createHealthService } = require("./services/health");
const { createRankService } = require("./services/rank");
const { createDataQualityService } = require("./services/data-quality");
const { createAdminOverviewService } = require("./services/admin-overview");
const { createUserCurrencyService } = require("./services/user-currency");
const { createBookChapterService } = require("./services/book-chapters");
const { createConfigService } = require("./services/config");
const { createBotSettingsService } = require("./services/bot-settings");
const { sendCsv } = require("./services/admin-exports");
const { remoteBackupStatus, uploadBackupToRemote } = require("./services/remote-backups");
const { createAuthService } = require("./services/auth");
const { createEventService } = require("./services/events");
const { createHotKeywordService } = require("./services/hot-keywords");
const { createBookSocialService } = require("./services/book-social");
const { createChapterMaintenanceService } = require("./services/chapter-maintenance");
const { createBookMaintenanceService } = require("./services/book-maintenance");
const { createSystemJobRetryService } = require("./services/job-retry");
const { createBotAuditService } = require("./services/bot-audit");
const { createPo18CrawlerService } = require("./services/po18-crawler");
const { createHealthRoutes } = require("./routes/health");
const { createRankRoutes } = require("./routes/rank");
const { createAdminSystemRoutes } = require("./routes/admin-system");
const { createAdminBackupRoutes } = require("./routes/admin-backups");
const { createAdminConfigRoutes } = require("./routes/admin-config");
const { createAdminCrawlerRoutes } = require("./routes/admin-crawler");
const { createAdminContentRoutes } = require("./routes/admin-content");
const { createAdminAuthRoutes } = require("./routes/admin-auth");
const { createBotApiRoutes } = require("./routes/bot-api");
const { createReaderApiRoutes } = require("./routes/reader-api");
const { createUploadApiRoutes } = require("./routes/upload-api");
const {
    createTelegramPushService,
    parseDailyReportTime,
    parseTelegramPushTypes,
    telegramApiUrl,
    telegramHtml
} = require("./services/telegram-push");
const {
    EDGE_TTS_FALLBACK_VOICES,
    edgeTtsVoices,
    edgeTtsSynthesize,
    ttsProviderSettings,
    synthesizeVolcengineTts,
    synthesizeAliyunTts,
    synthesizeAzureTts,
    synthesizeElevenLabsTts,
    synthesizeCartesiaTts
} = require("./services/tts");

const PORT = Number(process.env.PO18_UPLOAD_PORT || 3100);
const HOST = process.env.PO18_UPLOAD_HOST || "0.0.0.0";
const CONFIG_FILE = process.env.PO18_CONFIG_FILE || "/config/app.env";
const SESSION_SECRET = process.env.PO18_UPLOAD_SESSION_SECRET || "po18-upload-pg-change-me";
const DEFAULT_ADMIN = process.env.PO18_UPLOAD_ADMIN_USER || "admin";
const DEFAULT_PASSWORD = process.env.PO18_UPLOAD_ADMIN_PASSWORD || "admin123";
const UPLOAD_API_TOKEN = process.env.PO18_UPLOAD_API_TOKEN || "";
const STARTED_AT = Date.now();
const RUNTIME_LOG_FILE = process.env.PO18_RUNTIME_LOG_FILE || "/config/runtime.log";
const ADMIN_STATS_CACHE_MS = Number(process.env.PO18_ADMIN_STATS_CACHE_MS || 30000);
const ADMIN_SYSTEM_CACHE_MS = Number(process.env.PO18_ADMIN_SYSTEM_CACHE_MS || 3000);
const REQUEST_SLOW_MS = Number.isFinite(Number(process.env.PO18_SLOW_REQUEST_MS))
    ? Number(process.env.PO18_SLOW_REQUEST_MS)
    : 800;
const SEARCH_SLOW_QUERY_MS = Number.isFinite(Number(process.env.PO18_SEARCH_SLOW_QUERY_MS))
    ? Number(process.env.PO18_SEARCH_SLOW_QUERY_MS)
    : 800;
const STARTUP_DB_RETRY_MS = Number.isFinite(Number(process.env.PO18_STARTUP_DB_RETRY_MS))
    ? Math.max(1000, Number(process.env.PO18_STARTUP_DB_RETRY_MS))
    : 5000;
const app = express();
const adminStatsCache = { at: 0, payload: null };
const adminSystemStatusCache = { at: 0, payload: null };
const numericBookFields = new Set([
    "word_count",
    "chapter_count",
    "total_chapters",
    "subscribed_chapters",
    "free_chapters",
    "paid_chapters",
    "favorites_count",
    "comments_count",
    "monthly_popularity",
    "total_popularity",
    "weekly_popularity",
    "readers_count",
    "daily_popularity",
    "purchase_count"
]);
const numericChapterFields = new Set(["chapter_order"]);
const booleanChapterFields = new Set(["is_volume"]);
const configService = createConfigService({
    query,
    cleanPgText
});
const {
    cleanPlatformKey,
    configGet,
    configSet,
    exportPricingConfig,
    exportPricingPayload,
    nonNegativeInt,
    platformConfigPayload,
    platformLabelConfig
} = configService;
const botSettingsService = createBotSettingsService({
    configGet,
    configSet
});
const authService = createAuthService({
    query,
    crypto,
    configGet,
    scholarProfile,
    uploadApiTokenProvider: () => UPLOAD_API_TOKEN,
    botApiTokenProvider: () => process.env.PO18_BOT_API_TOKEN || ""
});
const {
    addMembershipPatch,
    botPublicUser,
    botUsernameForTelegram,
    botUserSelect,
    cdkDuration,
    csvCell,
    currentReaderUser,
    findBotUserByTelegramId,
    generateCdkCode,
    hashPassword,
    normalizeChatId,
    normalizeTelegramId,
    publicAdminReaderUser,
    publicReaderUser,
    requireAdmin,
    requireBotApi,
    requireLibraryAccess,
    requireReader,
    requireReaderContentAccess,
    requireUploadApi,
    telegramLoginBotIdFromToken,
    telegramLoginBotToken,
    telegramLoginNickname,
    todayDateKey,
    verifyPassword,
    verifyTelegramLoginPayload
} = authService;
const eventService = createEventService({
    query,
    cleanPgText,
    cleanPgValue
});
const { recordEvent } = eventService;
const hotKeywordService = createHotKeywordService({
    configGet,
    configSet
});
const {
    addHotKeyword,
    getHotKeywords
} = hotKeywordService;
const bookSocialService = createBookSocialService({
    query,
    pool,
    normalizeTelegramId,
    botUserSelect,
    scholarProfile,
    reviewPublishCost: Number(process.env.PO18_BOOK_REVIEW_PUBLISH_COST || 100),
    reviewMinLevel: Number(process.env.PO18_BOOK_REVIEW_MIN_LEVEL || 2),
    reviewMinLength: Number(process.env.PO18_BOOK_REVIEW_MIN_LENGTH || 6),
    reviewMaxLength: Number(process.env.PO18_BOOK_REVIEW_MAX_LENGTH || 1200)
});
const {
    bookReviewById,
    bookCrowdSummary,
    bookFeedbackCounts,
    createBookReview,
    crowdLeaderboard,
    listBookReviews,
    normalizeFeedback,
    reviewMaxLength,
    reviewMinLength,
    reviewMinLevel,
    reviewPublishCost,
    updateBookReviewChannelMessage,
    voteBookReview
} = bookSocialService;
const healthService = createHealthService({
    serviceName: "server-pg",
    startedAt: STARTED_AT,
    configFile: CONFIG_FILE,
    query,
    pool,
    uploadApiToken: () => UPLOAD_API_TOKEN,
    botApiToken: () => process.env.PO18_BOT_API_TOKEN || "",
    telegramTokenProvider: async () => {
        try {
            return await telegramLoginBotToken();
        } catch {
            return process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "";
        }
    }
});
const rankService = createRankService({
    query,
    labelsProvider: () => platformLabelConfig(),
    logger: console
});
const dataQualityService = createDataQualityService({ query });
const botAuditService = createBotAuditService({ query });
const adminOverviewService = createAdminOverviewService({
    query,
    configGet,
    healthService,
    backupListPayload,
    collectSystemJobInfo,
    filterLogText,
    readLogTail,
    readJsonLinesTail,
    topSlowRequests,
    listBotAuditLogs: botAuditService.listBotAuditLogs,
    collectBotAuditSummary: botAuditService.collectBotAuditSummary,
    runtimeLogFile: RUNTIME_LOG_FILE,
    requestLogFile: REQUEST_LOG_FILE,
    slowLogFile: SLOW_LOG_FILE,
    configFile: CONFIG_FILE,
    backupDir: DEFAULT_BACKUP_DIR,
    sessionSecretProvider: () => SESSION_SECRET,
    defaultPasswordProvider: () => DEFAULT_PASSWORD,
    uploadApiTokenProvider: () => UPLOAD_API_TOKEN,
    requestSlowMsProvider: () => REQUEST_SLOW_MS
});
const telegramPushService = createTelegramPushService({
    query,
    configGet,
    configSet,
    latestBookMetadata,
    tokenProvider: telegramLoginBotToken,
    logger: console
});
const userCurrencyService = createUserCurrencyService({
    query,
    pool,
    normalizeTelegramId,
    botUserSelect,
    todayDateKey,
    scholarProfile,
    nonNegativeInt,
    currencyLabel: serverCurrencyLabel
});
const {
    channelDailyReportRecipients,
    dailyReportConfig,
    dailyReportRecipients,
    notifyTelegram,
    postJson,
    sendDailyReport,
    startDailyReportScheduler,
    telegramPushConfig
} = telegramPushService;
const bookChapterService = createBookChapterService({
    query,
    pool,
    pick,
    bookColumns,
    chapterColumns,
    cleanPgText,
    cleanPgValue,
    cleanPgObject,
    normalizeCorrectionText,
    numericBookFields,
    booleanChapterFields,
    safePgInt,
    safePgBool,
    nowSql,
    recordEvent,
    notifyTelegram,
    logger: console
});
const chapterMaintenanceService = createChapterMaintenanceService({
    query,
    pool,
    chapterListOrderSql: bookChapterService.chapterListOrderSql
});
const bookMaintenanceService = createBookMaintenanceService({
    query,
    pool,
    recordEvent
});
const po18CrawlerService = createPo18CrawlerService({
    query,
    configGet,
    configSet,
    upsertBook: bookChapterService.upsertBook,
    saveChapter: bookChapterService.saveChapter,
    createSystemJob,
    updateSystemJob,
    recordEvent,
    logger: console
});
const systemJobRetryService = createSystemJobRetryService({
    getSystemJob,
    runTrackedJob,
    rankService,
    createBackupPayload,
    restoreBackupPayload,
    bookMaintenanceService,
    chapterMaintenanceService,
    po18CrawlerService,
    configFile: CONFIG_FILE,
    backupDir: DEFAULT_BACKUP_DIR,
    collectDiagnostics,
    collectCachedSystemStatus,
    restartProcess: () => process.exit(0),
    restartDelayMsProvider: () => Number(process.env.PO18_ADMIN_RESTART_DELAY_MS || 1200)
});
const healthRoutes = createHealthRoutes({
    healthService,
    requireAdmin,
    versionPayload,
    serviceName: "server-pg",
    pool,
    readJsonLinesTail,
    requestLogFile: REQUEST_LOG_FILE,
    slowLogFile: SLOW_LOG_FILE,
    eventLogFile: EVENT_LOG_FILE,
    metricsTokenProvider: () => process.env.PO18_METRICS_TOKEN || ""
});
const rankRoutes = createRankRoutes({
    rankService,
    requireAdmin,
    runTrackedJob
});
const adminSystemRoutes = createAdminSystemRoutes({
    requireAdmin,
    healthService,
    versionPayload,
    serviceName: "server-pg",
    configFile: CONFIG_FILE,
    runtimeLogFile: RUNTIME_LOG_FILE,
    collectCachedSystemStatus,
    collectDiagnostics,
    collectAdminSystemOverview: adminOverviewService.collectAdminSystemOverview,
    collectDataQuality: dataQualityService.collectDataQuality,
    collectBotAdminOverview: adminOverviewService.collectBotAdminOverview,
    botCommandSettings: botSettingsService.botCommandSettings,
    saveBotCommandSettings: botSettingsService.saveBotCommandSettings,
    listBotAuditLogs: botAuditService.listBotAuditLogs,
    listSystemJobs,
    getSystemJob,
    cancelSystemJob,
    retrySystemJob: systemJobRetryService.retrySystemJob,
    filterLogText,
    readLogTail,
    restartProcess: () => process.exit(0),
    restartDelayMsProvider: () => Number(process.env.PO18_ADMIN_RESTART_DELAY_MS || 1200)
});
const adminBackupRoutes = createAdminBackupRoutes({
    requireAdmin,
    configFile: CONFIG_FILE,
    backupDir: DEFAULT_BACKUP_DIR,
    collectDiagnostics,
    collectCachedSystemStatus,
    remoteBackupStatus,
    uploadBackupToRemote,
    logEvent,
    restartProcess: () => process.exit(0),
    restartDelayMsProvider: () => Number(process.env.PO18_ADMIN_RESTART_DELAY_MS || 1200)
});
const adminConfigRoutes = createAdminConfigRoutes({
    requireAdmin,
    configGet,
    configSet,
    telegramLoginBotIdFromToken,
    telegramPushConfig,
    dailyReportConfig,
    dailyReportRecipients,
    channelDailyReportRecipients,
    parseTelegramPushTypes,
    parseDailyReportTime,
    platformConfigPayload,
    cleanPlatformKey,
    exportPricingConfig,
    exportPricingPayload,
    sendDailyReport,
    postJson
});
const adminCrawlerRoutes = createAdminCrawlerRoutes({
    requireAdmin,
    po18CrawlerService
});
const adminContentRoutes = createAdminContentRoutes({
    requireAdmin,
    query,
    pool,
    adminStatsCache,
    ADMIN_STATS_CACHE_MS,
    STARTED_AT,
    getFreshCache,
    setFreshCache,
    normalizeCorrectionText,
    correctionCharLength,
    textFromHtml: bookChapterService.textFromHtml,
    replaceTextAtCharOffset,
    replaceFirstText,
    cleanPgText,
    normalizeTelegramId,
    botUserSelect,
    publicAdminReaderUser,
    todayDateKey,
    listTransactions: userCurrencyService.listTransactions,
    crowdLeaderboard,
    hashPassword,
    nonNegativeInt,
    recordTransaction: userCurrencyService.recordTransaction,
    addMembershipPatch,
    cdkDuration,
    csvCell,
    generateCdkCode,
    isCacheCountSort: bookChapterService.isCacheCountSort,
    bookOrder: bookChapterService.bookOrder,
    logSlowSearch,
    slowSearchContext,
    upsertBook: bookChapterService.upsertBook,
    cleanPatch: bookChapterService.cleanPatch,
    bookColumns,
    numericBookFields,
    updateSql: bookChapterService.updateSql,
    recordEvent,
    safeTxtFilename: bookChapterService.safeTxtFilename,
    buildBookTxt: bookChapterService.buildBookTxt,
    sendCsv,
    chapterListOrderSql: bookChapterService.chapterListOrderSql,
    chapterColumns,
    numericChapterFields,
    saveChapter: bookChapterService.saveChapter,
    previewChapterOrderRepairs: chapterMaintenanceService.previewChapterOrderRepairs,
    repairChapterOrderDuplicates: chapterMaintenanceService.repairChapterOrderDuplicates,
    stalePo18BooksPreview: bookMaintenanceService.stalePo18BooksPreview,
    cleanupStalePo18Books: bookMaintenanceService.cleanupStalePo18Books,
    runTrackedJob
});
const adminAuthRoutes = createAdminAuthRoutes({
    query,
    verifyPassword,
    requireAdmin
});
const botApiRoutes = createBotApiRoutes({
    requireBotApi,
    query,
    pool,
    hashPassword,
    botUserSelect,
    botPublicUser,
    normalizeTelegramId,
    normalizeChatId,
    botUsernameForTelegram,
    findBotUserByTelegramId,
    recordTransaction: userCurrencyService.recordTransaction,
    listTransactions: userCurrencyService.listTransactions,
    exportPricingConfig,
    dailyFreeExportStatus: userCurrencyService.dailyFreeExportStatus,
    claimDailyFreeExport: userCurrencyService.claimDailyFreeExport,
    spendUserCurrency: userCurrencyService.spendUserCurrency,
    todayDateKey,
    positiveNumber,
    signExpReward,
    scholarProfile,
    randomRedPacketAmount,
    normalizeFeedback,
    bookFeedbackCounts,
    bookCrowdSummary,
    crowdLeaderboard,
    bookReviewById,
    createBookReview,
    listBookReviews,
    reviewMaxLength,
    reviewMinLength,
    reviewMinLevel,
    reviewPublishCost,
    updateBookReviewChannelMessage,
    voteBookReview,
    pushBookReviewToChannel,
    getHotKeywords,
    addHotKeyword,
    recordEvent,
    createSystemJob,
    getSystemJob,
    updateSystemJob,
    botCommandSettings: botSettingsService.botCommandSettings,
    recordBotAuditLog: botAuditService.recordBotAuditLog
});
const readerApiRoutes = createReaderApiRoutes({
    query,
    currentReaderUser,
    publicReaderUser,
    hashPassword,
    verifyPassword,
    cdkDuration,
    botUserSelect,
    telegramLoginBotToken,
    telegramLoginBotIdFromToken,
    verifyTelegramLoginPayload,
    normalizeTelegramId,
    botUsernameForTelegram,
    telegramLoginNickname,
    requireReader,
    requireLibraryAccess,
    requireReaderContentAccess,
    todayDateKey,
    signExpReward,
    scholarProfile,
    recordTransaction: userCurrencyService.recordTransaction,
    getHotKeywords,
    platformConfigPayload,
    isCacheCountSort: bookChapterService.isCacheCountSort,
    bookOrder: bookChapterService.bookOrder,
    logSlowSearch,
    slowSearchContext,
    chapterListOrderSql: bookChapterService.chapterListOrderSql,
    chapterText: bookChapterService.chapterText,
    edgeTtsFallbackVoices: EDGE_TTS_FALLBACK_VOICES,
    edgeTtsVoices,
    edgeTtsSynthesize,
    ttsProviderSettings,
    synthesizeVolcengineTts,
    synthesizeAliyunTts,
    synthesizeAzureTts,
    synthesizeElevenLabsTts,
    synthesizeCartesiaTts,
    normalizeCorrectionText,
    correctionCharLength,
    listBookReviews
});
const uploadApiRoutes = createUploadApiRoutes({
    query,
    requireUploadApi,
    saveChapter: bookChapterService.saveChapter,
    safePgBool,
    cleanPgText,
    chapterText: bookChapterService.chapterText,
    upsertBook: bookChapterService.upsertBook,
    isPgConnectionError,
    chapterListOrderSql: bookChapterService.chapterListOrderSql,
    recordEvent
});
pool.on("error", (err) => {
    console.warn(`[pg-pool] ${err.message}`);
    logEvent("warn", "server-pg", "pg-pool-error", { error: err.message || String(err) });
});

app.use(cors({ origin: true, credentials: true }));
attachExpressPanel(app, { configFile: CONFIG_FILE });
app.use(compression());
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));
app.use(["/reader-api", "/reader-auth"], (req, res, next) => {
    delete req.headers["if-none-match"];
    delete req.headers["if-modified-since"];
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
});
app.use(
    session({
        name: "po18_upload_admin_pg",
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 12 }
    })
);
app.use(createRequestLogger({ service: "server-pg", slowMs: REQUEST_SLOW_MS, skip: (req) => req.path === "/favicon.ico" }));
app.use(healthRoutes);
app.use(rankRoutes);
app.use(adminSystemRoutes);
app.use(adminBackupRoutes);
app.use(adminConfigRoutes);
app.use(adminCrawlerRoutes);
app.use(adminContentRoutes);
app.use(adminAuthRoutes);
app.use(botApiRoutes);
app.use(readerApiRoutes);
app.use(uploadApiRoutes);

function getFreshCache(cache, ttlMs) {
    if (!ttlMs || ttlMs <= 0 || !cache.payload) return null;
    return Date.now() - cache.at <= ttlMs ? cache.payload : null;
}

function setFreshCache(cache, payload) {
    cache.at = Date.now();
    cache.payload = payload;
    return payload;
}

function slowSearchContext(req, extra = {}) {
    const queryParams = req.query || {};
    return {
        path: req.originalUrl || req.path,
        q: queryParams.q || "",
        keyword: queryParams.keyword || "",
        tag: queryParams.tag || "",
        author: queryParams.author || "",
        platform: queryParams.platform || "",
        sort: queryParams.sort || "",
        page: queryParams.page || "",
        limit: queryParams.limit || "",
        ...extra
    };
}

function logSlowSearch(label, startedAt, context = {}) {
    const ms = Date.now() - startedAt;
    if (SEARCH_SLOW_QUERY_MS <= 0 || ms < SEARCH_SLOW_QUERY_MS) return;
    console.warn(`[slow-search] ${label} ${ms}ms ${JSON.stringify({ ...context, elapsedMs: ms })}`);
    logEvent("warn", "server-pg", "slow-search", { label, duration_ms: ms, context });
}

async function collectCachedSystemStatus() {
    const cached = getFreshCache(adminSystemStatusCache, ADMIN_SYSTEM_CACHE_MS);
    if (cached) return cached;
    return setFreshCache(adminSystemStatusCache, await collectStatus(CONFIG_FILE));
}

function isPgConnectionError(err) {
    const code = String(err?.code || "");
    const message = String(err?.message || "");
    return (
        ["57P03", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ENOTFOUND"].includes(code) ||
        /terminat|timeout|connect|connection|ECONN|ETIMEDOUT|recovery mode|not yet accepting connections/i.test(message)
    );
}

function dbUnavailableMessage(err) {
    const code = String(err?.code || "");
    const message = String(err?.message || "");
    if (code === "57P03" || /recovery mode|not yet accepting connections/i.test(message)) {
        return "Database is starting or recovering, please retry later";
    }
    return "Database temporarily unavailable, please retry later";
}

process.on("unhandledRejection", (reason) => {
    const message = reason && reason.message ? reason.message : String(reason || "");
    if (isPgConnectionError(reason)) {
        console.warn(`[unhandled-db] ${message}`);
        return;
    }
    console.error(`[unhandled-rejection] ${message}`);
    process.exit(1);
});

process.on("uncaughtException", (err) => {
    const message = err && err.message ? err.message : String(err || "");
    if (isPgConnectionError(err)) {
        console.warn(`[uncaught-db] ${message}`);
        return;
    }
    console.error(`[uncaught-exception] ${message}`);
    process.exit(1);
});

const SCHOLAR_LEVEL_NAMES = [
    "卷首书童",
    "青灯蒙学",
    "砚边童生",
    "案前秀才",
    "藏书廪生",
    "乡试举人",
    "春闱贡士",
    "金榜进士",
    "翰林编修",
    "御阁侍读",
    "文渊学士",
    "兰台大学士",
    "一代文宗",
    "稷下鸿儒",
    "万卷书圣"
];

function positiveNumber(value, fallback, min = 1) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
}

const SCHOLAR_EXP_BASE = positiveNumber(process.env.PO18_SCHOLAR_EXP_BASE, 1200, 1);
const SCHOLAR_EXP_GROWTH = positiveNumber(process.env.PO18_SCHOLAR_EXP_GROWTH, 1.38, 1.01);
const SIGN_EXP_BASE = Math.trunc(positiveNumber(process.env.PO18_SIGN_EXP_BASE, 60, 1));
const SIGN_EXP_STREAK_BONUS = Math.trunc(positiveNumber(process.env.PO18_SIGN_EXP_STREAK_BONUS, 8, 0));

function scholarExpForNextLevel(level = 1) {
    const safeLevel = Math.max(1, Math.trunc(Number(level || 1)));
    return Math.max(1, Math.round(SCHOLAR_EXP_BASE * Math.pow(SCHOLAR_EXP_GROWTH, safeLevel - 1)));
}

function scholarProfile(expValue = 0) {
    const totalExp = Math.max(0, Math.trunc(Number(expValue || 0)));
    let level = 1;
    let levelExp = totalExp;
    const maxLevel = 99;
    while (level < maxLevel) {
        const need = scholarExpForNextLevel(level);
        if (levelExp < need) break;
        levelExp -= need;
        level += 1;
    }
    const nextLevelExp = scholarExpForNextLevel(level);
    const name = SCHOLAR_LEVEL_NAMES[Math.min(level - 1, SCHOLAR_LEVEL_NAMES.length - 1)] || `藏书第${level}境`;
    const nextName = SCHOLAR_LEVEL_NAMES[Math.min(level, SCHOLAR_LEVEL_NAMES.length - 1)] || `藏书第${level + 1}境`;
    return {
        level,
        name,
        exp: totalExp,
        level_exp: levelExp,
        next_level_exp: nextLevelExp,
        exp_to_next: Math.max(0, nextLevelExp - levelExp),
        progress: nextLevelExp ? Number((levelExp / nextLevelExp).toFixed(4)) : 1,
        next_level_name: nextName,
        daily_free_exports: level <= 2 ? 1 : level
    };
}

function signExpReward(day = 1) {
    const safeDay = Math.max(1, Math.trunc(Number(day || 1)));
    return SIGN_EXP_BASE + (safeDay - 1) * SIGN_EXP_STREAK_BONUS;
}

function randomRedPacketAmount(remainingAmount, remainingCount) {
    if (remainingCount <= 1) return Math.max(1, Number(remainingAmount || 0));
    const maxCan = Math.max(2, Math.floor(Number(remainingAmount || 0) * 0.6));
    const raw = crypto.randomInt(1, maxCan + 1);
    return Math.max(1, Math.min(raw, Number(remainingAmount || 0) - (remainingCount - 1)));
}

function safePgInt(value, fallback = 0) {
    const num = Number.parseInt(value, 10);
    if (!Number.isFinite(num)) return fallback;
    if (num < -2147483648 || num > 2147483647) return fallback;
    return num;
}

function safePgBool(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const text = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "y", "on", "volume"].includes(text)) return true;
    if (["0", "false", "no", "n", "off"].includes(text)) return false;
    return fallback;
}

function nowSql() {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function cleanPgText(value) {
    if (typeof value !== "string") return value;
    return value.replace(/\u0000/g, "");
}

function cleanPgValue(value) {
    if (typeof value === "string") return cleanPgText(value);
    if (Array.isArray(value)) return value.map(cleanPgValue);
    if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanPgValue(item)]));
    }
    return value;
}

function cleanPgObject(data = {}) {
    for (const key of Object.keys(data)) {
        data[key] = cleanPgValue(data[key]);
    }
    return data;
}

function normalizeCorrectionText(value = "") {
    return String(value || "").replace(/\r\n?/g, "\n");
}

function correctionCharLength(value = "") {
    return Array.from(String(value || "")).length;
}

function replaceFirstText(source = "", search = "", replacement = "") {
    const text = String(source || "");
    const target = String(search || "");
    if (!target) return { changed: false, value: text };
    const index = text.indexOf(target);
    if (index < 0) return { changed: false, value: text };
    return {
        changed: true,
        value: text.slice(0, index) + String(replacement || "") + text.slice(index + target.length)
    };
}

function replaceTextAtCharOffset(source = "", search = "", replacement = "", offset = null) {
    const index = Number(offset);
    const text = String(source || "");
    const target = String(search || "");
    if (!Number.isInteger(index) || index < 0 || !target) return { changed: false, value: text };
    const chars = Array.from(text);
    const targetLength = correctionCharLength(target);
    if (chars.slice(index, index + targetLength).join("") !== target) return { changed: false, value: text };
    chars.splice(index, targetLength, ...Array.from(String(replacement || "")));
    return { changed: true, value: chars.join("") };
}

function serverCurrencyLabel(currency) {
    return currency === "silver" ? "银币" : "铜币";
}

async function latestBookMetadata(bookId) {
    if (!bookId) return null;
    const result = await query(
        `SELECT title, detail_url, platform
         FROM book_metadata
         WHERE book_id = $1
         ORDER BY COALESCE(subscribed_chapters, 0) DESC, COALESCE(updated_at, created_at) DESC, id DESC
         LIMIT 1`,
        [String(bookId)]
    );
    return result.rows[0] || null;
}

function truncateTelegramText(value = "", max = 900) {
    const text = String(value || "");
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function bookReviewChannelText(review = {}, book = {}) {
    const title = book.title || review.book_title || review.book_id || "";
    const author = book.author || review.book_author || "";
    const reviewer = review.author_telegram_username
        ? `@${review.author_telegram_username}`
        : (review.author_nickname || review.nickname || "reader");
    const lines = [
        "<b>新书评</b>",
        "",
        `<b>${telegramHtml(title)}</b>`,
        author ? `作者：${telegramHtml(author)}` : "",
        `书号：<code>${telegramHtml(review.book_id || book.book_id || "")}</code>`,
        `发布者：${telegramHtml(reviewer)}`,
        "",
        telegramHtml(truncateTelegramText(review.content || "", 900)),
        "",
        `赞 ${Number(review.like_count || 0)} · 踩 ${Number(review.dislike_count || 0)}`
    ];
    return lines.filter(Boolean).join("\n");
}

function bookReviewChannelMarkup(review = {}) {
    const id = String(review.id || "");
    const bookId = String(review.book_id || "");
    const rows = [
        [
            { text: "赞 +100铜", callback_data: `rvup|${id}`.slice(0, 64) },
            { text: "踩 -1铜", callback_data: `rvdn|${id}`.slice(0, 64) }
        ]
    ];
    if (bookId) rows.push([{ text: "书籍详情", callback_data: `info|${bookId}`.slice(0, 64) }]);
    return { inline_keyboard: rows };
}

async function pushBookReviewToChannel({ review, book } = {}) {
    if (!review?.id) return { skipped: "missing_review" };
    const [token, chatId] = await Promise.all([
        telegramLoginBotToken(),
        configGet("telegram_chat_id")
    ]);
    if (!token || !chatId) {
        await updateBookReviewChannelMessage(review.id, { status: "skipped", error: "missing telegram_bot_token or telegram_chat_id" }).catch(() => {});
        return { skipped: "missing_channel_config" };
    }
    try {
        const raw = await postJson(telegramApiUrl(token, "sendMessage"), {
            chat_id: chatId,
            text: bookReviewChannelText(review, book),
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: bookReviewChannelMarkup(review)
        });
        const parsed = JSON.parse(raw || "{}");
        const messageId = parsed?.result?.message_id ? String(parsed.result.message_id) : "";
        await updateBookReviewChannelMessage(review.id, {
            channel_chat_id: String(chatId),
            channel_message_id: messageId,
            status: "sent",
            error: ""
        }).catch(() => {});
        return { sent: true, chat_id: String(chatId), message_id: messageId };
    } catch (err) {
        await updateBookReviewChannelMessage(review.id, {
            status: "failed",
            error: String(err.message || err).slice(0, 500)
        }).catch(() => {});
        throw err;
    }
}


async function initAdmin() {
    const found = await query("SELECT id FROM admin_users WHERE username = $1", [DEFAULT_ADMIN]);
    if (found.rows.length) return;
    const { salt, hash } = hashPassword(DEFAULT_PASSWORD);
    await query("INSERT INTO admin_users(username, password_hash, salt) VALUES ($1,$2,$3)", [DEFAULT_ADMIN, hash, salt]);
}

function requestHostWithoutPort(req) {
    const raw = String(req.headers["x-forwarded-host"] || req.get("host") || "").split(",")[0].trim();
    if (!raw) return "localhost";
    if (raw.startsWith("[")) return raw.replace(/:\d+$/, "");
    return raw.split(":")[0] || "localhost";
}

function readerRedirectUrl(req) {
    const configured = String(process.env.PO18_READER_PUBLIC_URL || process.env.READER_PUBLIC_URL || "").trim();
    if (configured) return configured;
    const protocol = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim() || "http";
    return `${protocol}://${requestHostWithoutPort(req)}:3200/`;
}

app.get("/favicon.ico", (req, res) => res.status(204).end());

app.get("/reader", (req, res) => res.redirect(302, readerRedirectUrl(req)));

app.use((req, res, next) => {
    const blockedPrefixes = ["/cirno", "/cirno-app", "/cirno-root"];
    if (blockedPrefixes.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
        res.status(404).json({ error: "Not Found" });
        return;
    }
    next();
});

app.get("/rank", (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(__dirname, "public", "rank.html"));
});

app.use(
    "/",
    express.static(path.join(__dirname, "public"), {
        etag: true,
        lastModified: true,
        maxAge: "1h",
        setHeaders(res, filePath) {
            if (filePath.endsWith("index.html")) {
                res.setHeader("Cache-Control", "no-cache");
            }
        }
    })
);
app.use((err, req, res, next) => {
    const isDbConnectionError = isPgConnectionError(err);
    if (isDbConnectionError) {
        console.warn(`[request-db] ${req.method} ${req.originalUrl}: ${err.message}`);
        return res.status(503).json({ error: dbUnavailableMessage(err), code: err.code || "" });
    }
    console.error(err);
    const body = { error: err.message || "Internal Server Error" };
    if (err.expectedConfirm) body.expectedConfirm = err.expectedConfirm;
    res.status(err.status || 500).json(body);
});

async function bootApplication() {
    await initPg();
    await initAdmin();
    startDailyReportScheduler();
    rankService.startRefreshScheduler();
    await po18CrawlerService.startScheduler();
}

function bootApplicationWithRetry(attempt = 1) {
    bootApplication()
        .then(() => {
            console.log("[startup] database initialized");
        })
        .catch((err) => {
            const message = err.message || String(err);
            if (isPgConnectionError(err)) {
                console.warn(`[startup] database unavailable (${message}); retrying in ${STARTUP_DB_RETRY_MS}ms`);
                setTimeout(() => bootApplicationWithRetry(attempt + 1), STARTUP_DB_RETRY_MS).unref();
                return;
            }
            console.error(`[startup] ${message}`);
        });
}

app.listen(PORT, HOST, () => {
    console.log(`[sidecar-pg] upload/admin server: http://${HOST}:${PORT}`);
    bootApplicationWithRetry();
});

