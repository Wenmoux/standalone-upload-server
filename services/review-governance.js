/**
 * [INPUT]: 依赖注入的 PostgreSQL query/事务、书评举报与申诉身份上下文及治理阈值
 * [OUTPUT]: 对外提供书评举报原因常量、治理服务工厂、领域错误和文本/整数规范化函数
 * [POS]: services 的书评治理聚合根，在事务内维护举报计数、隐藏状态、申诉与审核决议一致性
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const REPORT_REASONS = new Set(["spam", "abuse", "spoiler", "illegal", "other"]);

function governanceError(status, code, message, details) {
    return Object.assign(new Error(message), { status, code, details });
}

function positiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? Math.min(number, max) : fallback;
}

function normalizedText(value, maxLength) {
    return String(value || "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function createReviewGovernanceService(options = {}) {
    const query = options.query;
    const pool = options.pool;
    const autoReviewThreshold = positiveInteger(options.autoReviewThreshold ?? process.env.PO18_REVIEW_REPORT_THRESHOLD, 3, 20);
    const dailyReportLimit = positiveInteger(options.dailyReportLimit ?? process.env.PO18_REVIEW_REPORT_DAILY_LIMIT, 5, 100);

    if (typeof query !== "function" || !pool) throw new Error("review governance query and pool are required");

    async function actor(db, input = {}) {
        const userId = Number(input.userId || 0);
        const telegramId = String(input.telegramId || "").trim();
        const result = Number.isSafeInteger(userId) && userId > 0
            ? await db.query("SELECT id, telegram_id, is_banned FROM reader_users WHERE id=$1 LIMIT 1", [userId])
            : await db.query("SELECT id, telegram_id, is_banned FROM reader_users WHERE telegram_id=$1 LIMIT 1", [telegramId]);
        const user = result.rows[0];
        if (!user) throw governanceError(404, "REVIEW_ACTOR_NOT_FOUND", "review actor not found");
        if (user.is_banned) throw governanceError(403, "REVIEW_ACTOR_BANNED", "account is restricted");
        return user;
    }

    async function reportReview(input = {}) {
        const reviewId = Number(input.reviewId);
        const reason = String(input.reason || "").trim().toLowerCase();
        const details = normalizedText(input.details, 2000);
        if (!Number.isSafeInteger(reviewId) || reviewId <= 0) throw governanceError(400, "REVIEW_ID_INVALID", "invalid review id");
        if (!REPORT_REASONS.has(reason)) throw governanceError(400, "REVIEW_REPORT_REASON_INVALID", "invalid report reason");

        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            const user = await actor(db, input);
            const reviewResult = await db.query("SELECT id, user_id, status FROM reader_book_reviews WHERE id=$1 FOR UPDATE", [reviewId]);
            const review = reviewResult.rows[0];
            if (!review) throw governanceError(404, "REVIEW_NOT_FOUND", "review not found");
            if (Number(review.user_id) === Number(user.id)) throw governanceError(409, "REVIEW_SELF_REPORT", "cannot report your own review");
            const activity = await db.query(
                "SELECT COUNT(*)::int count FROM reader_book_review_reports WHERE reporter_user_id=$1 AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 day'",
                [user.id]
            );
            if (Number(activity.rows[0]?.count || 0) >= dailyReportLimit) {
                throw governanceError(429, "REVIEW_REPORT_RATE_LIMIT", "daily review report limit reached", { retry_after: 3600 });
            }
            const saved = await db.query(
                `INSERT INTO reader_book_review_reports(review_id, reporter_user_id, telegram_id, reason, details)
                 VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (review_id, reporter_user_id) DO UPDATE SET
                    reason=EXCLUDED.reason, details=EXCLUDED.details, status='pending',
                    resolved_by=NULL, resolution_note='', reviewed_at=NULL, updated_at=CURRENT_TIMESTAMP
                 RETURNING *`,
                [reviewId, user.id, user.telegram_id || String(input.telegramId || ""), reason, details]
            );
            const reportCount = await db.query(
                "SELECT COUNT(DISTINCT reporter_user_id)::int count FROM reader_book_review_reports WHERE review_id=$1 AND status='pending'",
                [reviewId]
            );
            const count = Number(reportCount.rows[0]?.count || 0);
            let reviewStatus = review.status;
            if (count >= autoReviewThreshold && review.status === "published") {
                const hidden = await db.query(
                    "UPDATE reader_book_reviews SET status='under_review', updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING status",
                    [reviewId]
                );
                reviewStatus = hidden.rows[0]?.status || "under_review";
            }
            await db.query("COMMIT");
            return { success: true, report: saved.rows[0], report_count: count, review_status: reviewStatus, auto_review_threshold: autoReviewThreshold };
        } catch (error) {
            await db.query("ROLLBACK").catch(() => {});
            throw error;
        } finally {
            db.release();
        }
    }

    async function appealReview(input = {}) {
        const reviewId = Number(input.reviewId);
        const content = normalizedText(input.content, 2000);
        if (!Number.isSafeInteger(reviewId) || reviewId <= 0) throw governanceError(400, "REVIEW_ID_INVALID", "invalid review id");
        if (Array.from(content).length < 6) throw governanceError(400, "REVIEW_APPEAL_TOO_SHORT", "appeal must contain at least 6 characters");

        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            const user = await actor(db, input);
            const reviewResult = await db.query("SELECT id, user_id, status FROM reader_book_reviews WHERE id=$1 FOR UPDATE", [reviewId]);
            const review = reviewResult.rows[0];
            if (!review) throw governanceError(404, "REVIEW_NOT_FOUND", "review not found");
            if (Number(review.user_id) !== Number(user.id)) throw governanceError(403, "REVIEW_APPEAL_NOT_AUTHOR", "only the review author can appeal");
            if (!["hidden", "under_review"].includes(review.status)) {
                throw governanceError(409, "REVIEW_APPEAL_NOT_AVAILABLE", "only hidden or under-review content can be appealed");
            }
            const saved = await db.query(
                `INSERT INTO reader_book_review_appeals(review_id, appellant_user_id, telegram_id, content)
                 VALUES ($1,$2,$3,$4)
                 ON CONFLICT (review_id, appellant_user_id) WHERE status='pending' DO UPDATE SET
                    content=EXCLUDED.content, updated_at=CURRENT_TIMESTAMP
                 RETURNING *`,
                [reviewId, user.id, user.telegram_id || String(input.telegramId || ""), content]
            );
            await db.query("COMMIT");
            return { success: true, appeal: saved.rows[0] };
        } catch (error) {
            await db.query("ROLLBACK").catch(() => {});
            throw error;
        } finally {
            db.release();
        }
    }

    async function listUserAppeals(userId) {
        const safeUserId = Number(userId);
        if (!Number.isSafeInteger(safeUserId) || safeUserId <= 0) return { rows: [] };
        const result = await query(
            `SELECT a.*, r.book_id, r.content review_content, r.status review_status
             FROM reader_book_review_appeals a
             JOIN reader_book_reviews r ON r.id=a.review_id
             WHERE a.appellant_user_id=$1
             ORDER BY a.created_at DESC, a.id DESC LIMIT 100`,
            [safeUserId]
        );
        return { rows: result.rows };
    }

    async function listModeration(input = {}) {
        const kind = String(input.kind || "reports") === "appeals" ? "appeals" : "reports";
        const status = String(input.status || "pending").trim().toLowerCase();
        const limit = positiveInteger(input.limit, 50, 200);
        const page = positiveInteger(input.page, 1, 1000000);
        const offset = (page - 1) * limit;
        const params = [status, limit, offset];
        const table = kind === "appeals" ? "reader_book_review_appeals" : "reader_book_review_reports";
        const actorColumn = kind === "appeals" ? "appellant_user_id" : "reporter_user_id";
        const count = await query(`SELECT COUNT(*)::int count FROM ${table} WHERE ($1='' OR status=$1)`, [status]);
        const result = await query(
            `SELECT q.*, r.book_id, r.content review_content, r.status review_status,
                    u.username actor_username, u.nickname actor_nickname, u.telegram_username actor_telegram_username,
                    author.username author_username, author.nickname author_nickname
             FROM ${table} q
             JOIN reader_book_reviews r ON r.id=q.review_id
             LEFT JOIN reader_users u ON u.id=q.${actorColumn}
             LEFT JOIN reader_users author ON author.id=r.user_id
             WHERE ($1='' OR q.status=$1)
             ORDER BY CASE WHEN q.status='pending' THEN 0 ELSE 1 END, q.created_at ASC, q.id ASC
             LIMIT $2 OFFSET $3`,
            params
        );
        return { kind, status, page, limit, total: Number(count.rows[0]?.count || 0), rows: result.rows };
    }

    async function resolveReport(input = {}) {
        const reportId = Number(input.reportId);
        const adminId = Number(input.adminId);
        const action = String(input.action || "").trim().toLowerCase();
        const note = normalizedText(input.note, 2000);
        if (!Number.isSafeInteger(reportId) || reportId <= 0) throw governanceError(400, "REVIEW_REPORT_ID_INVALID", "invalid report id");
        if (!["hide", "restore", "dismiss"].includes(action)) throw governanceError(400, "REVIEW_MODERATION_ACTION_INVALID", "invalid moderation action");
        if (Array.from(note).length < 2) throw governanceError(400, "REVIEW_MODERATION_NOTE_REQUIRED", "moderation note is required");
        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            const found = await db.query(
                "SELECT p.*, r.status review_status FROM reader_book_review_reports p JOIN reader_book_reviews r ON r.id=p.review_id WHERE p.id=$1 FOR UPDATE OF p, r",
                [reportId]
            );
            const report = found.rows[0];
            if (!report) throw governanceError(404, "REVIEW_REPORT_NOT_FOUND", "review report not found");
            const reviewStatus = action === "hide" ? "hidden" : action === "restore" ? "published" : report.review_status;
            if (action !== "dismiss") {
                await db.query("UPDATE reader_book_reviews SET status=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1", [report.review_id, reviewStatus]);
            }
            const status = action === "dismiss" ? "rejected" : "resolved";
            const updated = await db.query(
                `UPDATE reader_book_review_reports SET status=$2, resolved_by=$3, resolution_note=$4,
                    reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,
                [reportId, status, Number.isSafeInteger(adminId) && adminId > 0 ? adminId : null, note]
            );
            await db.query("COMMIT");
            return { success: true, action, review_status: reviewStatus, report: updated.rows[0] };
        } catch (error) {
            await db.query("ROLLBACK").catch(() => {});
            throw error;
        } finally {
            db.release();
        }
    }

    async function resolveAppeal(input = {}) {
        const appealId = Number(input.appealId);
        const adminId = Number(input.adminId);
        const action = String(input.action || "").trim().toLowerCase();
        const note = normalizedText(input.note, 2000);
        if (!Number.isSafeInteger(appealId) || appealId <= 0) throw governanceError(400, "REVIEW_APPEAL_ID_INVALID", "invalid appeal id");
        if (!["accept", "reject"].includes(action)) throw governanceError(400, "REVIEW_APPEAL_ACTION_INVALID", "invalid appeal action");
        if (Array.from(note).length < 2) throw governanceError(400, "REVIEW_MODERATION_NOTE_REQUIRED", "moderation note is required");
        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            const found = await db.query(
                "SELECT a.*, r.status review_status FROM reader_book_review_appeals a JOIN reader_book_reviews r ON r.id=a.review_id WHERE a.id=$1 FOR UPDATE OF a, r",
                [appealId]
            );
            const appeal = found.rows[0];
            if (!appeal) throw governanceError(404, "REVIEW_APPEAL_NOT_FOUND", "review appeal not found");
            if (action === "accept") {
                await db.query("UPDATE reader_book_reviews SET status='published', updated_at=CURRENT_TIMESTAMP WHERE id=$1", [appeal.review_id]);
            }
            const updated = await db.query(
                `UPDATE reader_book_review_appeals SET status=$2, resolved_by=$3, resolution_note=$4,
                    reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,
                [appealId, action === "accept" ? "accepted" : "rejected", Number.isSafeInteger(adminId) && adminId > 0 ? adminId : null, note]
            );
            await db.query("COMMIT");
            return { success: true, action, review_status: action === "accept" ? "published" : appeal.review_status, appeal: updated.rows[0] };
        } catch (error) {
            await db.query("ROLLBACK").catch(() => {});
            throw error;
        } finally {
            db.release();
        }
    }

    return { appealReview, listModeration, listUserAppeals, reportReview, resolveAppeal, resolveReport };
}

module.exports = { REPORT_REASONS, createReviewGovernanceService, governanceError, normalizedText, positiveInteger };
