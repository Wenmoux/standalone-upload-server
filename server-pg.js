/**
 * [INPUT]: 依赖 Express/PostgreSQL、账户/签到等领域服务、应用生命周期、启动流量闸门、Admin 静态产物及 /config 配置
 * [OUTPUT]: 装配并启动 3100 端口服务，在迁移及初始化完成前仅开放健康检查、拒绝业务流量
 * [POS]: 项目后端唯一组合根，只声明依赖图、HTTP 管线和启动入口，领域规则与生命周期下沉到 services
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const express = require("express");
const { markTelegramSystemPush } = require("./telegram-push-contract");
const crypto = require("crypto");
const { initPg, query, pool, databaseQueryMetrics, bookColumns, chapterColumns, pick } = require("./pg-store");
const { collectDiagnostics, collectStatus, filterLogText, readLogTail, versionPayload } = require("./docker/control-panel");
const {
    EVENT_LOG_FILE,
    REQUEST_LOG_FILE,
    SLOW_LOG_FILE,
    logEvent,
    readJsonLinesTail,
    topSlowRequests
} = require("./docker/structured-log");
const {
    collectSystemJobInfo,
    cancelSystemJob,
    claimSystemJob,
    claimSystemJobs,
    createSystemJob,
    getSystemJob,
    heartbeatSystemJob,
    listSystemJobs,
    collectSystemJobMetrics,
    runTrackedJob,
    updateSystemJob
} = require("./services/system-jobs");
const { DEFAULT_BACKUP_DIR, backupListPayload, createBackupPayload, restoreBackupPayload } = require("./services/backups");
const { createHealthService } = require("./services/health");
const { createStartupGate } = require("./services/startup-gate");
const { createRankService } = require("./services/rank");
const { createDataQualityService } = require("./services/data-quality");
const { createBookManifestService } = require("./services/book-manifest");
const { createAdminOverviewService } = require("./services/admin-overview");
const { createReaderRumService } = require("./services/reader-rum");
const { createUserCurrencyService } = require("./services/user-currency");
const { createReaderAccountService } = require("./services/reader-account");
const { createReaderCheckInService } = require("./services/reader-check-in");
const { createBookChapterService } = require("./services/book-chapters");
const { createConfigService } = require("./services/config");
const { createEpubStyle2AssetService } = require("./services/epub-style2-assets");
const { createBotSettingsService } = require("./services/bot-settings");
const { dbUnavailableMessage, isPgUnavailableError: isPgConnectionError } = require("./services/db-errors");
const { sendCsv } = require("./services/admin-exports");
const { remoteBackupStatus, uploadBackupToRemote } = require("./services/remote-backups");
const { createAuthService } = require("./services/auth");
const { createEventService } = require("./services/events");
const { createHotKeywordService } = require("./services/hot-keywords");
const { createWordCloudService } = require("./services/word-cloud");
const { createBookSocialService } = require("./services/book-social");
const { createBookCrowdService } = require("./services/book-crowd");
const { createRedPacketService } = require("./services/red-packets");
const { createReviewGovernanceService } = require("./services/review-governance");
const { createChapterMaintenanceService } = require("./services/chapter-maintenance");
const { createBookMaintenanceService } = require("./services/book-maintenance");
const { createSystemJobRetryService } = require("./services/job-retry");
const { createBotAuditService } = require("./services/bot-audit");
const { createPo18CrawlerService } = require("./services/po18-crawler");
const { createCredentialCrypto, encryptStoredPo18Credentials } = require("./services/credential-crypto");
const { botScopeForRequest, createApiTokenService } = require("./services/api-tokens");
const { createBackupRestoreDrillScheduler } = require("./services/backup-restore-drill");
const { listAdminAuditLogs } = require("./services/admin-audit");
const { createScholarProgression, currencyLabel: serverCurrencyLabel } = require("./services/scholar-progression");
const { cleanPgObject, cleanPgText, cleanPgValue, nowSql, safePgBool, safePgInt } = require("./services/postgres-values");
const { correctionCharLength, normalizeCorrectionText, replaceFirstText, replaceTextAtCharOffset } = require("./services/correction-text");
const {
    createCachedSystemStatusCollector,
    createSlowSearchLogger,
    getFreshCache,
    installProcessErrorHandlers,
    setFreshCache,
    slowSearchContext
} = require("./services/runtime-observability");
const { createBookReviewChannelService, createLatestBookMetadataLookup } = require("./services/book-review-channel");
const { createApplicationRuntime, installStaticAndErrorRoutes } = require("./services/application-runtime");
const { installHttpPipeline } = require("./services/http-pipeline");
const { assertProductionSecurity, trustProxySetting } = require("./services/http-security");
const { createHealthRoutes } = require("./routes/health");
const { createRankRoutes } = require("./routes/rank");
const { createAdminSystemRoutes } = require("./routes/admin-system");
const { createAdminBackupRoutes } = require("./routes/admin-backups");
const { createAdminConfigRoutes } = require("./routes/admin-config");
const { createAdminCrawlerRoutes } = require("./routes/admin-crawler");
const { createAdminContentRoutes } = require("./routes/admin-content");
const { createAdminManifestRoutes } = require("./routes/admin-manifests");
const { createReviewGovernanceRoutes } = require("./routes/review-governance");
const { createAdminAuthRoutes } = require("./routes/admin-auth");
const { createBotApiRoutes } = require("./routes/bot-api");
const { createReaderApiRoutes } = require("./routes/reader-api");
const { createUploadApiRoutes } = require("./routes/upload-api");
const { createOpenApiRoutes } = require("./routes/openapi");
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
const credentialCrypto = createCredentialCrypto({ fallbackSecret: SESSION_SECRET });
const apiTokenService = createApiTokenService({ query });
const RUNTIME_LOG_FILE = process.env.PO18_RUNTIME_LOG_FILE || "/config/runtime.log";
const ADMIN_STATS_CACHE_MS = Number(process.env.PO18_ADMIN_STATS_CACHE_MS || 30000);
const ADMIN_SYSTEM_CACHE_MS = Number(process.env.PO18_ADMIN_SYSTEM_CACHE_MS || 3000);
const REQUEST_SLOW_MS = Number.isFinite(Number(process.env.PO18_SLOW_REQUEST_MS)) ? Number(process.env.PO18_SLOW_REQUEST_MS) : 800;
const SEARCH_SLOW_QUERY_MS = Number.isFinite(Number(process.env.PO18_SEARCH_SLOW_QUERY_MS))
    ? Number(process.env.PO18_SEARCH_SLOW_QUERY_MS)
    : 800;
const STARTUP_DB_RETRY_MS = Number.isFinite(Number(process.env.PO18_STARTUP_DB_RETRY_MS))
    ? Math.max(1000, Number(process.env.PO18_STARTUP_DB_RETRY_MS))
    : 5000;
const STARTUP_FAILURE_RETRY_MS = Math.max(60000, STARTUP_DB_RETRY_MS);
const app = express();
const startupGate = createStartupGate({ retryAfterSeconds: Math.ceil(STARTUP_DB_RETRY_MS / 1000) });
app.set("trust proxy", trustProxySetting());
const adminStatsCache = { at: 0, payload: null };
const adminSystemStatusCache = { at: 0, payload: null };
const { scholarProfile, signExpReward, randomRedPacketAmount } = createScholarProgression({
    expBase: process.env.PO18_SCHOLAR_EXP_BASE,
    expGrowth: process.env.PO18_SCHOLAR_EXP_GROWTH,
    signExpBase: process.env.PO18_SIGN_EXP_BASE,
    signExpStreakBonus: process.env.PO18_SIGN_EXP_STREAK_BONUS
});
const logSlowSearch = createSlowSearchLogger({
    thresholdMs: SEARCH_SLOW_QUERY_MS,
    logEvent,
    logger: console
});
const collectCachedSystemStatus = createCachedSystemStatusCollector({
    cache: adminSystemStatusCache,
    ttlMs: ADMIN_SYSTEM_CACHE_MS,
    collectStatus,
    configFile: CONFIG_FILE
});
const latestBookMetadata = createLatestBookMetadataLookup(query);
installProcessErrorHandlers({
    isDatabaseError: isPgConnectionError,
    logger: console
});
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
const epubStyle2Assets = createEpubStyle2AssetService({ configFile: CONFIG_FILE });
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
    botApiTokenProvider: () => process.env.PO18_BOT_API_TOKEN || "",
    uploadTokenAuthenticator: ({ token, req }) => apiTokenService.authenticate({ token, kind: "upload", scope: "crawler:write", req }),
    botTokenAuthenticator: ({ token, req }) => apiTokenService.authenticate({ token, kind: "bot", scope: botScopeForRequest(req), req })
});
const {
    addMembershipPatch,
    botPublicUser,
    botUsernameForTelegram,
    botUserSelect,
    cdkDuration,
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
const readerAccountService = createReaderAccountService({
    query,
    pool,
    crypto,
    hashPassword,
    verifyPassword,
    cdkDuration,
    botUserSelect,
    normalizeTelegramId,
    botUsernameForTelegram,
    telegramLoginNickname
});
const readerCheckInService = createReaderCheckInService({ pool, botUserSelect, todayDateKey, signExpReward, scholarProfile });
const eventService = createEventService({
    query,
    cleanPgText,
    cleanPgValue
});
const { recordEvent } = eventService;
const hotKeywordService = createHotKeywordService({ configGet, configSet });
const { addHotKeyword, getHotKeywords } = hotKeywordService;
const wordCloudService = createWordCloudService({ query, getHotKeywords });
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
    claimBookReviewChannelDelivery,
    createBookReview,
    listBookReviews,
    reviewMaxLength,
    reviewMinLength,
    reviewMinLevel,
    reviewPublishCost,
    updateBookReviewChannelMessage,
    voteBookReview
} = bookSocialService;
const bookCrowdService = createBookCrowdService({ query, pool, normalizeTelegramId, botUserSelect, crowdVoteCost: 100 });
const redPacketService = createRedPacketService({ pool, botUserSelect, normalizeTelegramId, normalizeChatId, randomRedPacketAmount });
const reviewGovernanceService = createReviewGovernanceService({ query, pool });
const healthService = createHealthService({
    serviceName: "server-pg",
    startedAt: STARTED_AT,
    configFile: CONFIG_FILE,
    query,
    pool,
    uploadApiToken: () => UPLOAD_API_TOKEN,
    botApiToken: () => process.env.PO18_BOT_API_TOKEN || "",
    credentialEncryption: () => ({ configured: credentialCrypto.configured, activeKeyId: credentialCrypto.activeKeyId }),
    startupState: startupGate.snapshot,
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
const bookManifestService = createBookManifestService({
    query,
    pool,
    appVersion: () => versionPayload("server-pg").version
});
const backupRestoreDrillScheduler = createBackupRestoreDrillScheduler({
    configFile: CONFIG_FILE,
    backupDir: DEFAULT_BACKUP_DIR,
    logEvent
});
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
    labelsProvider: platformLabelConfig,
    readerPublicUrlProvider: () => process.env.PO18_READER_PUBLIC_URL || process.env.READER_PUBLIC_URL || "",
    tokenProvider: telegramLoginBotToken,
    logger: console
});
const readerRumService = createReaderRumService({ query });
const userCurrencyService = createUserCurrencyService({
    query,
    pool,
    normalizeTelegramId,
    botUserSelect,
    todayDateKey,
    scholarProfile,
    exportPricingConfig,
    nonNegativeInt,
    currencyLabel: serverCurrencyLabel
});
const {
    channelDailyReportRecipients,
    countRegisteredUserRecipients,
    dailyReportConfig,
    dailyReportRecipients,
    notifyTelegram,
    postJson,
    registeredUserRecipients,
    sendDirectMessage,
    sendDailyReport,
    startDailyReportScheduler,
    telegramPushConfig
} = telegramPushService;
const { pushBookReviewToChannel } = createBookReviewChannelService({
    latestBookMetadata,
    telegramPushConfig,
    telegramLoginBotToken,
    configGet,
    claimBookReviewChannelDelivery,
    updateBookReviewChannelMessage,
    postJson,
    telegramApiUrl,
    telegramHtml,
    markTelegramSystemPush
});
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
    credentialCrypto,
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
    crawlerSnapshotProvider: po18CrawlerService.snapshot,
    systemJobMetricsProvider: collectSystemJobMetrics,
    dataQualityMetricsProvider: dataQualityService.collectDataQualityMetrics,
    databaseQueryMetricsProvider: databaseQueryMetrics,
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
    readerRumSummary: readerRumService.summary,
    botCommandSettings: botSettingsService.botCommandSettings,
    saveBotCommandSettings: botSettingsService.saveBotCommandSettings,
    listBotAuditLogs: botAuditService.listBotAuditLogs,
    listAdminAuditLogs: (filters) => listAdminAuditLogs(query, filters),
    listApiTokens: apiTokenService.listTokens,
    revokeApiToken: apiTokenService.revokeToken,
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
    epubStyle2Assets,
    sendDailyReport,
    postJson,
    createSystemJob,
    countRegisteredUserRecipients
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
    crowdLeaderboard: bookCrowdService.crowdLeaderboard,
    hashPassword,
    nonNegativeInt,
    recordTransaction: userCurrencyService.recordTransaction,
    addMembershipPatch,
    cdkDuration,
    generateCdkCode,
    sendDirectMessage,
    readerPublicUrl: process.env.PO18_READER_PUBLIC_URL || process.env.READER_PUBLIC_URL || "",
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
const adminManifestRoutes = createAdminManifestRoutes({
    requireAdmin,
    bookManifestService,
    logEvent
});
const reviewGovernanceRoutes = createReviewGovernanceRoutes({
    requireAdmin,
    requireReader,
    requireBotApi,
    currentReaderUser,
    service: reviewGovernanceService
});
const adminAuthRoutes = createAdminAuthRoutes({
    query,
    hashPassword,
    verifyPassword,
    requireAdmin
});
const botApiRoutes = createBotApiRoutes({
    requireBotApi,
    query,
    pool,
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
    claimExtraExportQuota: userCurrencyService.claimExtraExportQuota,
    redeemExportQuotaCdk: userCurrencyService.redeemExportQuotaCdk,
    spendUserCurrency: userCurrencyService.spendUserCurrency,
    adjustUserCurrency: userCurrencyService.adjustUserCurrency,
    registerBotUser: readerAccountService.registerBotUser,
    importBotUsers: readerAccountService.importBotUsers,
    checkInUser: readerCheckInService.checkInUser,
    createRedPacket: redPacketService.createRedPacket,
    claimRedPacket: redPacketService.claimRedPacket,
    createBookFeedback: bookCrowdService.createBookFeedback,
    bookCrowdSummary: bookCrowdService.bookCrowdSummary,
    crowdLeaderboard: bookCrowdService.crowdLeaderboard,
    createCrowdVote: bookCrowdService.createCrowdVote,
    bookReviewById,
    createBookReview,
    listBookReviews,
    reviewMaxLength,
    reviewMinLength,
    reviewMinLevel,
    reviewPublishCost,
    voteBookReview,
    pushBookReviewToChannel,
    getHotKeywords,
    addHotKeyword,
    wordCloudPayload: wordCloudService.wordCloudPayload,
    recordEvent,
    credentialCrypto,
    createSystemJob,
    claimSystemJob,
    claimSystemJobs,
    getSystemJob,
    heartbeatSystemJob,
    updateSystemJob,
    listSystemJobs,
    cancelSystemJob,
    registeredUserRecipients,
    botCommandSettings: botSettingsService.botCommandSettings,
    recordBotAuditLog: botAuditService.recordBotAuditLog
});
const readerApiRoutes = createReaderApiRoutes({
    query,
    currentReaderUser,
    publicReaderUser,
    botUserSelect,
    telegramLoginBotToken,
    telegramLoginBotIdFromToken,
    verifyTelegramLoginPayload,
    requireReader,
    requireLibraryAccess,
    requireReaderContentAccess,
    registerReaderWithCdk: readerAccountService.registerReaderWithCdk,
    loginReaderWithPassword: readerAccountService.loginReaderWithPassword,
    loginReaderWithTelegram: readerAccountService.loginReaderWithTelegram,
    checkInUser: readerCheckInService.checkInUser,
    getHotKeywords,
    platformConfigPayload,
    isCacheCountSort: bookChapterService.isCacheCountSort,
    bookOrder: bookChapterService.bookOrder,
    logSlowSearch,
    slowSearchContext,
    chapterListOrderSql: bookChapterService.chapterListOrderSql,
    chapterText: bookChapterService.chapterText,
    textFromHtml: bookChapterService.textFromHtml,
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
    listBookReviews,
    readerRumService
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
const openApiRoutes = createOpenApiRoutes({
    app,
    versionProvider: () => versionPayload("server-pg").version
});
pool.on("error", (err) => {
    console.warn(`[pg-pool] ${err.message}`);
    logEvent("warn", "server-pg", "pg-pool-error", { error: err.message || String(err) });
});

installHttpPipeline({
    app,
    express,
    pool,
    startupGate,
    configFile: CONFIG_FILE,
    sessionSecret: SESSION_SECRET,
    requestSlowMs: REQUEST_SLOW_MS,
    query,
    logEvent,
    env: process.env,
    logger: console
});
app.use(healthRoutes);
app.use(rankRoutes);
app.use(adminSystemRoutes);
app.use(adminBackupRoutes);
app.use(adminConfigRoutes);
app.use(adminCrawlerRoutes);
app.use(adminManifestRoutes);
app.use(reviewGovernanceRoutes);
app.use(adminContentRoutes);
app.use(adminAuthRoutes);
app.use(botApiRoutes);
app.use(readerApiRoutes);
app.use(uploadApiRoutes);
app.use(openApiRoutes);

installStaticAndErrorRoutes({
    app,
    express,
    projectDir: __dirname,
    readerPublicUrlProvider: () => process.env.PO18_READER_PUBLIC_URL || process.env.READER_PUBLIC_URL || "",
    isDatabaseError: isPgConnectionError,
    databaseErrorMessage: dbUnavailableMessage,
    logger: console
});

const applicationRuntime = createApplicationRuntime({
    query,
    initPg,
    syncConfiguredTokens: apiTokenService.syncConfiguredTokens,
    configuredTokensProvider: () => ({
        botToken: process.env.PO18_BOT_API_TOKEN || "",
        botScopes: process.env.PO18_BOT_API_SCOPES || "",
        botAllowedIps: process.env.PO18_BOT_API_ALLOWED_IPS || "",
        uploadToken: UPLOAD_API_TOKEN,
        uploadAllowedIps: process.env.PO18_UPLOAD_API_ALLOWED_IPS || ""
    }),
    encryptStoredCredentials: encryptStoredPo18Credentials,
    credentialCrypto,
    defaultAdmin: DEFAULT_ADMIN,
    defaultPassword: DEFAULT_PASSWORD,
    hashPassword,
    startupGate,
    schedulers: [
        ["daily-report", () => startDailyReportScheduler()],
        ["rank-refresh", () => rankService.startRefreshScheduler()],
        ["backup-restore-drill", () => backupRestoreDrillScheduler.start()],
        ["po18-crawler", () => po18CrawlerService.startScheduler()]
    ],
    isDatabaseError: isPgConnectionError,
    startupDbRetryMs: STARTUP_DB_RETRY_MS,
    startupFailureRetryMs: STARTUP_FAILURE_RETRY_MS,
    logger: console
});

assertProductionSecurity();

app.listen(PORT, HOST, () => {
    console.log(`[sidecar-pg] upload/admin server: http://${HOST}:${PORT}`);
    applicationRuntime.bootApplicationWithRetry();
});
