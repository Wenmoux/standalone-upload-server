/**
 * [INPUT]: 依赖 Express/crypto、Admin/owner 权限、用户经济/CDK/搜索需求服务、PostgreSQL 与 CSV 输出
 * [OUTPUT]: 对外提供 Reader/Bot 用户、管理员授权、余额流水、CDK、搜索需求与管理导出路由
 * [POS]: routes 的后台用户经济与授权协议边界，精确隔离 owner 管理员切换并依赖事务型 service 结算账本
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const crypto = require("crypto");
const express = require("express");
void crypto;

function html(value) {
    return String(value ?? "").replace(
        /[&<>"']/g,
        (char) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            })[char]
    );
}

function createAdminUsersRoutes(deps = {}) {
    const router = express.Router();
    const {
        requireAdmin,
        query,
        todayDateKey,
        publicAdminReaderUser,
        listTransactions,
        crowdLeaderboard,
        hashPassword,
        nonNegativeInt,
        recordTransaction,
        botUserSelect,
        addMembershipPatch,
        cdkDuration,
        csvCell,
        sendCsv,
        generateCdkCode,
        sendDirectMessage = async () => {
            throw new Error("telegram notification unavailable");
        },
        readerPublicUrl = ""
    } = deps;

    function requireOwner(req, res, next) {
        const role = String(req.session?.adminUser?.role || "owner")
            .trim()
            .toLowerCase();
        if (role !== "owner") return res.status(403).json({ error: "仅 owner 可以设置 Reader/Bot 管理员" });
        next();
    }

    router.get("/admin-api/users", requireAdmin, async (req, res, next) => {
        try {
            const params = [todayDateKey()];
            const where = [];
            const q = String(req.query.q || req.query.username || "").trim();
            const telegramId = String(req.query.telegram_id || req.query.telegramId || "").trim();
            const membership = String(req.query.membership || "")
                .trim()
                .toLowerCase();
            const status = String(req.query.status || "")
                .trim()
                .toLowerCase();
            if (q) {
                params.push(`%${q}%`);
                where.push(`(u.username ILIKE $${params.length} OR u.nickname ILIKE $${params.length})`);
            }
            if (telegramId) {
                params.push(`%${telegramId}%`);
                where.push(`(u.telegram_id ILIKE $${params.length} OR u.telegram_username ILIKE $${params.length})`);
            }
            if (membership === "active") {
                where.push(`(u.membership_permanent IS TRUE OR u.membership_expires_at > CURRENT_TIMESTAMP)`);
            } else if (membership === "permanent") {
                where.push(`u.membership_permanent IS TRUE`);
            } else if (membership === "expired") {
                where.push(
                    `u.membership_permanent IS NOT TRUE AND u.membership_expires_at IS NOT NULL AND u.membership_expires_at <= CURRENT_TIMESTAMP`
                );
            } else if (membership === "none") {
                where.push(`u.membership_permanent IS NOT TRUE AND u.membership_expires_at IS NULL`);
            }
            if (status === "admin") {
                where.push(`u.is_admin IS TRUE`);
            } else if (status === "banned") {
                where.push(`u.is_banned IS TRUE`);
            } else if (status === "library_disabled") {
                where.push(`u.library_access IS NOT TRUE`);
            } else if (status === "normal") {
                where.push(`u.is_admin IS NOT TRUE AND u.is_banned IS NOT TRUE`);
            }
            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
            const rows = await query(
                `SELECT u.id, u.username, u.nickname, u.avatar_url, u.membership_expires_at, u.membership_permanent, u.library_access,
                        u.copper_coins, u.silver_coins, u.sign_cycle_day, u.last_sign_date, u.telegram_id, u.telegram_username,
                        u.created_at, u.last_login_at, u.is_admin, u.is_banned, u.invite_count, u.inviter_telegram_id,
                        u.export_unlocked_at, u.export_extra_quota, u.scholar_exp, COALESCE(e.free_exports_today, 0)::int free_exports_today
                 FROM reader_users u
                 LEFT JOIN (
                    SELECT user_id, COUNT(DISTINCT book_id)::int free_exports_today
                    FROM reader_export_usage
                    WHERE export_date = $1::date AND charge_type = 'free_quota'
                    GROUP BY user_id
                 ) e ON e.user_id = u.id
                 ${whereSql}
                 ORDER BY u.id DESC LIMIT 500`,
                params
            );
            res.json({ rows: rows.rows.map(publicAdminReaderUser) });
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/users/export.csv", requireAdmin, async (req, res, next) => {
        try {
            const params = [todayDateKey()];
            const where = [];
            const q = String(req.query.q || req.query.username || "").trim();
            const telegramId = String(req.query.telegram_id || req.query.telegramId || "").trim();
            const membership = String(req.query.membership || "")
                .trim()
                .toLowerCase();
            const status = String(req.query.status || "")
                .trim()
                .toLowerCase();
            if (q) {
                params.push(`%${q}%`);
                where.push(`(u.username ILIKE $${params.length} OR u.nickname ILIKE $${params.length})`);
            }
            if (telegramId) {
                params.push(`%${telegramId}%`);
                where.push(`(u.telegram_id ILIKE $${params.length} OR u.telegram_username ILIKE $${params.length})`);
            }
            if (membership === "active") where.push(`(u.membership_permanent IS TRUE OR u.membership_expires_at > CURRENT_TIMESTAMP)`);
            else if (membership === "permanent") where.push(`u.membership_permanent IS TRUE`);
            else if (membership === "expired")
                where.push(
                    `u.membership_permanent IS NOT TRUE AND u.membership_expires_at IS NOT NULL AND u.membership_expires_at <= CURRENT_TIMESTAMP`
                );
            else if (membership === "none") where.push(`u.membership_permanent IS NOT TRUE AND u.membership_expires_at IS NULL`);
            if (status === "admin") where.push(`u.is_admin IS TRUE`);
            else if (status === "banned") where.push(`u.is_banned IS TRUE`);
            else if (status === "library_disabled") where.push(`u.library_access IS NOT TRUE`);
            else if (status === "normal") where.push(`u.is_admin IS NOT TRUE AND u.is_banned IS NOT TRUE`);
            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
            const rows = await query(
                `SELECT u.id, u.username, u.nickname, u.library_access, u.membership_expires_at, u.membership_permanent,
                        u.copper_coins, u.silver_coins, u.scholar_exp, u.sign_cycle_day, u.last_sign_date,
                        u.telegram_id, u.telegram_username, u.is_admin, u.is_banned, u.invite_count, u.inviter_telegram_id,
                        u.export_unlocked_at, u.export_extra_quota, COALESCE(e.free_exports_today, 0)::int free_exports_today,
                        u.created_at, u.last_login_at
                 FROM reader_users u
                 LEFT JOIN (
                    SELECT user_id, COUNT(DISTINCT book_id)::int free_exports_today
                    FROM reader_export_usage
                    WHERE export_date = $1::date AND charge_type = 'free_quota'
                    GROUP BY user_id
                 ) e ON e.user_id = u.id
                 ${whereSql}
                 ORDER BY u.id DESC
                 LIMIT 20000`,
                params
            );
            sendCsv(
                res,
                `po18-users-${todayDateKey()}.csv`,
                rows.rows,
                [
                    "id",
                    "username",
                    "nickname",
                    "library_access",
                    "membership_expires_at",
                    "membership_permanent",
                    "copper_coins",
                    "silver_coins",
                    "scholar_exp",
                    "sign_cycle_day",
                    "last_sign_date",
                    "telegram_id",
                    "telegram_username",
                    "is_admin",
                    "is_banned",
                    "invite_count",
                    "inviter_telegram_id",
                    "export_unlocked_at",
                    "export_extra_quota",
                    "free_exports_today",
                    "created_at",
                    "last_login_at"
                ].map((key) => ({ key, label: key }))
            );
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/transactions", requireAdmin, async (req, res, next) => {
        try {
            const page = Math.max(1, Number(req.query.page || 1));
            const limit = Math.max(1, Math.min(200, Number(req.query.limit || 80)));
            const result = await listTransactions({
                telegramId: req.query.telegram_id || req.query.telegramId || "",
                userId: req.query.user_id || req.query.userId || "",
                type: req.query.type || "",
                currency: req.query.currency || "",
                limit,
                offset: (page - 1) * limit
            });
            res.json({ ...result, page });
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/transactions/export.csv", requireAdmin, async (req, res, next) => {
        try {
            const result = await listTransactions({
                telegramId: req.query.telegram_id || req.query.telegramId || "",
                userId: req.query.user_id || req.query.userId || "",
                type: req.query.type || "",
                currency: req.query.currency || "",
                limit: Math.max(1, Math.min(20000, Number(req.query.limit || 10000))),
                offset: 0
            });
            sendCsv(
                res,
                `po18-transactions-${todayDateKey()}.csv`,
                result.rows || [],
                [
                    "id",
                    "user_id",
                    "telegram_id",
                    "username",
                    "nickname",
                    "telegram_username",
                    "type",
                    "currency",
                    "amount",
                    "balance",
                    "detail",
                    "source",
                    "created_at"
                ].map((key) => ({ key, label: key }))
            );
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/book-feedback", requireAdmin, async (req, res, next) => {
        try {
            const limit = Math.max(1, Math.min(200, Number(req.query.limit || 80)));
            const rows = await query(
                `SELECT f.book_id,
                        COUNT(*) FILTER (WHERE f.feedback = 'like')::int like_count,
                        COUNT(*) FILTER (WHERE f.feedback = 'dislike')::int dislike_count,
                        COUNT(DISTINCT f.user_id)::int feedback_users,
                        MAX(f.created_at) latest_at,
                        m.title, m.author, m.platform
                 FROM reader_book_feedback f
                 LEFT JOIN LATERAL (
                    SELECT title, author, platform FROM book_metadata bm
                    WHERE bm.book_id = f.book_id
                    ORDER BY COALESCE(bm.subscribed_chapters, 0) DESC, COALESCE(bm.updated_at, bm.created_at) DESC, bm.id DESC
                    LIMIT 1
                 ) m ON true
                 GROUP BY f.book_id, m.title, m.author, m.platform
                 ORDER BY like_count DESC, dislike_count ASC, latest_at DESC
                 LIMIT $1`,
                [limit]
            );
            res.json({ rows: rows.rows });
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/search-requests", requireAdmin, async (req, res, next) => {
        try {
            const limit = Math.max(1, Math.min(300, Number(req.query.limit || 120)));
            const rows = await query(
                `WITH ranked AS (
                    SELECT
                        r.*,
                        ROW_NUMBER() OVER (
                            PARTITION BY r.query, r.platform, r.search_type
                            ORDER BY COALESCE(r.updated_at, r.created_at) DESC, r.id DESC
                        ) rn
                    FROM reader_search_requests r
                )
                SELECT
                    r.query,
                    MAX(r.clean_query) FILTER (WHERE r.rn = 1) clean_query,
                    r.platform,
                    r.search_type,
                    COUNT(*)::int submit_count,
                    COUNT(DISTINCT r.user_id)::int user_count,
                    MAX(COALESCE(r.updated_at, r.created_at)) latest_at,
                    MAX(r.telegram_id) FILTER (WHERE r.rn = 1) latest_telegram_id,
                    MAX(r.telegram_username) FILTER (WHERE r.rn = 1) latest_telegram_username,
                    MAX(r.nickname) FILTER (WHERE r.rn = 1) latest_nickname,
                    MAX(r.status) FILTER (WHERE r.rn = 1) status
                 FROM ranked r
                 GROUP BY r.query, r.platform, r.search_type
                 ORDER BY submit_count DESC, latest_at DESC
                 LIMIT $1`,
                [limit]
            );
            const summary = await query(
                `SELECT
                    COUNT(*)::int total,
                    COUNT(DISTINCT query)::int keywords,
                    COUNT(DISTINCT user_id)::int users,
                    COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int recent7d,
                    COUNT(*) FILTER (WHERE created_at >= now() - interval '1 day')::int recent24h
                 FROM reader_search_requests`
            );
            res.json({ rows: rows.rows, summary: summary.rows[0] || {}, limit });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/search-requests/resolve", requireAdmin, async (req, res, next) => {
        try {
            const queryText = String(req.body?.query || "").trim();
            const platform = String(req.body?.platform || "").trim();
            const searchType = String(req.body?.search_type || req.body?.searchType || "search").trim() || "search";
            const status = String(req.body?.status || "")
                .trim()
                .toLowerCase();
            const bookId = String(req.body?.book_id || req.body?.bookId || "").trim();
            const note = String(req.body?.note || "")
                .trim()
                .slice(0, 500);
            const notify = req.body?.notify !== false;
            const allowed = new Set(["pending", "accepted", "crawling", "cached", "rejected"]);
            if (!queryText) return res.status(400).json({ error: "query is required" });
            if (!allowed.has(status)) return res.status(400).json({ error: "invalid search request status" });
            if (status === "cached" && !bookId) return res.status(400).json({ error: "book_id is required when status is cached" });

            const updated = await query(
                `UPDATE reader_search_requests
                 SET status=$4,
                     resolved_book_id=$5,
                     resolution_note=$6,
                     resolved_at=CASE WHEN $4 IN ('cached', 'rejected') THEN CURRENT_TIMESTAMP ELSE NULL END,
                     notified_at=CASE WHEN $4 <> 'cached' THEN NULL ELSE notified_at END,
                     updated_at=CURRENT_TIMESTAMP
                 WHERE query=$1 AND COALESCE(platform, '')=$2 AND COALESCE(search_type, 'search')=$3
                 RETURNING id, telegram_id, telegram_username, nickname, notified_at`,
                [queryText, platform, searchType, status, bookId, note]
            );

            const rows = updated.rows || [];
            const notification = { requested: status === "cached" && notify, sent: 0, failed: 0, errors: [] };
            if (notification.requested && rows.length) {
                const recipients = new Map();
                for (const row of rows) {
                    const telegramId = String(row.telegram_id || "").trim();
                    if (!telegramId || row.notified_at || recipients.has(telegramId)) continue;
                    recipients.set(telegramId, row);
                }
                const base = String(readerPublicUrl || "")
                    .trim()
                    .replace(/\/+$/, "");
                const detailUrl = base && /^https?:\/\//i.test(base) ? `${base}/#/detail?bid=${encodeURIComponent(bookId)}` : "";
                for (const [telegramId, row] of recipients) {
                    const user = row.nickname || (row.telegram_username ? `@${row.telegram_username}` : "读者");
                    const message = [
                        "<b>你提交的缺书需求已有结果</b>",
                        `关键词：${html(queryText)}`,
                        platform ? `平台：${html(platform)}` : "",
                        `书号：<code>${html(bookId)}</code>`,
                        note ? `说明：${html(note)}` : ""
                    ]
                        .filter(Boolean)
                        .join("\n");
                    try {
                        await sendDirectMessage(telegramId, message, {
                            replyMarkup: detailUrl ? { inline_keyboard: [[{ text: "打开阅读器", url: detailUrl }]] } : undefined
                        });
                        notification.sent += 1;
                        await query(
                            `UPDATE reader_search_requests SET notified_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
                             WHERE query=$1 AND COALESCE(platform, '')=$2 AND COALESCE(search_type, 'search')=$3 AND telegram_id=$4`,
                            [queryText, platform, searchType, telegramId]
                        );
                    } catch (err) {
                        notification.failed += 1;
                        notification.errors.push(`${user}: ${err.message || String(err)}`.slice(0, 300));
                    }
                }
            }

            res.json({ success: true, status, updated: rows.length, notification });
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/book-crowd", requireAdmin, async (req, res, next) => {
        try {
            const limit = Math.max(1, Math.min(200, Number(req.query.limit || 80)));
            const leaderboard = await crowdLeaderboard(limit);
            res.json({
                rows: leaderboard.rows,
                total_books: leaderboard.total_books,
                total_votes: leaderboard.total_votes,
                total_silver: leaderboard.total_silver
            });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/users", requireAdmin, async (req, res, next) => {
        try {
            const username = String(req.body?.username || "").trim();
            const password = String(req.body?.password || "");
            const nickname = String(req.body?.nickname || username).trim();
            if (!/^[A-Za-z0-9_\u4e00-\u9fa5-]{2,32}$/.test(username)) return res.status(400).json({ error: "用户名需 2-32 位" });
            if (password.length < 6) return res.status(400).json({ error: "密码至少 6 位" });
            const { salt, hash } = hashPassword(password);
            const scholarExp = nonNegativeInt(req.body?.scholar_exp ?? req.body?.scholarExp, 0);
            const created = await query(
                `INSERT INTO reader_users(username, password_hash, salt, nickname, library_access, copper_coins, silver_coins, scholar_exp)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                 RETURNING ${botUserSelect()}`,
                [
                    username,
                    hash,
                    salt,
                    nickname,
                    req.body?.library_access !== false,
                    Number(req.body?.copper_coins || 0),
                    Number(req.body?.silver_coins || 0),
                    scholarExp
                ]
            );
            if (created.rows[0].copper_coins)
                await recordTransaction({
                    userId: created.rows[0].id,
                    telegramId: created.rows[0].telegram_id,
                    type: "admin_create",
                    currency: "copper",
                    amount: created.rows[0].copper_coins,
                    balance: created.rows[0].copper_coins,
                    detail: "后台新增用户",
                    source: "admin"
                });
            if (created.rows[0].silver_coins)
                await recordTransaction({
                    userId: created.rows[0].id,
                    telegramId: created.rows[0].telegram_id,
                    type: "admin_create",
                    currency: "silver",
                    amount: created.rows[0].silver_coins,
                    balance: created.rows[0].silver_coins,
                    detail: "后台新增用户",
                    source: "admin"
                });
            if (created.rows[0].scholar_exp)
                await recordTransaction({
                    userId: created.rows[0].id,
                    telegramId: created.rows[0].telegram_id,
                    type: "admin_create",
                    currency: "exp",
                    amount: created.rows[0].scholar_exp,
                    balance: created.rows[0].scholar_exp,
                    detail: "后台新增用户",
                    source: "admin"
                });
            res.json({ success: true, user: publicAdminReaderUser(created.rows[0]) });
        } catch (err) {
            next(err);
        }
    });

    router.put("/admin-api/users/:id", requireAdmin, async (req, res, next) => {
        try {
            if (
                Object.prototype.hasOwnProperty.call(req.body || {}, "is_admin") ||
                Object.prototype.hasOwnProperty.call(req.body || {}, "isAdmin")
            ) {
                return res.status(400).json({ error: "管理员权限必须通过专用授权接口修改" });
            }
            const before = await query("SELECT id, telegram_id, copper_coins, silver_coins, scholar_exp FROM reader_users WHERE id=$1", [
                req.params.id
            ]);
            if (!before.rows[0]) return res.status(404).json({ error: "用户不存在" });
            const patch = {
                nickname: String(req.body?.nickname || "").trim(),
                avatar_url: String(req.body?.avatar_url || "").trim(),
                library_access: req.body?.library_access !== false,
                copper_coins: Number(req.body?.copper_coins || 0),
                silver_coins: Number(req.body?.silver_coins || 0),
                scholar_exp: nonNegativeInt(req.body?.scholar_exp ?? req.body?.scholarExp, 0)
            };
            if (!patch.nickname) return res.status(400).json({ error: "昵称不能为空" });
            const copperDelta = Number(patch.copper_coins || 0) - Number(before.rows[0].copper_coins || 0);
            const silverDelta = Number(patch.silver_coins || 0) - Number(before.rows[0].silver_coins || 0);
            const expDelta = Number(patch.scholar_exp || 0) - Number(before.rows[0].scholar_exp || 0);
            const reason = String(req.body?.reason || req.body?.audit_reason || req.body?.auditReason || "").trim();
            if ((copperDelta || silverDelta || expDelta) && reason.length < 2)
                return res.status(400).json({ error: "修改铜币、银币或经验必须填写原因" });
            const updated = await query(
                `UPDATE reader_users SET nickname=$1, avatar_url=$2, library_access=$3, copper_coins=$4, silver_coins=$5, scholar_exp=$6
                 WHERE id=$7 RETURNING ${botUserSelect()}`,
                [
                    patch.nickname,
                    patch.avatar_url,
                    patch.library_access,
                    patch.copper_coins,
                    patch.silver_coins,
                    patch.scholar_exp,
                    req.params.id
                ]
            );
            const detail = reason ? `后台修改：${reason}` : "后台修改";
            if (copperDelta)
                await recordTransaction({
                    userId: updated.rows[0].id,
                    telegramId: before.rows[0].telegram_id,
                    type: "admin_adjust",
                    currency: "copper",
                    amount: copperDelta,
                    balance: updated.rows[0].copper_coins,
                    detail,
                    source: "admin"
                });
            if (silverDelta)
                await recordTransaction({
                    userId: updated.rows[0].id,
                    telegramId: before.rows[0].telegram_id,
                    type: "admin_adjust",
                    currency: "silver",
                    amount: silverDelta,
                    balance: updated.rows[0].silver_coins,
                    detail,
                    source: "admin"
                });
            if (expDelta)
                await recordTransaction({
                    userId: updated.rows[0].id,
                    telegramId: before.rows[0].telegram_id,
                    type: "admin_adjust",
                    currency: "exp",
                    amount: expDelta,
                    balance: updated.rows[0].scholar_exp,
                    detail,
                    source: "admin"
                });
            res.json({ success: true, user: publicAdminReaderUser(updated.rows[0]) });
        } catch (err) {
            next(err);
        }
    });

    router.patch("/admin-api/users/:id/admin", requireAdmin, requireOwner, async (req, res, next) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "无效用户 ID" });
            if (typeof req.body?.is_admin !== "boolean") return res.status(400).json({ error: "is_admin 必须是布尔值" });
            const reason = String(req.body?.reason || req.body?.audit_reason || req.body?.auditReason || "").trim();
            if (reason.length < 2 || reason.length > 500) return res.status(400).json({ error: "设置或取消管理员必须填写 2-500 字原因" });
            const updated = await query(
                `UPDATE reader_users SET is_admin=$1
                 WHERE id=$2 RETURNING ${botUserSelect()}`,
                [req.body.is_admin, id]
            );
            if (!updated.rows[0]) return res.status(404).json({ error: "用户不存在" });
            res.json({ success: true, user: publicAdminReaderUser(updated.rows[0]) });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/users/:id/membership", requireAdmin, async (req, res, next) => {
        try {
            const found = await query("SELECT * FROM reader_users WHERE id=$1", [req.params.id]);
            const user = found.rows[0];
            if (!user) return res.status(404).json({ error: "用户不存在" });
            const duration = String(req.body?.duration_type || req.body?.duration || "");
            const patch = addMembershipPatch(user, duration);
            const updated = await query(
                `UPDATE reader_users SET membership_permanent=$1, membership_expires_at=$2, library_access=TRUE
                 WHERE id=$3 RETURNING ${botUserSelect()}`,
                [patch.permanent, patch.expiresAt, req.params.id]
            );
            res.json({ success: true, user: publicAdminReaderUser(updated.rows[0]) });
        } catch (err) {
            next(err);
        }
    });

    router.delete("/admin-api/users/:id", requireAdmin, async (req, res, next) => {
        try {
            await query("DELETE FROM reader_users WHERE id=$1", [req.params.id]);
            res.json({ success: true });
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/cdks", requireAdmin, async (req, res, next) => {
        try {
            const status = String(req.query.status || "")
                .trim()
                .toLowerCase();
            const whereSql = status === "used" ? "WHERE c.used_by IS NOT NULL" : status === "unused" ? "WHERE c.used_by IS NULL" : "";
            const rows = await query(
                `SELECT c.*, u.username used_username, u.nickname used_nickname
                 FROM reader_cdks c LEFT JOIN reader_users u ON u.id = c.used_by
                 ${whereSql}
                 ORDER BY c.id DESC LIMIT 500`
            );
            res.json({ rows: rows.rows });
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/cdks/export.csv", requireAdmin, async (req, res, next) => {
        try {
            const status = String(req.query.status || "")
                .trim()
                .toLowerCase();
            const whereSql = status === "used" ? "WHERE c.used_by IS NOT NULL" : status === "unused" ? "WHERE c.used_by IS NULL" : "";
            const rows = await query(
                `SELECT c.id, c.code, c.cdk_type, c.duration_type, c.duration_days, c.export_quota, c.created_by, c.created_at, c.used_by, c.used_at,
                        u.username used_username, u.nickname used_nickname
                 FROM reader_cdks c LEFT JOIN reader_users u ON u.id = c.used_by
                 ${whereSql}
                 ORDER BY c.id DESC`
            );
            const header = [
                "id",
                "code",
                "cdk_type",
                "duration_type",
                "duration_days",
                "export_quota",
                "status",
                "created_by",
                "created_at",
                "used_by",
                "used_username",
                "used_nickname",
                "used_at"
            ];
            const lines = [
                header.join(","),
                ...rows.rows.map((row) =>
                    [
                        row.id,
                        row.code,
                        row.cdk_type || "membership",
                        row.duration_type,
                        row.duration_days,
                        row.export_quota || 0,
                        row.used_by ? "used" : "unused",
                        row.created_by,
                        row.created_at,
                        row.used_by,
                        row.used_username,
                        row.used_nickname,
                        row.used_at
                    ]
                        .map(csvCell)
                        .join(",")
                )
            ];
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="reader-cdks-${todayDateKey()}.csv"`);
            res.send(`\uFEFF${lines.join("\r\n")}\r\n`);
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/cdks", requireAdmin, async (req, res, next) => {
        try {
            const cdkType =
                String(req.body?.cdk_type || req.body?.type || "membership")
                    .trim()
                    .toLowerCase() === "export_quota"
                    ? "export_quota"
                    : "membership";
            const duration =
                cdkType === "membership"
                    ? cdkDuration(req.body?.duration_type || req.body?.duration || "7d")
                    : { type: "export_quota", days: 0 };
            if (!duration) return res.status(400).json({ error: "无效 CDK 时长" });
            const exportQuota =
                cdkType === "export_quota"
                    ? Math.max(1, Math.min(10000, Math.trunc(Number(req.body?.export_quota || req.body?.quota || 1))))
                    : 0;
            const count = Math.max(1, Math.min(100, Number(req.body?.count || 1)));
            const rows = [];
            for (let i = 0; i < count; i++) {
                let code =
                    String(req.body?.code || "")
                        .trim()
                        .toUpperCase() || generateCdkCode();
                if (count > 1 || i > 0) code = generateCdkCode();
                const inserted = await query(
                    `INSERT INTO reader_cdks(code, cdk_type, duration_type, duration_days, export_quota, created_by)
                     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
                    [code, cdkType, duration.type, duration.days, exportQuota, req.session.adminUser?.username || "admin"]
                );
                rows.push(inserted.rows[0]);
            }
            res.json({ success: true, rows });
        } catch (err) {
            next(err);
        }
    });

    router.delete("/admin-api/cdks/:id", requireAdmin, async (req, res, next) => {
        try {
            await query("DELETE FROM reader_cdks WHERE id=$1", [req.params.id]);
            res.json({ success: true });
        } catch (err) {
            next(err);
        }
    });

    return router;
}

module.exports = { createAdminUsersRoutes };
