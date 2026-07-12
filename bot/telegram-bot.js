/**
 * [INPUT]: 依赖 bot 内客户端、命令/领域处理器、自动推送取消置顶策略、任务运行时、Telegram polling/health 与环境配置
 * [OUTPUT]: 提供 Telegram Bot 进程组合入口，启动命令同步、系统推送取消置顶、任务恢复、长轮询和健康服务
 * [POS]: bot 的唯一组合根，负责依赖注入和进程生命周期；可拆领域逻辑不得继续沉积于此
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require("fs/promises");
const { createWriteStream } = require("fs");
const { pipeline } = require("stream/promises");
const os = require("os");
const path = require("path");
const { PgBotClient } = require("./pg-bot-client");
const { createRateLimiter, formatWait, positiveMs } = require("./rate-limit");
const { createTelegramClient, truncate } = require("./telegram");
const { createCommandRegistry } = require("./command-registry");
const { registerAccountCommands } = require("./commands/account");
const { registerExportCommands } = require("./commands/export");
const { registerIntegrationCommands } = require("./commands/integrations");
const { registerSearchCommands } = require("./commands/search");
const { registerSocialCommands } = require("./commands/social");
const { asExportError, classifyExportError, formatExportFailure } = require("./export-errors");
const { DEFAULT_RECOMMEND_PLATFORM, SEARCH_PLATFORM_SUFFIXES, parsePlatformSuffix, platformLabel } = require("./search-platforms");
const { createSearchQueryParser } = require("./search-query");
const { createEpubBuilder } = require("./epub-builder");
const { createPo18Client } = require("./po18-client");
const { createRemoteStorage } = require("./remote-storage");
const { createBotUi } = require("./ui-formatters");
const { createBotTaskRuntime } = require("./task-runtime");
const { startBotHealthServer } = require("./health-server");
const { createMessageRuntime } = require("./message-runtime");
const { createExportBuilder } = require("./export-builder");
const { EPUB_EXPORT_STYLE_CHOICES, epubStyleSelectionMarkup, normalizeEpubStyleChoice } = require("./epub-style-picker");
const { createTaskSchedulers } = require("./task-schedulers");
const { createReviewDraftStore, createSearchCache, helpLinesFromCommands: buildHelpLinesFromCommands } = require("./bot-session");
const { createTelegramPollingRuntime } = require("./polling-runtime");
const { createAutomaticPushUnpinHandler } = require("./automatic-push-unpin");
const { createPo18AccountHandlers } = require("./po18-account-handlers");
const { createShareHandlers } = require("./share-handlers");
const { createTaskStatusHandlers } = require("./task-status-handlers");
const { createSearchHandlers } = require("./search-handlers");
const { createSocialHandlers } = require("./social-handlers");
const {
    meText,
    registerText,
    signSuccessText,
    startHelpText
} = require("./account-formatters");
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
const BOT_BACKGROUND_CONCURRENCY = Number.isFinite(BOT_BACKGROUND_CONCURRENCY_VALUE)
    ? Math.max(1, BOT_BACKGROUND_CONCURRENCY_VALUE)
    : 2;
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
const STARTED_AT = Date.now();
const CROWD_VOTE_COST = 100;
const PO18_BOOKSHELF_SHARE_REWARD_COPPER = Math.max(0, Number(process.env.PO18_BOOKSHELF_SHARE_REWARD_COPPER || 1000));
const PO18_BOOKSHELF_SHARE_REWARD_MIN_CHAPTERS = Math.max(0, Number(process.env.PO18_BOOKSHELF_SHARE_REWARD_MIN_CHAPTERS || 20));
const client = new PgBotClient();
const telegramClient = createTelegramClient({
    token: TELEGRAM_TOKEN,
    apiBase: TELEGRAM_API_BASE,
    requestTimeoutMs: TELEGRAM_REQUEST_TIMEOUT
});
const { telegram, sendMessage, editMessage, sendDocument, sendPhoto, answerCallback } = telegramClient;
const maybeUnpinAutomaticPush = createAutomaticPushUnpinHandler({ telegram, logger: console });
const rateLimiter = createRateLimiter({ maxKeys: Number(process.env.TELEGRAM_RATE_LIMIT_MAX_KEYS || 5000) });
const { parseSearchQuery, parseBookId } = createSearchQueryParser({ searchLimit: SEARCH_LIMIT });
const {
    commandOf,
    argsOf,
    isGroup,
    withCooldown,
    mentionsMe,
    recordBotAudit,
    withBotAudit,
    deliverLongGroupResult
} = createMessageRuntime({
    client,
    rateLimiter,
    formatWait,
    sendMessage,
    editMessage,
    escapeHtml,
    classifyExportError,
    botUserProvider: () => botUser,
    longTextThreshold: BOT_GROUP_LONG_TEXT_THRESHOLD
});
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
} = createBotUi({ escapeHtml, cleanText, truncate, isVolumeChapter, crowdVoteCost: CROWD_VOTE_COST });
const { po18Fetch, parseLoginFields, hasPo18Auth, fetchPo18Bookshelf, fetchPo18PurchasedChapters } = createPo18Client({ cleanText });
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
const { pikpakConfig, webdavRequest, pikpakList, pikpakSearch } = createRemoteStorage();
if (!TELEGRAM_TOKEN) {
    console.error("缺少 TELEGRAM_BOT_TOKEN");
    process.exit(1);
}

let botUser = null;
const searchCache = createSearchCache({ maxSize: Number(process.env.TELEGRAM_SEARCH_CACHE_MAX || 200) });
const reviewDrafts = createReviewDraftStore({ ttlMs: 10 * 60 * 1000, maxSize: 1000 });
const privateExportStarts = new Map();
let commandRegistry = null;
let persistentJobsRecovered = false;
const commandSettingsState = { at: 0, payload: null };

const {
    handleLoginPo18,
    handleMyBookshelf,
    handlePo18Code,
    handlePo18Logout,
    handlePo18Set,
    handlePo18Status
} = createPo18AccountHandlers({
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
    fetchPo18Bookshelf
});

const {
    persistentJobTypes,
    recoverSystemJob,
    scheduleExport,
    scheduleMyBookshelf,
    scheduleShare,
    scheduleShareBookshelf
} = createTaskSchedulers({
    botTaskQueue,
    sendMessage,
    isGroup,
    sendExport,
    handleMyBookshelf,
    handleShare,
    handleShareBookshelf
});

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
    const withBookshelfCooldown = (message, label, handler) => withCooldown(message, "mybookshelf", BOT_BOOKSHELF_COOLDOWN_MS, label, handler);
    const withPikpakCooldown = (message, label, handler) => withCooldown(message, "pikpak", BOT_PIKPAK_COOLDOWN_MS, label, handler);

    registerAccountCommands(registry, {
        handleStart,
        handleRegister,
        handleMe,
        handleSign,
        handleRedeem,
        handleGive,
        handleTop,
        handleTransactions,
        handleTasks,
        handleTask,
        handleCancelJob
    });
    registerSearchCommands(registry, { withSearchCooldown, withInfoCooldown, handleSearch, handleHot, handleWordCloud, handleRandom, handleInfo });
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

function helpLinesFromCommands() {
    return buildHelpLinesFromCommands(getCommandRegistry(), escapeHtml);
}

function rememberSearch(query) {
    return searchCache.remember(query);
}

function botPrivateUrl(payload = "") {
    const username = String(botUser?.username || "").trim();
    if (!username) return "";
    const suffix = payload ? `?start=${encodeURIComponent(payload)}` : "";
    return `https://t.me/${username}${suffix}`;
}

function cleanupPrivateExportStarts() {
    const now = Date.now();
    for (const [key, pending] of privateExportStarts.entries()) {
        if (!pending?.createdAt || now - pending.createdAt > PRIVATE_EXPORT_START_TTL_MS) privateExportStarts.delete(key);
    }
}

function rememberPrivateExportStart(from = {}, chat = {}, bookId = "", format = "txt", exportOptions = {}) {
    cleanupPrivateExportStarts();
    const key = `ex_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    privateExportStarts.set(key, {
        userId: String(from.id || ""),
        chatId: String(typeof chat === "object" ? chat.id : chat || ""),
        bookId: String(bookId || "").trim(),
        format: String(format || "txt").trim(),
        epubStyleId: normalizeEpubStyleChoice(exportOptions.epubStyleId),
        createdAt: Date.now()
    });
    return key;
}

function takePrivateExportStart(payload = "", userId = "") {
    cleanupPrivateExportStarts();
    const key = String(payload || "").trim();
    if (!key.startsWith("ex_")) return null;
    const pending = privateExportStarts.get(key);
    if (!pending || String(pending.userId) !== String(userId || "")) return null;
    privateExportStarts.delete(key);
    return pending;
}

function privateExportStartMarkup(payload = "") {
    const url = botPrivateUrl(payload);
    return url ? { inline_keyboard: [[{ text: "打开私聊继续导出", url }]] } : undefined;
}

async function canSendPrivateMessage(userId) {
    try {
        await telegram("sendChatAction", { chat_id: userId, action: "upload_document" });
        return true;
    } catch (err) {
        if (/forbidden|bot can't initiate conversation|chat not found|blocked/i.test(String(err.message || ""))) return false;
        throw err;
    }
}

async function requestEpubStyle(chat, _from, bookId) {
    const chatId = typeof chat === "object" ? chat.id : chat;
    const id = String(bookId || "").trim();
    if (!id) return sendMessage(chatId, "用法：/exportepub 书号");
    return sendMessage(chatId, [
        "请选择 EPUB 生成样式：",
        `<code>${escapeHtml(id)}</code>`,
        "选择后才会开始生成和计算导出费用。"
    ].join("\n"), { reply_markup: epubStyleSelectionMarkup(id, callback) });
}



async function ensureRegistered(user) {
    const found = await client.getUser(user.id);
    if (found) return found;
    const created = await client.registerUser(user);
    return created.user;
}

async function handleStart(message, payload) {
    await refreshCommandSettings();
    const user = await ensureRegistered(message.from);
    const pendingExport = takePrivateExportStart(payload, message.from.id);
    if (pendingExport) {
        await sendMessage(message.chat.id, [
            "私聊已授权，开始继续刚才的导出。",
            `书号：<code>${escapeHtml(pendingExport.bookId)}</code>`,
            `格式：${escapeHtml(pendingExport.format.toUpperCase())}`,
            pendingExport.epubStyleId ? `样式：${escapeHtml(EPUB_EXPORT_STYLE_CHOICES.find((item) => item.id === pendingExport.epubStyleId)?.label || pendingExport.epubStyleId)}` : ""
        ].filter(Boolean).join("\n")).catch(() => {});
        return scheduleExport(message.chat, message.from, pendingExport.bookId, pendingExport.format, {
            epubStyleId: pendingExport.epubStyleId
        });
    }
    await deliverLongGroupResult(message, startHelpText({
        user,
        payload,
        helpLines: helpLinesFromCommands(),
        escapeHtml,
        scholarText
    }), {}, { title: "Bot 帮助" });
}

async function handleRegister(message, payload) {
    const result = await client.registerUser(message.from, payload);
    await sendMessage(message.chat.id, registerText(result, { escapeHtml, scholarText }));
}

async function handleMe(message) {
    await ensureRegistered(message.from);
    const data = await client.me(message.from.id);
    await deliverLongGroupResult(message, meText({
        user: data.user || {},
        stats: data.stats || {},
        telegramId: message.from.id,
        escapeHtml,
        scholarText,
        freeExportText
    }), {}, { title: "我的账户" });
}

async function handleSign(message) {
    await ensureRegistered(message.from);
    try {
        const result = await client.sign(message.from.id);
        await sendMessage(message.chat.id, signSuccessText(result, { escapeHtml, scholarText }));
    } catch (err) {
        if (err.status === 409) return sendMessage(message.chat.id, "今天已经签到过了。");
        throw err;
    }
}

const {
    handleHot,
    handleInfo,
    handleRandom,
    handleSearch,
    handleSearchRequestSubmit,
    handleWordCloud,
    sendBookCards
} = createSearchHandlers({
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
    bookActions
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

async function handleRedeem(message, args) {
    await ensureRegistered(message.from);
    const code = String(args || "").trim().split(/\s+/)[0] || "";
    if (!code) return sendMessage(message.chat.id, "用法：/redeem CDK-XXXX-XXXX");
    try {
        const result = await client.redeemCdk(message.from.id, code);
        await sendMessage(message.chat.id, [
            "兑换成功。",
            `增加下载次数：${result.cdk?.export_quota || 0}`,
            `当前额外下载次数：${result.user?.export_extra_quota || 0}`
        ].join("\n"));
    } catch (err) {
        if (err.status) return sendMessage(message.chat.id, `兑换失败：${escapeHtml(err.message || "CDK 无效")}`);
        throw err;
    }
}

async function handleGive(message, args) {
    const sender = await ensureRegistered(message.from);
    if (!sender.is_admin) return sendMessage(message.chat.id, "只有管理员可以发币。");
    const parts = args.split(/\s+/).filter(Boolean);
    const target = parts.find((part) => /^-?\d+$/.test(part));
    const amount = Number(parts.find((part) => /^-?\d+$/.test(part) && part !== target) || parts[parts.length - 1]);
    const currency = parts.some((part) => /银|silver/i.test(part)) ? "silver" : "copper";
    if (!target || !amount) return sendMessage(message.chat.id, "用法：/give 123456789 铜币 100");
    const result = await client.addCurrency(target, currency, amount);
    await sendMessage(message.chat.id, `已发放 ${currency === "silver" ? "银币" : "铜币"} ${amount}，目标余额：${currency === "silver" ? result.user.silver_coins : result.user.copper_coins}`);
}

async function handleTop(message, args) {
    const currency = /经验|等級|等级|书卷|level|exp/i.test(args || "") ? "exp" : /银|silver/i.test(args || "") ? "silver" : "copper";
    const data = await client.top(currency, 10);
    const rows = data.rows || [];
    if (!rows.length) return sendMessage(message.chat.id, "还没有排行榜数据。");
    await deliverLongGroupResult(message, [
        `<b>${currencyLabel(currency)}排行榜 TOP 10</b>`,
        "",
        ...rows.map((user, index) => {
            const name = user.nickname || user.telegram_username || user.username || user.telegram_id || "-";
            const value = currency === "silver" ? user.silver_coins : currency === "exp" ? user.scholar_exp : user.copper_coins;
            return `${index + 1}. ${escapeHtml(name)} · ${currencyLabel(currency)} ${value}`;
        })
    ].join("\n"), {}, { title: "排行榜" });
}

async function handleTransactions(message) {
    await ensureRegistered(message.from);
    const data = await client.transactions(message.from.id, 10);
    const rows = data.rows || [];
    if (!rows.length) return sendMessage(message.chat.id, "你还没有流水记录。");
    await deliverLongGroupResult(message, [
        "<b>最近币流水</b>",
        "",
        ...rows.map(transactionLine)
    ].join("\n"), {}, { title: "最近币流水" });
}

async function handleRedPacket(message, args) {
    const user = await ensureRegistered(message.from);
    const parsed = parseRedPacketArgs(args);
    if (!parsed.totalAmount || parsed.totalAmount < 1 || parsed.totalCount < 1) {
        return sendMessage(message.chat.id, "用法：\n/hb 100 5 发铜币红包\n/hb silver 100 3 发银币红包\n/hb @username 100 指定发");
    }
    if (parsed.totalCount > 100) return sendMessage(message.chat.id, "最多分 100 份。");
    if (parsed.totalAmount < parsed.totalCount) return sendMessage(message.chat.id, "红包金额不能小于份数。");
    const balance = parsed.currency === "silver" ? user.silver_coins : user.copper_coins;
    if (balance < parsed.totalAmount) return sendMessage(message.chat.id, `${currencyLabel(parsed.currency)}不足，需要 ${parsed.totalAmount}。`);
    let targetUser = null;
    if (parsed.target) {
        targetUser = await client.getUserByTelegramUsername(parsed.target).catch(() => null);
        if (!targetUser) return sendMessage(message.chat.id, `没找到 ${escapeHtml(parsed.target)}，目标需要先 /reg 注册。`);
    }
    const result = await client.createRedPacket({
        sender_telegram_id: message.from.id,
        target_telegram_id: targetUser?.telegram_id || "",
        chat_id: message.chat.id,
        currency: parsed.currency,
        total_amount: parsed.totalAmount,
        total_count: parsed.totalCount,
        note: parsed.note
    });
    const senderName = user.nickname || user.telegram_username || user.username || message.from.username || message.from.id;
    if (targetUser) {
        return sendMessage(message.chat.id, `🎁 ${escapeHtml(senderName)} 给 @${escapeHtml(targetUser.telegram_username || targetUser.username || targetUser.telegram_id)} 发了 ${parsed.totalAmount} ${currencyLabel(parsed.currency)}`);
    }
    return sendMessage(message.chat.id, [
        `🎁 ${escapeHtml(senderName)} 发了一个${currencyLabel(parsed.currency)}红包`,
        `💰 ${parsed.totalAmount} ${currencyLabel(parsed.currency)} / ${parsed.totalCount} 份`,
        `💬 ${escapeHtml(parsed.note || "恭喜发财")}`
    ].join("\n"), { reply_markup: redPacketMarkup(result.packet.id) });
}

async function handleClaimRedPacket(message, packetId = "") {
    await ensureRegistered(message.from);
    try {
        const result = await client.claimRedPacket({
            telegram_id: message.from.id,
            chat_id: message.chat.id,
            packet_id: packetId || ""
        });
        const claimedBy = mentionUser(result.user || {}, message.from || {});
        await sendMessage(message.chat.id, `恭喜 ${claimedBy} 抢到了 ${result.amount} ${currencyLabel(result.currency)}！`);
    } catch (err) {
        await sendMessage(message.chat.id, escapeHtml(err.message || "抢红包失败"));
    }
}

async function handlePikpak(message, args) {
    await ensureRegistered(message.from);
    const config = pikpakConfig();
    if (!config.url || !config.username || !config.password) {
        return sendMessage(message.chat.id, "管理员尚未配置 PikPak WebDAV。需要设置 PIKPAK_WEBDAV_URL / USERNAME / PASSWORD。");
    }
    const parts = String(args || "").split(/\s+/).filter(Boolean);
    const sub = (parts.shift() || "").toLowerCase();
    if (["search", "s", "搜", "查"].includes(sub)) {
        const keyword = parts.join(" ").trim();
        if (!keyword) return sendMessage(message.chat.id, "用法：/pikpak search 关键词");
        const progress = await sendMessage(message.chat.id, `正在搜索「${escapeHtml(keyword)}」...`);
        const files = await pikpakSearch(config, keyword);
        if (!files.length) return editMessage(message.chat.id, progress.message_id, `没找到「${escapeHtml(keyword)}」相关的文件。`).catch(() => {});
        const lines = [`<b>PikPak 搜索：${escapeHtml(keyword)}</b>`, `找到 ${files.length} 个文件`, ""];
        for (const file of files.slice(0, 20)) {
            lines.push(`📄 <b>${escapeHtml(file.name)}</b>`);
            lines.push(`   ${bytes(file.size)} · <code>${escapeHtml(file.path)}</code>`);
            if (/\.(epub|txt|pdf)$/i.test(file.name)) lines.push(`   /pikpak dl ${escapeHtml(file.path)}`);
        }
        if (files.length > 20) lines.push("", `仅显示前 20 个。`);
        return deliverLongGroupResult(message, lines.join("\n"), {}, {
            title: "PikPak 搜索结果",
            editTarget: { chatId: message.chat.id, messageId: progress.message_id }
        }).catch(() => sendMessage(message.chat.id, lines.join("\n")));
    }
    if (["dl", "down", "下载"].includes(sub)) {
        const remotePath = parts.join(" ").trim();
        if (!remotePath) return sendMessage(message.chat.id, "用法：/pikpak dl /epub/xxx.epub");
        const fileName = safeFileName(remotePath.split("/").filter(Boolean).pop() || "pikpak-file", "pikpak-file");
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pikpak-"));
        const filePath = path.join(dir, fileName);
        const progress = await sendMessage(message.chat.id, `正在下载：${escapeHtml(fileName)}`);
        try {
            const response = await webdavRequest(config, "GET", remotePath);
            if (!response.ok) return editMessage(message.chat.id, progress.message_id, `下载失败：HTTP ${response.status}`).catch(() => {});
            await pipeline(response.body, createWriteStream(filePath));
            await editMessage(message.chat.id, progress.message_id, "下载完成，正在发送...").catch(() => {});
            await sendDocument(isGroup(message.chat) ? message.from.id : message.chat.id, filePath, escapeHtml(fileName));
            if (isGroup(message.chat)) await editMessage(message.chat.id, progress.message_id, "已私聊发送 PikPak 文件。").catch(() => {});
            else await editMessage(message.chat.id, progress.message_id, "PikPak 文件已发送。").catch(() => {});
        } finally {
            await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        }
        return;
    }
    const listPath = sub && sub.startsWith("/") ? sub : config.root;
    const files = await pikpakList(config, listPath);
    if (!files.length) return sendMessage(message.chat.id, "PikPak 目录为空或连接失败。");
    const lines = [`<b>PikPak</b> ${escapeHtml(listPath)}`, `共 ${files.length} 项`, ""];
    for (const file of files.slice(0, 20)) {
        if (file.is_dir) lines.push(`📂 <b>${escapeHtml(file.name)}</b>/\n   <code>${escapeHtml(file.path)}</code>`);
        else {
            lines.push(`📄 <b>${escapeHtml(file.name)}</b> · ${bytes(file.size)}`);
            if (/\.(epub|txt|pdf)$/i.test(file.name)) lines.push(`   /pikpak dl ${escapeHtml(file.path)}`);
        }
    }
    if (files.length > 20) lines.push("", `仅显示前 20 个。`);
    return deliverLongGroupResult(message, lines.join("\n"), {}, { title: "PikPak 目录" });
}

async function sendExport(chat, from, bookId, format, _signal, exportOptions = {}) {
    const chatId = typeof chat === "object" ? chat.id : chat;
    const groupExport = typeof chat === "object" && isGroup(chat);
    const id = String(bookId || "").trim();
    if (!id) throw asExportError("EXPORT_MISSING_BOOK_ID", `用法：/export${format} 书号`);
    await ensureRegistered(from);
    const [permission, pricingData, bookData] = await Promise.all([
        client.exportPermission(from.id, id),
        client.exportPricing().catch(() => ({})),
        client.getBook(id)
    ]);
    const pricing = normalizeExportPricing(pricingData.pricing ? pricingData : permission.pricing || {});
    const freeExport = permission.free_export || {};
    const canUseDailyExport = !!freeExport.available;
    const canUseExtraExport = !!freeExport.extra_book_already_used || Number(freeExport.extra_remaining || 0) > 0;
    if (groupExport && !(await canSendPrivateMessage(from.id))) {
        const payload = rememberPrivateExportStart(from, chat, id, format, exportOptions);
        const failure = formatExportFailure(asExportError("EXPORT_PRIVATE_CHAT_REQUIRED", "Forbidden: bot can't initiate conversation with a user"));
        await sendMessage(chatId, [
            failure.message,
            `错误码：${failure.code}`,
            "Telegram 不允许 Bot 主动私聊未 /start 的用户。",
            "点下面按钮打开私聊，发送 /start 后会自动继续这次导出。"
        ].join("\n"), { reply_markup: privateExportStartMarkup(payload) });
        return;
    }
    const epubStyleId = normalizeEpubStyleChoice(exportOptions.epubStyleId);
    const epubStyleLabel = EPUB_EXPORT_STYLE_CHOICES.find((item) => item.id === epubStyleId)?.label || "";
    const progress = await sendMessage(chatId, `正在生成 ${format.toUpperCase()}${epubStyleLabel ? `（${escapeHtml(epubStyleLabel)}）` : ""}：<code>${escapeHtml(id)}</code>`);
    let result = null;
    try {
        const savedEpubConfig = pricingData.pricing?.epub || pricingData.epub || {};
        result = await buildExport(bookData.book, format, from, {
            epub: epubStyleId ? { ...savedEpubConfig, styleId: epubStyleId } : savedEpubConfig
        });
        const quote = exportQuote(result, pricing);
        const paidBook = Number(quote.paidChapters || 0) > 0;
        const user = permission.user || {};
        if (paidBook && !permission.unlocked && !canUseDailyExport && !canUseExtraExport) {
            const exportErr = asExportError("EXPORT_FREE_QUOTA_USED", "paid export quota used");
            exportErr.userNotified = true;
            const failure = formatExportFailure(exportErr);
            await editMessage(chatId, progress.message_id, [
                failure.message,
                `错误码：${failure.code}`,
                freeExportText(freeExport),
                `授权价格：${pricing.unlockCost} 银币`,
                `当前银币：${user.silver_coins ?? 0}`,
                "付费章节导出可使用每日免费额度、额外下载次数，或开通导出授权后按收费章节扣银币。"
            ].join("\n"), { reply_markup: { inline_keyboard: [[{ text: "开通导出授权", callback_data: callback(["unlock", id]) }]] } }).catch(() => {});
            throw exportErr;
        }
        if (!paidBook && quote.amount > 0 && Number(user.copper_coins || 0) < Number(quote.amount || 0)) {
            const exportErr = asExportError("EXPORT_INSUFFICIENT_BALANCE", `copper insufficient, need ${quote.amount}`);
            exportErr.userNotified = true;
            const failure = formatExportFailure(exportErr);
            await editMessage(chatId, progress.message_id, [
                failure.message,
                `错误码：${failure.code}`,
                `本次费用：${exportQuoteText(quote)}`,
                `当前铜币：${user.copper_coins ?? 0}`
            ].join("\n")).catch(() => {});
            throw exportErr;
        }
        if (paidBook && permission.unlocked && !canUseDailyExport && !canUseExtraExport && quote.amount > 0 && Number(user.silver_coins || 0) < Number(quote.amount || 0)) {
            const exportErr = asExportError("EXPORT_INSUFFICIENT_BALANCE", `silver insufficient, need ${quote.amount}`);
            exportErr.userNotified = true;
            const failure = formatExportFailure(exportErr);
            await editMessage(chatId, progress.message_id, [
                failure.message,
                `错误码：${failure.code}`,
                `本次费用：${exportQuoteText(quote)}`,
                `当前银币：${user.silver_coins ?? 0}`
            ].join("\n")).catch(() => {});
            throw exportErr;
        }

        const settlementOptions = exportOptions.settlementKey ? {
            idempotencyKey: exportOptions.settlementKey,
            idempotencyScope: "export-settlement",
            bookId: result.book.book_id
        } : {};

        async function settleSuccessfulExport() {
            if (paidBook) {
                if (canUseDailyExport) {
                    try {
                        const claimed = await client.claimFreeExport(from.id, result.book.book_id, format, settlementOptions);
                        return { kind: "daily", usage: claimed.usage || null };
                    } catch (err) {
                        if (err.status !== 409) throw err;
                    }
                }
                if (canUseExtraExport) {
                    try {
                        const claimed = await client.claimExtraExport(from.id, result.book.book_id, format, settlementOptions);
                        return { kind: "extra", usage: claimed.usage || null };
                    } catch (err) {
                        if (err.status !== 409) throw err;
                    }
                }
                if (!permission.unlocked) {
                    throw asExportError("EXPORT_FREE_QUOTA_USED", "paid export quota used");
                }
            }
            if (quote.amount > 0) {
                await client.spendCurrency(
                    from.id,
                    quote.currency,
                    quote.amount,
                    `export_${format}_fee`,
                    `${result.book.book_id} ${result.chapters} chapters paid=${quote.paidChapters}`,
                    "telegram_bot",
                    settlementOptions
                );
                return { kind: "currency", quote };
            }
            return { kind: "free", quote };
        }

        async function recordAndSettle() {
            await client.recordUserEvent(from.id, `export_${format}`, `${result.book.book_id} ${result.chapters} chapters`).catch(() => {});
            try {
                return await settleSuccessfulExport();
            } catch (err) {
                const message = err.status === 409 ? (err.data?.quota ? freeExportText(err.data.quota) : err.message) : (err.message || String(err));
                if (err.status === 409) {
                    const exportErr = asExportError("EXPORT_INSUFFICIENT_BALANCE", err.message || "insufficient balance", err);
                    exportErr.userNotified = true;
                    throw exportErr;
                }
                throw Object.assign(err, { settlementMessage: message });
            }
        }

        const exportTitle = escapeHtml(result.book.title || result.book.book_id);
        const exportSummary = `${exportTitle}\n已导出 ${result.chapters} 章`;
        if (groupExport) {
            try {
                await sendDocument(from.id, result.filePath, exportSummary);
                await recordAndSettle();
                await editMessage(chatId, progress.message_id, `${format.toUpperCase()} 已私聊发送：${exportSummary}`).catch(() => {});
            } catch (err) {
                if (/forbidden|bot can't initiate conversation|chat not found|blocked/i.test(String(err.message || ""))) {
                    const exportErr = asExportError("EXPORT_PRIVATE_CHAT_REQUIRED", err.message || "private chat required", err);
                    exportErr.userNotified = true;
                    const failure = formatExportFailure(exportErr);
                    const payload = rememberPrivateExportStart(from, chat, id, format, exportOptions);
                    await editMessage(chatId, progress.message_id, [
                        failure.message,
                        `错误码：${failure.code}`,
                        `原因：${escapeHtml(failure.raw || err.message)}`,
                        "点下面按钮打开私聊，发送 /start 后会自动继续这次导出。"
                    ].join("\n"), { reply_markup: privateExportStartMarkup(payload) }).catch(() => {});
                    throw exportErr;
                }
                await editMessage(chatId, progress.message_id, [
                    `${format.toUpperCase()} 已私聊发送：${exportSummary}`,
                    `但扣费/扣次数记录失败：${escapeHtml(err.settlementMessage || err.message || String(err))}`
                ].join("\n")).catch(() => {});
                err.userNotified = true;
                throw err;
            }
            return;
        }
        await sendDocument(chatId, result.filePath, exportSummary);
        try {
            await recordAndSettle();
        } catch (err) {
            await editMessage(chatId, progress.message_id, [
                `${format.toUpperCase()} 导出完成：${exportSummary}`,
                `但扣费/扣次数记录失败：${escapeHtml(err.settlementMessage || err.message || String(err))}`
            ].join("\n")).catch(() => {});
            err.userNotified = true;
            throw err;
        }
        await editMessage(chatId, progress.message_id, `${format.toUpperCase()} 导出完成：${exportSummary}`).catch(() => {});
    } finally {
        if (result?.filePath) await fs.rm(path.dirname(result.filePath), { recursive: true, force: true }).catch(() => {});
    }
}

async function handleMessage(message) {
    const text = message.text || message.caption || "";
    if (!text) return;
    const reviewDraft = reviewDraftContext(message, text);
    if (reviewDraft) {
        const action = /^(?:取消|\/cancel(?:@\w+)?)$/i.test(text.trim())
            ? "book_review_draft_cancel"
            : "book_review_publish_guided";
        return withBotAudit(message, "/review", action, { book_id: reviewDraft.bookId }, () => handleReviewDraft(message, text));
    }
    if (isGroup(message.chat) && !text.startsWith("/") && !mentionsMe(text)) return;
    const cmd = commandOf(text);
    const args = argsOf(text);
    const platformCommand = cmd.match(/^\/(search|hot|random)-([a-z][a-z0-9_-]*)$/i);
    if (platformCommand) {
        const suffixKey = platformCommand[2].toLowerCase().replace(/[_-]+/g, "");
        if (SEARCH_PLATFORM_SUFFIXES[suffixKey]) {
            const platformArgs = [args, `-${platformCommand[2].toLowerCase()}`].filter(Boolean).join(" ");
            const action = platformCommand[1].toLowerCase();
            const details = { platform: SEARCH_PLATFORM_SUFFIXES[suffixKey], shortcut: cmd };
            if (action === "search") return withBotAudit(message, cmd, "search", details, () => withCooldown(message, "search", BOT_SEARCH_COOLDOWN_MS, "搜索", () => handleSearch(message, platformArgs)));
            if (action === "hot") return withBotAudit(message, cmd, "hot", details, () => withCooldown(message, "search", BOT_SEARCH_COOLDOWN_MS, "热门", () => handleHot(message, platformArgs)));
            if (action === "random") return withBotAudit(message, cmd, "random", details, () => withCooldown(message, "search", BOT_SEARCH_COOLDOWN_MS, "随机推荐", () => handleRandom(message, platformArgs)));
        }
    }
    if (cmd.startsWith("/info_")) {
        return withBotAudit(message, "/info", "info", { shortcut: cmd }, () => withCooldown(message, "info", BOT_INFO_COOLDOWN_MS, "详情", () => handleInfo(message, cmd.slice("/info_".length))));
    }
    const registry = getCommandRegistry();
    const command = registry.resolve(cmd);
    if (command) {
        await refreshCommandSettings();
        if (!registry.isEnabled(command.primaryCommand || command.command)) {
            return withBotAudit(message, command.primaryCommand || command.command, "command_disabled", { alias: cmd }, () => sendMessage(message.chat.id, registry.disabledMessage(command.primaryCommand || command.command)));
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
        return withBotAudit(message, "/search", "search_implicit", {}, () => withCooldown(message, "search", BOT_SEARCH_COOLDOWN_MS, "搜索", () => handleSearch(message, text)));
    }
}

async function handleCallback(query) {
    const message = query.message;
    if (!message) return answerCallback(query.id);
    const callbackMessage = { chat: message.chat, from: query.from };
    const [action, a, ...rest] = String(query.data || "").split("|");
    if (!["like", "dislike", "cvote", "sreq", "rvup", "rvdn", "reviewcancel"].includes(action)) await answerCallback(query.id);
    if (action === "noop") return;
    if (action === "info") return withBotAudit(callbackMessage, "/info", "info_callback", { book_id: a }, () => withCooldown(callbackMessage, "info", BOT_INFO_COOLDOWN_MS, "详情", () => handleInfo(callbackMessage, a, { chatId: message.chat.id, messageId: message.message_id })));
    if (action === "fav") {
        return withBotAudit(callbackMessage, "/myfav", "favorite_add", { book_id: a }, async () => {
            await ensureRegistered(query.from);
            await client.addBookshelf(query.from.id, a);
            return sendMessage(message.chat.id, `已收藏：<code>${escapeHtml(a)}</code>`);
        });
    }
    if (action === "txt") return withBotAudit(callbackMessage, "/exporttxt", "export_txt_callback", { book_id: a }, () => withCooldown(callbackMessage, "export", BOT_EXPORT_COOLDOWN_MS, "导出", () => scheduleExport(message.chat, query.from, a, "txt")));
    if (action === "epub") return withBotAudit(callbackMessage, "/exportepub", "export_epub_style_prompt", { book_id: a }, () => requestEpubStyle(message.chat, query.from, a));
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
    if (action === "unlock") {
        return withBotAudit(callbackMessage, "/exporttxt", "export_unlock", { book_id: a }, async () => {
            await ensureRegistered(query.from);
            const result = await client.unlockExport(query.from.id);
            return sendMessage(message.chat.id, [
                result.cost ? `导出授权已开通，消耗银币 ${result.cost}。` : "导出授权已开通。",
                `当前银币：${result.user.silver_coins}`,
                a ? `现在可以导出：<code>${escapeHtml(a)}</code>` : ""
            ].filter(Boolean).join("\n"), { reply_markup: a ? bookActions(a) : undefined });
        });
    }
    if (action === "share") return withBotAudit(callbackMessage, "/share", "share_callback", { book_id: a }, () => scheduleShare(callbackMessage, a));
    if (action === "sharebs") return withBotAudit(callbackMessage, "/mybookshelf", "share_bookshelf_callback", {}, () => scheduleShareBookshelf(callbackMessage));
    if (action === "like" || action === "dislike") {
        const tip = await withBotAudit(callbackMessage, "/info", `feedback_${action}`, { book_id: a }, () => handleFeedback(
            { chat: message.chat, from: query.from },
            a,
            action === "like" ? "like" : "dislike",
            "info",
            { chatId: message.chat.id, messageId: message.message_id }
        ));
        return answerCallback(query.id, tip || "已更新");
    }
    if (action === "qhb") return withBotAudit(callbackMessage, "/qhb", "red_packet_claim_callback", { packet_id: a }, () => handleClaimRedPacket({ chat: message.chat, from: query.from }, a));
    if (action === "crowd") return withBotAudit(callbackMessage, "/crowd", "crowd_callback", { book_id: a }, () => handleCrowd({ chat: message.chat, from: query.from }, a, { chatId: message.chat.id, messageId: message.message_id }));
    if (action === "reviews") return withBotAudit(callbackMessage, "/reviews", "book_reviews_callback", { book_id: a }, () => handleReviews({ chat: message.chat, from: query.from }, a, { chatId: message.chat.id, messageId: message.message_id }));
    if (action === "reviewnew") return withBotAudit(callbackMessage, "/review", "book_review_prompt", { book_id: a }, () => handleReviewStart({ chat: message.chat, from: query.from }, a));
    if (action === "reviewcancel") {
        const tip = await withBotAudit(callbackMessage, "/review", "book_review_draft_cancel", { book_id: a }, () => handleReviewCancel(
            { chat: message.chat, from: query.from },
            a,
            { chatId: message.chat.id, messageId: message.message_id }
        ));
        return answerCallback(query.id, tip);
    }
    if (action === "cvote") {
        try {
            const tip = await withBotAudit(callbackMessage, "/crowd", "crowd_vote", { book_id: a }, () => handleCrowdVote(
                { chat: message.chat, from: query.from },
                a,
                { chatId: message.chat.id, messageId: message.message_id }
            ));
            return answerCallback(query.id, tip || "已更新");
        } catch (err) {
            return answerCallback(query.id, err.message || "投票失败");
        }
    }
    if (action === "rvup" || action === "rvdn") {
        try {
            const vote = action === "rvup" ? "like" : "dislike";
            const tip = await withBotAudit(callbackMessage, "/review", `book_review_${vote}`, { review_id: a }, () => handleReviewVote(
                { chat: message.chat, from: query.from },
                a,
                vote,
                { chatId: message.chat.id, messageId: message.message_id }
            ));
            return answerCallback(query.id, tip || "已更新");
        } catch (err) {
            return answerCallback(query.id, err.message || "投票失败");
        }
    }
    if (action === "search") {
        const rawQuery = searchCache.get(rest.join("|")) || rest.join("|");
        return withBotAudit(callbackMessage, "/search", "search_page", { page: Number(a || 1) }, () => withCooldown(callbackMessage, "search", BOT_SEARCH_COOLDOWN_MS, "搜索", () => handleSearch(callbackMessage, rawQuery, Number(a || 1), { chatId: message.chat.id, messageId: message.message_id })));
    }
    if (action === "sreq") {
        try {
            const rawQuery = searchCache.get(a) || rest.join("|");
            const tip = await withBotAudit(callbackMessage, "/search", "search_request_submit", { cache_key: a }, () => handleSearchRequestSubmit(callbackMessage, rawQuery));
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

async function syncBotCommands() {
    await refreshCommandSettings(true);
    const commands = getCommandRegistry().telegramCommands();
    const scopes = [
        { type: "default" },
        { type: "all_private_chats" },
        { type: "all_group_chats" },
        { type: "all_chat_administrators" }
    ];
    for (const scope of scopes) {
        await telegram("deleteMyCommands", { scope }).catch((err) => console.warn(`[telegram-bot] deleteMyCommands ${scope.type} failed: ${err.message}`));
        await telegram("setMyCommands", { commands, scope }).catch((err) => console.warn(`[telegram-bot] setMyCommands ${scope.type} failed: ${err.message}`));
    }
}

const botRuntime = createTelegramPollingRuntime({
    telegram,
    handleUpdate,
    sendMessage,
    escapeHtml,
    delay,
    pollTimeout: POLL_TIMEOUT,
    pollRetryDelayMs: 3000,
    startupRetryDelayMs: 10000,
    client,
    syncBotCommands,
    telegramApiBase: TELEGRAM_API_BASE,
    onConnected(user) {
        botUser = user;
        console.log(`[telegram-bot] @${user.username} connected to ${client.baseUrl}`);
        if (!persistentJobsRecovered) {
            persistentJobsRecovered = true;
            recoverPersistentJobs(persistentJobTypes, recoverSystemJob)
                .then((count) => console.log(`[bot-task] recovered ${count} persistent jobs`))
                .catch((err) => {
                    persistentJobsRecovered = false;
                    console.warn(`[bot-task] recovery failed: ${err.message || String(err)}`);
                });
        }
    }
});

startBotHealthServer({
    port: BOT_HEALTH_PORT,
    host: BOT_HEALTH_HOST,
    staleMs: BOT_HEALTH_STALE_MS,
    startedAt: STARTED_AT,
    telegramApiBase: TELEGRAM_API_BASE,
    client,
    telegramClient,
    botTaskQueue,
    rateLimiter,
    stateProvider: botRuntime.state
});

botRuntime.runForever();













