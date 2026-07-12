/**
 * [INPUT]: 依赖 Node HTTPS、根级系统推送标记契约、config 平台标签、事件查询器与 Telegram Bot API 配置
 * [OUTPUT]: 对外提供带跨进程标记的 Telegram 推送服务、注册用户收件人分页/计数、类型过滤、消息转义、原文链接和日报时间窗口函数
 * [POS]: services 的 Telegram 通知适配层，把上传事件与注册用户范围转为可由 Bot 安全消费的群组推送、日报及全员通知边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const https = require("https");
const { TELEGRAM_SYSTEM_PUSH_MARKER, markTelegramSystemPush } = require("../telegram-push-contract");
const { DEFAULT_PLATFORM_LABELS, normalizePlatformKey } = require("./config");

const TELEGRAM_CAPTION_LIMIT = 1024;
const TELEGRAM_CAPTION_CONTENT_LIMIT = TELEGRAM_CAPTION_LIMIT - TELEGRAM_SYSTEM_PUSH_MARKER.length;

const TELEGRAM_PUSH_TYPE_ALIASES = {
    meta: "metadata",
    metadata: "metadata",
    "元信息": "metadata",
    chapter: "chapter",
    chapters: "chapter",
    chapter_update: "chapter",
    chapter_updates: "chapter",
    chapterupdate: "chapter",
    chapterupdates: "chapter",
    "章节": "chapter",
    "章节更新": "chapter",
    daily: "daily",
    daily_report: "daily",
    dailyreport: "daily",
    "日报": "daily",
    review: "review",
    reviews: "review",
    book_review: "review",
    book_reviews: "review",
    "书评": "review"
};

function telegramHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function shortenText(value = "", max = 160) {
    const text = String(value || "").trim();
    if (!Number.isFinite(Number(max)) || max <= 3) return text;
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function plainText(value = "") {
    return String(value || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p\s*>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

function formatMetadataTags(value = "", max = 12) {
    const source = Array.isArray(value) ? value : String(value || "").split(/[\s,，、;；|/]+/);
    const tags = [];
    for (const item of source) {
        const tag = String(item || "").trim().replace(/^#+/, "");
        if (tag && !tags.includes(tag)) tags.push(tag);
        if (tags.length >= max) break;
    }
    return tags.join(" / ");
}

function fitEscapedText(value = "", max = 160) {
    const limit = Math.max(0, Math.floor(Number(max) || 0));
    const text = String(value || "").trim();
    if (telegramHtml(text).length <= limit) return text;
    if (limit <= 3) return "";
    let result = "";
    for (const char of Array.from(text)) {
        const next = `${result}${char}`;
        if (telegramHtml(`${next}...`).length > limit) break;
        result = next;
    }
    return result ? `${result}...` : "";
}

function httpUrl(value = "", base = "") {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^\/\//.test(raw)) return `https:${raw}`;
    const baseUrl = String(base || "").trim();
    if (raw.startsWith("/") && /^https?:\/\//i.test(baseUrl)) {
        try {
            return new URL(raw, baseUrl).toString();
        } catch {}
    }
    return "";
}

function readerBookDetailUrl(bookId, publicUrl = "") {
    const id = String(bookId || "").trim();
    const base = String(publicUrl || process.env.PO18_READER_PUBLIC_URL || process.env.READER_PUBLIC_URL || "").trim().replace(/\/+$/, "");
    if (!id || !/^https?:\/\//i.test(base)) return "";
    return `${base}/#/detail?bid=${encodeURIComponent(id)}`;
}

function platformDisplayName(platform = "", labels = {}) {
    const raw = String(platform || "").trim();
    if (!raw) return "-";
    const merged = { ...DEFAULT_PLATFORM_LABELS, ...(labels || {}) };
    if (merged[raw]) return merged[raw];
    const key = normalizePlatformKey(raw);
    const found = Object.entries(merged).find(([value]) => normalizePlatformKey(value) === key);
    return found?.[1] || raw;
}

function metadataCardCaption(event = {}, book = {}, labels = {}) {
    const title = shortenText(book?.title || event.title || event.book_id || "-", 80);
    const author = shortenText(book?.author || event.author || "-", 50);
    const platform = shortenText(platformDisplayName(book?.platform || event.platform || "", labels), 40);
    const category = shortenText(book?.category || event.category || "-", 50);
    const status = shortenText(book?.status || event.status || "-", 24);
    const tags = shortenText(formatMetadataTags(book?.tags || event.tags || ""), 90);
    const headerLines = [
        `<b>${telegramHtml("\u4e66\u540d")}：${telegramHtml(title)}</b>`,
        `${telegramHtml("\u4f5c\u8005")}：${telegramHtml(author)}`,
        `${telegramHtml("\u5e73\u53f0")}：${telegramHtml(platform)}`,
        `${telegramHtml("\u5206\u7c7b")}：${telegramHtml(category)}`,
        `${telegramHtml("\u72b6\u6001")}：${telegramHtml(status)}`,
        `${telegramHtml("\u6807\u7b7e")}：${telegramHtml(tags || "-")}`,
        "",
        `${telegramHtml("\u7b80\u4ecb")}：`
    ];
    const header = headerLines.join("\n");
    const quoteOpen = "<blockquote expandable>";
    const quoteClose = "</blockquote>";
    const rawDescription = plainText(book?.description || book?.description_html || event.description || "");
    const descriptionBudget = Math.max(80, TELEGRAM_CAPTION_CONTENT_LIMIT - header.length - quoteOpen.length - quoteClose.length - 1);
    const description = fitEscapedText(rawDescription || "-", descriptionBudget);
    return `${header}\n${quoteOpen}${telegramHtml(description || "-")}${quoteClose}`;
}

function metadataCardMarkup(event = {}, book = {}, readerPublicUrl = "") {
    const bookId = String(event.book_id || book?.book_id || "").trim();
    const detailUrl = httpUrl(book?.detail_url || event.source || "", event.source || "");
    const readerUrl = readerBookDetailUrl(bookId, readerPublicUrl);
    const row = [];
    if (readerUrl) row.push({ text: "\u9605\u8bfb\u5668\u8be6\u60c5", url: readerUrl });
    if (detailUrl) row.push({ text: "\u539f\u7ad9\u94fe\u63a5", url: detailUrl });
    return row.length ? { inline_keyboard: [row] } : undefined;
}

function normalizeTelegramPushType(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const key = raw.replace(/[-\s]+/g, "_").toLowerCase();
    return TELEGRAM_PUSH_TYPE_ALIASES[key] || TELEGRAM_PUSH_TYPE_ALIASES[raw] || "";
}

function parseTelegramPushTypes(value) {
    let items = [];
    if (Array.isArray(value)) {
        items = value;
    } else if (value && typeof value === "object") {
        items = Object.entries(value).filter(([, enabled]) => !!enabled).map(([key]) => key);
    } else {
        const text = String(value || "").trim();
        if (!text) return [];
        try {
            const parsed = JSON.parse(text);
            return parseTelegramPushTypes(parsed);
        } catch {}
        items = text.split(/[\s,;，；|]+/);
    }
    const selected = [];
    for (const item of items) {
        const type = normalizeTelegramPushType(item);
        if (type && !selected.includes(type)) selected.push(type);
    }
    return selected;
}

function telegramPushTypeEnabled(config, type) {
    return !!config?.enabled && Array.isArray(config.pushTypes) && config.pushTypes.includes(type);
}

function originalChapterUrl(event, book = null) {
    const bookId = encodeURIComponent(String(event.book_id || ""));
    const chapterId = encodeURIComponent(String(event.chapter_id || ""));
    const detailUrl = String(book?.detail_url || "").trim();
    if (detailUrl && /^https?:\/\//i.test(detailUrl)) {
        const base = detailUrl.replace(/\/articles(?:\/.*)?$/i, "");
        if (base) return `${base}/articles/${chapterId}`;
    }
    return `https://www.po18.tw/books/${bookId}/articles/${chapterId}`;
}

function dailyReportDateParts(date = new Date()) {
    const china = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    return {
        year: china.getUTCFullYear(),
        month: china.getUTCMonth() + 1,
        day: china.getUTCDate(),
        hour: china.getUTCHours(),
        minute: china.getUTCMinutes()
    };
}

function dailyReportDateString(date = new Date()) {
    const parts = dailyReportDateParts(date);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function sqlTimestamp(date) {
    return date.toISOString().slice(0, 19).replace("T", " ");
}

function dailyReportRange(dateString = dailyReportDateString()) {
    const [year, month, day] = String(dateString).split("-").map(Number);
    const start = new Date(Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start: sqlTimestamp(start), end: sqlTimestamp(end) };
}

function parseDailyReportTime(value = "") {
    const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return { value: "22:00", hour: 22, minute: 0 };
    const hour = Math.max(0, Math.min(23, Number(match[1])));
    const minute = Math.max(0, Math.min(59, Number(match[2])));
    return { value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, hour, minute };
}

function splitChatIds(value = "") {
    return String(value || "")
        .split(/[\s,;，；]+/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function telegramApiUrl(token, method, base = process.env.TELEGRAM_API_BASE || "https://api.telegram.org") {
    return `${String(base || "https://api.telegram.org").replace(/\/+$/, "")}/bot${token}/${method}`;
}

function postJson(url, body) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => (res.statusCode >= 200 && res.statusCode < 300 ? resolve(data) : reject(new Error(`HTTP ${res.statusCode}: ${data}`))));
        });
        req.on("error", reject);
        req.write(JSON.stringify(body));
        req.end();
    });
}

function missingDependency(name) {
    return async () => {
        throw new Error(`${name} is not configured`);
    };
}

function createTelegramPushService(options = {}) {
    const query = options.query || missingDependency("query");
    const configGet = options.configGet || (async () => "");
    const configSet = options.configSet || (async () => {});
    const latestBookMetadata = options.latestBookMetadata || (async () => null);
    const tokenProvider = options.tokenProvider || (async () => configGet("telegram_bot_token"));
    const labelsProvider = options.labelsProvider || (async () => ({}));
    const readerPublicUrlProvider = options.readerPublicUrlProvider || (() => process.env.PO18_READER_PUBLIC_URL || process.env.READER_PUBLIC_URL || "");
    const sendJson = options.postJson || postJson;
    const sendDelayMs = Number.isFinite(Number(options.sendDelayMs)) ? Math.max(0, Number(options.sendDelayMs)) : 300;
    const logger = options.logger || console;

    async function telegramPushConfig() {
        const [enabled, pushTypes] = await Promise.all([
            configGet("telegram_enabled"),
            configGet("telegram_push_types")
        ]);
        return {
            enabled: enabled === "1",
            // Backward compatibility: old installations only had the global switch,
            // which meant "push chapter updates".
            pushTypes: pushTypes ? parseTelegramPushTypes(pushTypes) : (enabled === "1" ? ["chapter"] : [])
        };
    }

    async function reserveMetadataPush(event = {}, book = {}) {
        const bookId = String(event.book_id || book?.book_id || "").trim();
        if (!bookId) return { reserved: true, bookId: "", eventId: null };
        const eventId = event.id ? Number(event.id) : null;
        const platform = String(book?.platform || event.platform || "").trim();
        const result = await query(
            `INSERT INTO telegram_metadata_pushes(book_id, platform, event_id, created_at, updated_at)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT (platform, book_id) DO NOTHING
             RETURNING book_id`,
            [bookId, platform, eventId]
        );
        return { reserved: result.rows.length > 0, bookId, eventId, platform };
    }

    async function markMetadataPushSent(reservation = {}, method = "") {
        if (!reservation.bookId) return;
        await query(
            `UPDATE telegram_metadata_pushes
             SET message_method = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE book_id = $1 AND platform = $3`,
            [reservation.bookId, String(method || "").trim(), reservation.platform || ""]
        );
    }

    async function releaseMetadataPushReservation(reservation = {}) {
        if (!reservation.bookId) return;
        await query(
            `DELETE FROM telegram_metadata_pushes
             WHERE book_id = $1
               AND platform = $3
               AND (event_id = $2 OR ($2::bigint IS NULL AND event_id IS NULL))`,
            [reservation.bookId, reservation.eventId, reservation.platform || ""]
        );
    }

    async function notifyTelegram(event) {
        const eventType = String(event.event_type || "");
        if (!["metadata", "chapter"].includes(eventType)) return;
        const [pushConfig, token, chatId] = await Promise.all([
            telegramPushConfig(),
            configGet("telegram_bot_token"),
            configGet("telegram_chat_id")
        ]);
        if (!telegramPushTypeEnabled(pushConfig, eventType) || !token || !chatId) return;
        const book = await latestBookMetadata(event.book_id);
        const bookTitle = book?.title || event.book_id || "";
        let text = "";
        if (eventType === "chapter") {
            const chapterTitle = event.title || event.chapter_id || "";
            const chapterUrl = originalChapterUrl(event, book);
            text = markTelegramSystemPush([
                `章节更新: ${telegramHtml(bookTitle)}`,
                `章节名: ${telegramHtml(chapterTitle)}`,
                `章节链接: <a href="${telegramHtml(chapterUrl)}">${telegramHtml(chapterUrl)}</a>`
            ].join("\n"));
            await sendJson(telegramApiUrl(token, "sendMessage"), { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true });
        } else {
            const reservation = await reserveMetadataPush(event, book);
            if (!reservation.reserved) {
                await query("UPDATE upload_events SET telegram_status = 'skipped' WHERE id = $1", [event.id]);
                return;
            }
            const [labels, readerPublicUrl] = await Promise.all([
                labelsProvider().catch(() => ({})),
                Promise.resolve(readerPublicUrlProvider()).catch(() => "")
            ]);
            const caption = markTelegramSystemPush(metadataCardCaption(event, book, labels));
            const replyMarkup = metadataCardMarkup(event, book, readerPublicUrl);
            const coverUrl = httpUrl(book?.cover || event.cover || "", book?.detail_url || event.source || "");
            const basePayload = {
                chat_id: chatId,
                parse_mode: "HTML",
                ...(replyMarkup ? { reply_markup: replyMarkup } : {})
            };
            let method = "sendMessage";
            try {
                if (coverUrl) {
                    try {
                        method = "sendPhoto";
                        await sendJson(telegramApiUrl(token, "sendPhoto"), { ...basePayload, photo: coverUrl, caption });
                    } catch (err) {
                        logger.warn(`[telegram] metadata photo push failed, fallback to text: ${err.message}`);
                        method = "sendMessage";
                        await sendJson(telegramApiUrl(token, "sendMessage"), { ...basePayload, text: caption, disable_web_page_preview: true });
                    }
                } else {
                    await sendJson(telegramApiUrl(token, "sendMessage"), { ...basePayload, text: caption, disable_web_page_preview: true });
                }
            } catch (err) {
                await releaseMetadataPushReservation(reservation).catch((releaseErr) => {
                    logger.warn(`[telegram] metadata push reservation release failed: ${releaseErr.message}`);
                });
                throw err;
            }
            try {
                await markMetadataPushSent(reservation, method);
            } catch (err) {
                logger.warn(`[telegram] metadata push record update failed: ${err.message}`);
            }
        }
        await query("UPDATE upload_events SET telegram_status = 'sent' WHERE id = $1", [event.id]);
    }

    async function dailyReportConfig() {
        const [enabled, time, adminIds, lastDate] = await Promise.all([
            configGet("telegram_daily_report_enabled"),
            configGet("telegram_daily_report_time"),
            configGet("telegram_daily_report_admin_ids"),
            configGet("telegram_daily_report_last_date")
        ]);
        const parsedTime = parseDailyReportTime(time || process.env.PO18_DAILY_REPORT_TIME || "22:00");
        return {
            enabled: enabled !== "0",
            time: parsedTime.value,
            hour: parsedTime.hour,
            minute: parsedTime.minute,
            adminIds: adminIds || "",
            lastDate: lastDate || ""
        };
    }

    async function dailyReportRecipients(config = null) {
        const reportConfig = config || await dailyReportConfig();
        const configured = splitChatIds(reportConfig.adminIds);
        if (configured.length) return configured;
        const result = await query(
            `SELECT telegram_id
             FROM reader_users
             WHERE COALESCE(is_admin, FALSE) = TRUE
               AND COALESCE(is_banned, FALSE) = FALSE
               AND COALESCE(telegram_id, '') <> ''
             ORDER BY id`
        );
        return [...new Set(result.rows.map((row) => String(row.telegram_id || "").trim()).filter(Boolean))];
    }

    async function registeredUserRecipients({ afterId = 0, limit = 100 } = {}) {
        const safeAfterId = Math.max(0, Math.trunc(Number(afterId || 0)));
        const safeLimit = Math.max(1, Math.min(500, Math.trunc(Number(limit || 100))));
        const result = await query(
            `SELECT id, telegram_id
             FROM reader_users
             WHERE id > $1
               AND COALESCE(is_banned, FALSE) = FALSE
               AND COALESCE(telegram_id, '') <> ''
             ORDER BY id ASC
             LIMIT $2`,
            [safeAfterId, safeLimit + 1]
        );
        const rows = result.rows.slice(0, safeLimit).map((row) => ({ id: Number(row.id), telegram_id: String(row.telegram_id || "").trim() }));
        return { rows, has_more: result.rows.length > safeLimit };
    }

    async function countRegisteredUserRecipients() {
        const result = await query(
            `SELECT COUNT(DISTINCT telegram_id)::int count
             FROM reader_users
             WHERE COALESCE(is_banned, FALSE) = FALSE
               AND COALESCE(telegram_id, '') <> ''`
        );
        return Number(result.rows[0]?.count || 0);
    }

    async function channelDailyReportRecipients() {
        const [pushConfig, chatId] = await Promise.all([
            telegramPushConfig(),
            configGet("telegram_chat_id")
        ]);
        if (!telegramPushTypeEnabled(pushConfig, "daily") || !chatId) return [];
        return splitChatIds(chatId);
    }

    async function collectDailyReport(dateString = dailyReportDateString()) {
        const range = dailyReportRange(dateString);
        const params = [range.start, range.end, dateString];
        const [summary, topUploaders] = await Promise.all([
            query(
                `WITH active_users AS (
                    SELECT user_id::text uid FROM reader_history WHERE updated_at >= $1::timestamp AND updated_at < $2::timestamp
                    UNION SELECT user_id::text FROM reader_transactions WHERE created_at >= $1::timestamp AND created_at < $2::timestamp
                    UNION SELECT user_id::text FROM reader_book_feedback WHERE updated_at >= $1::timestamp AND updated_at < $2::timestamp
                    UNION SELECT user_id::text FROM reader_book_crowd_votes WHERE created_at >= $1::timestamp AND created_at < $2::timestamp
                    UNION SELECT user_id::text FROM reader_corrections WHERE updated_at >= $1::timestamp AND updated_at < $2::timestamp
                    UNION SELECT id::text FROM reader_users WHERE last_login_at >= $1::timestamp AND last_login_at < $2::timestamp
                    UNION SELECT id::text FROM reader_users WHERE last_sign_date = $3::date
                 )
                 SELECT
                    (SELECT COUNT(DISTINCT book_id)::int FROM book_metadata WHERE created_at >= $1::timestamp AND created_at < $2::timestamp) new_books,
                    (SELECT COUNT(*)::int FROM chapter_cache WHERE created_at >= $1::timestamp AND created_at < $2::timestamp) new_chapters,
                    (SELECT COUNT(*)::int FROM upload_events WHERE event_type = 'metadata' AND created_at >= $1::timestamp AND created_at < $2::timestamp) metadata_events,
                    (SELECT COUNT(DISTINCT book_id)::int FROM book_metadata WHERE updated_at >= $1::timestamp AND updated_at < $2::timestamp) metadata_books,
                    (SELECT COUNT(*)::int FROM upload_events WHERE created_at >= $1::timestamp AND created_at < $2::timestamp) upload_events,
                    (SELECT COUNT(*)::int FROM upload_events WHERE event_type = 'chapter' AND created_at >= $1::timestamp AND created_at < $2::timestamp) chapter_events,
                    (SELECT COUNT(DISTINCT uid)::int FROM active_users WHERE COALESCE(uid, '') <> '') active_users,
                    (SELECT COUNT(*)::int FROM reader_users WHERE last_sign_date = $3::date) signed_users,
                    (SELECT COUNT(*)::int FROM reader_users WHERE created_at >= $1::timestamp AND created_at < $2::timestamp) new_users,
                    (SELECT COUNT(*)::int FROM reader_transactions WHERE created_at >= $1::timestamp AND created_at < $2::timestamp) transactions,
                    (SELECT COUNT(*)::int FROM reader_corrections WHERE created_at >= $1::timestamp AND created_at < $2::timestamp) corrections,
                    (SELECT COUNT(DISTINCT book_id)::int FROM book_metadata) total_books,
                    (SELECT COUNT(*)::int FROM chapter_cache) total_chapters,
                    (SELECT COUNT(*)::int FROM book_metadata) total_metadata,
                    (SELECT COUNT(*)::int FROM reader_users) total_users,
                    (SELECT COUNT(*)::int FROM upload_events WHERE event_type = 'chapter' AND telegram_status = 'pending') pending_telegram`,
                params
            ),
            query(
                `SELECT COALESCE(NULLIF(uploader, ''), '-') uploader, COUNT(*)::int count
                 FROM chapter_cache
                 WHERE created_at >= $1::timestamp AND created_at < $2::timestamp
                 GROUP BY COALESCE(NULLIF(uploader, ''), '-')
                 ORDER BY count DESC, uploader ASC
                 LIMIT 5`,
                [range.start, range.end]
            )
        ]);
        return { date: dateString, ...summary.rows[0], topUploaders: topUploaders.rows };
    }

    function formatDailyReport(report) {
        const topUploaders = (report.topUploaders || [])
            .map((row, index) => `${index + 1}. ${telegramHtml(row.uploader)} ${Number(row.count || 0)}`)
            .join("\n");
        return [
            `PO18 管理日报 ${telegramHtml(report.date)}`,
            "",
            `今日新增书籍: ${Number(report.new_books || 0)}`,
            `今日新增章节: ${Number(report.new_chapters || 0)}`,
            `今日元信息事件: ${Number(report.metadata_events || 0)}`,
            `今日元信息涉及书类: ${Number(report.metadata_books || 0)}`,
            `今日活跃人数: ${Number(report.active_users || 0)}`,
            `今日签到人数: ${Number(report.signed_users || 0)}`,
            `今日新增用户: ${Number(report.new_users || 0)}`,
            `今日上传事件: ${Number(report.upload_events || 0)} / 章节事件 ${Number(report.chapter_events || 0)}`,
            `今日交易: ${Number(report.transactions || 0)}`,
            `今日纠错提交: ${Number(report.corrections || 0)}`,
            "",
            `总书类: ${Number(report.total_books || 0)}`,
            `总章节: ${Number(report.total_chapters || 0)}`,
            `总元信息: ${Number(report.total_metadata || 0)}`,
            `总用户: ${Number(report.total_users || 0)}`,
            `待发送章节推送: ${Number(report.pending_telegram || 0)}`,
            topUploaders ? `\n今日上传者TOP:\n${topUploaders}` : ""
        ].filter((line) => line !== "").join("\n");
    }

    async function sendDailyReport({ force = false } = {}) {
        const reportConfig = await dailyReportConfig();
        if (!force && !reportConfig.enabled) return { skipped: "disabled" };
        const token = await tokenProvider();
        if (!token) return { skipped: "missing_token" };
        const recipients = [...new Set([
            ...(await dailyReportRecipients(reportConfig)),
            ...(await channelDailyReportRecipients())
        ])];
        if (!recipients.length) return { skipped: "missing_recipients" };
        const date = dailyReportDateString();
        const report = await collectDailyReport(date);
        const text = markTelegramSystemPush(formatDailyReport(report));
        const results = [];
        for (const chatId of recipients) {
            try {
                await sendJson(telegramApiUrl(token, "sendMessage"), { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true });
                results.push({ chatId, ok: true });
            } catch (err) {
                results.push({ chatId, ok: false, error: err.message });
            }
            if (sendDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, sendDelayMs));
        }
        if (!force && results.some((item) => item.ok)) {
            await configSet("telegram_daily_report_last_date", date);
        }
        return { date, recipients: recipients.length, sent: results.filter((item) => item.ok).length, results };
    }

    async function sendDirectMessage(chatId, text, options = {}) {
        const token = await tokenProvider();
        if (!token) throw new Error("telegram bot token is not configured");
        const payload = {
            chat_id: String(chatId || "").trim(),
            text: String(text || ""),
            parse_mode: options.parseMode || "HTML",
            disable_web_page_preview: options.disableWebPagePreview !== false
        };
        if (!payload.chat_id) throw new Error("telegram chat id is required");
        if (options.replyMarkup) payload.reply_markup = options.replyMarkup;
        return sendJson(telegramApiUrl(token, "sendMessage"), payload);
    }

    async function maybeSendDailyReport() {
        try {
            const reportConfig = await dailyReportConfig();
            if (!reportConfig.enabled) return;
            const now = dailyReportDateParts();
            const today = dailyReportDateString();
            if (reportConfig.lastDate === today) return;
            if (now.hour !== reportConfig.hour || now.minute !== reportConfig.minute) return;
            const result = await sendDailyReport();
            logger.log(`[daily-report] ${today} sent ${result.sent || 0}/${result.recipients || 0}`);
        } catch (err) {
            logger.warn(`[daily-report] ${err.message}`);
        }
    }

    function startDailyReportScheduler() {
        maybeSendDailyReport();
        return setInterval(maybeSendDailyReport, 60 * 1000);
    }

    return {
        channelDailyReportRecipients,
        collectDailyReport,
        countRegisteredUserRecipients,
        dailyReportConfig,
        dailyReportRecipients,
        formatDailyReport,
        maybeSendDailyReport,
        notifyTelegram,
        postJson: sendJson,
        registeredUserRecipients,
        sendDirectMessage,
        sendDailyReport,
        startDailyReportScheduler,
        telegramPushConfig
    };
}

module.exports = {
    TELEGRAM_PUSH_TYPE_ALIASES,
    createTelegramPushService,
    dailyReportDateParts,
    dailyReportDateString,
    dailyReportRange,
    normalizeTelegramPushType,
    originalChapterUrl,
    parseDailyReportTime,
    parseTelegramPushTypes,
    postJson,
    splitChatIds,
    telegramApiUrl,
    telegramHtml,
    telegramPushTypeEnabled
};
