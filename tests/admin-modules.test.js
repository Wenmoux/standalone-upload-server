const assert = require("assert/strict");
const http = require("http");
const test = require("node:test");
const express = require("express");
const { createAdminOverviewService, parseSlowLogLines, topFailureReasons } = require("../services/admin-overview");
const { createDataQualityService, rowNumber } = require("../services/data-quality");
const { createAdminSystemRoutes } = require("../routes/admin-system");
const { createAdminBackupRoutes } = require("../routes/admin-backups");
const { createAdminConfigRoutes } = require("../routes/admin-config");
const { createAdminCrawlerRoutes } = require("../routes/admin-crawler");

async function withApp(router, fn) {
    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function adminOnly(req, res, next) {
    if (req.get("X-Test-Admin") !== "1") return res.status(401).json({ error: "admin required" });
    next();
}

test("data quality service builds summary and samples", async () => {
    let calls = 0;
    const service = createDataQualityService({
        query: async () => {
            calls += 1;
            if (calls === 1) {
                return { rows: [{ books: 10, missing_chapter_books: 2, no_cover: 3, no_description: 4, platform_abnormal: 1, stale_books: 5, coverage_percent: 88.5 }] };
            }
            if (calls === 2) {
                return { rows: [{ duplicate_books: 1, duplicate_order_groups: 2, large_chapters: 3 }] };
            }
            return { rows: [{ book_id: `b${calls}` }] };
        }
    });

    const payload = await service.collectDataQuality();

    assert.equal(calls, 10);
    assert.equal(rowNumber({ a: "7" }, "a"), 7);
    assert.equal(payload.summary.books, 10);
    assert.equal(payload.summary.duplicate_books, 1);
    assert.equal(payload.summary.large_chapters, 3);
    assert.deepEqual(payload.samples.duplicate_books, [{ book_id: "b3" }]);
});

test("admin overview helpers parse slow logs and failure reasons", () => {
    assert.deepEqual(parseSlowLogLines("GET /a 42ms\nPOST /b 7.5 ms", 2), [
        { ms: 42, line: "GET /a 42ms" },
        { ms: 7.5, line: "POST /b 7.5 ms" }
    ]);
    assert.deepEqual(topFailureReasons(["job failed: timeout", "x error - denied", "job failed: timeout"]), [
        { reason: "timeout", count: 2 },
        { reason: "denied", count: 1 }
    ]);
});

test("admin overview service builds system and bot overview payloads", async () => {
    const service = createAdminOverviewService({
        query: async (sql) => {
            if (/FROM reader_users/.test(sql)) return { rows: [{ users: 2, active_users: 1 }] };
            if (/FROM reader_transactions/.test(sql)) return { rows: [{ type: "sign", count: 3 }] };
            if (/FROM reader_export_usage/.test(sql)) return { rows: [{ format: "txt", count: 4 }] };
            return { rows: [] };
        },
        configGet: async () => "",
        healthService: {
            checkResult: (name, ok, fields) => ({ name, ok, ...fields }),
            collectSchemaInfo: async () => ({ version: "test" }),
            telegramApiHealthCheck: async () => ({ ok: true, detail: "telegram" })
        },
        collectSystemJobInfo: async () => ({ recent: [] }),
        backupListPayload: async () => ({ rows: [] }),
        readLogTail: () => "GET /slow 900ms\n[bot-task] failed: timeout",
        filterLogText: (text, filter) => filter === "bot" ? "[bot-task] failed: timeout" : text,
        readJsonLinesTail: () => [{ level: "error", service: "server", path: "/x", status: 500 }],
        topSlowRequests: () => [],
        listBotAuditLogs: async () => ({ rows: [{ command: "/search", action: "search", status: "succeeded", telegram_id: "42", duration_ms: 8, created_at: "2026-06-05T00:00:00.000Z" }] }),
        collectBotAuditSummary: async () => ({ failure_reasons: [{ reason: "EXPORT_NO_CONTENT", count: 2 }], commands: [{ command: "/search", action: "search", count: 3, failed: 0 }] }),
        configFile: "missing-test-config.env",
        sessionSecretProvider: () => "secret-secret-secret",
        defaultPasswordProvider: () => "not-default",
        uploadApiTokenProvider: () => "upload-token-123456"
    });

    const system = await service.collectAdminSystemOverview();
    const bot = await service.collectBotAdminOverview();

    assert.equal(system.schema.version, "test");
    assert.equal(system.securityChecks.find((item) => item.name === "Session Secret").ok, true);
    assert.equal(system.slowRequests[0].ms, 900);
    assert.equal(bot.telegram_api.detail, "telegram");
    assert.equal(bot.activity.users, 2);
    assert.deepEqual(bot.failure_reasons, [{ reason: "EXPORT_NO_CONTENT", count: 2 }]);
    assert.equal(bot.audit.available, true);
    assert.match(bot.recent_tasks[0], /\/search/);
});

test("admin system routes expose status, jobs and logs behind admin middleware", async () => {
    const router = createAdminSystemRoutes({
        requireAdmin: adminOnly,
        configFile: "/config/app.env",
        runtimeLogFile: "/config/runtime.log",
        versionPayload: () => ({ version: "v-test" }),
        healthService: { collectDeepHealth: async () => ({ ok: true }) },
        collectCachedSystemStatus: async () => ({ ok: true }),
        collectDiagnostics: async () => ({ diag: true }),
        collectAdminSystemOverview: async () => ({ overview: true }),
        collectDataQuality: async () => ({ quality: true }),
        collectBotAdminOverview: async () => ({ bot: true }),
        listBotAuditLogs: async (query) => ({ query, rows: [{ id: 1 }] }),
        listSystemJobs: async (query) => ({ query, rows: [] }),
        getSystemJob: async (id) => id === "42" ? { id } : null,
        retrySystemJob: async (req, id) => ({ success: true, job: { id: 77, retried_from: id } }),
        cancelSystemJob: async (id) => ({ id, status: "canceled" }),
        readLogTail: () => "a\nb",
        filterLogText: (text, filter) => `${filter}:${text}`,
        restartProcess: () => {}
    });

    await withApp(router, async (base) => {
        assert.equal((await fetch(`${base}/admin-api/system/status`)).status, 401);
        const status = await fetch(`${base}/admin-api/system/status`, { headers: { "X-Test-Admin": "1" } });
        assert.equal(status.status, 200);
        assert.equal((await status.json()).version.version, "v-test");

        const jobs = await fetch(`${base}/admin-api/jobs?status=running`, { headers: { "X-Test-Admin": "1" } });
        assert.equal((await jobs.json()).query.status, "running");

        const missing = await fetch(`${base}/admin-api/jobs/404`, { headers: { "X-Test-Admin": "1" } });
        assert.equal(missing.status, 404);

        const retry = await fetch(`${base}/admin-api/jobs/42/retry`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({})
        });
        assert.deepEqual((await retry.json()).job, { id: 77, retried_from: "42" });

        const cancel = await fetch(`${base}/admin-api/jobs/42/cancel`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({})
        });
        assert.deepEqual((await cancel.json()).job, { id: "42", status: "canceled" });

        const audit = await fetch(`${base}/admin-api/bot/audit?status=failed&limit=5`, { headers: { "X-Test-Admin": "1" } });
        const auditPayload = await audit.json();
        assert.equal(auditPayload.query.status, "failed");
        assert.equal(auditPayload.query.limit, "5");
    });
});

test("admin backup routes validate restore confirmation and call backup service", async () => {
    const previous = process.env.PO18_RESTART_AFTER_RESTORE;
    process.env.PO18_RESTART_AFTER_RESTORE = "0";
    const calls = [];
    const router = createAdminBackupRoutes({
        requireAdmin: adminOnly,
        configFile: "/config/app.env",
        backupDir: "/backups",
        backupListPayload: async (input) => ({ rows: [{ file: "a.dump" }], input }),
        restoreBackupJob: async (req, input) => {
            calls.push(input);
            return { success: true, restore: { file: input.fileName, bytes: 12 } };
        },
        logEvent: (...args) => calls.push({ log: args }),
        restartProcess: () => {}
    });

    try {
        await withApp(router, async (base) => {
            const list = await fetch(`${base}/admin-api/backup/list`, { headers: { "X-Test-Admin": "1" } });
            assert.equal((await list.json()).rows[0].file, "a.dump");

            const bad = await fetch(`${base}/admin-api/backup/restore`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
                body: JSON.stringify({ file: "a.dump", confirm: "wrong" })
            });
            assert.equal(bad.status, 400);

            const ok = await fetch(`${base}/admin-api/backup/restore`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
                body: JSON.stringify({ file: "a.dump", confirm: "RESTORE a.dump" })
            });
            assert.equal(ok.status, 200);
            assert.equal((await ok.json()).restore.file, "a.dump");
        });
    } finally {
        if (previous === undefined) delete process.env.PO18_RESTART_AFTER_RESTORE;
        else process.env.PO18_RESTART_AFTER_RESTORE = previous;
    }

    assert.equal(calls[0].fileName, "a.dump");
});

test("admin backup routes expose remote backup status and upload", async () => {
    const calls = [];
    const router = createAdminBackupRoutes({
        requireAdmin: adminOnly,
        backupDir: "/backups",
        remoteBackupStatus: async () => ({ configured: true, provider: "webdav" }),
        uploadBackupToRemote: async (file, options) => {
            calls.push({ file, options });
            return { provider: "webdav", url: "https://dav.example/po18.dump", bytes: 42 };
        },
        logEvent: (...args) => calls.push({ log: args })
    });

    await withApp(router, async (base) => {
        const blocked = await fetch(`${base}/admin-api/backup/remote/status`);
        assert.equal(blocked.status, 401);

        const status = await fetch(`${base}/admin-api/backup/remote/status`, { headers: { "X-Test-Admin": "1" } });
        assert.deepEqual(await status.json(), { configured: true, provider: "webdav" });

        const missing = await fetch(`${base}/admin-api/backup/remote/upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({})
        });
        assert.equal(missing.status, 400);

        const uploaded = await fetch(`${base}/admin-api/backup/remote/upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ file: "po18.dump" })
        });
        const body = await uploaded.json();
        assert.equal(uploaded.status, 200);
        assert.equal(body.remote.provider, "webdav");
        assert.equal(body.remote.bytes, 42);
    });

    assert.deepEqual(calls[0], { file: "po18.dump", options: { backupDir: "/backups" } });
    assert.ok(calls.some((item) => item.log?.[2] === "backup-remote-uploaded"));
});

test("admin config routes read and update telegram, platform and export settings", async () => {
    const stored = {
        telegram_bot_token: "123456:token",
        telegram_chat_id: "chat-1"
    };
    const writes = [];
    const router = createAdminConfigRoutes({
        requireAdmin: adminOnly,
        configGet: async (key) => stored[key] || "",
        configSet: async (key, value) => {
            writes.push({ key, value });
            stored[key] = value;
        },
        telegramLoginBotIdFromToken: (token) => token.split(":")[0] || "",
        telegramPushConfig: async () => ({ enabled: true, pushTypes: ["chapter"] }),
        dailyReportConfig: async () => ({ enabled: true, time: "22:00", adminIds: "1", lastDate: "2026-06-05" }),
        dailyReportRecipients: async () => ["1", "2"],
        channelDailyReportRecipients: async () => ["2", "3"],
        parseTelegramPushTypes: (value) => Array.isArray(value) ? value : [],
        parseDailyReportTime: (value) => ({ value: String(value || "22:00") }),
        platformConfigPayload: async () => ({ labels: { po18: "PO18" } }),
        cleanPlatformKey: (value) => String(value || "").trim().toLowerCase(),
        exportPricingConfig: async () => ({ unlockCost: 10, freeCopperCost: 20, paidChapterSilverCost: 30 }),
        exportPricingPayload: (value) => ({
            unlockCost: Number(value.unlockCost || 0),
            freeCopperCost: Number(value.freeCopperCost || 0),
            paidChapterSilverCost: Number(value.paidChapterSilverCost || 0)
        }),
        sendDailyReport: async () => ({ sent: 1 }),
        postJson: async () => "{}"
    });

    await withApp(router, async (base) => {
        const telegram = await fetch(`${base}/admin-api/config/telegram`, { headers: { "X-Test-Admin": "1" } });
        const telegramBody = await telegram.json();
        assert.equal(telegramBody.loginBotId, "123456");
        assert.equal(telegramBody.dailyReportRecipients, 3);

        const updateTelegram = await fetch(`${base}/admin-api/config/telegram`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ enabled: true, pushTypes: ["daily"], botToken: "next", chatId: "chat-2", dailyReportTime: "21:30" })
        });
        assert.equal(updateTelegram.status, 200);

        const platform = await fetch(`${base}/admin-api/config/platforms`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ labels: { " PO18 ": "PO18", empty: "" } })
        });
        assert.equal(platform.status, 200);

        const exportConfig = await fetch(`${base}/admin-api/config/export`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ unlockCost: 11, freeCopperCost: 22, paidChapterSilverCost: 33 })
        });
        const exportBody = await exportConfig.json();
        assert.equal(exportBody.unlockCost, 11);

        const daily = await fetch(`${base}/admin-api/config/telegram/daily-report/test`, {
            method: "POST",
            headers: { "X-Test-Admin": "1" }
        });
        assert.equal((await daily.json()).sent, 1);
    });

    assert.ok(writes.some((item) => item.key === "telegram_push_types" && item.value === "[\"daily\"]"));
    assert.ok(writes.some((item) => item.key === "platform_labels" && item.value === "{\"po18\":\"PO18\"}"));
    assert.ok(writes.some((item) => item.key === "bot_export_unlock_cost" && item.value === "11"));
});

test("admin crawler routes expose config and control endpoints", async () => {
    const calls = [];
    const router = createAdminCrawlerRoutes({
        requireAdmin: adminOnly,
        po18CrawlerService: {
            loadConfig: async () => ({ enabled: true, cookie: "a=1", intervalMinutes: 60 }),
            maskedConfig: (config) => ({ ...config, cookieConfigured: true, cookieLength: 3 }),
            snapshot: () => ({ running: false, paused: false, logs: [] }),
            saveConfig: async (input) => ({ enabled: !!input.enabled, cookie: input.cookie || "a=1" }),
            runNow: async (input, actor) => {
                calls.push({ input, actor });
                return { id: 1 };
            },
            pause: () => true,
            resume: () => true,
            stop: () => true,
            testCookie: async () => ({ ok: true, sampleBooks: [{ bookId: "1", title: "A" }] })
        }
    });

    await withApp(router, async (base) => {
        const config = await fetch(`${base}/admin-api/po18-crawler`, { headers: { "X-Test-Admin": "1" } });
        assert.equal((await config.json()).config.cookieConfigured, true);

        const run = await fetch(`${base}/admin-api/po18-crawler/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({})
        });
        assert.equal((await run.json()).job.id, 1);

        const testCookie = await fetch(`${base}/admin-api/po18-crawler/test-cookie`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({})
        });
        assert.equal((await testCookie.json()).result.ok, true);
    });

    assert.equal(calls[0].actor, "admin");
});
