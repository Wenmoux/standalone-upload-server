const fs = require("fs/promises");
const { createWriteStream } = require("fs");
const http = require("http");
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
const { createTaskSchedulers } = require("./task-schedulers");
const { createSearchCache, helpLinesFromCommands: buildHelpLinesFromCommands } = require("./bot-session");
const { createTelegramPollingRuntime } = require("./polling-runtime");
const {
    meText,
    registerText,
    signSuccessText,
    startHelpText,
    walletText
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
const { botTaskQueue } = createBotTaskRuntime({
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
    reviewVoteActions,
    currencyLabel,
    transactionLine,
    nonNegativeInt,
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
const { scheduleExport, scheduleMyBookshelf, scheduleShare, scheduleShareBookshelf } = createTaskSchedulers({
    botTaskQueue,
    sendMessage,
    isGroup,
    sendExport,
    handleMyBookshelf,
    handleShare,
    handleShareBookshelf
});
if (!TELEGRAM_TOKEN) {
    console.error("缺少 TELEGRAM_BOT_TOKEN");
    process.exit(1);
}

let botUser = null;
const searchCache = createSearchCache({ maxSize: Number(process.env.TELEGRAM_SEARCH_CACHE_MAX || 200) });
const po18LoginSessions = new Map();
let commandRegistry = null;
const commandSettingsState = { at: 0, payload: null };



function getCommandRegistry() {
    if (commandRegistry) return commandRegistry;
    const registry = createCommandRegistry();
    const withSearchCooldown = (message, label, handler) => withCooldown(message, "search", BOT_SEARCH_COOLDOWN_MS, label, handler);
    const withInfoCooldown = (message, label, handler) => withCooldown(message, "info", BOT_INFO_COOLDOWN_MS, label, handler);
    const withExportCooldown = (message, label, handler) => withCooldown(message, "export", BOT_EXPORT_COOLDOWN_MS, label, handler);
    const withBookshelfCooldown = (message, label, handler) => withCooldown(message, "mybookshelf", BOT_BOOKSHELF_COOLDOWN_MS, label, handler);
    const withPikpakCooldown = (message, label, handler) => withCooldown(message, "pikpak", BOT_PIKPAK_COOLDOWN_MS, label, handler);

    registerAccountCommands(registry, { handleStart, handleRegister, handleMe, handleSign, handleGive, handleTop, handleTransactions });
    registerSearchCommands(registry, { withSearchCooldown, withInfoCooldown, handleSearch, handleHot, handleRandom, handleInfo });
    registerSocialCommands(registry, { handleMyFav, handleRedPacket, handleClaimRedPacket, handleCrowd, handleReview, handleReviews });
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
    registerExportCommands(registry, { withExportCooldown, scheduleExport });
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



async function ensureRegistered(user) {
    const found = await client.getUser(user.id);
    if (found) return found;
    const created = await client.registerUser(user);
    return created.user;
}

async function handleStart(message, payload) {
    await refreshCommandSettings();
    const user = await client.getUser(message.from.id);
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

async function handleWallet(message) {
    const user = await ensureRegistered(message.from);
    await sendMessage(message.chat.id, walletText(user, { escapeHtml, scholarText }));
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

async function sendBookCards(target, rows, title) {
    const message = typeof target === "object" ? target : null;
    const chatId = message ? message.chat.id : target;
    const text = [`<b>${escapeHtml(title)}</b>`, "", ...rows.map((book, index) => bookListItem(book, index + 1))].join("\n\n");
    if (message) return deliverLongGroupResult(message, text, { reply_markup: listActions(rows) }, { title });
    return sendMessage(chatId, text, { reply_markup: listActions(rows) });
}

async function handleSearch(message, rawQuery, page = 1, editTarget = null) {
    const query = rawQuery.trim();
    if (!query) return sendMessage(message.chat.id, "用法：/search 关键词 [-qd|-fq] 或 /search #标签 [-qd|-fq]");
    const { params, type, keyword, platform, cleanQuery } = parseSearchQuery(query);
    if (!keyword) return sendMessage(message.chat.id, "用法：/search 关键词 [-qd|-fq] 或 /search #标签 [-qd|-fq]");
    params.page = page;
    const data = await client.searchBooks(params);
    await client.recordSearch(keyword, type, data.total).catch(() => {});
    const label = platformLabel(platform);
    if (!data.rows.length) {
        const searchKey = rememberSearch(query);
        const text = [
            `没找到「${escapeHtml(cleanQuery || query)}」在 ${escapeHtml(label)} 的相关书。`,
            "可以提交到缺书需求列表，后台会统计后续补库优先级。"
        ].join("\n");
        const markup = searchRequestActions(searchKey);
        if (editTarget) return deliverLongGroupResult(message, text, { reply_markup: markup }, { title: `${label} 搜索无结果`, editTarget });
        return sendMessage(message.chat.id, text, { reply_markup: markup });
    }
    const visibleCount = (Number(data.page || page) - 1) * Number(data.limit || SEARCH_LIMIT) + data.rows.length;
    const totalText = data.total_is_estimated && data.has_more ? `${visibleCount}+` : data.total;
    const header = `${escapeHtml(label)} · 找到 ${totalText} 本，当前第 ${data.page} 页`;
    const searchKey = rememberSearch(query);
    if (editTarget) {
        const text = [`<b>${escapeHtml(query)}</b>`, header, "", ...data.rows.map((book, index) => bookListItem(book, (data.page - 1) * data.limit + index + 1))].join("\n\n");
        const pager = searchPager(searchKey, data.page, data.total, data.limit);
        const actions = listActions(data.rows);
        await deliverLongGroupResult(message, text, { reply_markup: mergeKeyboards(actions, pager) }, { title: `${label} 搜索结果`, editTarget });
    } else {
        const text = [`<b>${escapeHtml(query)}</b>`, header, "", ...data.rows.map((book, index) => bookListItem(book, (data.page - 1) * data.limit + index + 1))].join("\n\n");
        const pager = searchPager(searchKey, data.page, data.total, data.limit);
        const actions = listActions(data.rows);
        await deliverLongGroupResult(message, text, { reply_markup: mergeKeyboards(actions, pager) }, { title: `${label} 搜索结果` });
    }
}

async function handleHot(message, args = "") {
    const { platform } = parsePlatformSuffix(args, { defaultPlatform: DEFAULT_RECOMMEND_PLATFORM });
    const data = await client.searchBooks({ page: 1, limit: SEARCH_LIMIT, sort: "popularity_desc", platform, cache_min: 1, fast: 1 });
    const keywords = await client.hotKeywords(8).catch(() => ({ rows: [] }));
    const title = keywords.rows?.length
        ? `${platformLabel(platform)} 热门排行\n热搜：${keywords.rows.map((row) => `${row.keyword}(${row.count})`).join(" / ")}`
        : `${platformLabel(platform)} 热门排行`;
    await sendBookCards(message, data.rows, title);
}

async function handleRandom(message, args = "") {
    const { platform } = parsePlatformSuffix(args, { defaultPlatform: DEFAULT_RECOMMEND_PLATFORM });
    const page = Math.max(1, Math.floor(Math.random() * 30) + 1);
    const data = await client.searchBooks({ page, limit: SEARCH_LIMIT, sort: "updated_desc", platform, cache_min: 1, fast: 1 });
    if (!data.rows.length) return sendMessage(message.chat.id, "暂时没有可推荐的书。");
    await sendBookCards(message, data.rows, `${platformLabel(platform)} 随机推荐`);
}

async function handleInfo(message, bookId, editTarget = null) {
    const id = bookId.trim();
    if (!id) return sendMessage(message.chat.id, "用法：/info 书号");
    const [{ book }, chapters, reviews] = await Promise.all([
        client.getBook(id),
        client.getChapters(id),
        client.listBookReviews(id, message.from?.id || "", 3).catch(() => null)
    ]);
    const text = detailCardText(book, chapters.rows || [], reviews);
    const markup = bookActions(book.book_id, book.detail_url);
    if (editTarget) return deliverLongGroupResult(message, text, { reply_markup: markup }, { title: "书籍详情", editTarget });
    return deliverLongGroupResult(message, text, { reply_markup: markup }, { title: "书籍详情" });
}

async function handleFeedback(message, bookId, feedback, source = "info", editTarget = null) {
    const id = String(bookId || "").trim();
    if (!id) return sendMessage(message.chat.id, "缺少书号");
    await ensureRegistered(message.from);
    const result = await client.feedback(message.from.id, id, feedback, source);
    const isLike = result.feedback === "like";
    const text = result.already_exists
        ? `这本你已经点过${isLike ? "喜欢" : "不喜欢"}了。`
        : (isLike ? "记住了，以后往这个方向多推。" : "记下了，以后少推这类。");
    if (editTarget) {
        await handleInfo(message, id, editTarget).catch(() => {});
        return text;
    }
    return sendMessage(message.chat.id, [
        text,
        `喜欢 ${result.counts?.like_count || 0} · 不喜欢 ${result.counts?.dislike_count || 0}`
    ].join("\n"), { reply_markup: bookActions(id) });
}

async function handleSearchRequestSubmit(message, rawQuery) {
    const query = String(rawQuery || "").trim();
    if (!query) return "提交已过期，请重新搜索后再点提交。";
    const { params, type, keyword, platform, cleanQuery } = parseSearchQuery(query);
    if (!keyword) return "搜索词无效，请重新搜索后再提交。";
    await ensureRegistered(message.from);
    const result = await client.submitSearchRequest(message.from.id, {
        query,
        clean_query: cleanQuery || keyword || query,
        type,
        platform: platform || "",
        result_count: 0,
        source: "bot_search_no_result",
        telegram_username: message.from.username || "",
        nickname: userDisplayName(message.from)
    });
    return result.already_exists
        ? "这个搜索需求你已经提交过了。"
        : "已提交到缺书需求列表。";
}

async function handleCrowd(message, rawBook = "", editTarget = null) {
    await ensureRegistered(message.from);
    const bookId = parseBookId(rawBook);
    if (!bookId) {
        const data = await client.crowdLeaderboard(message.from.id, 10);
        const stats = data.stats || {};
        const text = [
            "<b>众筹榜</b>",
            "",
            "用法：/crowd 书籍链接 或 /crowd 书号",
            `每次支持消耗 ${CROWD_VOTE_COST} 银币。`,
            "",
            "<b>当前排行榜</b>",
            ...(data.leaderboard || []).map((row) => `${row.rank || "-"} · ${escapeHtml(row.title || row.book_id)} · ${Number(row.supporter_count || 0)} 人`),
            ...(data.leaderboard?.length ? [] : ["暂无投票记录"]),
            "",
            `总计：${Number(stats.total_books || 0)} 本书 · ${Number(stats.total_votes || 0)} 次支持 · ${Number(stats.total_silver || 0)} 银币`
        ].join("\n");
        if (editTarget) return deliverLongGroupResult(message, text, {}, { title: "众筹榜", editTarget });
        return deliverLongGroupResult(message, text, {}, { title: "众筹榜" });
    }
    const result = await client.crowdBook(bookId, message.from.id, 10);
    const text = crowdCardText(result, result.book?.supported_by_me);
    const markup = crowdActions(result.book?.book_id || bookId, result.book?.detail_url || "");
    if (editTarget) return deliverLongGroupResult(message, text, { reply_markup: markup }, { title: "众筹详情", editTarget });
    return deliverLongGroupResult(message, text, { reply_markup: markup }, { title: "众筹详情" });
}

async function handleCrowdVote(message, bookId, editTarget = null) {
    const id = parseBookId(bookId);
    if (!id) return sendMessage(message.chat.id, "缺少书号");
    await ensureRegistered(message.from);
    const result = await client.crowdVote(id, message.from.id, CROWD_VOTE_COST);
    const text = crowdCardText(result, true);
    const markup = crowdActions(result.book?.book_id || id, result.book?.detail_url || "");
    if (editTarget) {
        await editMessage(editTarget.chatId, editTarget.messageId, text, { reply_markup: markup }).catch(() => {});
        return result.already_exists
            ? "你已支持过这本书"
            : `支持成功，消耗 ${result.vote_cost || CROWD_VOTE_COST} 银币`;
    }
    return deliverLongGroupResult(message, text, { reply_markup: markup }, { title: "众筹详情" });
}

function parseReviewArgs(args = "") {
    const text = String(args || "").trim();
    if (!text) return { bookId: "", content: "" };
    const first = text.split(/\s+/)[0] || "";
    const bookId = parseBookId(first);
    if (!bookId) return { bookId: "", content: "" };
    return {
        bookId,
        content: text.slice(first.length).trim()
    };
}

async function handleReviews(message, rawBook = "", editTarget = null) {
    await ensureRegistered(message.from);
    const bookId = parseBookId(rawBook);
    if (!bookId) return sendMessage(message.chat.id, "用法：/reviews 书号");
    const payload = await client.listBookReviews(bookId, message.from.id, 5);
    const text = bookReviewsText(bookId, payload);
    const markup = bookReviewsActions(bookId);
    if (editTarget) return deliverLongGroupResult(message, text, { reply_markup: markup }, { title: "书评", editTarget });
    return deliverLongGroupResult(message, text, { reply_markup: markup }, { title: "书评" });
}

async function handleReview(message, args = "") {
    const { bookId, content } = parseReviewArgs(args);
    if (!bookId || !content) return sendMessage(message.chat.id, "用法：/review 书号 内容");
    await ensureRegistered(message.from);
    const result = await client.publishBookReview(bookId, message.from.id, content);
    const channelText = result.channel?.sent
        ? "频道：已推送"
        : result.channel?.skipped
            ? `频道：未推送（${escapeHtml(result.channel.skipped)}）`
            : result.channel?.error
                ? `频道：推送失败（${escapeHtml(result.channel.error)}）`
                : "频道：未推送";
    const lines = [
        "书评已发布。",
        `书号：<code>${escapeHtml(bookId)}</code>`,
        `消耗：${Number(result.cost || 0)} 铜`,
        `当前铜币：${Number(result.user?.copper_coins || 0)}`,
        channelText,
        "",
        `赞会给你 +100 铜，踩会扣 1 铜；同一用户重复点击不会重复结算。`
    ];
    return sendMessage(message.chat.id, lines.join("\n"), { reply_markup: bookReviewsActions(bookId) });
}

async function handleReviewVote(message, reviewId, vote, editTarget = null) {
    await ensureRegistered(message.from);
    const result = await client.voteBookReview(reviewId, message.from.id, vote);
    if (editTarget && result.review) {
        await editMessage(editTarget.chatId, editTarget.messageId, reviewChannelText(result.review), {
            reply_markup: reviewVoteActions(result.review)
        }).catch(() => {});
    }
    if (result.already_exists) return vote === "like" ? "你已经赞过了" : "你已经踩过了";
    if (Number(result.reward_delta || 0) > 0) return `已赞，作者 +${result.reward_delta} 铜`;
    if (Number(result.reward_delta || 0) < 0) return `已踩，作者 ${result.reward_delta} 铜`;
    return "已更新";
}

async function handleMyFav(message) {
    await ensureRegistered(message.from);
    const data = await client.listBookshelf(message.from.id);
    if (!data.rows.length) return sendMessage(message.chat.id, "你的书架还没有书。");
    await sendBookCards(message, data.rows.slice(0, 20), `我的收藏：${data.rows.length} 本`);
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

async function handlePo18Set(message, args) {
    await ensureRegistered(message.from);
    const parts = String(args || "").split(/\s+/).filter(Boolean);
    if (parts.length < 2) return sendMessage(message.chat.id, "用法：/po18set 账号 密码");
    await client.savePo18Account(message.from.id, { account: parts[0], password: parts.slice(1).join(" "), last_status: "account_saved" });
    return sendMessage(message.chat.id, "PO18 账号密码已保存。接着发 /loginpo18 获取验证码。");
}

async function handleLoginPo18(message) {
    await ensureRegistered(message.from);
    const account = await client.po18Account(message.from.id);
    if (!account.account) return sendMessage(message.chat.id, "先用 /po18set 账号 密码 保存登录信息。");
    const loginUrl = "https://members.po18.tw/apps/login.php?u=https://www.po18.tw/site/alarm";
    const { response, cookies } = await po18Fetch(loginUrl, { redirect: "follow" });
    if (!response.ok) return sendMessage(message.chat.id, `获取登录页失败：HTTP ${response.status}`);
    const html = await response.text();
    const fields = parseLoginFields(html);
    const captcha = await po18Fetch(`https://members.po18.tw/apps/images.php?${Date.now()}`, {
        redirect: "follow",
        headers: { Referer: loginUrl }
    }, cookies);
    if (!captcha.response.ok) {
        return sendMessage(message.chat.id, `PO18 验证码获取失败：HTTP ${captcha.response.status}。稍后重试 /loginpo18，或先在浏览器确认 PO18 账号能打开登录页。`);
    }
    const contentType = String(captcha.response.headers.get("content-type") || "").toLowerCase();
    const image = Buffer.from(await captcha.response.arrayBuffer());
    if (!image.length) {
        return sendMessage(message.chat.id, "PO18 验证码图片为空，可能是 PO18 登录页临时跳转、风控或验证码接口没返回图片。请稍后重试 /loginpo18。");
    }
    if (/text\/html|application\/json|text\/plain/.test(contentType)) {
        return sendMessage(message.chat.id, "PO18 没有返回验证码图片，而是返回了页面内容。请稍后重试 /loginpo18，或先在浏览器打开 PO18 登录页确认没有验证/风控。");
    }
    po18LoginSessions.set(String(message.from.id), { fields, cookies: captcha.cookies, account: account.account, password: account.password || "", createdAt: Date.now() });
    return sendPhoto(message.chat.id, image, "po18-captcha.jpg", "PO18 验证码来了，发 /po18code xxxx 提交。");
}

async function handlePo18Code(message, args) {
    await ensureRegistered(message.from);
    const code = String(args || "").trim().split(/\s+/)[0];
    if (!code) return sendMessage(message.chat.id, "用法：/po18code 验证码");
    const session = po18LoginSessions.get(String(message.from.id));
    if (!session) return sendMessage(message.chat.id, "先发 /loginpo18 获取验证码。");
    const fields = { ...session.fields, account: session.account, pwd: session.password, captcha: code };
    if (!fields.remember_me) fields.remember_me = "1";
    const body = new URLSearchParams(fields);
    const result = await po18Fetch("https://members.po18.tw/apps/login.php", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: "https://members.po18.tw",
            Referer: "https://members.po18.tw/apps/login.php?u=https://www.po18.tw/site/alarm"
        },
        body
    }, session.cookies);
    if (hasPo18Auth(result.cookies)) {
        await client.savePo18Account(message.from.id, { account: session.account, password: session.password, cookies: result.cookies, last_status: "login_ok" });
        po18LoginSessions.delete(String(message.from.id));
        return sendMessage(message.chat.id, "PO18 登录成功，Cookie 已保存。");
    }
    return sendMessage(message.chat.id, "验证码不对或登录失败，重新发 /loginpo18 再试。");
}

async function handlePo18Status(message) {
    await ensureRegistered(message.from);
    const account = await client.po18Account(message.from.id);
    const ok = account.cookies?.length && hasPo18Auth(account.cookies);
    return sendMessage(message.chat.id, [
        `PO18 账号：${escapeHtml(account.account || "未绑定")}`,
        `状态：${ok ? "已保存 Cookie" : "未登录/已失效"}`,
        account.updated_at ? `更新时间：${escapeHtml(String(account.updated_at).slice(0, 19).replace("T", " "))}` : ""
    ].filter(Boolean).join("\n"));
}

async function handlePo18Logout(message) {
    po18LoginSessions.delete(String(message.from.id));
    await client.clearPo18Account(message.from.id);
    return sendMessage(message.chat.id, "PO18 登录状态已清除。");
}

async function handleMyBookshelf(message) {
    await ensureRegistered(message.from);
    const account = await client.po18Account(message.from.id);
    if (!account.cookies?.length || !hasPo18Auth(account.cookies)) return sendMessage(message.chat.id, "还没绑定 PO18 账号，先 /po18set 账号 密码，再 /loginpo18。");
    const progress = await sendMessage(message.chat.id, `正在拉取你的 PO18 书架（账号：${escapeHtml(account.account || "?")}），请稍候...`);
    const books = await fetchPo18Bookshelf(account.cookies);
    if (!books.length) return editMessage(message.chat.id, progress.message_id, "没拉到已购书籍。要么书架是空的，要么 Cookie 失效了。").catch(() => {});
    let added = 0;
    for (const book of books) {
        await client.addBookshelf(message.from.id, book.book_id).catch(() => {});
        added += 1;
    }
    const lines = [`<b>我的 PO18 书架</b>（共 ${books.length} 本，已加入收藏 ${added} 本）`, ""];
    for (const book of books.slice(0, 30)) {
        lines.push(`• ${escapeHtml(book.title || book.book_id)} / ${escapeHtml(book.author || "未知")}`);
        lines.push(`  /info_${book.book_id}`);
    }
    if (books.length > 30) lines.push("", `还有 ${books.length - 30} 本未展示。`);
    const shareMarkup = { reply_markup: { inline_keyboard: [[{ text: "上传共享已购书架", callback_data: callback(["sharebs"]) }]] } };
    await deliverLongGroupResult(message, lines.join("\n"), shareMarkup, {
        title: "PO18 书架",
        editTarget: { chatId: message.chat.id, messageId: progress.message_id }
    }).catch(() => sendMessage(message.chat.id, lines.join("\n"), shareMarkup));
}

async function sendExport(chat, from, bookId, format) {
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
    const canUseFreeExport = !!freeExport.available;
    if (!permission.unlocked && !canUseFreeExport) {
        await sendMessage(chatId, [
            "今日免费导出额度已用完，继续导出需要先开通授权。",
            freeExportText(freeExport),
            `授权价格：${pricing.unlockCost} 银币`,
            `当前银币：${permission.user?.silver_coins ?? 0}`,
            `导出扣费：纯免费书 ${pricing.freeCopperCost} 铜币/次；收费章节 ${pricing.paidChapterSilverCost} 银币/章。`,
            "点击下方按钮消耗银币开通后再导出。"
        ].join("\n"), { reply_markup: { inline_keyboard: [[{ text: "开通导出授权", callback_data: callback(["unlock", id]) }]] } });
        return;
    }
    const progress = await sendMessage(chatId, `正在生成 ${format.toUpperCase()}：<code>${escapeHtml(id)}</code>`);
    let result = null;
    try {
        result = await buildExport(bookData.book, format, from);
        const quote = exportQuote(result, pricing);
        let freeClaim = null;
        if (canUseFreeExport) {
            try {
                const claimed = await client.claimFreeExport(from.id, result.book.book_id, format);
                freeClaim = claimed.usage || null;
            } catch (err) {
                if (err.status === 409 && !permission.unlocked) {
                    const exportErr = asExportError("EXPORT_FREE_QUOTA_USED", err.message || "free export quota used", err);
                    exportErr.userNotified = true;
                    const failure = formatExportFailure(exportErr);
                    await editMessage(chatId, progress.message_id, [
                        failure.message,
                        `错误码：${failure.code}`,
                        err.data?.quota ? freeExportText(err.data.quota) : escapeHtml(failure.raw || err.message),
                        `可开通导出授权：${pricing.unlockCost} 银币`
                    ].join("\n")).catch(() => {});
                    throw exportErr;
                }
                if (err.status !== 409) throw err;
            }
        }
        if (!freeClaim && quote.amount > 0) {
            try {
                await client.spendCurrency(
                    from.id,
                    quote.currency,
                    quote.amount,
                    `export_${format}_fee`,
                    `${result.book.book_id} ${result.chapters} chapters paid=${quote.paidChapters}`,
                    "telegram_bot"
                );
            } catch (err) {
                if (err.status === 409) {
                    const exportErr = asExportError("EXPORT_INSUFFICIENT_BALANCE", err.message || "insufficient balance", err);
                    exportErr.userNotified = true;
                    const failure = formatExportFailure(exportErr);
                    await editMessage(chatId, progress.message_id, [
                        failure.message,
                        `错误码：${failure.code}`,
                        `本次费用：${exportQuoteText(quote)}`,
                        `原因：${escapeHtml(failure.raw || err.message)}`
                    ].join("\n")).catch(() => {});
                    throw exportErr;
                }
                throw err;
            }
        }
        const exportTitle = escapeHtml(result.book.title || result.book.book_id);
        const exportSummary = `${exportTitle}\n已导出 ${result.chapters} 章`;
        if (groupExport) {
            try {
                await sendDocument(from.id, result.filePath, exportSummary);
                await client.recordUserEvent(from.id, `export_${format}`, `${result.book.book_id} ${result.chapters} chapters`).catch(() => {});
                await editMessage(chatId, progress.message_id, `${format.toUpperCase()} 已私聊发送：${exportSummary}`).catch(() => {});
            } catch (err) {
                const exportErr = asExportError("EXPORT_PRIVATE_CHAT_REQUIRED", err.message || "private chat required", err);
                exportErr.userNotified = true;
                const failure = formatExportFailure(exportErr);
                await editMessage(chatId, progress.message_id, [
                    failure.message,
                    `错误码：${failure.code}`,
                    `原因：${escapeHtml(failure.raw || err.message)}`
                ].join("\n")).catch(() => {});
                throw exportErr;
            }
            return;
        }
        await sendDocument(chatId, result.filePath, exportSummary);
        await client.recordUserEvent(from.id, `export_${format}`, `${result.book.book_id} ${result.chapters} chapters`).catch(() => {});
        await editMessage(chatId, progress.message_id, `${format.toUpperCase()} 导出完成：${exportSummary}`).catch(() => {});
    } finally {
        if (result?.filePath) await fs.rm(path.dirname(result.filePath), { recursive: true, force: true }).catch(() => {});
    }
}

function shareBookId(book = {}) {
    return String(book.book_id || book.bookId || book.bid || "").trim();
}

function shareBookTitle(book = {}) {
    return book.title || shareBookId(book) || "-";
}

function isPo18ShareBook(book = {}) {
    return /po18/i.test(String(book.platform || ""))
        || /po18\.tw/i.test(String(book.detail_url || book.detailUrl || ""));
}

function normalizeShareBook(input = {}, fallbackId = "") {
    const bookId = shareBookId(input) || String(fallbackId || "").trim();
    return {
        ...input,
        book_id: bookId,
        platform: input.platform || "po18",
        detail_url: input.detail_url || input.detailUrl || (bookId ? `https://www.po18.tw/books/${bookId}/articles` : "")
    };
}

function positiveNumber(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function shareChapterOrder(chapter = {}, fallback = 0) {
    const order = positiveNumber(chapter.chapter_order ?? chapter.chapterOrder ?? chapter.order);
    return order || positiveNumber(fallback);
}

function boolish(value) {
    if (value === true || value === 1) return true;
    const text = String(value ?? "").trim().toLowerCase();
    if (!text) return false;
    return ["1", "true", "yes", "paid", "vip", "charge", "needpay"].includes(text)
        || /付费|付費|收费|收費|订阅|訂閱|订购|訂購|购买|購買|vip/i.test(text);
}

function explicitFreeChapter(chapter = {}) {
    if (chapter.is_free === true || chapter.isFree === true || chapter.free === true) return true;
    for (const key of ["price", "chapterPrice", "chapter_price", "cost", "fee"]) {
        if (chapter[key] !== undefined && Number(chapter[key]) === 0) return true;
    }
    const text = String(chapter.access || chapter.accessText || chapter.status || chapter.mark || "");
    return /免费|免費/.test(text) && !/付费|付費|订阅|訂閱|订购|訂購|购买|購買/.test(text);
}

function explicitPaidChapter(chapter = {}) {
    if (explicitFreeChapter(chapter)) return false;
    for (const key of ["is_paid", "isPaid", "paid", "vip", "isVip", "is_vip", "requiresPayment", "requires_payment"]) {
        if (chapter[key] !== undefined && boolish(chapter[key])) return true;
    }
    for (const key of ["price", "chapterPrice", "chapter_price", "cost", "fee"]) {
        if (chapter[key] !== undefined && Number(chapter[key]) > 0) return true;
    }
    const text = String(chapter.access || chapter.accessText || chapter.status || chapter.mark || "");
    return /付费|付費|收费|收費|订阅|訂閱|订购|訂購|购买|購買|vip/i.test(text);
}

function rewardableShareChapter(book = {}, chapter = {}, index = 0) {
    if (isVolumeChapter(chapter) || explicitFreeChapter(chapter)) return false;
    if (explicitPaidChapter(chapter)) return true;
    const freeChapters = positiveNumber(book.free_chapters ?? book.freeChapters);
    const paidChapters = positiveNumber(book.paid_chapters ?? book.paidChapters);
    const totalChapters = positiveNumber(book.total_chapters ?? book.totalChapters ?? book.chapter_count ?? book.chapterCount);
    const inferredFree = !freeChapters && paidChapters && totalChapters > paidChapters ? totalChapters - paidChapters : freeChapters;
    if (inferredFree > 0) return shareChapterOrder(chapter, index) > inferredFree;
    if (paidChapters > 0 && totalChapters > 0) return true;
    return false;
}

async function resolveShareBook(bookId, fallbackBook = null) {
    const fallback = fallbackBook ? normalizeShareBook(fallbackBook, bookId) : null;
    try {
        const data = await client.getBook(bookId);
        if (data?.book) return normalizeShareBook({ ...(fallback || {}), ...data.book }, bookId);
    } catch (err) {
        if (!fallback) throw err;
        console.warn(`[share] book metadata fallback ${bookId}: ${err.message || String(err)}`);
    }
    if (fallback) return fallback;
    throw new Error(`book not found: ${bookId}`);
}

async function localShareChapters(bookId) {
    try {
        const data = await client.getChapters(bookId, true);
        return (data.rows || []).filter((chapter) => String(chapter.chapter_id || chapter.chapterId || chapter.id || "").trim());
    } catch (err) {
        console.warn(`[share] local chapters unavailable ${bookId}: ${err.message || String(err)}`);
        return [];
    }
}

async function notifyShareProgress(options, state) {
    if (typeof options.onProgress !== "function") return;
    await options.onProgress(state).catch(() => {});
}

async function shareBookForUser(message, inputBook, options = {}) {
    const bookId = shareBookId(inputBook);
    if (!bookId) throw new Error("missing book id");
    const uploader = userDisplayName(message.from);
    const uploaderId = String(message.from.id || "");
    const book = await resolveShareBook(bookId, inputBook);
    await notifyShareProgress(options, { phase: "metadata", book });

    const meta = await client.shareMetadata([bookToSharePayload(book, uploader, uploaderId)]);
    const metaStats = meta.stats || {};
    if (meta.success === false || Number(metaStats.failed || 0) > 0) {
        return {
            book,
            status: "metadata_failed",
            error: (metaStats.errors || ["共享书籍信息失败"])[0],
            total: 0,
            uploaded: 0,
            rewardableUploaded: 0,
            skipped: 0,
            failed: 0
        };
    }

    let chapters = await localShareChapters(book.book_id);
    if (!chapters.length && isPo18ShareBook(book)) {
        const account = options.account !== undefined ? options.account : await client.po18Account(message.from.id).catch(() => null);
        if (account?.cookies?.length && hasPo18Auth(account.cookies)) {
            await notifyShareProgress(options, { phase: "po18", book });
            try {
                chapters = (await fetchPo18PurchasedChapters(book.book_id, account.cookies))
                    .filter((chapter) => String(chapter.chapter_id || chapter.chapterId || chapter.id || "").trim());
            } catch (err) {
                return {
                    book,
                    status: "chapter_fetch_failed",
                    error: err.message || String(err),
                    total: 0,
                    uploaded: 0,
                    rewardableUploaded: 0,
                    skipped: 0,
                    failed: 0
                };
            }
        }
    }

    if (!chapters.length) {
        return { book, status: "no_chapters", total: 0, uploaded: 0, rewardableUploaded: 0, skipped: 0, failed: 0 };
    }

    await notifyShareProgress(options, { phase: "cache", book, total: chapters.length });
    const cache = await client.checkSharedCache(book.book_id);
    const cachedIds = extractCacheIds(cache);
    const uploadItems = chapters
        .map((chapter, index) => ({ chapter, index: index + 1, chapterId: String(chapter.chapter_id || chapter.chapterId || chapter.id || index + 1) }))
        .filter((item) => !cachedIds.has(item.chapterId));
    const skipped = chapters.length - uploadItems.length;

    if (!uploadItems.length) {
        return { book, status: "cached", total: chapters.length, uploaded: 0, rewardableUploaded: 0, skipped, failed: 0 };
    }

    let uploaded = 0;
    let rewardableUploaded = 0;
    let failed = 0;
    for (let i = 0; i < uploadItems.length; i += 1) {
        const item = uploadItems[i];
        if (i === 0 || (i + 1) % 10 === 0 || i + 1 === uploadItems.length) {
            await notifyShareProgress(options, {
                phase: "upload",
                book,
                current: i + 1,
                uploadTotal: uploadItems.length,
                skipped,
                uploaded,
                rewardableUploaded,
                failed,
                total: chapters.length
            });
        }
        const payload = {
            ...chapterToSharePayload(book, item.chapter, item.index, uploader, uploaderId),
            source: "telegram_bot"
        };
        if (!payload.html || !payload.text) {
            failed += 1;
            continue;
        }
        try {
            await client.shareChapter(payload);
            uploaded += 1;
            if (rewardableShareChapter(book, item.chapter, item.index)) rewardableUploaded += 1;
        } catch (err) {
            failed += 1;
            console.error(`[share] ${book.book_id}/${payload.chapterId}: ${err.message}`);
        }
    }

    return {
        book,
        status: failed ? (uploaded ? "partial" : "failed") : "uploaded",
        total: chapters.length,
        uploaded,
        rewardableUploaded,
        skipped,
        failed
    };
}

async function handleShare(message, bookId) {
    const id = String(bookId || "").trim();
    if (!id) return sendMessage(message.chat.id, "用法：共享 书号");
    await ensureRegistered(message.from);
    const progress = await sendMessage(message.chat.id, `正在共享：<code>${escapeHtml(id)}</code>\n准备书籍信息...`);
    const stats = await shareBookForUser(message, { book_id: id }, {
        onProgress: (state) => {
            const title = escapeHtml(shareBookTitle(state.book));
            if (state.phase === "metadata") {
                return editMessage(message.chat.id, progress.message_id, `正在共享：<code>${escapeHtml(id)}</code>\n准备书籍信息...`);
            }
            if (state.phase === "po18") {
                return editMessage(message.chat.id, progress.message_id, [
                    "已共享书籍信息，本地没有正文缓存。",
                    `书籍：${title}`,
                    "正在用 PO18 登录态拉取已购章节..."
                ].join("\n"));
            }
            if (state.phase === "cache") {
                return editMessage(message.chat.id, progress.message_id, `已共享书籍信息，正在检查正文缓存...\n书籍：${title}`);
            }
            if (state.phase === "upload") {
                return editMessage(message.chat.id, progress.message_id, [
                    `正在上传正文：${state.current}/${state.uploadTotal}`,
                    `书籍：${title}`,
                    `已上传 ${state.uploaded} 章 / 可奖励付费新增 ${state.rewardableUploaded || 0} 章`,
                    `跳过 ${state.skipped} 章 / 失败 ${state.failed} 章`
                ].join("\n"));
            }
            return null;
        }
    });

    if (stats.status === "metadata_failed") {
        await editMessage(message.chat.id, progress.message_id, `共享失败：${escapeHtml(stats.error || "共享书籍信息失败")}`).catch(() => {});
        return;
    }
    if (stats.status === "chapter_fetch_failed") {
        await editMessage(message.chat.id, progress.message_id, [
            "已共享书籍信息，但拉取 PO18 已购章节失败。",
            `书籍：${escapeHtml(shareBookTitle(stats.book))}`,
            `原因：${escapeHtml(stats.error || "未知错误")}`
        ].join("\n")).catch(() => {});
        return;
    }
    if (stats.status === "no_chapters") {
        await editMessage(message.chat.id, progress.message_id, [
            "已共享书籍信息，但本地没有正文缓存。",
            `书籍：${escapeHtml(shareBookTitle(stats.book))}`,
            "如果这是 PO18 已购书，请先 /po18set 账号 密码，再 /loginpo18 后重试。"
        ].join("\n")).catch(() => {});
        return;
    }
    if (stats.status === "cached") {
        await editMessage(message.chat.id, progress.message_id, `正文已是最新。\n共 ${stats.total} 章，跳过 ${stats.skipped} 章。`).catch(() => {});
        return;
    }

    await editMessage(message.chat.id, progress.message_id, [
        "正文上传完成。",
        `书籍：${escapeHtml(shareBookTitle(stats.book))}`,
        `新增 ${stats.uploaded} 章 / 可奖励付费新增 ${stats.rewardableUploaded || 0} 章`,
        `跳过 ${stats.skipped} 章 / 失败 ${stats.failed} 章`
    ].join("\n")).catch(() => {});
}

function bulkShareProgressText(summary, state = null) {
    const lines = [
        "<b>PO18 已购书架上传共享</b>",
        `进度：${summary.done}/${summary.total}`,
        `成功：${summary.successBooks} 本 / 奖励：${summary.rewardCopper} 铜币`,
        `新增：${summary.uploadedChapters} 章 / 可奖励付费新增：${summary.rewardableChapters} 章`,
        `跳过：${summary.skippedChapters} 章 / 失败章节：${summary.failedChapters} 章`,
        `失败书籍：${summary.failedBooks} 本`
    ];
    if (state?.book) {
        lines.push("", `当前：${escapeHtml(shareBookTitle(state.book))}（${escapeHtml(shareBookId(state.book))}）`);
        if (state.phase === "po18") lines.push("状态：正在用 PO18 登录态拉取已购章节");
        else if (state.phase === "cache") lines.push(`状态：检查共享缓存（共 ${state.total || 0} 章）`);
        else if (state.phase === "upload") lines.push(`状态：上传 ${state.current}/${state.uploadTotal}，本书已上传 ${state.uploaded} 章，可奖励 ${state.rewardableUploaded || 0} 章`);
        else lines.push("状态：准备书籍信息");
    }
    return lines.join("\n");
}

async function handleShareBookshelf(message) {
    await ensureRegistered(message.from);
    const account = await client.po18Account(message.from.id);
    if (!account.cookies?.length || !hasPo18Auth(account.cookies)) return sendMessage(message.chat.id, "还没绑定 PO18 账号，先 /po18set 账号 密码，再 /loginpo18。");
    const progress = await sendMessage(message.chat.id, `正在拉取你的 PO18 书架（账号：${escapeHtml(account.account || "?")}），准备上传共享...`);
    const books = await fetchPo18Bookshelf(account.cookies);
    if (!books.length) {
        await editMessage(message.chat.id, progress.message_id, "没拉到已购书籍。要么书架是空的，要么 Cookie 失效了。").catch(() => {});
        return { total: 0 };
    }

    for (const book of books) {
        await client.addBookshelf(message.from.id, book.book_id).catch(() => {});
    }

    const summary = {
        total: books.length,
        done: 0,
        successBooks: 0,
        failedBooks: 0,
        rewardedBooks: 0,
        rewardCopper: 0,
        uploadedChapters: 0,
        rewardableChapters: 0,
        skippedChapters: 0,
        failedChapters: 0
    };
    let lastEditAt = 0;
    const editProgress = async (state = null, force = false) => {
        const now = Date.now();
        if (!force && now - lastEditAt < 2500) return;
        lastEditAt = now;
        await editMessage(message.chat.id, progress.message_id, bulkShareProgressText(summary, state)).catch(() => {});
    };

    await editProgress(null, true);
    for (const book of books) {
        let stats;
        try {
            stats = await shareBookForUser(message, book, {
                account,
                onProgress: (state) => editProgress(state, false)
            });
        } catch (err) {
            stats = {
                book: normalizeShareBook(book),
                status: "failed",
                error: err.message || String(err),
                total: 0,
                uploaded: 0,
                rewardableUploaded: 0,
                skipped: 0,
                failed: 0
            };
        }

        summary.done += 1;
        summary.uploadedChapters += Number(stats.uploaded || 0);
        summary.rewardableChapters += Number(stats.rewardableUploaded || 0);
        summary.skippedChapters += Number(stats.skipped || 0);
        summary.failedChapters += Number(stats.failed || 0);
        if (Number(stats.uploaded || 0) > 0) summary.successBooks += 1;
        if (stats.status === "failed" || stats.status === "metadata_failed" || stats.status === "chapter_fetch_failed" || stats.status === "no_chapters") summary.failedBooks += 1;

        if (Number(stats.rewardableUploaded || 0) > PO18_BOOKSHELF_SHARE_REWARD_MIN_CHAPTERS && PO18_BOOKSHELF_SHARE_REWARD_COPPER > 0) {
            try {
                await client.addCurrency(
                    message.from.id,
                    "copper",
                    PO18_BOOKSHELF_SHARE_REWARD_COPPER,
                    "po18_bookshelf_share_reward",
                    `${shareBookId(stats.book)} paid_uploaded=${stats.rewardableUploaded} uploaded=${stats.uploaded} tgid=${message.from.id}`
                );
                summary.rewardedBooks += 1;
                summary.rewardCopper += PO18_BOOKSHELF_SHARE_REWARD_COPPER;
            } catch (err) {
                console.warn(`[share-bookshelf] reward failed ${shareBookId(stats.book)}: ${err.message || String(err)}`);
            }
        }
        await client.recordUserEvent(
            message.from.id,
            "po18_bookshelf_share",
            `${shareBookId(stats.book)} status=${stats.status} uploaded=${stats.uploaded || 0} paid_uploaded=${stats.rewardableUploaded || 0} skipped=${stats.skipped || 0} failed=${stats.failed || 0}`
        ).catch(() => {});
        await editProgress({ phase: "done", book: stats.book }, true);
    }

    await editMessage(message.chat.id, progress.message_id, [
        "<b>PO18 已购书架上传共享完成</b>",
        `处理：${summary.done}/${summary.total} 本`,
        `成功新增：${summary.successBooks} 本 / 失败：${summary.failedBooks} 本`,
        `新增章节：${summary.uploadedChapters} / 可奖励付费新增：${summary.rewardableChapters}`,
        `跳过：${summary.skippedChapters} / 失败章节：${summary.failedChapters}`,
        `奖励：${summary.rewardedBooks} 本，合计 ${summary.rewardCopper} 铜币`,
        `奖励规则：单本本次新增付费章节 > ${PO18_BOOKSHELF_SHARE_REWARD_MIN_CHAPTERS} 章奖励 ${PO18_BOOKSHELF_SHARE_REWARD_COPPER} 铜币；免费章节和已有章节不计入。`
    ].join("\n")).catch(() => {});
    return summary;
}

async function handleMessage(message) {
    const text = message.text || message.caption || "";
    if (!text) return;
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
    if (!["like", "dislike", "cvote", "sreq", "rvup", "rvdn"].includes(action)) await answerCallback(query.id);
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
    if (action === "epub") return withBotAudit(callbackMessage, "/exportepub", "export_epub_callback", { book_id: a }, () => withCooldown(callbackMessage, "export", BOT_EXPORT_COOLDOWN_MS, "导出", () => scheduleExport(message.chat, query.from, a, "epub")));
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
    if (update.message) return handleMessage(update.message);
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
    }
});

startBotHealthServer({
    port: BOT_HEALTH_PORT,
    host: BOT_HEALTH_HOST,
    staleMs: BOT_HEALTH_STALE_MS,
    startedAt: STARTED_AT,
    telegramApiBase: TELEGRAM_API_BASE,
    client,
    botTaskQueue,
    rateLimiter,
    stateProvider: botRuntime.state
});

botRuntime.runForever();













