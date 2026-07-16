/**
 * [INPUT]: 依赖 node:test 子测试上下文、真实 PostgreSQL fixture 与红包/书评/清单/备份/回滚领域服务
 * [OUTPUT]: 对外提供 runPgDomainFlowCases，覆盖并发结算、治理清单、真实备份恢复及最新迁移回滚
 * [POS]: tests 的 PostgreSQL 业务与运维集成用例组，由 pg-flows.test 顺序编排并共享同一迁移数据库
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { Client } = require("pg");

const execFileAsync = promisify(execFile);

async function runPgDomainFlowCases(t, context = {}) {
    const {
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
    } = context;

    await t.test("red packet concurrent claims settle balances and packet state", async () => {
        await seedBotUser(query, { username: "sender", telegramId: "100", copper: 10 });
        await seedBotUser(query, { username: "claimer1", telegramId: "101" });
        await seedBotUser(query, { username: "claimer2", telegramId: "102" });
        const redPacketService = createRedPacketService({
            pool,
            botUserSelect,
            normalizeTelegramId: (value) => String(value || "").trim(),
            normalizeChatId: (value) => String(value || "").trim(),
            randomRedPacketAmount: (remainingAmount, remainingCount) => (remainingCount <= 1 ? Number(remainingAmount) : 1)
        });

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
            createRedPacket: redPacketService.createRedPacket,
            claimRedPacket: redPacketService.claimRedPacket,
            getHotKeywords: async () => [],
            addHotKeyword: async () => null,
            recordEvent: async () => null
        });

        await withApp(router, async (base) => {
            const createRequest = () =>
                fetch(`${base}/bot-api/red-packets`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-Bot-Token": "bot-token" },
                    body: JSON.stringify({
                        sender_telegram_id: "100",
                        chat_id: "chat-a",
                        total_amount: 2,
                        total_count: 2,
                        currency: "copper",
                        idempotency_key: "integration:red-packet:chat-a:1"
                    })
                });
            const created = await Promise.all([createRequest(), createRequest()]);
            assert.deepEqual(
                created.map((response) => response.status),
                [200, 200]
            );
            const createdPayloads = await Promise.all(created.map((response) => response.json()));
            const packetId = createdPayloads[0].packet.id;
            assert.equal(createdPayloads[1].packet.id, packetId);
            assert.equal(createdPayloads.filter((payload) => payload.repeated).length, 1);

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

            const repeated = await fetch(`${base}/bot-api/red-packets/claim`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Bot-Token": "bot-token" },
                body: JSON.stringify({ telegram_id: "101", chat_id: "chat-a", packet_id: packetId })
            });
            assert.equal(repeated.status, 200);
            assert.equal((await repeated.json()).repeated, true);
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
            "SELECT telegram_id, copper_coins FROM reader_users WHERE telegram_id=ANY($1::text[]) ORDER BY telegram_id",
            [["100", "101", "102"]]
        );
        assert.deepEqual(
            balances.rows.map((row) => [row.telegram_id, Number(row.copper_coins)]),
            [
                ["100", 8],
                ["101", 1],
                ["102", 1]
            ]
        );
        const tx = await query(
            `SELECT type, COUNT(*)::int count
             FROM reader_transactions
             WHERE telegram_id=ANY($1::text[])
             GROUP BY type ORDER BY type`,
            [["100", "101", "102"]]
        );
        assert.deepEqual(tx.rows, [
            { type: "hb_receive", count: 2 },
            { type: "hb_send", count: 1 }
        ]);
        const ledger = await query("SELECT COUNT(*)::int count FROM reader_operation_ledger WHERE idempotency_key=$1", [
            "integration:red-packet:chat-a:1"
        ]);
        assert.equal(ledger.rows[0].count, 1);
    });

    await t.test("expired red packet returns its remainder to the sender", async () => {
        await seedBotUser(query, { username: "refund-sender", telegramId: "110", copper: 10 });
        await seedBotUser(query, { username: "refund-trigger", telegramId: "111" });
        const redPacketService = createRedPacketService({
            pool,
            botUserSelect,
            normalizeTelegramId: (value) => String(value || "").trim(),
            normalizeChatId: (value) => String(value || "").trim(),
            randomRedPacketAmount: () => 1
        });
        const router = createBotApiRoutes({
            requireBotApi,
            botPublicUser: publicUser,
            createRedPacket: redPacketService.createRedPacket,
            claimRedPacket: redPacketService.claimRedPacket
        });
        await withApp(router, async (base) => {
            const created = await fetch(`${base}/bot-api/red-packets`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Bot-Token": "bot-token" },
                body: JSON.stringify({ sender_telegram_id: "110", chat_id: "chat-expired", total_amount: 3, total_count: 2 })
            });
            const packetId = (await created.json()).packet.id;
            await query("UPDATE reader_red_packets SET expired_at=CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id=$1", [packetId]);
            const expired = await fetch(`${base}/bot-api/red-packets/claim`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Bot-Token": "bot-token" },
                body: JSON.stringify({ telegram_id: "111", chat_id: "chat-expired", packet_id: packetId })
            });
            assert.equal(expired.status, 410);
            assert.equal((await expired.json()).refunded, 3);
        });
        const sender = await query("SELECT copper_coins FROM reader_users WHERE telegram_id='110'");
        assert.equal(Number(sender.rows[0].copper_coins), 10);
        const refund = await query("SELECT amount FROM reader_transactions WHERE telegram_id='110' AND type='hb_refund'");
        assert.equal(Number(refund.rows[0].amount), 3);
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

        const idempotentAuthor = await seedBotUser(query, {
            username: "review-idempotent-author",
            telegramId: "review-idempotent-tg",
            copper: 300
        });
        const social = createBookSocialService({
            query,
            pool,
            normalizeTelegramId: (value) => String(value || "").trim(),
            botUserSelect,
            scholarProfile: () => ({ level: 2, name: "L2" }),
            reviewPublishCost: 100
        });
        const publishInput = {
            telegramId: idempotentAuthor.telegram_id,
            bookId: "manifest-pg",
            content: "真实数据库中的幂等书评发布。",
            source: "telegram_bot",
            idempotencyKey: "integration:book-review:one"
        };
        const firstReview = await social.createBookReview(publishInput);
        const repeatedReview = await social.createBookReview(publishInput);
        assert.equal(firstReview.repeated, false);
        assert.equal(repeatedReview.repeated, true);
        assert.equal(repeatedReview.review.id, firstReview.review.id);
        const reviewSettlement = await query(
            `SELECT
                (SELECT copper_coins FROM reader_users WHERE id=$1)::int balance,
                (SELECT COUNT(*) FROM reader_book_reviews WHERE user_id=$1 AND book_id='manifest-pg')::int reviews,
                (SELECT COUNT(*) FROM reader_transactions WHERE operation_key='integration:book-review:one')::int transactions`,
            [idempotentAuthor.id]
        );
        assert.deepEqual(reviewSettlement.rows[0], { balance: 200, reviews: 1, transactions: 1 });
        await assert.rejects(
            social.createBookReview({ ...publishInput, content: "复用操作键但替换内容必须冲突。" }),
            (error) => error.status === 409 && error.code === "IDEMPOTENCY_CONFLICT"
        );

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
}

module.exports = { runPgDomainFlowCases };
