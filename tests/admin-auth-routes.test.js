const assert = require("assert/strict");
const http = require("http");
const test = require("node:test");
const express = require("express");
const { createAdminAuthRoutes } = require("../routes/admin-auth");

async function withApp(router, fn, options = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = {
            adminUser: options.adminUser || null,
            destroyed: false,
            destroy(callback) {
                this.destroyed = true;
                this.adminUser = null;
                callback();
            }
        };
        next();
    });
    app.use(router);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function adminOnly(req, res, next) {
    if (!req.session.adminUser) return res.status(401).json({ error: "admin required" });
    next();
}

test("admin auth route logs in and updates last login", async () => {
    const calls = [];
    const router = createAdminAuthRoutes({
        requireAdmin: adminOnly,
        verifyPassword: (password, user) => password === "secret" && user.username === "admin",
        query: async (sql, params) => {
            calls.push({ sql, params });
            if (/FROM admin_users/.test(sql)) {
                return { rows: [{ id: 7, username: "admin", password_hash: "hash" }] };
            }
            return { rows: [], rowCount: 1 };
        }
    });

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/admin-api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "admin", password: "secret" })
        });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).user, { id: 7, username: "admin" });
    });

    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /SELECT \* FROM admin_users/);
    assert.match(calls[1].sql, /UPDATE admin_users SET last_login_at/);
    assert.deepEqual(calls[1].params, [7]);
});

test("admin auth route rejects invalid password", async () => {
    let updates = 0;
    const router = createAdminAuthRoutes({
        requireAdmin: adminOnly,
        verifyPassword: () => false,
        query: async (sql) => {
            if (/UPDATE admin_users/.test(sql)) updates++;
            return { rows: [{ id: 1, username: "admin" }] };
        }
    });

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/admin-api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "admin", password: "bad" })
        });
        assert.equal(response.status, 401);
    });

    assert.equal(updates, 0);
});

test("admin auth route exposes current user and protects logout", async () => {
    const router = createAdminAuthRoutes({
        requireAdmin: adminOnly,
        verifyPassword: () => false,
        query: async () => ({ rows: [] })
    });

    await withApp(router, async (base) => {
        const me = await fetch(`${base}/admin-api/auth/me`);
        assert.deepEqual(await me.json(), { user: { id: 3, username: "root" } });

        const logout = await fetch(`${base}/admin-api/auth/logout`, { method: "POST" });
        assert.equal(logout.status, 200);
        assert.deepEqual(await logout.json(), { success: true });
    }, { adminUser: { id: 3, username: "root" } });

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/admin-api/auth/logout`, { method: "POST" });
        assert.equal(response.status, 401);
    });
});
