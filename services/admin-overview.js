const fs = require("fs/promises");

function parseSlowLogLines(text, limit = 20) {
    return String(text || "")
        .split(/\r?\n/)
        .map((line) => {
            const match = line.match(/(\d+(?:\.\d+)?)\s*ms\b/i);
            if (!match) return null;
            return { ms: Number(match[1]), line: line.slice(0, 600) };
        })
        .filter((item) => item && Number.isFinite(item.ms))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, limit);
}

function topFailureReasons(lines, limit = 8) {
    const counts = new Map();
    for (const line of lines || []) {
        const matched = String(line || "").match(/(?:failed|error|timeout|429|403|401)[:\s-]+(.+)$/i);
        if (!matched) continue;
        const reason = matched[1].replace(/\s+/g, " ").slice(0, 160);
        counts.set(reason, (counts.get(reason) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([reason, count]) => ({ reason, count }));
}

function createAdminOverviewService(options = {}) {
    const query = options.query || (async () => ({ rows: [] }));
    const configGet = options.configGet || (async () => "");
    const healthService = options.healthService || {};
    const backupListPayload = options.backupListPayload || (async () => ({ rows: [] }));
    const collectSystemJobInfo = options.collectSystemJobInfo || (async () => ({}));
    const filterLogText = options.filterLogText || ((text) => String(text || ""));
    const readLogTail = options.readLogTail || (() => "");
    const readJsonLinesTail = options.readJsonLinesTail || (() => []);
    const topSlowRequests = options.topSlowRequests || (() => []);
    const listBotAuditLogs = options.listBotAuditLogs;
    const collectBotAuditSummary = options.collectBotAuditSummary;
    const runtimeLogFile = options.runtimeLogFile || process.env.PO18_RUNTIME_LOG_FILE || "/config/runtime.log";
    const requestLogFile = options.requestLogFile || process.env.PO18_REQUEST_LOG_FILE || "/config/logs/requests.jsonl";
    const slowLogFile = options.slowLogFile || process.env.PO18_SLOW_LOG_FILE || "/config/logs/slow-requests.jsonl";
    const configFile = options.configFile || process.env.PO18_CONFIG_FILE || "/config/app.env";
    const backupDir = options.backupDir || process.env.PO18_BACKUP_DIR || "/config/backups";
    const sessionSecretProvider = options.sessionSecretProvider || (() => process.env.PO18_UPLOAD_SESSION_SECRET || "po18-upload-pg-change-me");
    const defaultPasswordProvider = options.defaultPasswordProvider || (() => process.env.PO18_UPLOAD_ADMIN_PASSWORD || "admin123");
    const uploadApiTokenProvider = options.uploadApiTokenProvider || (() => process.env.PO18_UPLOAD_API_TOKEN || "");
    const requestSlowMsProvider = options.requestSlowMsProvider || (() => Number(process.env.PO18_SLOW_REQUEST_MS || 800));

    function structuredSlowRequests(limit = 20) {
        const rows = topSlowRequests(slowLogFile, limit);
        return rows.map((item) => ({
            ...item,
            line: `${item.method || "-"} ${item.path || "-"} status=${item.status || "-"} service=${item.service || "-"} request_id=${item.request_id || "-"}`
        }));
    }

    function recentStructuredErrors(limit = 20) {
        return readJsonLinesTail(requestLogFile, { limit: 500, maxBytes: 512000 })
            .filter((item) => item.level === "error" || Number(item.status || 0) >= 500)
            .slice(-limit)
            .reverse()
            .map((item) => `${item.ts || ""} ${item.service || ""} ${item.method || ""} ${item.path || ""} status=${item.status || ""} ${item.request_id || ""}`.trim());
    }

    function slowRequestsOverview(logTail, limit = 20) {
        const structured = structuredSlowRequests(limit);
        if (structured.length) return structured;
        return parseSlowLogLines(logTail, limit);
    }

    function recentBotLogLines(limit = 40) {
        return filterLogText(readLogTail(runtimeLogFile, 160000), "bot")
            .split(/\r?\n/)
            .filter(Boolean)
            .slice(-limit)
            .reverse();
    }

    function formatBotAuditLine(row = {}) {
        const time = String(row.created_at || "").slice(0, 19).replace("T", " ");
        const user = row.telegram_username ? `@${row.telegram_username}` : row.telegram_id || "-";
        const status = row.status || "-";
        const duration = row.duration_ms ? `${row.duration_ms}ms` : "-";
        const command = row.command || row.action || "-";
        const reason = row.status === "failed" ? ` ${row.error_code || row.error || "failed"}` : "";
        return `${time} ${status} ${command} ${user} ${duration}${reason}`.trim();
    }

    async function auditOverview() {
        if (typeof listBotAuditLogs !== "function" && typeof collectBotAuditSummary !== "function") {
            return { available: false, recent: [], summary: null };
        }
        try {
            const [recent, summary] = await Promise.all([
                typeof listBotAuditLogs === "function" ? listBotAuditLogs({ limit: 20 }) : Promise.resolve({ rows: [] }),
                typeof collectBotAuditSummary === "function" ? collectBotAuditSummary({ sinceDays: 7 }) : Promise.resolve(null)
            ]);
            return {
                available: true,
                recent: recent.rows || [],
                summary
            };
        } catch (err) {
            return {
                available: false,
                error: err.message || String(err),
                recent: [],
                summary: null
            };
        }
    }

    async function collectBotAdminOverview() {
        const storedBotToken = await configGet("telegram_bot_token").catch(() => "");
        const tokenConfigured = !!(process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || storedBotToken);
        const botHealth = tokenConfigured && typeof healthService.httpHealthCheck === "function"
            ? await healthService.httpHealthCheck("bot", process.env.BOT_HEALTH_URL || "http://127.0.0.1:3300/health/ready", { required: false })
            : healthService.checkResult("bot", true, { required: false, skipped: true, detail: "Telegram Bot Token is not configured" });
        const telegramApi = typeof healthService.telegramApiHealthCheck === "function"
            ? await healthService.telegramApiHealthCheck()
            : { ok: true, skipped: true };
        const logs = recentBotLogLines(80);
        const activity = await query(
            `SELECT
                COUNT(*) FILTER (WHERE COALESCE(telegram_id, '') <> '')::int users,
                COUNT(*) FILTER (WHERE COALESCE(telegram_id, '') <> '' AND is_banned = false)::int active_users,
                COUNT(*) FILTER (WHERE last_sign_date = CURRENT_DATE)::int signed_today,
                COUNT(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '7 days')::int login_7d,
                COUNT(*) FILTER (WHERE export_unlocked_at IS NOT NULL)::int export_unlocked
             FROM reader_users`
        ).catch(() => ({ rows: [{}] }));
        const tx = await query(
            `SELECT type, COUNT(*)::int count
             FROM reader_transactions
             WHERE created_at > NOW() - INTERVAL '7 days'
             GROUP BY type
             ORDER BY count DESC
             LIMIT 12`
        ).catch(() => ({ rows: [] }));
        const exports = await query(
            `SELECT format, COUNT(*)::int count
             FROM reader_export_usage
             WHERE export_date >= CURRENT_DATE - INTERVAL '7 days'
             GROUP BY format
             ORDER BY count DESC`
        ).catch(() => ({ rows: [] }));
        const body = botHealth.body || {};
        const taskLogs = logs
            .filter((line) => /\[bot-task\]/i.test(line))
            .slice(0, 20);
        const audit = await auditOverview();
        const auditLines = audit.recent.map(formatBotAuditLine);
        const auditFailures = audit.summary?.failure_reasons || [];
        return {
            generated_at: new Date().toISOString(),
            health: botHealth,
            telegram_api: telegramApi,
            online: !!botHealth.ok && !botHealth.skipped,
            bot_username: body.bot_username || "",
            queue: body.background_tasks || { running: 0, queued: 0, locks: 0, concurrency: 0 },
            rate_limits: body.rate_limits || { keys: 0, maxKeys: 0 },
            client: body.client || {},
            pikpak: {
                configured: !!(process.env.PIKPAK_WEBDAV_URL && process.env.PIKPAK_WEBDAV_USERNAME && process.env.PIKPAK_WEBDAV_PASSWORD),
                url_present: !!process.env.PIKPAK_WEBDAV_URL,
                username_present: !!process.env.PIKPAK_WEBDAV_USERNAME,
                root: process.env.PIKPAK_WEBDAV_ROOT || "/"
            },
            activity: activity.rows[0] || {},
            transactions_7d: tx.rows,
            exports_7d: exports.rows,
            audit: {
                available: audit.available,
                error: audit.error || "",
                summary: audit.summary || null,
                recent: audit.recent
            },
            recent_logs: logs.slice(0, 30),
            recent_tasks: auditLines.length ? auditLines : taskLogs,
            failure_reasons: auditFailures.length ? auditFailures : topFailureReasons(logs)
        };
    }

    async function collectAdminSystemOverview() {
        const logTail = readLogTail(runtimeLogFile, 160000);
        const recentErrors = recentStructuredErrors(20).concat(filterLogText(logTail, "error")
            .split(/\r?\n/)
            .filter(Boolean)
            .slice(-20)
            .reverse()).slice(0, 20);
        const configExists = await fs.access(configFile).then(() => true).catch(() => false);
        const sessionSecret = String(sessionSecretProvider() || "");
        const defaultPassword = String(defaultPasswordProvider() || "");
        const uploadApiToken = String(uploadApiTokenProvider() || "");
        return {
            schema: typeof healthService.collectSchemaInfo === "function" ? await healthService.collectSchemaInfo() : {},
            jobs: await collectSystemJobInfo(),
            securityChecks: [
                {
                    name: "Setup Token",
                    ok: String(process.env.PO18_SETUP_TOKEN || "").length >= 16,
                    detail: process.env.PO18_SETUP_TOKEN ? "已配置" : "未配置，将依赖启动面板生成值"
                },
                {
                    name: "Session Secret",
                    ok: sessionSecret !== "po18-upload-pg-change-me" && sessionSecret.length >= 16,
                    detail: sessionSecret === "po18-upload-pg-change-me" ? "仍是默认值" : "已配置"
                },
                {
                    name: "Upload API Token",
                    ok: uploadApiToken.length >= 16,
                    detail: uploadApiToken ? "已配置，外部上传写入接口需要请求头 Token" : "未配置，上传写入接口会拒绝外部请求"
                },
                {
                    name: "Bot API Token",
                    ok: String(process.env.PO18_BOT_API_TOKEN || "").length >= 16,
                    detail: process.env.PO18_BOT_API_TOKEN ? "已配置，Bot API 需要请求头 Token" : "未配置，Bot API 会拒绝请求"
                },
                {
                    name: "管理员密码",
                    ok: defaultPassword !== "admin123" && defaultPassword.length >= 8,
                    detail: defaultPassword === "admin123" ? "仍是默认密码" : "已配置"
                },
                {
                    name: "配置文件",
                    ok: configExists,
                    detail: configExists ? configFile : "配置文件不存在或未挂载"
                },
                {
                    name: "PostgreSQL URL",
                    ok: /^postgres(?:ql)?:\/\//i.test(String(process.env.PO18_PG_URL || "")),
                    detail: process.env.PO18_PG_URL ? "已配置并脱敏展示在诊断 JSON" : "未配置"
                }
            ],
            recentErrors,
            slowRequests: slowRequestsOverview(logTail, 20),
            logs: {
                runtime: runtimeLogFile,
                requests: requestLogFile,
                slowRequests: slowLogFile,
                slowThresholdMs: Number(requestSlowMsProvider() || 0)
            },
            backups: await backupListPayload({ backupDir })
        };
    }

    return {
        collectAdminSystemOverview,
        collectBotAdminOverview,
        recentBotLogLines,
        recentStructuredErrors,
        slowRequestsOverview,
        structuredSlowRequests
    };
}

module.exports = {
    createAdminOverviewService,
    parseSlowLogLines,
    topFailureReasons
};
