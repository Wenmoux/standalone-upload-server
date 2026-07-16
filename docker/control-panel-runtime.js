/**
 * [INPUT]: 依赖 PostgreSQL、服务健康端点、运行日志，以及由控制面组合根注入的配置和版本读取能力
 * [OUTPUT]: 对外提供 createControlPanelRuntime，生成状态采集、脱敏诊断和日志筛选服务
 * [POS]: docker 控制面的只读运行事实层，隔离外部探测与诊断，不渲染页面也不处理 HTTP 响应
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const fsSync = require("fs");
const { URL } = require("url");

function createControlPanelRuntime(options = {}) {
    const DEFAULT_CONFIG_FILE = options.defaultConfigFile;
    const DEFAULT_RUNTIME_LOG_FILE = options.defaultRuntimeLogFile;
    const REQUIRED_TABLES = options.requiredTables || [];
    const currentValues = options.currentValues;
    const loadConfigIntoEnv = options.loadConfigIntoEnv;
    const readEnvFileSync = options.readEnvFileSync;
    const versionPayload = options.versionPayload;

    async function testDatabase(connectionString) {
        const { Pool } = require("pg");
        const started = Date.now();
        const pool = new Pool({
            connectionString,
            max: 1,
            idleTimeoutMillis: 1000,
            connectionTimeoutMillis: Number(process.env.PO18_SETUP_DB_TEST_TIMEOUT_MS || 1500)
        });
        try {
            await pool.query("SELECT 1");
            return { ok: true, latency_ms: Date.now() - started };
        } finally {
            await pool.end().catch(() => {});
        }
    }

    async function collectDatabaseState(connectionString) {
        const { Pool } = require("pg");
        const pool = new Pool({
            connectionString,
            max: 1,
            idleTimeoutMillis: 1000,
            connectionTimeoutMillis: Number(process.env.PO18_SETUP_DB_TEST_TIMEOUT_MS || 1500)
        });
        try {
            const [versionResult, tablesResult] = await Promise.all([
                pool.query("SELECT current_database() AS database, version() AS version"),
                pool.query(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
                    [REQUIRED_TABLES]
                )
            ]);
            const present = new Set(tablesResult.rows.map((row) => row.table_name));
            const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
            const state = {
                ok: missing.length === 0,
                database: versionResult.rows[0]?.database || "",
                pg_version: String(versionResult.rows[0]?.version || "").split(" on ")[0],
                required_tables: REQUIRED_TABLES.map((table) => ({ table, ok: present.has(table) })),
                missing_tables: missing
            };
            if (!missing.length) {
                const counts = await pool.query(`
                    SELECT
                      (SELECT COUNT(*)::int FROM book_metadata) AS books,
                      (SELECT COUNT(*)::int FROM chapter_cache) AS chapters,
                      (SELECT COUNT(*)::int FROM reader_users) AS users,
                      (SELECT COUNT(*)::int FROM admin_users) AS admins,
                      (SELECT COUNT(*)::int FROM upload_events) AS events
                `);
                state.counts = counts.rows[0] || {};
            }
            return state;
        } finally {
            await pool.end().catch(() => {});
        }
    }

    function databaseStateResult(state) {
        if (!state.ok) {
            return {
                name: "database schema",
                ok: false,
                detail: `missing tables: ${state.missing_tables.join(", ") || "unknown"}`,
                body: state
            };
        }
        const counts = state.counts || {};
        return {
            name: "database schema",
            ok: true,
            detail: `tables ready; books=${counts.books || 0}, chapters=${counts.chapters || 0}, users=${counts.users || 0}, admins=${counts.admins || 0}`,
            body: state
        };
    }

    async function checkHttp(name, url, required = true) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Number(process.env.STATUS_TIMEOUT_MS || 1500));
        const started = Date.now();
        try {
            const response = await fetch(url, { signal: controller.signal });
            const text = await response.text();
            let body = {};
            try {
                body = text ? JSON.parse(text) : {};
            } catch {
                body = { raw: text.slice(0, 200) };
            }
            return {
                name,
                ok: response.ok && body.ok !== false,
                required,
                status: response.status,
                latency_ms: Date.now() - started,
                url,
                body
            };
        } catch (err) {
            return { name, ok: false, required, latency_ms: Date.now() - started, url, error: err.message || String(err) };
        } finally {
            clearTimeout(timeout);
        }
    }

    async function collectStatus(configFile = DEFAULT_CONFIG_FILE) {
        loadConfigIntoEnv(configFile);
        const values = currentValues(configFile);
        const hasConfig = fsSync.existsSync(configFile) || !!values.PO18_PG_URL;
        const results = [];
        if (!hasConfig) {
            results.push({ name: "setup", ok: true, skipped: false, detail: "等待保存配置" });
            return results;
        }
        const [server, reader, db, dbState] = await Promise.all([
            checkHttp("server-pg", process.env.SERVER_PG_HEALTH_URL || "http://127.0.0.1:3100/health/deep", true),
            checkHttp("reader", process.env.READER_HEALTH_URL || "http://127.0.0.1:3200/health/ready", true),
            testDatabase(values.PO18_PG_URL).catch((err) => ({ ok: false, error: err.message || String(err) })),
            collectDatabaseState(values.PO18_PG_URL).catch((err) => ({
                ok: false,
                error: err.message || String(err),
                missing_tables: REQUIRED_TABLES
            }))
        ]);
        results.push(server, reader, { name: "database", required: true, ...db });
        results.push(
            dbState.error ? { name: "database schema", required: true, ...dbState } : { ...databaseStateResult(dbState), required: true }
        );
        if (values.TELEGRAM_BOT_TOKEN) {
            results.push(await checkHttp("bot", process.env.BOT_HEALTH_URL || "http://127.0.0.1:3300/health/ready", false));
        } else {
            results.push({ name: "bot", ok: true, required: false, skipped: true, detail: "未配置 Telegram Token" });
        }
        return results;
    }

    function redactValue(key, value) {
        const text = String(value || "");
        if (!text) return "";
        if (/PG_URL/i.test(key)) {
            try {
                const url = new URL(text);
                if (url.password) url.password = "***";
                return url.toString();
            } catch {
                return text.replace(/:\/\/([^:\s]+):([^@\s]+)@/, "://$1:***@");
            }
        }
        if (/(TOKEN|PASSWORD|SECRET|KEY)/i.test(key)) return `<set:${text.length}>`;
        return text;
    }

    function configDiagnostics(configFile = DEFAULT_CONFIG_FILE) {
        const config = readEnvFileSync(configFile);
        const keys = [
            "PO18_SETUP_TOKEN",
            "PO18_PG_URL",
            "PO18_UPLOAD_ADMIN_USER",
            "PO18_UPLOAD_ADMIN_PASSWORD",
            "PO18_UPLOAD_SESSION_SECRET",
            "PO18_UPLOAD_API_TOKEN",
            "PO18_METRICS_TOKEN",
            "PO18_BOT_API_TOKEN",
            "TELEGRAM_BOT_TOKEN",
            "TELEGRAM_API_BASE",
            "PO18_SHARE_API_URL",
            "PIKPAK_WEBDAV_URL",
            "PIKPAK_WEBDAV_USERNAME",
            "PIKPAK_WEBDAV_PASSWORD",
            "PIKPAK_WEBDAV_ROOT"
        ];
        const fields = {};
        for (const key of keys) {
            const value = process.env[key] || config[key] || "";
            fields[key] = { present: !!value, value: redactValue(key, value) };
        }
        return {
            config_file: configFile,
            config_exists: fsSync.existsSync(configFile),
            fields
        };
    }

    async function collectDiagnostics(configFile = DEFAULT_CONFIG_FILE, statusResults = null) {
        const status = statusResults || (await collectStatus(configFile));
        return {
            generated_at: new Date().toISOString(),
            version: versionPayload("po18-reader"),
            runtime: {
                pid: process.pid,
                cwd: process.cwd(),
                node_env: process.env.NODE_ENV || "",
                ports: {
                    server: process.env.PO18_UPLOAD_PORT || "3100",
                    reader: process.env.PO18_READER_PORT || "3200",
                    bot_health: process.env.BOT_HEALTH_PORT || "3300"
                }
            },
            config: configDiagnostics(configFile),
            status,
            log_summary: {
                file: process.env.PO18_RUNTIME_LOG_FILE || DEFAULT_RUNTIME_LOG_FILE,
                recent_errors: filterLogText(readLogTail(process.env.PO18_RUNTIME_LOG_FILE || DEFAULT_RUNTIME_LOG_FILE, 80000), "error")
                    .split(/\r?\n/)
                    .slice(-30)
            }
        };
    }

    function readLogTail(logFile = DEFAULT_RUNTIME_LOG_FILE, maxBytes = 120000) {
        try {
            if (!fsSync.existsSync(logFile))
                return "暂无运行日志。单容器模式会把 run-all 子进程日志写入这里；也可以执行 docker logs po18-app --tail 200。";
            const stat = fsSync.statSync(logFile);
            const fd = fsSync.openSync(logFile, "r");
            const length = Math.min(stat.size, maxBytes);
            const buffer = Buffer.alloc(length);
            fsSync.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
            fsSync.closeSync(fd);
            return buffer.toString("utf8");
        } catch (err) {
            return `读取日志失败: ${err.message || String(err)}`;
        }
    }

    function filterLogText(text, filter = "all") {
        const mode = String(filter || "all").toLowerCase();
        if (mode === "all") return text;
        const patterns = {
            error: /(error|fail|exception|unhandled|timeout|econn|refused|denied|invalid|fatal)/i,
            database: /(database|postgres|pg-|pg\]|pool|po18_pg_url|connection|select 1)/i,
            bot: /(\[bot\]|telegram|bot\/telegram|polling|webdav)/i,
            reader: /(\[reader\]|reader-server|dist-reader|po18_api_base)/i,
            server: /(\[server-pg\]|\[sidecar|server-pg|request-db|admin-api|reader-api)/i,
            setup: /(\[setup\]|\[run-all\]|setup token|config saved)/i
        };
        const pattern = patterns[mode] || patterns.all;
        if (!pattern) return text;
        return (
            text
                .split(/\r?\n/)
                .filter((line) => pattern.test(line))
                .join("\n") || `没有匹配 ${mode} 的日志。`
        );
    }

    return {
        collectDatabaseState,
        collectDiagnostics,
        collectStatus,
        databaseStateResult,
        filterLogText,
        readLogTail,
        testDatabase
    };
}

module.exports = { createControlPanelRuntime };
