const express = require("express");

function createAdminAuthRoutes(options = {}) {
    const router = express.Router();
    const query = options.query;
    const hashPassword = options.hashPassword;
    const verifyPassword = options.verifyPassword;
    const requireAdmin = options.requireAdmin || ((req, res, next) => next());

    router.post("/admin-api/auth/login", async (req, res, next) => {
        try {
            const result = await query("SELECT * FROM admin_users WHERE username = $1", [req.body?.username || ""]);
            const user = result.rows[0];
            if (!user || !verifyPassword(req.body?.password || "", user)) {
                return res.status(401).json({ error: "\u7528\u6237\u540d\u6216\u5bc6\u7801\u9519\u8bef" });
            }
            req.session.adminUser = { id: user.id, username: user.username, role: user.role || "owner" };
            await query("UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1", [user.id]);
            res.json({ user: { id: user.id, username: user.username } });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/auth/logout", requireAdmin, (req, res) => {
        req.session.destroy(() => res.json({ success: true }));
    });

    router.get("/admin-api/auth/me", (req, res) => {
        const user = req.session.adminUser;
        res.json({ user: user ? { id: user.id, username: user.username } : null });
    });

    router.get("/admin-api/auth/access", requireAdmin, (req, res) => {
        res.json({ role: req.session.adminUser?.role || "owner" });
    });

    router.get("/admin-api/auth/admins", requireAdmin, async (req, res, next) => {
        try {
            const result = await query("SELECT id, username, role, created_at, last_login_at FROM admin_users ORDER BY id");
            res.json({ rows: result.rows });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/auth/admins", requireAdmin, async (req, res, next) => {
        try {
            const username = String(req.body?.username || "").trim();
            const password = String(req.body?.password || "");
            const role = String(req.body?.role || "viewer").trim().toLowerCase();
            if (!/^[A-Za-z0-9_\-]{2,40}$/.test(username)) return res.status(400).json({ error: "管理员用户名需 2-40 位" });
            if (password.length < 10) return res.status(400).json({ error: "管理员密码至少 10 位" });
            if (!["owner", "operator", "moderator", "viewer"].includes(role)) return res.status(400).json({ error: "无效管理员角色" });
            const passwordData = hashPassword(password);
            const result = await query(
                `INSERT INTO admin_users(username, password_hash, salt, role)
                 VALUES ($1,$2,$3,$4) RETURNING id, username, role, created_at, last_login_at`,
                [username, passwordData.hash, passwordData.salt, role]
            );
            res.json({ success: true, user: result.rows[0] });
        } catch (err) {
            next(err);
        }
    });

    router.put("/admin-api/auth/admins/:id", requireAdmin, async (req, res, next) => {
        try {
            const id = Number(req.params.id);
            const found = await query("SELECT id, username, role FROM admin_users WHERE id=$1", [id]);
            const user = found.rows[0];
            if (!user) return res.status(404).json({ error: "管理员不存在" });
            const role = String(req.body?.role || user.role || "viewer").trim().toLowerCase();
            if (!["owner", "operator", "moderator", "viewer"].includes(role)) return res.status(400).json({ error: "无效管理员角色" });
            if (user.role === "owner" && role !== "owner") {
                const owners = await query("SELECT COUNT(*)::int count FROM admin_users WHERE role='owner'");
                if (Number(owners.rows[0]?.count || 0) <= 1) return res.status(409).json({ error: "不能降级最后一个 owner" });
            }
            const password = String(req.body?.password || "");
            let result;
            if (password) {
                if (password.length < 10) return res.status(400).json({ error: "管理员密码至少 10 位" });
                const passwordData = hashPassword(password);
                result = await query(
                    `UPDATE admin_users SET role=$2, password_hash=$3, salt=$4 WHERE id=$1
                     RETURNING id, username, role, created_at, last_login_at`,
                    [id, role, passwordData.hash, passwordData.salt]
                );
            } else {
                result = await query(
                    `UPDATE admin_users SET role=$2 WHERE id=$1 RETURNING id, username, role, created_at, last_login_at`,
                    [id, role]
                );
            }
            if (Number(req.session.adminUser?.id) === id) req.session.adminUser.role = role;
            res.json({ success: true, user: result.rows[0] });
        } catch (err) {
            next(err);
        }
    });

    router.delete("/admin-api/auth/admins/:id", requireAdmin, async (req, res, next) => {
        try {
            const id = Number(req.params.id);
            if (Number(req.session.adminUser?.id) === id) return res.status(409).json({ error: "不能删除当前登录管理员" });
            const found = await query("SELECT id, role FROM admin_users WHERE id=$1", [id]);
            const user = found.rows[0];
            if (!user) return res.status(404).json({ error: "管理员不存在" });
            if (user.role === "owner") {
                const owners = await query("SELECT COUNT(*)::int count FROM admin_users WHERE role='owner'");
                if (Number(owners.rows[0]?.count || 0) <= 1) return res.status(409).json({ error: "不能删除最后一个 owner" });
            }
            await query("DELETE FROM admin_users WHERE id=$1", [id]);
            res.json({ success: true });
        } catch (err) {
            next(err);
        }
    });

    return router;
}

module.exports = { createAdminAuthRoutes };
