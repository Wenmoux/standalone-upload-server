const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs/promises");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const test = require("node:test");
const express = require("express");
const { Client } = require("pg");

const execFileAsync = promisify(execFile);

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
    const { initPg, query, pool, runMigrationRollback, runMigrations, listMigrationFiles } = require("../pg-store");
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
    const { createBookManifestService } = require("../services/book-manifest");
    const { createReviewGovernanceService } = require("../services/review-governance");

    await resetDatabase(query, initPg);

    await t.test("chapter stats stay exact across insert update move and delete", async () => {
        await query("INSERT INTO book_metadata(book_id, platform, title) VALUES ('stats-a', 'qidian', 'A')");
        await query(
            `INSERT INTO chapter_cache(book_id, chapter_id, title, platform, chapter_order)
             VALUES ('stats-a','1','one','qidian',1),
                    ('stats-a','2','two','qidian',2),
                    ('stats-a','3','three','qidian',3)`
        );
        let stats = await query("SELECT book_id, cache_count FROM book_stats WHERE book_id='stats-a'");
        assert.deepEqual(stats.rows[0], { book_id: "stats-a", cache_count: 3 });

        await query(
            `INSERT INTO chapter_cache(book_id, chapter_id, title, platform, chapter_order)
             VALUES ('stats-a','1','one-reuploaded','qidian',1)
             ON CONFLICT (book_id, chapter_id) DO UPDATE SET
                title = EXCLUDED.title,
                updated_at = CURRENT_TIMESTAMP`
        );
        stats = await query("SELECT book_id, cache_count FROM book_stats WHERE book_id='stats-a'");
        assert.deepEqual(stats.rows[0], { book_id: "stats-a", cache_count: 3 });

        await query("UPDATE chapter_cache SET title = title || '-updated' WHERE book_id='stats-a'");
        stats = await query("SELECT book_id, cache_count FROM book_stats WHERE book_id='stats-a'");
        assert.deepEqual(stats.rows[0], { book_id: "stats-a", cache_count: 3 });

        await query("UPDATE chapter_cache SET book_id='stats-b' WHERE book_id='stats-a' AND chapter_id='3'");
        stats = await query("SELECT book_id, cache_count FROM book_stats WHERE book_id IN ('stats-a','stats-b') ORDER BY book_id");
        assert.deepEqual(stats.rows, [
            { book_id: "stats-a", cache_count: 2 },
            { book_id: "stats-b", cache_count: 1 }
        ]);

        await query("DELETE FROM chapter_cache WHERE book_id IN ('stats-a','stats-b')");
        stats = await query("SELECT book_id, cache_count FROM book_stats WHERE book_id IN ('stats-a','stats-b') ORDER BY book_id");
        assert.deepEqual(stats.rows, [{ book_id: "stats-a", cache_count: 0 }]);
    });

    await t.test("chapter batch write benchmark keeps 1000 chapter statistics bounded", async () => {
        const durations = [];
        const walBefore = await query("SELECT pg_current_wal_lsn() start_lsn");
        for (let run = 1; run <= 5; run += 1) {
            const bookId = `benchmark-${run}`;
            await query("INSERT INTO book_metadata(book_id, platform, title) VALUES ($1, 'benchmark', $2)", [bookId, `Benchmark ${run}`]);
            const values = [];
            const params = [];
            for (let chapter = 1; chapter <= 1000; chapter += 1) {
                const base = params.length;
                values.push(`($${base + 1},$${base + 2},$${base + 3},'benchmark',$${base + 4})`);
                params.push(bookId, String(chapter), `Chapter ${chapter}`, chapter);
            }
            const startedAt = performance.now();
            await query(
                `INSERT INTO chapter_cache(book_id, chapter_id, title, platform, chapter_order) VALUES ${values.join(",")}`,
                params
            );
            durations.push(performance.now() - startedAt);
            const stats = await query("SELECT cache_count FROM book_stats WHERE book_id=$1", [bookId]);
            assert.equal(stats.rows[0]?.cache_count, 1000);
        }
        const walAfter = await query("SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), $1::pg_lsn)::bigint::text wal_bytes", [
            walBefore.rows[0].start_lsn
        ]);
        const sorted = durations.slice().sort((a, b) => a - b);
        const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
        const p50 = percentile(0.5);
        const p95 = percentile(0.95);
        console.log(
            `# chapter-write-benchmark batches=5 chapters_per_batch=1000 p50_ms=${p50.toFixed(1)} p95_ms=${p95.toFixed(1)} wal_bytes=${walAfter.rows[0].wal_bytes}`
        );
        assert.ok(p95 < 10000, `1000 chapter batch p95 too slow: ${p95.toFixed(1)}ms`);
        await query("DELETE FROM chapter_cache WHERE platform='benchmark'");
        await query("DELETE FROM book_metadata WHERE platform='benchmark'");
    });

    await t.test("admin audit records are append-only", async () => {
        const inserted = await query(
            `INSERT INTO admin_audit_logs(actor_username, method, path, action, status_code, details_json)
             VALUES ('integration-admin','DELETE','/admin-api/books/1','delete.books.:id',200,'{}'::jsonb)
             RETURNING id`
        );
        await assert.rejects(() => query("UPDATE admin_audit_logs SET reason='changed' WHERE id=$1", [inserted.rows[0].id]), /append-only/);
        await assert.rejects(() => query("DELETE FROM admin_audit_logs WHERE id=$1", [inserted.rows[0].id]), /append-only/);
        const remaining = await query("SELECT COUNT(*)::int count FROM admin_audit_logs WHERE id=$1", [inserted.rows[0].id]);
        assert.equal(remaining.rows[0].count, 1);
    });

    await t.test("persistent system jobs support idempotency leases heartbeat recovery and running cancel", async () => {
        const first = await createSystemJob({
            type: "bot_export_txt",
            input: { book_id: "lease-book" },
            createdBy: "integration",
            idempotencyKey: "integration:lease:one",
            maxAttempts: 4
        });
        const duplicate = await createSystemJob({
            type: "bot_export_txt",
            input: { book_id: "lease-book" },
            createdBy: "integration",
            idempotencyKey: "integration:lease:one",
            maxAttempts: 4
        });
        assert.equal(duplicate.id, first.id);
        assert.equal(duplicate.duplicate, true);

        const claimed = await claimSystemJob(first.id, { workerId: "worker-a", leaseSeconds: 30 });
        assert.equal(claimed.status, "running");
        assert.equal(claimed.locked_by, "worker-a");
        assert.equal(claimed.attempt, 1);
        const heartbeat = await heartbeatSystemJob(first.id, { workerId: "worker-a", progress: 35, leaseSeconds: 45 });
        assert.equal(heartbeat.progress, 35);
        const cancelRequested = await cancelSystemJob(first.id, { actor: "integration-admin" });
        assert.equal(cancelRequested.status, "running");
        assert.ok(cancelRequested.cancel_requested_at);
        await updateSystemJob(first.id, { status: "canceled", error: "canceled", finished: true });

        const recoverable = await createSystemJob({
            type: "bot_share_upload",
            input: { book_id: "recover-book" },
            createdBy: "integration",
            idempotencyKey: "integration:lease:recover",
            maxAttempts: 4
        });
        const initialClaim = await claimSystemJob(recoverable.id, { workerId: "worker-a", leaseSeconds: 30 });
        assert.equal(initialClaim.attempt, 1);
        await query("UPDATE system_jobs SET lease_expires_at=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id=$1", [recoverable.id]);
        const recovered = await claimSystemJobs({ workerId: "worker-b", types: ["bot_share_upload"], limit: 2, leaseSeconds: 30 });
        assert.equal(recovered.length, 1);
        assert.equal(recovered[0].id, recoverable.id);
        assert.equal(recovered[0].attempt, 2);
        assert.equal(recovered[0].locked_by, "worker-b");
        await updateSystemJob(recoverable.id, { status: "succeeded", progress: 100, result: { ok: true }, finished: true });
    });

    await t.test("reclaimed workers cannot repeat an export charge or share reward", async () => {
        await seedBotUser(query, { username: "settlement-user", telegramId: "settlement-tg", copper: 500 });
        const currency = createUserCurrencyService({
            query,
            pool,
            normalizeTelegramId: (value) => String(value || "").trim(),
            botUserSelect,
            currencyLabel: (value) => value
        });

        const exportJob = await createSystemJob({
            type: "bot_export_txt",
            input: { book_id: "settlement-book", telegram_id: "settlement-tg" },
            createdBy: "integration",
            idempotencyKey: "integration:settlement:charge",
            maxAttempts: 3
        });
        await claimSystemJob(exportJob.id, { workerId: "worker-before-crash", leaseSeconds: 30 });
        const chargeInput = {
            telegramId: "settlement-tg",
            currency: "copper",
            amount: 120,
            type: "export_txt_fee",
            idempotencyKey: `system-job:${exportJob.id}:export-settlement`,
            idempotencyScope: "export-settlement",
            idempotencyData: { book_id: "settlement-book", format: "txt" }
        };
        const charged = await currency.spendUserCurrency(chargeInput);
        assert.equal(charged.repeated, false);
        await query("UPDATE system_jobs SET lease_expires_at=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id=$1", [exportJob.id]);
        const exportRecovered = await claimSystemJobs({
            workerId: "worker-after-crash",
            types: ["bot_export_txt"],
            limit: 1,
            leaseSeconds: 30
        });
        assert.equal(exportRecovered[0]?.id, exportJob.id);
        const replayedCharge = await currency.spendUserCurrency(chargeInput);
        assert.equal(replayedCharge.repeated, true);

        const shareJob = await createSystemJob({
            type: "bot_po18_bookshelf_share",
            input: { book_id: "reward-book", telegram_id: "settlement-tg" },
            createdBy: "integration",
            idempotencyKey: "integration:settlement:reward",
            maxAttempts: 3
        });
        await claimSystemJob(shareJob.id, { workerId: "share-worker-before-crash", leaseSeconds: 30 });
        const rewardInput = {
            telegramId: "settlement-tg",
            currency: "copper",
            delta: 1000,
            type: "po18_bookshelf_share_reward",
            idempotencyKey: `system-job:${shareJob.id}:po18-share-reward:reward-book`,
            idempotencyScope: "po18-share-reward",
            idempotencyData: { book_id: "reward-book" }
        };
        const rewarded = await currency.adjustUserCurrency(rewardInput);
        assert.equal(rewarded.repeated, false);
        await query("UPDATE system_jobs SET lease_expires_at=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id=$1", [shareJob.id]);
        const shareRecovered = await claimSystemJobs({
            workerId: "share-worker-after-crash",
            types: ["bot_po18_bookshelf_share"],
            limit: 1,
            leaseSeconds: 30
        });
        assert.equal(shareRecovered[0]?.id, shareJob.id);
        const replayedReward = await currency.adjustUserCurrency(rewardInput);
        assert.equal(replayedReward.repeated, true);

        const balance = await query("SELECT copper_coins FROM reader_users WHERE telegram_id='settlement-tg'");
        assert.equal(Number(balance.rows[0].copper_coins), 1380);
        const effects = await query(
            `SELECT operation_scope, COUNT(*)::int count
             FROM reader_operation_ledger
             WHERE telegram_id='settlement-tg'
             GROUP BY operation_scope
             ORDER BY operation_scope`
        );
        assert.deepEqual(effects.rows, [
            { operation_scope: "export-settlement", count: 1 },
            { operation_scope: "po18-share-reward", count: 1 }
        ]);
        const transactions = await query(
            "SELECT COUNT(*)::int count FROM reader_transactions WHERE telegram_id='settlement-tg' AND operation_key <> ''"
        );
        assert.equal(transactions.rows[0].count, 2);
        await updateSystemJob(exportJob.id, { status: "succeeded", progress: 100, finished: true });
        await updateSystemJob(shareJob.id, { status: "succeeded", progress: 100, finished: true });
    });

    await t.test("API tokens are hashed scoped auditable and revocable", async () => {
        const service = createApiTokenService({ query, cacheTtlMs: 1000 });
        const rawToken = "integration-bot-token-secret";
        const synced = await service.syncToken({
            name: "integration-bot",
            kind: "bot",
            token: rawToken,
            scopes: ["bot:read"],
            allowedIps: ["127.0.0.1"]
        });
        const stored = await query("SELECT token_hash, token_prefix FROM api_tokens WHERE id=$1", [synced.id]);
        assert.notEqual(stored.rows[0].token_hash, rawToken);
        assert.equal(stored.rows[0].token_hash.length, 64);
        const allowed = await service.authenticate({ token: rawToken, kind: "bot", scope: "bot:read", req: { ip: "127.0.0.1" } });
        assert.equal(allowed.ok, true);
        const denied = await service.authenticate({ token: rawToken, kind: "bot", scope: "bot:admin", req: { ip: "127.0.0.1" } });
        assert.equal(denied.status, 403);
        await service.revokeToken(synced.id);
        const revoked = await service.authenticate({ token: rawToken, kind: "bot", scope: "bot:read", req: { ip: "127.0.0.1" } });
        assert.equal(revoked.status, 401);
    });

    await t.test("existing PO18 account credentials migrate from plaintext to AES-GCM", async () => {
        const user = await query(
            `INSERT INTO reader_users(username, password_hash, salt, nickname, telegram_id)
             VALUES ('credential-user','hash','salt','Credential User','credential-tg') RETURNING id`
        );
        await query(
            `INSERT INTO reader_po18_accounts(user_id, telegram_id, account, password, cookies_json)
             VALUES ($1,'credential-tg','po18-account','plain-password',$2::jsonb)`,
            [user.rows[0].id, JSON.stringify([{ name: "authtoken1", value: "plain-cookie" }])]
        );
        const credentialCrypto = createCredentialCrypto({ fallbackSecret: "integration-credential-secret" });
        const result = await encryptStoredPo18Credentials(query, credentialCrypto);
        assert.equal(result.updated >= 1, true);
        const stored = await query("SELECT password, cookies_json FROM reader_po18_accounts WHERE user_id=$1", [user.rows[0].id]);
        assert.equal(credentialCrypto.isEncrypted(stored.rows[0].password), true);
        assert.equal(credentialCrypto.decryptString(stored.rows[0].password), "plain-password");
        assert.deepEqual(credentialCrypto.decryptJson(stored.rows[0].cookies_json), [{ name: "authtoken1", value: "plain-cookie" }]);
        await query("DELETE FROM reader_po18_accounts WHERE user_id=$1", [user.rows[0].id]);
        await query("DELETE FROM reader_users WHERE id=$1", [user.rows[0].id]);
    });

    await t.test("reader registration consumes a CDK", async () => {
        await query("INSERT INTO reader_cdks(code, duration_type, duration_days, created_by) VALUES ($1,$2,$3,$4)", [
            "PG-CDK-1",
            "7d",
            7,
            "integration"
        ]);
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

            const claims = await Promise.all(
                ["101", "102"].map((telegramId) =>
                    fetch(`${base}/bot-api/red-packets/claim`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "X-Bot-Token": "bot-token" },
                        body: JSON.stringify({ telegram_id: telegramId, chat_id: "chat-a", packet_id: packetId })
                    })
                )
            );
            assert.deepEqual(claims.map((response) => response.status).sort(), [200, 200]);
        });

        const packet = await query(
            "SELECT status, remaining_count, remaining_amount, claimed_count, claimed_amount FROM reader_red_packets"
        );
        assert.deepEqual(packet.rows[0], {
            status: "claimed",
            remaining_count: 0,
            remaining_amount: 0,
            claimed_count: 2,
            claimed_amount: 2
        });
        const balances = await query(
            "SELECT telegram_id, copper_coins FROM reader_users WHERE telegram_id IS NOT NULL ORDER BY telegram_id"
        );
        assert.deepEqual(
            balances.rows.map((row) => [row.telegram_id, Number(row.copper_coins)]),
            [
                ["100", 8],
                ["101", 1],
                ["102", 1]
            ]
        );
        const tx = await query("SELECT type, COUNT(*)::int count FROM reader_transactions GROUP BY type ORDER BY type");
        assert.deepEqual(tx.rows, [
            { type: "hb_receive", count: 2 },
            { type: "hb_send", count: 1 }
        ]);
    });

    await t.test("manifest checksums and review governance execute against the migrated schema", async () => {
        const metadata = await query(
            `INSERT INTO book_metadata(book_id, platform, title, author, chapter_count, metadata_cached_at)
             VALUES ('manifest-pg', 'po18', 'Manifest Integration', 'Integration Author', 2, CURRENT_TIMESTAMP)
             RETURNING id`
        );
        await query(
            `INSERT INTO chapter_cache(book_id, chapter_id, title, html, text, platform, chapter_order)
             VALUES ('manifest-pg','manifest-1','One','<p>one</p>','one','po18',1),
                    ('manifest-pg','manifest-2','Two','<p>two</p>','two','po18',2)`
        );
        const manifestService = createBookManifestService({ query, pool, appVersion: () => "integration-test" });
        const manifest = await manifestService.exportManifest(metadata.rows[0].id);
        assert.equal(manifest.summary.chapters, 2);
        assert.match(manifest.checksum.value, /^[0-9a-f]{64}$/);

        const firstImport = await manifestService.importManifest(manifest);
        assert.deepEqual(firstImport.chapters, { total: 2, inserted: 0, updated: 2, unchanged: 0 });
        const secondImport = await manifestService.importManifest(manifest);
        assert.deepEqual(secondImport.chapters, { total: 2, inserted: 0, updated: 0, unchanged: 2 });
        const persistedChecksums = await query(
            `SELECT
                (SELECT manifest_checksum FROM book_metadata WHERE id=$1) metadata_checksum,
                COUNT(*) FILTER (WHERE manifest_checksum ~ '^[0-9a-f]{64}$')::int chapter_checksums
             FROM chapter_cache WHERE book_id='manifest-pg'`,
            [metadata.rows[0].id]
        );
        assert.equal(persistedChecksums.rows[0].metadata_checksum, manifest.checksum.value);
        assert.equal(persistedChecksums.rows[0].chapter_checksums, 2);

        const collision = await query(
            "INSERT INTO book_metadata(book_id, platform, title) VALUES ('manifest-pg','qidian','Collision Guard') RETURNING id"
        );
        await assert.rejects(
            manifestService.exportManifest(metadata.rows[0].id),
            (error) => error.code === "BOOK_ID_COLLISION_REQUIRES_BOOK_KEY" && error.status === 409
        );
        await query("DELETE FROM book_metadata WHERE id=$1", [collision.rows[0].id]);

        const author = await seedBotUser(query, { username: "review-author", telegramId: "review-author-tg" });
        const reporter = await seedBotUser(query, { username: "review-reporter", telegramId: "review-reporter-tg" });
        const review = await query(
            `INSERT INTO reader_book_reviews(user_id, telegram_id, nickname, book_id, content, status, source)
             VALUES ($1,$2,'Integration Author','manifest-pg','integration review','published','integration')
             RETURNING id`,
            [author.id, author.telegram_id]
        );
        const adminPassword = hashPassword("integration-admin-password");
        const admin = await query(
            `INSERT INTO admin_users(username, password_hash, salt)
             VALUES ('review-integration-admin',$1,$2) RETURNING id`,
            [adminPassword.hash, adminPassword.salt]
        );
        const governance = createReviewGovernanceService({ query, pool, autoReviewThreshold: 1, dailyReportLimit: 5 });
        const reported = await governance.reportReview({
            userId: reporter.id,
            reviewId: review.rows[0].id,
            reason: "spam",
            details: "integration report"
        });
        assert.equal(reported.review_status, "under_review");
        const appealed = await governance.appealReview({
            userId: author.id,
            reviewId: review.rows[0].id,
            content: "这是一次真实数据库集成申诉。"
        });
        const hidden = await governance.resolveReport({
            reportId: reported.report.id,
            adminId: admin.rows[0].id,
            action: "hide",
            note: "integration moderation"
        });
        assert.equal(hidden.review_status, "hidden");
        const restored = await governance.resolveAppeal({
            appealId: appealed.appeal.id,
            adminId: admin.rows[0].id,
            action: "accept",
            note: "integration appeal accepted"
        });
        assert.equal(restored.review_status, "published");
        const reviewState = await query("SELECT status FROM reader_book_reviews WHERE id=$1", [review.rows[0].id]);
        assert.equal(reviewState.rows[0].status, "published");
        const vote = await query(
            `INSERT INTO reader_book_review_votes(review_id, user_id, telegram_id, vote)
             VALUES ($1,$2,$3,'like') RETURNING change_count`,
            [review.rows[0].id, reporter.id, reporter.telegram_id]
        );
        assert.equal(vote.rows[0].change_count, 0);
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

        let dumpFile = "";
        await withApp(
            router,
            async (base) => {
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
                assert.match(body.backup.sha256, /^[0-9a-f]{64}$/);
                assert.ok(body.backup.archive_entries > 0);
                dumpFile = path.join(backupRoot, body.backup.file);
                await fs.access(dumpFile);
            },
            () => ({ adminUser: { id: 1, username: "integration-admin" } })
        );

        const job = await query("SELECT type, status, progress FROM system_jobs WHERE type=$1 ORDER BY id DESC LIMIT 1", [
            "backup:postgres"
        ]);
        assert.deepEqual(job.rows[0], { type: "backup:postgres", status: "succeeded", progress: 100 });

        const databaseName = `po18_restore_drill_${process.pid}`;
        const adminUrl = new URL(pgUrl);
        adminUrl.pathname = "/postgres";
        const targetUrl = new URL(pgUrl);
        targetUrl.pathname = `/${databaseName}`;
        const admin = new Client({ connectionString: adminUrl.toString() });
        await admin.connect();
        try {
            await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
            await admin.query(`CREATE DATABASE ${databaseName}`);
            await execFileAsync("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl", "--dbname", targetUrl.toString(), dumpFile], {
                timeout: 120000
            });
            const restored = new Client({ connectionString: targetUrl.toString() });
            await restored.connect();
            try {
                const schema = await restored.query("SELECT COUNT(*)::int count FROM schema_migrations");
                assert.ok(schema.rows[0].count >= 12);
                const chapterTable = await restored.query("SELECT to_regclass('public.chapter_cache')::text name");
                assert.equal(chapterTable.rows[0].name, "chapter_cache");
            } finally {
                await restored.end();
            }
        } finally {
            await admin
                .query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()", [
                    databaseName
                ])
                .catch(() => {});
            await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`).catch(() => {});
            await admin.end();
        }
    });

    await t.test("migration rollback can revert and reapply the latest migration", async () => {
        const previous = process.env.PO18_ALLOW_SCHEMA_ROLLBACK;
        process.env.PO18_ALLOW_SCHEMA_ROLLBACK = "1";
        try {
            const files = await listMigrationFiles();
            const latest = files.at(-1);
            const rolledBack = await runMigrationRollback({ steps: 1, confirm: "ROLLBACK" });
            assert.equal(rolledBack[0].version, latest.version);
            const record = await query("SELECT version FROM schema_migrations WHERE version=$1", [latest.version]);
            assert.equal(record.rows.length, 0);

            await runMigrations();
            const restored = await query("SELECT version FROM schema_migrations WHERE version=$1", [latest.version]);
            assert.equal(restored.rows[0].version, latest.version);
        } finally {
            if (previous === undefined) delete process.env.PO18_ALLOW_SCHEMA_ROLLBACK;
            else process.env.PO18_ALLOW_SCHEMA_ROLLBACK = previous;
        }
    });

    await pool.end();
});
