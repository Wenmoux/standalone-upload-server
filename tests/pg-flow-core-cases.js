/**
 * [INPUT]: 依赖 node:test 子测试上下文、真实 PostgreSQL fixture 与迁移/任务/账户领域服务
 * [OUTPUT]: 对外提供 runPgCoreFlowCases，覆盖迁移、元数据、章节统计、任务租约、Token、凭据和注册事务
 * [POS]: tests 的 PostgreSQL 核心平台集成用例组，由 pg-flows.test 顺序编排，避免跨文件并发重置 schema
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const fs = require("fs/promises");

async function runPgCoreFlowCases(t, context = {}) {
    const {
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
    } = context;

    await t.test("legacy duplicate taxonomy upgrades through the immutable migration 020", async () => {
        await query("DROP SCHEMA IF EXISTS public CASCADE");
        await query("CREATE SCHEMA public");
        const files = await listMigrationFiles();
        const bootstrapFiles = files.filter((file) => file.version <= "019_job_effect_idempotency");
        for (const migration of bootstrapFiles) {
            await query(await fs.readFile(migration.path, "utf8"));
        }

        await query(
            `INSERT INTO book_metadata(book_id, platform, title, category, tags)
             VALUES ('taxonomy-legacy', 'qidian', 'Legacy', '玄幻, 玄幻', 'Fantasy, fantasy, 热血, 热血')`
        );
        const inputRepair = files.find((file) => file.version === "019_taxonomy_input_deduplication");
        const taxonomyMigration = files.find((file) => file.version === "020_taxonomy_and_quality_semantics");
        const triggerRepair = files.find((file) => file.version === "023_taxonomy_conflict_deduplication");
        await query(await fs.readFile(inputRepair.path, "utf8"));
        await query(await fs.readFile(taxonomyMigration.path, "utf8"));

        const legacy = await query(
            `SELECT category, tags,
                    (SELECT COUNT(*)::int FROM book_taxonomy WHERE metadata_id = metadata.id) taxonomy_count
             FROM book_metadata metadata
             WHERE book_id = 'taxonomy-legacy'`
        );
        assert.deepEqual(legacy.rows[0], {
            category: "玄幻",
            tags: "Fantasy, 热血",
            taxonomy_count: 3
        });

        await query(await fs.readFile(triggerRepair.path, "utf8"));
        await query("UPDATE book_metadata SET tags = 'Fantasy, fantasy, 热血, 热血' WHERE book_id = 'taxonomy-legacy'");
        const future = await query(
            `SELECT kind, normalized_value
             FROM book_taxonomy
             WHERE metadata_id = (SELECT id FROM book_metadata WHERE book_id = 'taxonomy-legacy')
             ORDER BY kind, normalized_value`
        );
        assert.deepEqual(future.rows, [
            { kind: "category", normalized_value: "玄幻" },
            { kind: "tag", normalized_value: "fantasy" },
            { kind: "tag", normalized_value: "热血" }
        ]);
    });

    await resetDatabase(query, initPg);

    await t.test("unchanged qidian metadata payload writes typed timestamp columns", async () => {
        const numericBookFields = new Set([
            "word_count",
            "chapter_count",
            "total_chapters",
            "subscribed_chapters",
            "free_chapters",
            "paid_chapters",
            "favorites_count",
            "comments_count",
            "monthly_popularity",
            "total_popularity",
            "weekly_popularity",
            "readers_count",
            "daily_popularity",
            "purchase_count"
        ]);
        const service = createBookChapterService({
            query,
            pool,
            pick,
            bookColumns,
            chapterColumns,
            cleanPgText: (value) => (typeof value === "string" ? value.replace(/\u0000/g, "") : value),
            cleanPgValue: (value) => value,
            cleanPgObject: (value) => value,
            numericBookFields,
            booleanChapterFields: new Set(["is_volume"]),
            safePgInt: (value, fallback = 0) => Number.parseInt(value, 10) || fallback,
            safePgBool: (value) => Boolean(value),
            nowSql: () => new Date().toISOString(),
            recordEvent: async () => null,
            notifyTelegram: async () => null,
            logger: { warn: () => {} }
        });
        await service.upsertBook({
            bookId: "1047414337",
            title: "顶流手记",
            author: "油炸大金",
            platform: "qidian",
            latestChapterDate: "2026-07-12 07:10:00",
            sourceUpdatedAt: "",
            catalogUpdatedAt: ""
        });
        const stored = await query(
            `SELECT latest_chapter_date::text latest_chapter_date, source_updated_at, catalog_updated_at
             FROM book_metadata WHERE book_id = '1047414337' AND platform = 'qidian'`
        );
        assert.equal(stored.rows[0].latest_chapter_date, "2026-07-12 07:10:00");
        assert.equal(stored.rows[0].source_updated_at, null);
        assert.equal(stored.rows[0].catalog_updated_at, null);
    });

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
        const heartbeat = await heartbeatSystemJob(first.id, {
            workerId: "worker-a",
            attempt: claimed.attempt,
            progress: 35,
            leaseSeconds: 45
        });
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
        const readerAccountService = createReaderAccountService({
            query,
            pool,
            hashPassword,
            verifyPassword: () => false,
            cdkDuration,
            botUserSelect,
            normalizeTelegramId: (value) => String(value || "").trim(),
            botUsernameForTelegram: (id) => `tg_${id}`,
            telegramLoginNickname: () => "tg"
        });
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
            correctionCharLength: (value = "") => Array.from(String(value)).length,
            registerReaderWithCdk: readerAccountService.registerReaderWithCdk
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

            await query("INSERT INTO reader_cdks(code, duration_type, duration_days, created_by) VALUES ($1,$2,$3,$4)", [
                "PG-CDK-RACE",
                "7d",
                7,
                "integration"
            ]);
            const concurrent = await Promise.all(
                ["pgreader3", "pgreader4"].map((username) =>
                    fetch(`${base}/reader-auth/register`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ username, password: "secret1", cdk: "PG-CDK-RACE" })
                    })
                )
            );
            assert.deepEqual(concurrent.map((item) => item.status).sort(), [200, 409]);
        });

        const cdk = await query("SELECT used_by, used_at FROM reader_cdks WHERE code=$1", ["PG-CDK-1"]);
        assert.ok(cdk.rows[0].used_by);
        assert.ok(cdk.rows[0].used_at);
        const raceUsers = await query("SELECT username FROM reader_users WHERE username IN ('pgreader3', 'pgreader4')");
        assert.equal(raceUsers.rows.length, 1);
    });
}

module.exports = { runPgCoreFlowCases };
