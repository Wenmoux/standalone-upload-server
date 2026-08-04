/**
 * [INPUT]: 依赖 bot 内客户端、动态平台注册表、领域处理器、命令注册、任务运行时、进程生命周期边界与环境配置
 * [OUTPUT]: 装配 Telegram Bot 领域依赖与 update 分派，并把命令同步、任务恢复、polling/health 启动交给进程运行时
 * [POS]: bot 的唯一业务组合根，只负责依赖注入和 update 分派，领域交互与进程生命周期分别下沉到独立边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { PgBotClient } = require("./pg-bot-client");
const { createRateLimiter, formatWait, positiveMs } = require("./rate-limit");
const { createTelegramClient, truncate } = require("./telegram");
const { createCommandRegistry } = require("./command-registry");
const { registerAccountCommands } = require("./commands/account");
const { registerExportCommands } = require("./commands/export");
const { registerIntegrationCommands } = require("./commands/integrations");
const { registerSearchCommands } = require("./commands/search");
const { registerSocialCommands } = require("./commands/social");
const { asExportError, classifyExportError, formatExportFailure, isPrivateChatUnavailableError } = require("./export-errors");
const { DEFAULT_RECOMMEND_PLATFORM, createSearchPlatformRegistry } = require("./search-platforms");
const { createSearchQueryParser } = require("./search-query");
const { createEpubBuilder } = require("./epub-builder");
const { createPo18Client } = require("./po18-client");
const { createRemoteStorage } = require("./remote-storage");
const { createBotUi } = require("./ui-formatters");
const { createBotTaskRuntime } = require("./task-runtime");
const { createMessageRuntime } = require("./message-runtime");
const { createExportBuilder } = require("./export-builder");
const epubPicker = require("./epub-style-picker");
const { renderEpubPreviewPng } = require("./epub-preview");
const {
    EPUB_EXPORT_STYLE_CHOICES,
    epubCustomSelectionMarkup,
    epubCustomSummary,
    epubStudioSelectionMarkup,
    epubStudioSummary,
    epubStyleSelectionMarkup,
    normalizeEpubCustomConfig,
    normalizeEpubStyleChoice,
    parseEpubCustomState,
    parseEpubStudioState
} = epubPicker;
const { createTaskSchedulers } = require("./task-schedulers");
const {
    createBroadcastDraftStore,
    createReviewDraftStore,
    createSearchCache,
    helpLinesFromCommands: buildHelpLinesFromCommands
} = require("./bot-session");
const { startBotProcessRuntime } = require("./process-runtime");
const { createAutomaticPushUnpinHandler } = require("./automatic-push-unpin");
const { createPo18AccountHandlers } = require("./po18-account-handlers");
const { createShareHandlers } = require("./share-handlers");
const { createTaskStatusHandlers } = require("./task-status-handlers");
const { createSearchHandlers } = require("./search-handlers");
const { createSocialHandlers } = require("./social-handlers");
const { createBroadcastHandlers } = require("./broadcast-handlers");
const { createAccountHandlers } = require("./account-handlers");
const { createEconomyHandlers } = require("./economy-handlers");
const { createExportDelivery } = require("./export-delivery");
const { createEpubCustomHandler } = require("./epub-custom-handlers");
const { createEpubStudioHandler } = require("./epub-studio-handlers");
const { createPikpakHandler } = require("./pikpak-handler");
const {
    mainMenuMarkup,
    mainMenuText,
    meText,
    po18MenuMarkup,
    po18MenuText,
    registerText,
    signSuccessText,
    startHelpText
} = require("./account-formatters");
const { createMenuHandlers } = require("./menu-handlers");
const {
    escapeHtml,
    delay,
    yieldToEventLoop,
    writeStreamChunk,
    finishWriteStream,
    cleanText,
    chapterPlainText,
    isVolumeChapter,
    safeFileName,
    bytes,
    userDisplayName,
    mentionUser,
    bookToSharePayload,
    extractCacheIds,
    chapterToSharePayload
} = require("./text-share-utils");
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "";
const TELEGRAM_API_BASE = String(process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
const POLL_TIMEOUT = Number(process.env.TELEGRAM_POLL_TIMEOUT || 25);
const TELEGRAM_REQUEST_TIMEOUT = Number(process.env.TELEGRAM_REQUEST_TIMEOUT_MS || Math.max(60000, (POLL_TIMEOUT + 10) * 1000));
const SEARCH_LIMIT = Number(process.env.TELEGRAM_SEARCH_LIMIT || 5);
const EXPORT_MAX_CHAPTERS = Number(process.env.TELEGRAM_EXPORT_MAX_CHAPTERS || 5000);
const BOT_BACKGROUND_CONCURRENCY_VALUE = Number(process.env.TELEGRAM_BOT_BACKGROUND_CONCURRENCY);
const BOT_BACKGROUND_CONCURRENCY = Number.isFinite(BOT_BACKGROUND_CONCURRENCY_VALUE) ? Math.max(1, BOT_BACKGROUND_CONCURRENCY_VALUE) : 2;
const BOT_SEARCH_COOLDOWN_MS = positiveMs(process.env.TELEGRAM_SEARCH_COOLDOWN_MS, 2000);
const BOT_INFO_COOLDOWN_MS = positiveMs(process.env.TELEGRAM_INFO_COOLDOWN_MS, 2000);
const BOT_EXPORT_COOLDOWN_MS = positiveMs(process.env.TELEGRAM_EXPORT_COOLDOWN_MS, 60000);
const BOT_BOOKSHELF_COOLDOWN_MS = positiveMs(process.env.TELEGRAM_BOOKSHELF_COOLDOWN_MS, 300000);
const BOT_PIKPAK_COOLDOWN_MS = positiveMs(process.env.TELEGRAM_PIKPAK_COOLDOWN_MS, 10000);
const BOT_GROUP_LONG_TEXT_THRESHOLD = positiveMs(process.env.TELEGRAM_GROUP_LONG_TEXT_THRESHOLD, 1600);
const PRIVATE_EXPORT_START_TTL_MS = positiveMs(process.env.TELEGRAM_PRIVATE_EXPORT_START_TTL_MS, 30 * 60 * 1000);
const BOT_HEALTH_PORT = Number(process.env.BOT_HEALTH_PORT || 3300);
const BOT_HEALTH_HOST = process.env.BOT_HEALTH_HOST || "127.0.0.1";
const BOT_HEALTH_STALE_MS = Number(process.env.BOT_HEALTH_STALE_MS || 120000);
const SEARCH_PLATFORM_CONFIG_TTL_MS = 60_000;
const STARTED_AT = Date.now();
const CROWD_VOTE_COST = 100;
const PO18_BOOKSHELF_SHARE_REWARD_COPPER = Math.max(0, Number(process.env.PO18_BOOKSHELF_SHARE_REWARD_COPPER || 1000));
const PO18_BOOKSHELF_SHARE_REWARD_MIN_CHAPTERS = Math.max(0, Number(process.env.PO18_BOOKSHELF_SHARE_REWARD_MIN_CHAPTERS || 20));
const client = new PgBotClient();
const searchPlatformRegistry = createSearchPlatformRegistry();
const parsePlatformSuffix = (...args) => searchPlatformRegistry.parsePlatformSuffix(...args);
const platformLabel = (...args) => searchPlatformRegistry.platformLabel(...args);
const telegramClient = createTelegramClient({
    token: TELEGRAM_TOKEN,
    apiBase: TELEGRAM_API_BASE,
    requestTimeoutMs: TELEGRAM_REQUEST_TIMEOUT
});
const { telegram, sendMessage, editMessage, editPhoto, clearReplyMarkup, sendDocument, sendPhoto, answerCallback } = telegramClient;
const maybeUnpinAutomaticPush = createAutomaticPushUnpinHandler({ telegram, logger: console });
const rateLimiter = createRateLimiter({ maxKeys: Number(process.env.TELEGRAM_RATE_LIMIT_MAX_KEYS || 5000) });
const { parseSearchQuery, parseBookId } = createSearchQueryParser({ searchLimit: SEARCH_LIMIT, parsePlatformSuffix });
const { commandOf, argsOf, isGroup, withCooldown, mentionsMe, recordBotAudit, withBotAudit, deliverLongGroupResult } = createMessageRuntime(
    {
        client,
        rateLimiter,
        formatWait,
        sendMessage,
        editMessage,
        escapeHtml,
        classifyExportError,
        botUserProvider: () => botUser,
        longTextThreshold: BOT_GROUP_LONG_TEXT_THRESHOLD
    }
);
const { botTaskQueue, recoverPersistentJobs } = createBotTaskRuntime({
    client,
    sendMessage,
    escapeHtml,
    formatExportFailure,
    recordBotAudit,
    concurrency: BOT_BACKGROUND_CONCURRENCY
});
const { makeEpubFiles, buildZip } = createEpubBuilder({ cleanText, escapeHtml, chapterPlainText, isVolumeChapter, yieldToEventLoop });
const {
    callback,
    bookActions,
    bookReviewsActions,
    crowdActions,
    listActions,
    searchPager,
    searchRequestActions,
    mergeKeyboards,
    bookListItem,
    bookReviewsText,
    detailCardText,
    crowdCardText,
    reviewChannelText,
    reviewPromptActions,
    reviewVoteActions,
    currencyLabel,
    transactionLine,
    normalizeExportPricing,
    paidExportChapterCount,
    exportQuote,
    exportQuoteText,
    scholarText,
    freeExportText,
    parseRedPacketArgs,
    redPacketMarkup
} = createBotUi({ escapeHtml, cleanText, truncate, isVolumeChapter, platformLabel, crowdVoteCost: CROWD_VOTE_COST });
const { po18Fetch, parseLoginFields, hasPo18Auth, validatePo18Session, fetchPo18Bookshelf, fetchPo18PurchasedChapters } = createPo18Client({
    cleanText
});
const { buildExport } = createExportBuilder({
    client,
    exportMaxChapters: EXPORT_MAX_CHAPTERS,
    isVolumeChapter,
    hasPo18Auth,
    fetchPo18PurchasedChapters,
    asExportError,
    safeFileName,
    writeStreamChunk,
    finishWriteStream,
    yieldToEventLoop,
    chapterPlainText,
    paidExportChapterCount,
    makeEpubFiles,
    buildZip
});
const exportDelivery = createExportDelivery({
    client,
    telegram,
    sendMessage,
    editMessage,
    editPhoto,
    clearReplyMarkup,
    sendPhoto,
    sendDocument,
    isGroup,
    escapeHtml,
    asExportError,
    formatExportFailure,
    isPrivateChatUnavailableError,
    normalizeEpubCustomConfig,
    normalizeEpubStyleChoice,
    epubStyleChoices: EPUB_EXPORT_STYLE_CHOICES,
    epubCustomSelectionMarkup,
    epubCustomSummary,
    epubStudioSelectionMarkup,
    epubStudioSummary,
    epubStyleSelectionMarkup,
    callback,
    ensureRegistered: (...args) => accountHandlers.ensureRegistered(...args),
    buildExport,
    normalizeExportPricing,
    exportQuote,
    exportQuoteText,
    freeExportText,
    botUserProvider: () => botUser,
    privateExportStartTtlMs: PRIVATE_EXPORT_START_TTL_MS,
    renderEpubPreviewPng
});
const { requestEpubCustomization, requestEpubStudio, requestEpubStyle, sendExport, takePrivateExportStart } = exportDelivery;
const accountHandlers = createAccountHandlers({
    client,
    sendMessage,
    deliverLongGroupResult,
    escapeHtml,
    scholarText,
    freeExportText,
    startHelpText,
    registerText,
    meText,
    signSuccessText,
    mainMenuText,
    mainMenuMarkup,
    refreshCommandSettings,
    helpLinesFromCommands,
    takePrivateExportStart,
    scheduleExport: (...args) => scheduleExport(...args),
    epubStyleChoices: EPUB_EXPORT_STYLE_CHOICES
});
const { ensureRegistered, handleHelp, handleMe, handleMenu, handleRegister, handleSign, handleStart } = accountHandlers;
const { handleShare, handleShareBookshelf } = createShareHandlers({
    client,
    sendMessage,
    editMessage,
    ensureRegistered,
    escapeHtml,
    isVolumeChapter,
    userDisplayName,
    bookToSharePayload,
    extractCacheIds,
    chapterToSharePayload,
    fetchPo18PurchasedChapters,
    fetchPo18Bookshelf,
    hasPo18Auth,
    rewardCopper: PO18_BOOKSHELF_SHARE_REWARD_COPPER,
    rewardMinChapters: PO18_BOOKSHELF_SHARE_REWARD_MIN_CHAPTERS
});
const { pikpakConfig, webdavRequest, pikpakList, pikpakSearch } = createRemoteStorage();
const { handleClaimRedPacket, handleGive, handleRedeem, handleRedPacket, handleTop, handleTransactions } = createEconomyHandlers({
    client,
    ensureRegistered,
    sendMessage,
    deliverLongGroupResult,
    escapeHtml,
    currencyLabel,
    transactionLine,
    parseRedPacketArgs,
    redPacketMarkup,
    mentionUser
});
const handlePikpak = createPikpakHandler({
    ensureRegistered,
    pikpakConfig,
    webdavRequest,
    pikpakList,
    pikpakSearch,
    sendMessage,
    editMessage,
    sendDocument,
    deliverLongGroupResult,
    escapeHtml,
    bytes,
    safeFileName,
    isGroup
});
if (!TELEGRAM_TOKEN) {
    console.error("缺少 TELEGRAM_BOT_TOKEN");
    process.exit(1);
}
let botUser = null;
const searchCache = createSearchCache({ maxSize: Number(process.env.TELEGRAM_SEARCH_CACHE_MAX || 200) });
const reviewDrafts = createReviewDraftStore({ ttlMs: 10 * 60 * 1000, maxSize: 1000 });
const broadcastDrafts = createBroadcastDraftStore({ ttlMs: 10 * 60 * 1000, maxSize: 200, maxLength: 3000 });
let commandRegistry = null;
const commandSettingsState = { at: 0, payload: null };
const searchPlatformState = { at: 0, loading: null };
const { handleLoginPo18, handleMyBookshelf, handlePo18Code, handlePo18Logout, handlePo18Set, handlePo18Status } = createPo18AccountHandlers(
    {
        client,
        ensureRegistered,
        sendMessage,
        sendPhoto,
        editMessage,
        deliverLongGroupResult,
        escapeHtml,
        callback,
        po18Fetch,
        parseLoginFields,
        hasPo18Auth,
        fetchPo18Bookshelf,
        validatePo18Session,
        isGroup
    }
);
const { persistentJobTypes, recoverSystemJob, scheduleExport, scheduleMyBookshelf, scheduleShare, scheduleShareBookshelf } =
    createTaskSchedulers({
        botTaskQueue,
        sendMessage,
        isGroup,
        sendExport,
        handleMyBookshelf,
        handleShare,
        handleShareBookshelf,
        sendRegisteredUserBroadcast: (...args) => broadcastHandlers.sendRegisteredUserBroadcast(...args)
    });
const epubHandlerDeps = {
    requestEpubStyle,
    scheduleExport,
    sendMessage,
    withBotAudit,
    withCooldown,
    exportCooldownMs: BOT_EXPORT_COOLDOWN_MS
};
const handleEpubCustom = createEpubCustomHandler({ ...epubHandlerDeps, parseEpubCustomState, requestEpubCustomization });
const handleEpubStudio = createEpubStudioHandler({ ...epubHandlerDeps, parseEpubStudioState, requestEpubStudio });
const { handleTasks, handleTask, handleCancelJob } = createTaskStatusHandlers({
    client,
    ensureRegistered,
    sendMessage,
    escapeHtml
});
function getCommandRegistry() {
    if (commandRegistry) return commandRegistry;
    const registry = createCommandRegistry();
    const withSearchCooldown = (message, label, handler) => withCooldown(message, "search", BOT_SEARCH_COOLDOWN_MS, label, handler);
    const withInfoCooldown = (message, label, handler) => withCooldown(message, "info", BOT_INFO_COOLDOWN_MS, label, handler);
    const withExportCooldown = (message, label, handler) => withCooldown(message, "export", BOT_EXPORT_COOLDOWN_MS, label, handler);
    const withBookshelfCooldown = (message, label, handler) =>
        withCooldown(message, "mybookshelf", BOT_BOOKSHELF_COOLDOWN_MS, label, handler);
    const withPikpakCooldown = (message, label, handler) => withCooldown(message, "pikpak", BOT_PIKPAK_COOLDOWN_MS, label, handler);
    registerAccountCommands(registry, {
        handleStart,
        handleMenu,
        handleHelp,
        handleRegister,
        handleMe,
        handleSign,
        handleRedeem,
        handleGive,
        handleBroadcast,
        handleTop,
        handleTransactions,
        handleTasks,
        handleTask,
        handleCancelJob
    });
    registerSearchCommands(registry, {
        withSearchCooldown,
        withInfoCooldown,
        handleSearch,
        handleHot,
        handleWordCloud,
        handleRandom,
        handleInfo
    });
    registerSocialCommands(registry, {
        handleMyFav,
        handleRedPacket,
        handleClaimRedPacket,
        handleCrowd,
        handleReview,
        handleReviews,
        handleReportReview,
        handleAppealReview
    });
    registerIntegrationCommands(registry, {
        withPikpakCooldown,
        withBookshelfCooldown,
        handlePikpak,
        handlePo18Set,
        handleLoginPo18,
        handlePo18Code,
        handlePo18Status,
        handlePo18Logout,
        scheduleMyBookshelf
    });
    registerExportCommands(registry, { withExportCooldown, scheduleExport, requestEpubStyle });
    commandRegistry = registry;
    return registry;
}
async function refreshCommandSettings(force = false) {
    const ttl = Number(process.env.PO18_BOT_COMMAND_SETTINGS_TTL_MS || 15000);
    if (!force && commandSettingsState.payload && Date.now() - commandSettingsState.at < ttl) return commandSettingsState.payload;
    try {
        const payload = await client.commandSettings();
        commandSettingsState.payload = payload;
        commandSettingsState.at = Date.now();
        getCommandRegistry().setSettings(payload);
        return payload;
    } catch (err) {
        console.warn(`[bot-commands] settings refresh failed: ${err.message || String(err)}`);
        return commandSettingsState.payload || { commands: [] };
    }
}
async function refreshSearchPlatforms(force = false) {
    if (!force && searchPlatformState.at && Date.now() - searchPlatformState.at < SEARCH_PLATFORM_CONFIG_TTL_MS)
        return searchPlatformRegistry.snapshot();
    if (searchPlatformState.loading) return searchPlatformState.loading;
    searchPlatformState.loading = client
        .searchPlatforms()
        .then((payload) => searchPlatformRegistry.update(payload))
        .catch((err) => {
            console.warn(`[bot-platforms] refresh failed: ${err.message || String(err)}`);
            return searchPlatformRegistry.snapshot();
        })
        .finally(() => {
            searchPlatformState.at = Date.now();
            searchPlatformState.loading = null;
        });
    return searchPlatformState.loading;
}
function helpLinesFromCommands() {
    return buildHelpLinesFromCommands(getCommandRegistry(), escapeHtml);
}

function rememberSearch(query) {
    return searchCache.remember(query);
}
const { handleHot, handleInfo, handleRandom, handleSearch, handleSearchRequestSubmit, handleWordCloud, sendBookCards } =
    createSearchHandlers({
        client,
        searchLimit: SEARCH_LIMIT,
        defaultRecommendPlatform: DEFAULT_RECOMMEND_PLATFORM,
        parseSearchQuery,
        parsePlatformSuffix,
        platformLabel,
        rememberSearch,
        ensureRegistered,
        userDisplayName,
        escapeHtml,
        sendMessage,
        editMessage,
        sendDocument,
        sendPhoto,
        deliverLongGroupResult,
        bookListItem,
        listActions,
        searchPager,
        searchRequestActions,
        mergeKeyboards,
        detailCardText,
        bookActions,
        refreshSearchPlatforms
    });
const {
    handleCrowd,
    handleCrowdVote,
    handleFeedback,
    handleMyFav,
    handleReview,
    handleReviewCancel,
    handleReviewDraft,
    handleReviewStart,
    handleReviews,
    handleReviewVote,
    handleReportReview,
    handleAppealReview,
    reviewDraftContext
} = createSocialHandlers({
    client,
    crowdVoteCost: CROWD_VOTE_COST,
    ensureRegistered,
    handleInfo,
    parseBookId,
    sendBookCards,
    sendMessage,
    editMessage,
    deleteMessage: (chatId, messageId) => telegram("deleteMessage", { chat_id: chatId, message_id: messageId }),
    deliverLongGroupResult,
    escapeHtml,
    bookActions,
    crowdCardText,
    crowdActions,
    bookReviewsText,
    bookReviewsActions,
    reviewChannelText,
    reviewDrafts,
    reviewPromptActions,
    reviewVoteActions
});
const broadcastHandlers = createBroadcastHandlers({
    client,
    ensureRegistered,
    sendMessage,
    editMessage,
    escapeHtml,
    drafts: broadcastDrafts,
    delay
});
const { broadcastDraftContext, handleBroadcast, handleBroadcastCancel, handleBroadcastConfirm, handleBroadcastDraft } = broadcastHandlers;
const { handleMenuAction } = createMenuHandlers({
    sendMessage,
    mainMenuMarkup,
    po18MenuText,
    po18MenuMarkup,
    handleMenu,
    handleHelp,
    handleHot,
    handleRandom,
    handleWordCloud,
    handleMe,
    handleSign,
    handleTasks,
    handleTop,
    handlePo18Status,
    handleLoginPo18,
    scheduleMyBookshelf,
    withSearchCooldown: (message, label, handler) => withCooldown(message, "search", BOT_SEARCH_COOLDOWN_MS, label, handler),
    withBookshelfCooldown: (message, label, handler) => withCooldown(message, "mybookshelf", BOT_BOOKSHELF_COOLDOWN_MS, label, handler)
});
async function handleMessage(message) {
    const text = message.text || message.caption || "";
    if (!text) return;
    const broadcastDraft = broadcastDraftContext(message, text);
    if (broadcastDraft) {
        const action = /^(?:取消|\/cancel(?:@\w+)?)$/i.test(text.trim()) ? "broadcast_draft_cancel" : "broadcast_preview";
        return withBotAudit(message, "/broadcast", action, {}, () => handleBroadcastDraft(message, text));
    }
    const reviewDraft = reviewDraftContext(message, text);
    if (reviewDraft) {
        const action = /^(?:取消|\/cancel(?:@\w+)?)$/i.test(text.trim()) ? "book_review_draft_cancel" : "book_review_publish_guided";
        return withBotAudit(message, "/review", action, { book_id: reviewDraft.bookId }, () => handleReviewDraft(message, text));
    }
    if (isGroup(message.chat) && !text.startsWith("/") && !mentionsMe(text)) return;
    const cmd = commandOf(text);
    const args = argsOf(text);
    const platformCommand = cmd.match(/^\/(search|hot|random)-([a-z][a-z0-9_-]*)$/i);
    if (platformCommand) {
        await refreshSearchPlatforms();
        const platform = searchPlatformRegistry.resolveSuffix(platformCommand[2]);
        if (platform) {
            const platformArgs = [args, `-${platformCommand[2].toLowerCase()}`].filter(Boolean).join(" ");
            const action = platformCommand[1].toLowerCase();
            const details = { platform, shortcut: cmd };
            if (action === "search")
                return withBotAudit(message, cmd, "search", details, () =>
                    withCooldown(message, "search", BOT_SEARCH_COOLDOWN_MS, "搜索", () => handleSearch(message, platformArgs))
                );
            if (action === "hot")
                return withBotAudit(message, cmd, "hot", details, () =>
                    withCooldown(message, "search", BOT_SEARCH_COOLDOWN_MS, "热门", () => handleHot(message, platformArgs))
                );
            if (action === "random")
                return withBotAudit(message, cmd, "random", details, () =>
                    withCooldown(message, "search", BOT_SEARCH_COOLDOWN_MS, "随机推荐", () => handleRandom(message, platformArgs))
                );
        }
    }
    if (cmd.startsWith("/info_")) {
        return withBotAudit(message, "/info", "info", { shortcut: cmd }, () =>
            withCooldown(message, "info", BOT_INFO_COOLDOWN_MS, "详情", () => handleInfo(message, cmd.slice("/info_".length)))
        );
    }
    const registry = getCommandRegistry();
    const command = registry.resolve(cmd);
    if (command) {
        await refreshCommandSettings();
        if (!registry.isEnabled(command.primaryCommand || command.command)) {
            return withBotAudit(message, command.primaryCommand || command.command, "command_disabled", { alias: cmd }, () =>
                sendMessage(message.chat.id, registry.disabledMessage(command.primaryCommand || command.command))
            );
        }
        return withBotAudit(
            message,
            command.primaryCommand || command.command,
            command.action,
            { alias: cmd === command.command ? "" : cmd },
            () => command.handler({ message, args, text, cmd, command })
        );
    }
    if (!text.startsWith("/") && !isGroup(message.chat)) {
        return withBotAudit(message, "/search", "search_implicit", {}, () =>
            withCooldown(message, "search", BOT_SEARCH_COOLDOWN_MS, "搜索", () => handleSearch(message, text))
        );
    }
}

async function handleCallback(query) {
    const message = query.message;
    if (!message) return answerCallback(query.id);
    const callbackMessage = { chat: message.chat, from: query.from };
    const [action, a, ...rest] = String(query.data || "").split("|");
    if (!["like", "dislike", "cvote", "sreq", "rvup", "rvdn", "reviewcancel", "broadcastsend", "broadcastcancel"].includes(action))
        await answerCallback(query.id);
    if (action === "noop") return;
    if (action === "menu") {
        const menuAction = String(a || "home");
        return withBotAudit(callbackMessage, "/menu", `menu_${menuAction}`, {}, () => handleMenuAction(callbackMessage, menuAction));
    }
    if (action === "broadcastsend") {
        try {
            const tip = await withBotAudit(callbackMessage, "/broadcast", "broadcast_publish", {}, () =>
                handleBroadcastConfirm(callbackMessage, a, { chatId: message.chat.id, messageId: message.message_id })
            );
            return answerCallback(query.id, tip || "已入队");
        } catch (err) {
            return answerCallback(query.id, err.message || "发布失败");
        }
    }
    if (action === "broadcastcancel") {
        const tip = await handleBroadcastCancel(callbackMessage, a, { chatId: message.chat.id, messageId: message.message_id });
        return answerCallback(query.id, tip);
    }
    if (action === "info")
        return withBotAudit(callbackMessage, "/info", "info_callback", { book_id: a }, () =>
            withCooldown(callbackMessage, "info", BOT_INFO_COOLDOWN_MS, "详情", () =>
                handleInfo(callbackMessage, a, { chatId: message.chat.id, messageId: message.message_id })
            )
        );
    if (action === "fav") {
        return withBotAudit(callbackMessage, "/myfav", "favorite_add", { book_id: a }, async () => {
            await ensureRegistered(query.from);
            await client.addBookshelf(query.from.id, a);
            return sendMessage(message.chat.id, `已收藏：<code>${escapeHtml(a)}</code>`);
        });
    }
    if (action === "txt")
        return withBotAudit(callbackMessage, "/exporttxt", "export_txt_callback", { book_id: a }, () =>
            withCooldown(callbackMessage, "export", BOT_EXPORT_COOLDOWN_MS, "导出", () =>
                scheduleExport(message.chat, query.from, a, "txt")
            )
        );
    if (action === "epub")
        return withBotAudit(callbackMessage, "/exportepub", "export_epub_style_prompt", { book_id: a }, () =>
            requestEpubStyle(message.chat, query.from, a)
        );
    if (action === "epubstyle") {
        const styleId = normalizeEpubStyleChoice(a);
        const bookId = String(rest[0] || "").trim();
        if (!styleId || !bookId) return sendMessage(message.chat.id, "EPUB 样式或书号无效，请重新选择。");
        return withBotAudit(callbackMessage, "/exportepub", "export_epub_callback", { book_id: bookId, style_id: styleId }, () =>
            withCooldown(callbackMessage, "export", BOT_EXPORT_COOLDOWN_MS, "导出", () =>
                scheduleExport(message.chat, query.from, bookId, "epub", { epubStyleId: styleId })
            )
        );
    }
    if (action === "epubcustom") {
        return handleEpubCustom({ operation: a, state: rest, message, from: query.from, callbackMessage });
    }
    if (action === "epubstudio") {
        return handleEpubStudio({ operation: a, state: rest, message, from: query.from, callbackMessage });
    }
    if (action === "unlock") {
        return withBotAudit(callbackMessage, "/exporttxt", "export_unlock", { book_id: a }, async () => {
            await ensureRegistered(query.from);
            const result = await client.unlockExport(query.from.id);
            return sendMessage(
                message.chat.id,
                [
                    result.cost ? `导出授权已开通，消耗银币 ${result.cost}。` : "导出授权已开通。",
                    `当前银币：${result.user.silver_coins}`,
                    a ? `现在可以导出：<code>${escapeHtml(a)}</code>` : ""
                ]
                    .filter(Boolean)
                    .join("\n"),
                { reply_markup: a ? bookActions(a) : undefined }
            );
        });
    }
    if (action === "share")
        return withBotAudit(callbackMessage, "/share", "share_callback", { book_id: a }, () => scheduleShare(callbackMessage, a));
    if (action === "sharebs")
        return withBotAudit(callbackMessage, "/mybookshelf", "share_bookshelf_callback", {}, () => scheduleShareBookshelf(callbackMessage));
    if (action === "like" || action === "dislike") {
        const tip = await withBotAudit(callbackMessage, "/info", `feedback_${action}`, { book_id: a }, () =>
            handleFeedback({ chat: message.chat, from: query.from }, a, action === "like" ? "like" : "dislike", "info", {
                chatId: message.chat.id,
                messageId: message.message_id
            })
        );
        return answerCallback(query.id, tip || "已更新");
    }
    if (action === "qhb")
        return withBotAudit(callbackMessage, "/qhb", "red_packet_claim_callback", { packet_id: a }, () =>
            handleClaimRedPacket({ chat: message.chat, from: query.from }, a)
        );
    if (action === "crowd")
        return withBotAudit(callbackMessage, "/crowd", "crowd_callback", { book_id: a }, () =>
            handleCrowd({ chat: message.chat, from: query.from }, a, { chatId: message.chat.id, messageId: message.message_id })
        );
    if (action === "reviews")
        return withBotAudit(callbackMessage, "/reviews", "book_reviews_callback", { book_id: a }, () =>
            handleReviews({ chat: message.chat, from: query.from }, a, { chatId: message.chat.id, messageId: message.message_id })
        );
    if (action === "reviewnew")
        return withBotAudit(callbackMessage, "/review", "book_review_prompt", { book_id: a }, () =>
            handleReviewStart({ chat: message.chat, from: query.from }, a)
        );
    if (action === "reviewcancel") {
        const tip = await withBotAudit(callbackMessage, "/review", "book_review_draft_cancel", { book_id: a }, () =>
            handleReviewCancel({ chat: message.chat, from: query.from }, a, { chatId: message.chat.id, messageId: message.message_id })
        );
        return answerCallback(query.id, tip);
    }
    if (action === "cvote") {
        try {
            const tip = await withBotAudit(callbackMessage, "/crowd", "crowd_vote", { book_id: a }, () =>
                handleCrowdVote({ chat: message.chat, from: query.from }, a, { chatId: message.chat.id, messageId: message.message_id })
            );
            return answerCallback(query.id, tip || "已更新");
        } catch (err) {
            return answerCallback(query.id, err.message || "投票失败");
        }
    }
    if (action === "rvup" || action === "rvdn") {
        try {
            const vote = action === "rvup" ? "like" : "dislike";
            const tip = await withBotAudit(callbackMessage, "/review", `book_review_${vote}`, { review_id: a }, () =>
                handleReviewVote({ chat: message.chat, from: query.from }, a, vote, {
                    chatId: message.chat.id,
                    messageId: message.message_id
                })
            );
            return answerCallback(query.id, tip || "已更新");
        } catch (err) {
            return answerCallback(query.id, err.message || "投票失败");
        }
    }
    if (action === "search") {
        const rawQuery = searchCache.get(rest.join("|")) || rest.join("|");
        return withBotAudit(callbackMessage, "/search", "search_page", { page: Number(a || 1) }, () =>
            withCooldown(callbackMessage, "search", BOT_SEARCH_COOLDOWN_MS, "搜索", () =>
                handleSearch(callbackMessage, rawQuery, Number(a || 1), { chatId: message.chat.id, messageId: message.message_id })
            )
        );
    }
    if (action === "sreq") {
        try {
            const rawQuery = searchCache.get(a) || rest.join("|");
            const tip = await withBotAudit(callbackMessage, "/search", "search_request_submit", { cache_key: a }, () =>
                handleSearchRequestSubmit(callbackMessage, rawQuery)
            );
            return answerCallback(query.id, tip || "已提交");
        } catch (err) {
            return answerCallback(query.id, err.message || "提交失败");
        }
    }
}

async function handleUpdate(update) {
    if (update.message) {
        if (await maybeUnpinAutomaticPush(update.message)) return;
        return handleMessage(update.message);
    }
    if (update.callback_query) return handleCallback(update.callback_query);
}

startBotProcessRuntime({
    botTaskQueue,
    client,
    delay,
    escapeHtml,
    getCommandRegistry,
    handleUpdate,
    healthHost: BOT_HEALTH_HOST,
    healthPort: BOT_HEALTH_PORT,
    healthStaleMs: BOT_HEALTH_STALE_MS,
    onConnectedUser(user) {
        botUser = user;
        refreshSearchPlatforms(true).catch(() => {});
    },
    persistentJobTypes,
    pollTimeout: POLL_TIMEOUT,
    rateLimiter,
    recoverPersistentJobs,
    recoverSystemJob,
    refreshCommandSettings,
    sendMessage,
    startedAt: STARTED_AT,
    telegram,
    telegramApiBase: TELEGRAM_API_BASE,
    telegramClient
});
