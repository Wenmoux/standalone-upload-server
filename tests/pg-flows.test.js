/**
 * [INPUT]: 依赖 node:test、真实 PostgreSQL、共享 HTTP/账户 fixture 与拆分后的核心/领域用例组
 * [OUTPUT]: 提供真实 PostgreSQL schema 重置、生产依赖装配和顺序集成测试组合
 * [POS]: tests 的 PostgreSQL 集成组合根，保证两个用例组共享同一数据库且不发生跨文件并发 schema 重置
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const crypto = require("crypto");
const http = require("http");
const test = require("node:test");
const express = require("express");
const { runPgCoreFlowCases } = require("./pg-flow-core-cases");
const { runPgDomainFlowCases } = require("./pg-flow-domain-cases");

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
    app.use((err, req, res, _next) => {
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
    const {
        bookColumns,
        chapterColumns,
        initPg,
        pick,
        query,
        pool,
        runMigrationRollback,
        runMigrations,
        listMigrationFiles
    } = require("../pg-store");
    const { createReaderApiRoutes } = require("../routes/reader-api");
    const { createBotApiRoutes } = require("../routes/bot-api");
    const { createAdminBackupRoutes } = require("../routes/admin-backups");
    const {
        cancelSystemJob,
        claimSystemJob,
        claimSystemJobs,
        createSystemJob,
        heartbeatSystemJob,
        updateSystemJob
    } = require("../services/system-jobs");
    const { createApiTokenService } = require("../services/api-tokens");
    const { createCredentialCrypto, encryptStoredPo18Credentials } = require("../services/credential-crypto");
    const { createUserCurrencyService } = require("../services/user-currency");
    const { createReaderAccountService } = require("../services/reader-account");
    const { createBookManifestService } = require("../services/book-manifest");
    const { createBookChapterService } = require("../services/book-chapters");
    const { createBookSocialService } = require("../services/book-social");
    const { createReviewGovernanceService } = require("../services/review-governance");
    const { createRedPacketService } = require("../services/red-packets");

    await runPgCoreFlowCases(t, {
        bookColumns,
        chapterColumns,
        initPg,
        pick,
        query,
        pool,
        listMigrationFiles,
        createReaderApiRoutes,
        cancelSystemJob,
        claimSystemJob,
        claimSystemJobs,
        createSystemJob,
        heartbeatSystemJob,
        updateSystemJob,
        createApiTokenService,
        createCredentialCrypto,
        encryptStoredPo18Credentials,
        createUserCurrencyService,
        createReaderAccountService,
        createBookChapterService,
        withApp,
        resetDatabase,
        seedBotUser,
        hashPassword,
        botUserSelect,
        publicUser,
        cdkDuration
    });
    await runPgDomainFlowCases(t, {
        query,
        pool,
        runMigrationRollback,
        runMigrations,
        listMigrationFiles,
        createBotApiRoutes,
        createAdminBackupRoutes,
        createBookManifestService,
        createBookSocialService,
        createReviewGovernanceService,
        createRedPacketService,
        withApp,
        seedBotUser,
        requireAdmin,
        requireBotApi,
        hashPassword,
        botUserSelect,
        publicUser,
        pgUrl
    });

    await pool.end();
});
