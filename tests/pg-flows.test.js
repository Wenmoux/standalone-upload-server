const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs/promises");
const http = require("http");
const os = require("os");
const path = require("path");
const test = require("node:test");
const express = require("express");

if (process.env.PO18_TEST_PG_URL) {
    process.env.PO18_PG_URL = process.env.PO18_TEST_PG_URL;
}

const pgUrl = process.env.PO18_TEST_PG_URL || "";

function hashPassword(password) {
    const salt = crypto.randomBytes(8).toString("hex");
    const hash = crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
    return { salt, hash };
}

function cdkDuration(type) {
    const map = {
        "7d": { type: "7d", days: 7 },
        "30d": { type: "30d", days: 30 },
        "365d": { type: "365d", days: 365 },
        permanent: { type: "permanent", days: 0 }
    };
    return map[String(type || "").toLowerCase()] || null;
}

function botUserSelect() {
    return `id, username, nickname, avatar_url, membership_expires_at, membership_permanent, library_access,
            copper_coins, silver_coins, sign_cycle_day, last_sign_date, created_at, last_login_at,
            telegram_id, telegram_username, is_admin, is_banned, invite_count, inviter_telegram_id, export_unlocked_at, scholar_exp`;
}

function publicUser(user) {
    if (!user) return null;
    return {
        id: user.id,
        username: user.username,
        nickname: user.nickname || user.username,
        membership_permanent: !!user.membership_permanent,
        library_access: user.library_access !== false,
        copper_coins: Number(user.copper_coins || 0),
        silver_coins: Number(user.silver_coins || 0),
        telegram_id: user.telegram_id || ""
    };
}

function requireAdmin(req, res, next) {
    req.session = req.session || {};
    req.session.adminUser = req.session.adminUser || { id: 1, username: "integration-admin" };
    next();
}

function requireBotApi(req, res, next) {
    if (req.get("X-Bot-Token") !== "bot-token") return res.status(401).json({ error: "bot token invalid" });
    next();
}

async function withApp(router, fn, sessionFactory = () => ({})) {
    const app = express();
    app.use(express.json({ limit: "5mb" }));
    app.use((req, res, next) => {
        req.session = sessionFactory(req);
        next();
    });
    app.use(router);
    app.use((err, req, res, next) => {
        res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

async function resetDatabase(query, initPg) {
    await query("DROP SCHEMA IF EXISTS public CASCADE");
    await query("CREATE SCHEMA public");
    await initPg();
}

async function seedBotUser(query, { username, telegramId, copper = 0, silver = 0 }) {
    const password = hashPassword("integration-password");
    const result = await query(
        `INSERT INTO reader_users(username, password_hash, salt, nickname, library_access, membership_permanent,
                                  copper_coins, silver_coins, telegram_id, telegram_username)
         VALUES ($1,$2,$3,$4,TRUE,TRUE,$5,$6,$7,$8)
         RETURNING ${botUserSelect()}`,
        [username, password.hash, password.salt, username, copper, silver, telegramId, username]
    );
    return result.rows[0];
}

test("postgres integration covers CDK, red packets and backup jobs", { skip: pgUrl ? false : "set PO18_TEST_PG_URL to run" }, async (t) => {
    const { initPg, query, pool, runMigrationRollback, runMigrations } = require("../pg-store");
    const { createReaderApiRoutes } = require("../routes/reader-api");
    const { createBotApiRoutes } = require("../routes/bot-api");
    const { createAdminBackupRoutes } = require("../routes/admin-backups");

    await resetDatabase(query, initPg);

    await t.test("reader registration consumes a CDK", async () => {
        await query(
            "INSERT INTO reader_cdks(code, duration_type, duration_days, created_by) VALUES ($1,$2,$3,$4)",
            ["PG-CDK-1", "7d", 7, "integration"]
        );
        const router = createReaderApiRoutes({
            query,
            currentReaderUser: async () => null,
            publicReaderUser: publicUser,
            hashPassword,
            verifyPassword: () => false,
            cdkDuration,
            botUserSelect,
            telegramLoginBotToken: async () => "",
            telegramLoginBotIdFromToken: () => "",
            verifyTelegramLoginPayload: () => ({ ok: false }),
            normalizeTelegramId: (value) => String(value || "").trim(),
            botUsernameForTelegram: (id) => `tg_${id}`,
            telegramLoginNickname: () => "tg",
            requireReader: (req, res, next) => next(),
            requireLibraryAccess: (req, res, next) => next(),
            requireReaderContentAccess: (req, res, next) => next(),
            todayDateKey: () => "2026-06-05",
            signExpReward: () => 1,
            scholarProfile: () => ({ level: 1, name: "L1", exp: 0, daily_free_exports: 1 }),
            recordTransaction: async () => null,
            getHotKeywords: async () => [],
            platformConfigPayload: async () => ({}),
            isCacheCountSort: () => false,
            bookOrder: () => "m.id DESC",
            logSlowSearch: () => {},
            slowSearchContext: () => ({}),
            chapterListOrderSql: () => "id ASC",
            chapterText: () => "",
            edgeTtsFallbackVoices: [],
            edgeTtsVoices: async () => [],
            edgeTtsSynthesize: async () => Buffer.from(""),
            ttsProviderSettings: async () => ({}),
            synthesizeVolcengineTts: async () => Buffer.from(""),
            synthesizeAliyunTts: async () => Buffer.from(""),
            synthesizeAzureTts: async () => Buffer.from(""),
            synthesizeElevenLabsTts: async () => Buffer.from(""),
            synthesizeCartesiaTts: async () => Buffer.from(""),
            normalizeCorrectionText: (value = "") => String(value),
            correctionCharLength: (value = "") => Array.from(String(value)).length
        });

        await withApp(router, async (base) => {
            const response = await fetch(`${base}/reader-auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: "pgreader", password: "secret1", cdk: "PG-CDK-1" })
            });
            assert.equal(response.status, 200);
            const body = await response.json();
            assert.equal(body.success, true);
            assert.equal(body.user.username, "pgreader");

            const reused = await fetch(`${base}/reader-auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: "pgreader2", password: "secret1", cdk: "PG-CDK-1" })
            });
            assert.equal(reused.status, 409);
        });

        const cdk = await query("SELECT used_by, used_at FROM reader_cdks WHERE code=$1", ["PG-CDK-1"]);
        assert.ok(cdk.rows[0].used_by);
        assert.ok(cdk.rows[0].used_at);
    });

    await t.test("red packet concurrent claims settle balances and packet state", async () => {
        await seedBotUser(query, { username: "sender", telegramId: "100", copper: 10 });
        await seedBotUser(query, { username: "claimer1", telegramId: "101" });
        await seedBotUser(query, { username: "claimer2", telegramId: "102" });

        const router = createBotApiRoutes({
            requireBotApi,
            query,
            pool,
            hashPassword,
            botUserSelect,
            botPublicUser: publicUser,
            normalizeTelegramId: (value) => String(value || "").trim(),
            normalizeChatId: (value) => String(value || "").trim(),
            botUsernameForTelegram: (id) => `tg_${id}`,
            findBotUserByTelegramId: async (telegramId) => {
                const result = await query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id=$1`, [String(telegramId)]);
                return result.rows[0] || null;
            },
            recordTransaction: async () => null,
            listTransactions: async () => ({ rows: [], total: 0 }),
            exportPricingConfig: async () => ({ unlockCost: 100, freeCopperCost: 100, paidChapterSilverCost: 10 }),
            dailyFreeExportStatus: async () => ({ available: true }),
            claimDailyFreeExport: async () => ({}),
            spendUserCurrency: async () => ({}),
            todayDateKey: () => "2026-06-05",
            positiveNumber: (value, fallback = 1, min = 1) => Math.max(min, Number(value || fallback)),
            signExpReward: () => 1,
            scholarProfile: () => ({ level: 1, name: "L1", exp: 0, daily_free_exports: 1 }),
            randomRedPacketAmount: (remainingAmount, remainingCount) => (remainingCount <= 1 ? Number(remainingAmount) : 1),
            normalizeFeedback: (value) => String(value || ""),
            bookFeedbackCounts: async () => ({}),
            bookCrowdSummary: async () => ({}),
            crowdLeaderboard: async () => ({ rows: [] }),
            getHotKeywords: async () => [],
            addHotKeyword: async () => null,
            recordEvent: async () => null
        });

        await withApp(router, async (base) => {
            const created = await fetch(`${base}/bot-api/red-packets`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Bot-Token": "bot-token" },
                body: JSON.stringify({ sender_telegram_id: "100", chat_id: "chat-a", total_amount: 2, total_count: 2, currency: "copper" })
            });
            assert.equal(created.status, 200);
            const packetId = (await created.json()).packet.id;

            const claims = await Promise.all(["101", "102"].map((telegramId) => fetch(`${base}/bot-api/red-packets/claim`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Bot-Token": "bot-token" },
                body: JSON.stringify({ telegram_id: telegramId, chat_id: "chat-a", packet_id: packetId })
            })));
            assert.deepEqual(claims.map((response) => response.status).sort(), [200, 200]);
        });

        const packet = await query("SELECT status, remaining_count, remaining_amount, claimed_count, claimed_amount FROM reader_red_packets");
        assert.deepEqual(packet.rows[0], {
            status: "claimed",
            remaining_count: 0,
            remaining_amount: 0,
            claimed_count: 2,
            claimed_amount: 2
        });
        const balances = await query("SELECT telegram_id, copper_coins FROM reader_users WHERE telegram_id IS NOT NULL ORDER BY telegram_id");
        assert.deepEqual(balances.rows.map((row) => [row.telegram_id, Number(row.copper_coins)]), [["100", 8], ["101", 1], ["102", 1]]);
        const tx = await query("SELECT type, COUNT(*)::int count FROM reader_transactions GROUP BY type ORDER BY type");
        assert.deepEqual(tx.rows, [{ type: "hb_receive", count: 2 }, { type: "hb_send", count: 1 }]);
    });

    await t.test("backup route writes a real postgres dump and system job", async () => {
        const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "po18-pg-backups-"));
        const configFile = path.join(backupRoot, "app.env");
        await fs.writeFile(configFile, `PO18_PG_URL=${pgUrl}\n`, "utf8");

        const router = createAdminBackupRoutes({
            requireAdmin,
            configFile,
            backupDir: backupRoot,
            collectDiagnostics: async () => ({ ok: true }),
            collectCachedSystemStatus: async () => ({ ok: true }),
            logEvent: () => {},
            restartProcess: () => {},
            restartDelayMsProvider: () => 1
        });

        await withApp(router, async (base) => {
            const response = await fetch(`${base}/admin-api/backup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "postgres" })
            });
            assert.equal(response.status, 200);
            const body = await response.json();
            assert.equal(body.success, true);
            assert.equal(body.backup.type, "postgres");
            assert.ok(body.backup.bytes > 0);
            await fs.access(path.join(backupRoot, body.backup.file));
        }, () => ({ adminUser: { id: 1, username: "integration-admin" } }));

        const job = await query("SELECT type, status, progress FROM system_jobs WHERE type=$1 ORDER BY id DESC LIMIT 1", ["backup:postgres"]);
        assert.deepEqual(job.rows[0], { type: "backup:postgres", status: "succeeded", progress: 100 });
    });

    await t.test("migration rollback can revert and reapply the latest migration", async () => {
        const previous = process.env.PO18_ALLOW_SCHEMA_ROLLBACK;
        process.env.PO18_ALLOW_SCHEMA_ROLLBACK = "1";
        try {
            const rolledBack = await runMigrationRollback({ steps: 1, confirm: "ROLLBACK" });
            assert.equal(rolledBack[0].version, "008_reader_search_requests");
            const missing = await query("SELECT to_regclass('public.reader_search_requests')::text regclass");
            assert.equal(missing.rows[0].regclass, null);
            const record = await query("SELECT version FROM schema_migrations WHERE version=$1", ["008_reader_search_requests"]);
            assert.equal(record.rows.length, 0);

            await runMigrations();
            const restored = await query("SELECT to_regclass('public.reader_search_requests')::text regclass");
            assert.equal(restored.rows[0].regclass, "reader_search_requests");
        } finally {
            if (previous === undefined) delete process.env.PO18_ALLOW_SCHEMA_ROLLBACK;
            else process.env.PO18_ALLOW_SCHEMA_ROLLBACK = previous;
        }
    });

    await pool.end();
});
