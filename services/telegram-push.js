const https = require("https");

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
    "日报": "daily"
};

function telegramHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
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
            text = [
                `章节更新: ${telegramHtml(bookTitle)}`,
                `章节名: ${telegramHtml(chapterTitle)}`,
                `章节链接: <a href="${telegramHtml(chapterUrl)}">${telegramHtml(chapterUrl)}</a>`
            ].join("\n");
        } else {
            const detailUrl = String(book?.detail_url || event.source || "").trim();
            text = [
                `元信息更新: ${telegramHtml(bookTitle)}`,
                `书籍ID: ${telegramHtml(event.book_id || "-")}`,
                `站点: ${telegramHtml(book?.platform || event.platform || "-")}`,
                /^https?:\/\//i.test(detailUrl) ? `书籍链接: <a href="${telegramHtml(detailUrl)}">${telegramHtml(detailUrl)}</a>` : ""
            ].filter(Boolean).join("\n");
        }
        await sendJson(telegramApiUrl(token, "sendMessage"), { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true });
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
        const text = formatDailyReport(report);
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
        dailyReportConfig,
        dailyReportRecipients,
        formatDailyReport,
        maybeSendDailyReport,
        notifyTelegram,
        postJson: sendJson,
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
