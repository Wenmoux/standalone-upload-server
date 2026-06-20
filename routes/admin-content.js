const express = require("express");
const { createAdminMaintenanceRoutes } = require("./admin-maintenance");
const { createAdminUsersRoutes } = require("./admin-users");
const { createAdminLibraryRoutes } = require("./admin-library");

function createAdminContentRoutes(deps = {}) {
    const router = express.Router();
    const {
        requireAdmin,
        query,
        pool,
        adminStatsCache,
        ADMIN_STATS_CACHE_MS,
        STARTED_AT,
        getFreshCache,
        setFreshCache,
        normalizeCorrectionText,
        correctionCharLength,
        textFromHtml,
        replaceTextAtCharOffset,
        replaceFirstText,
        cleanPgText,
        normalizeTelegramId,
        botUserSelect,
        publicAdminReaderUser,
        todayDateKey
    } = deps;

    router.get("/admin-api/corrections", requireAdmin, async (req, res, next) => {
        try {
            const rawStatus = String(req.query.status || "pending").toLowerCase();
            const status = ["pending", "approved", "rejected"].includes(rawStatus) ? rawStatus : "";
            const limit = Math.max(1, Math.min(300, Number(req.query.limit || 100)));
            const params = [];
            const where = [];
            if (status) {
                params.push(status);
                where.push(`c.status = $${params.length}`);
            }
            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
            params.push(limit);
            const rows = await query(
                `SELECT c.*,
                        COALESCE(c.original_length, LENGTH(c.original_text))::int original_length,
                        COALESCE(c.corrected_length, LENGTH(c.corrected_text))::int corrected_length,
                        u.username, u.nickname, u.telegram_id, u.telegram_username
                 FROM reader_corrections c
                 LEFT JOIN reader_users u ON u.id = c.user_id
                 ${whereSql}
                 ORDER BY CASE WHEN c.status = 'pending' THEN 0 ELSE 1 END, c.created_at DESC, c.id DESC
                 LIMIT $${params.length}`,
                params
            );
            const counts = await query(
                `SELECT
                    COUNT(*) FILTER (WHERE status = 'pending')::int pending,
                    COUNT(*) FILTER (WHERE status = 'approved')::int approved,
                    COUNT(*) FILTER (WHERE status = 'rejected')::int rejected,
                    COUNT(*)::int total
                 FROM reader_corrections`
            );
            res.json({ rows: rows.rows, counts: counts.rows[0] || {}, status: status || "all", limit });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/corrections/:id/approve", requireAdmin, async (req, res, next) => {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const found = await client.query(
                `SELECT c.*
                 FROM reader_corrections c
                 WHERE c.id = $1
                 FOR UPDATE OF c`,
                [req.params.id]
            );
            const correction = found.rows[0];
            if (!correction) {
                await client.query("ROLLBACK");
                return res.status(404).json({ error: "纠错记录不存在" });
            }
            if (correction.status !== "pending") {
                await client.query("ROLLBACK");
                return res.status(409).json({ error: "该纠错已审核" });
            }
            const originalText = normalizeCorrectionText(correction.original_text);
            const correctedText = normalizeCorrectionText(correction.corrected_text);
            if (correctionCharLength(originalText) !== correctionCharLength(correctedText)) {
                await client.query("ROLLBACK");
                return res.status(400).json({ error: "纠错前后字数不一致，不能通过" });
            }

            const chapterResult = await client.query(
                `SELECT * FROM chapter_cache
                 WHERE book_id = $1 AND chapter_id = $2
                 LIMIT 1
                 FOR UPDATE`,
                [correction.book_id, correction.chapter_id]
            );
            const chapter = chapterResult.rows[0];
            if (!chapter) {
                await client.query("ROLLBACK");
                return res.status(404).json({ error: "章节不存在，不能应用纠错" });
            }
            const storedText = chapter.text || textFromHtml(chapter.html);
            let textPatch = replaceTextAtCharOffset(storedText, originalText, correctedText, correction.start_offset);
            if (!textPatch.changed) textPatch = replaceFirstText(storedText, originalText, correctedText);
            const htmlPatch = replaceFirstText(chapter.html || "", originalText, correctedText);
            if (!textPatch.changed && !htmlPatch.changed) {
                await client.query("ROLLBACK");
                return res.status(409).json({ error: "原文已变化，未在章节中找到" });
            }
            await client.query(
                `UPDATE chapter_cache
                 SET text = $1, html = $2, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $3`,
                [
                    cleanPgText(textPatch.changed ? textPatch.value : storedText),
                    cleanPgText(htmlPatch.changed ? htmlPatch.value : chapter.html),
                    chapter.id
                ]
            );

            const rewarded = await client.query(
                `UPDATE reader_users
                 SET copper_coins = COALESCE(copper_coins, 0) + 200,
                     silver_coins = COALESCE(silver_coins, 0) + 100
                 WHERE id = $1
                 RETURNING ${botUserSelect()}`,
                [correction.user_id]
            );
            const user = rewarded.rows[0];
            if (!user) {
                await client.query("ROLLBACK");
                return res.status(409).json({ error: "提交用户不存在，无法发放奖励" });
            }

            const detail = `纠错奖励：${correction.book_title || correction.book_id} / ${correction.chapter_title || correction.chapter_id}`;
            await client.query(
                `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [user.id, normalizeTelegramId(user.telegram_id), "correction_reward", "copper", 200, user.copper_coins, detail, "admin"]
            );
            await client.query(
                `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [user.id, normalizeTelegramId(user.telegram_id), "correction_reward", "silver", 100, user.silver_coins, detail, "admin"]
            );

            const updated = await client.query(
                `UPDATE reader_corrections
                 SET status = 'approved',
                     review_note = $2,
                     reviewed_by = $3,
                     reviewed_at = CURRENT_TIMESTAMP,
                     applied_at = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1
                 RETURNING *`,
                [correction.id, String(req.body?.note || "").slice(0, 500), req.session.adminUser?.username || "admin"]
            );
            await client.query(
                `INSERT INTO upload_events
                 (event_type, action, book_id, chapter_id, title, platform, source, uploader, uploader_id, details, telegram_status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                [
                    "correction",
                    "approve",
                    correction.book_id,
                    correction.chapter_id,
                    correction.chapter_title || chapter.title || "",
                    chapter.platform || "",
                    "admin",
                    req.session.adminUser?.username || "admin",
                    req.session.adminUser?.username || "admin",
                    JSON.stringify({ correctionId: correction.id, reward: { copper: 200, silver: 100 }, htmlApplied: htmlPatch.changed }),
                    "skipped"
                ]
            );
            await client.query("COMMIT");
            res.json({ success: true, correction: updated.rows[0], user: publicAdminReaderUser(user), htmlApplied: htmlPatch.changed });
        } catch (err) {
            try {
                await client.query("ROLLBACK");
            } catch {}
            next(err);
        } finally {
            client.release();
        }
    });

    router.post("/admin-api/corrections/:id/reject", requireAdmin, async (req, res, next) => {
        try {
            const updated = await query(
                `UPDATE reader_corrections
                 SET status = 'rejected',
                     review_note = $2,
                     reviewed_by = $3,
                     reviewed_at = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND status = 'pending'
                 RETURNING *`,
                [req.params.id, String(req.body?.note || "").slice(0, 500), req.session.adminUser?.username || "admin"]
            );
            if (!updated.rows[0]) return res.status(404).json({ error: "待审核纠错不存在或已审核" });
            res.json({ success: true, correction: updated.rows[0] });
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/stats", requireAdmin, async (req, res, next) => {
        const started = Date.now();
        try {
            const cached = getFreshCache(adminStatsCache, ADMIN_STATS_CACHE_MS);
            if (cached) {
                res.setHeader("X-PO18-Cache", "hit");
                res.setHeader("X-PO18-Stats-Ms", String(Date.now() - started));
                return res.json({ ...cached, cached: true });
            }
            const [bookStats, aggregateStats, completeStats, recentChapterStats, eventStats, feedbackUserStats, crowdUserStats, corrections, botStats, txStats, exportStats, platforms] = await Promise.all([
                query(`
                    SELECT
                        COUNT(*)::int metadata,
                        COUNT(DISTINCT book_id)::int books,
                        COUNT(*) FILTER (WHERE COALESCE(updated_at, created_at) >= now() - interval '7 days')::int metadata7d,
                        COUNT(DISTINCT COALESCE(NULLIF("uploaderId", ''), uploader))::int "metadataUploaders",
                        COUNT(DISTINCT platform)::int "platformsCount",
                        MAX(COALESCE(updated_at, created_at)) "lastMetadataAt"
                    FROM book_metadata
                `),
                query(`
                    SELECT
                        COALESCE(SUM(cache_count), 0)::int chapters,
                        COUNT(*) FILTER (WHERE cache_count > 0)::int "cachedBooks",
                        COALESCE(SUM(like_count), 0)::int "feedbackLikes",
                        COALESCE(SUM(dislike_count), 0)::int "feedbackDislikes",
                        COALESCE(SUM(crowd_votes), 0)::int "crowdVotes",
                        COUNT(*) FILTER (WHERE crowd_votes > 0)::int "crowdBooks",
                        COALESCE(SUM(crowd_silver), 0)::bigint "crowdSilver",
                        MAX(last_chapter_at) "lastChapterAt"
                    FROM book_stats
                `),
                query(`
                    WITH latest_metadata AS (
                        SELECT DISTINCT ON (book_id)
                            book_id,
                            GREATEST(
                                COALESCE(total_chapters, 0),
                                COALESCE(subscribed_chapters, 0),
                                COALESCE(chapter_count, 0)
                            )::int expected_chapters
                        FROM book_metadata
                        ORDER BY book_id,
                            GREATEST(
                                COALESCE(total_chapters, 0),
                                COALESCE(subscribed_chapters, 0),
                                COALESCE(chapter_count, 0)
                            ) DESC,
                            COALESCE(updated_at, created_at) DESC,
                            id DESC
                    )
                    SELECT COUNT(*) FILTER (
                        WHERE expected_chapters > 0
                          AND COALESCE(bs.cache_count, 0) > expected_chapters * 0.8
                    )::int "completeBooks"
                    FROM latest_metadata lm
                    LEFT JOIN book_stats bs ON bs.book_id = lm.book_id
                `),
                query(`
                    SELECT
                        COUNT(*) FILTER (WHERE touched_at >= now() - interval '7 days')::int chapters7d,
                        COUNT(*) FILTER (WHERE touched_at >= now() - interval '1 day')::int chapters24h,
                        COUNT(*) FILTER (WHERE touched_at >= CURRENT_DATE::timestamp AND touched_at < CURRENT_DATE::timestamp + interval '1 day')::int "chaptersToday",
                        COUNT(DISTINCT uploader_identity)::int uploaders
                    FROM (
                        SELECT
                            COALESCE(updated_at, created_at) touched_at,
                            COALESCE(NULLIF("uploaderId", ''), uploader) uploader_identity
                        FROM chapter_cache
                    ) c
                `),
                query(`
                    SELECT
                        COUNT(*)::int events,
                        COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int events7d,
                        COUNT(*) FILTER (WHERE created_at >= now() - interval '1 day')::int events24h
                    FROM upload_events
                `),
                query(
                    `SELECT
                        COUNT(DISTINCT user_id)::int users
                     FROM reader_book_feedback`
                ),
                query(
                    `SELECT
                        COUNT(DISTINCT user_id)::int users
                     FROM reader_book_crowd_votes`
                ),
                query(
                    `SELECT
                        COUNT(*)::int total,
                        COUNT(*) FILTER (WHERE status = 'pending')::int pending,
                        COUNT(*) FILTER (WHERE status = 'approved')::int approved,
                        COUNT(*) FILTER (WHERE status = 'rejected')::int rejected,
                        COUNT(DISTINCT user_id)::int users
                     FROM reader_corrections`
                ),
                query(
                    `SELECT
                        COUNT(*) FILTER (WHERE COALESCE(telegram_id, '') <> '')::int bot_users,
                        COUNT(*) FILTER (WHERE COALESCE(telegram_id, '') <> '' AND COALESCE(is_banned, FALSE) = FALSE)::int bot_active_users,
                        COUNT(*) FILTER (WHERE COALESCE(telegram_id, '') <> '' AND last_sign_date = CURRENT_DATE)::int bot_signed_today,
                        COUNT(*) FILTER (WHERE COALESCE(telegram_id, '') <> '' AND last_sign_date >= CURRENT_DATE - INTERVAL '7 days')::int bot_signed_7d,
                        COUNT(*) FILTER (WHERE COALESCE(telegram_id, '') <> '' AND export_unlocked_at IS NOT NULL)::int bot_export_unlocked,
                        COALESCE(SUM(copper_coins) FILTER (WHERE COALESCE(telegram_id, '') <> ''), 0)::bigint bot_copper_total,
                        COALESCE(SUM(silver_coins) FILTER (WHERE COALESCE(telegram_id, '') <> ''), 0)::bigint bot_silver_total
                     FROM reader_users`
                ),
                query(`
                    SELECT
                        COUNT(*)::int "botTransactions",
                        COUNT(*) FILTER (WHERE created_at >= now() - interval '1 day')::int "botTransactions24h",
                        COUNT(DISTINCT telegram_id) FILTER (WHERE created_at >= now() - interval '7 days' AND COALESCE(telegram_id, '') <> '')::int "botTxUsers7d"
                    FROM reader_transactions
                    WHERE source = 'telegram_bot'
                `),
                query(
                    `SELECT
                        COUNT(DISTINCT user_id)::int "botFreeExportUsersToday",
                        COUNT(*)::int "botFreeExportBooksToday"
                     FROM reader_export_usage
                     WHERE export_date = $1::date AND charge_type = 'free_quota'`,
                    [todayDateKey()]
                ),
                query("SELECT platform, COUNT(*)::int count FROM book_metadata GROUP BY platform ORDER BY count DESC")
            ]);
            const bookRow = bookStats.rows[0] || {};
            const aggregateRow = aggregateStats.rows[0] || {};
            const completeRow = completeStats.rows[0] || {};
            const recentChapterRow = recentChapterStats.rows[0] || {};
            const eventRow = eventStats.rows[0] || {};
            const txRow = txStats.rows[0] || {};
            const exportRow = exportStats.rows[0] || {};
            const bookCount = bookRow.books || 0;
            const chapterCount = aggregateRow.chapters || 0;
            const cachedBookCount = aggregateRow.cachedBooks || 0;
            const feedbackLikes = Number(aggregateRow.feedbackLikes || 0);
            const feedbackDislikes = Number(aggregateRow.feedbackDislikes || 0);
            const payload = {
                metadata: bookRow.metadata || 0,
                books: bookCount,
                cachedBooks: cachedBookCount,
                completeBooks: completeRow.completeBooks || 0,
                chapters: chapterCount,
                metadata7d: bookRow.metadata7d || 0,
                metadataUploaders: bookRow.metadataUploaders || 0,
                platformsCount: bookRow.platformsCount || 0,
                lastMetadataAt: bookRow.lastMetadataAt || null,
                chapters7d: recentChapterRow.chapters7d || 0,
                chapters24h: recentChapterRow.chapters24h || 0,
                chaptersToday: recentChapterRow.chaptersToday || 0,
                uploaders: recentChapterRow.uploaders || 0,
                lastChapterAt: aggregateRow.lastChapterAt || null,
                events7d: eventRow.events7d || 0,
                events24h: eventRow.events24h || 0,
                botTransactions: txRow.botTransactions || 0,
                botTransactions24h: txRow.botTransactions24h || 0,
                botTxUsers7d: txRow.botTxUsers7d || 0,
                botFreeExportUsersToday: exportRow.botFreeExportUsersToday || 0,
                botFreeExportBooksToday: exportRow.botFreeExportBooksToday || 0,
                metadata24h: 0,
                metadataToday: 0,
                platforms: platforms.rows,
                topUploaders: [],
                events: eventRow.events || 0,
                feedback: feedbackLikes + feedbackDislikes,
                feedbackLikes,
                feedbackDislikes,
                feedbackUsers: feedbackUserStats.rows[0].users,
                crowdVotes: aggregateRow.crowdVotes || 0,
                crowdBooks: aggregateRow.crowdBooks || 0,
                crowdUsers: crowdUserStats.rows[0].users,
                crowdSilver: aggregateRow.crowdSilver || 0,
                corrections: corrections.rows[0].total,
                correctionsPending: corrections.rows[0].pending,
                correctionsApproved: corrections.rows[0].approved,
                correctionsRejected: corrections.rows[0].rejected,
                correctionUsers: corrections.rows[0].users,
                botUsers: botStats.rows[0].bot_users,
                botActiveUsers: botStats.rows[0].bot_active_users,
                botSignedToday: botStats.rows[0].bot_signed_today,
                botSigned7d: botStats.rows[0].bot_signed_7d,
                botExportUnlocked: botStats.rows[0].bot_export_unlocked,
                botCopperTotal: botStats.rows[0].bot_copper_total,
                botSilverTotal: botStats.rows[0].bot_silver_total,
                avgChaptersPerBook: cachedBookCount ? Number((chapterCount / cachedBookCount).toFixed(1)) : 0,
                mainDbSize: 0,
                sidecarDbSize: 0,
                uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
                startedAt: new Date(STARTED_AT).toISOString()
            };
            setFreshCache(adminStatsCache, payload);
            res.setHeader("X-PO18-Cache", "miss");
            res.setHeader("X-PO18-Stats-Ms", String(Date.now() - started));
            res.json(payload);
        } catch (err) {
            next(err);
        }
    });

    router.use(createAdminUsersRoutes(deps));

    router.use(createAdminMaintenanceRoutes(deps));

    router.use(createAdminLibraryRoutes(deps));

    router.get("/admin-api/events", requireAdmin, async (req, res, next) => {
        try {
            const limit = Math.min(300, Math.max(20, Number(req.query.limit || 80)));
            const rows = await query("SELECT * FROM upload_events ORDER BY id DESC LIMIT $1", [limit]);
            res.json({ rows: rows.rows });
        } catch (err) {
            next(err);
        }
    });

    return router;
}

module.exports = { createAdminContentRoutes };


