const express = require("express");

function createAdminAuthRoutes(options = {}) {
    const router = express.Router();
    const query = options.query;
    const verifyPassword = options.verifyPassword;
    const requireAdmin = options.requireAdmin || ((req, res, next) => next());

    router.post("/admin-api/auth/login", async (req, res, next) => {
        try {
            const result = await query("SELECT * FROM admin_users WHERE username = $1", [req.body?.username || ""]);
            const user = result.rows[0];
            if (!user || !verifyPassword(req.body?.password || "", user)) {
                return res.status(401).json({ error: "鐢ㄦ埛鍚嶆垨瀵嗙爜閿欒" });
            }
            req.session.adminUser = { id: user.id, username: user.username };
            await query("UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1", [user.id]);
            res.json({ user: req.session.adminUser });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/auth/logout", requireAdmin, (req, res) => {
        req.session.destroy(() => res.json({ success: true }));
    });

    router.get("/admin-api/auth/me", (req, res) => {
        res.json({ user: req.session.adminUser || null });
    });

    return router;
}

module.exports = { createAdminAuthRoutes };
