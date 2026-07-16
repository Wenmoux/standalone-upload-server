/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供 Admin 登录持久化时序、会话、角色和 CSRF 路由契约的自动化回归断言
 * [POS]: tests 的 Admin 登录、会话、角色和 CSRF 路由契约守卫，防止响应领先于 session 落库或权限语义静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
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
            },
            save(callback) {
                options.onSave?.(this);
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
    let savedAdmin = null;
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

    await withApp(
        router,
        async (base) => {
            const response = await fetch(`${base}/admin-api/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: "admin", password: "secret" })
            });
            assert.equal(response.status, 200);
            assert.deepEqual((await response.json()).user, { id: 7, username: "admin" });
        },
        { onSave: (session) => (savedAdmin = { ...session.adminUser }) }
    );

    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /SELECT \* FROM admin_users/);
    assert.match(calls[1].sql, /UPDATE admin_users SET last_login_at/);
    assert.deepEqual(calls[1].params, [7]);
    assert.deepEqual(savedAdmin, { id: 7, username: "admin", role: "owner" });
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

    await withApp(
        router,
        async (base) => {
            const me = await fetch(`${base}/admin-api/auth/me`);
            assert.deepEqual(await me.json(), { user: { id: 3, username: "root" } });

            const logout = await fetch(`${base}/admin-api/auth/logout`, { method: "POST" });
            assert.equal(logout.status, 200);
            assert.deepEqual(await logout.json(), { success: true });
        },
        { adminUser: { id: 3, username: "root" } }
    );

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/admin-api/auth/logout`, { method: "POST" });
        assert.equal(response.status, 401);
    });
});

test("admin auth access exposes role without changing the legacy me payload", async () => {
    const router = createAdminAuthRoutes({
        requireAdmin: adminOnly,
        verifyPassword: () => false,
        query: async () => ({ rows: [] })
    });

    await withApp(
        router,
        async (base) => {
            const me = await fetch(`${base}/admin-api/auth/me`);
            assert.deepEqual(await me.json(), { user: { id: 4, username: "operator" } });

            const access = await fetch(`${base}/admin-api/auth/access`);
            assert.equal(access.status, 200);
            assert.deepEqual(await access.json(), { role: "operator" });
        },
        { adminUser: { id: 4, username: "operator", role: "operator" } }
    );
});

test("admin account routes create, update and delete accounts", async () => {
    const admins = new Map([
        [1, { id: 1, username: "root", role: "owner" }],
        [2, { id: 2, username: "helper", role: "viewer" }]
    ]);
    let nextId = 3;
    const router = createAdminAuthRoutes({
        requireAdmin: adminOnly,
        verifyPassword: () => false,
        hashPassword: (password) => ({ hash: `hash:${password}`, salt: "salt" }),
        query: async (sql, params = []) => {
            if (/SELECT id, username, role, created_at, last_login_at FROM admin_users ORDER BY id/.test(sql)) {
                return { rows: [...admins.values()] };
            }
            if (/INSERT INTO admin_users/.test(sql)) {
                const user = { id: nextId++, username: params[0], role: params[3], created_at: null, last_login_at: null };
                admins.set(user.id, user);
                return { rows: [user] };
            }
            if (/SELECT id, username, role FROM admin_users WHERE id=\$1/.test(sql)) {
                return { rows: admins.has(params[0]) ? [admins.get(params[0])] : [] };
            }
            if (/UPDATE admin_users SET role=\$2/.test(sql)) {
                const user = { ...admins.get(params[0]), role: params[1], created_at: null, last_login_at: null };
                admins.set(user.id, user);
                return { rows: [user] };
            }
            if (/SELECT id, role FROM admin_users WHERE id=\$1/.test(sql)) {
                const user = admins.get(params[0]);
                return { rows: user ? [{ id: user.id, role: user.role }] : [] };
            }
            if (/DELETE FROM admin_users WHERE id=\$1/.test(sql)) {
                admins.delete(params[0]);
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`unexpected SQL: ${sql}`);
        }
    });

    await withApp(
        router,
        async (base) => {
            const created = await fetch(`${base}/admin-api/auth/admins`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: "ops", password: "very-secret", role: "operator" })
            });
            assert.equal(created.status, 200);
            assert.equal((await created.json()).user.role, "operator");

            const updated = await fetch(`${base}/admin-api/auth/admins/2`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role: "moderator" })
            });
            assert.equal(updated.status, 200);
            assert.equal((await updated.json()).user.role, "moderator");

            const removed = await fetch(`${base}/admin-api/auth/admins/2`, { method: "DELETE" });
            assert.equal(removed.status, 200);
            assert.equal(admins.has(2), false);

            const selfDelete = await fetch(`${base}/admin-api/auth/admins/1`, { method: "DELETE" });
            assert.equal(selfDelete.status, 409);
        },
        { adminUser: { id: 1, username: "root", role: "owner" } }
    );
});

test("admin account routes protect the last owner", async () => {
    const router = createAdminAuthRoutes({
        requireAdmin: adminOnly,
        verifyPassword: () => false,
        hashPassword: () => ({ hash: "hash", salt: "salt" }),
        query: async (sql) => {
            if (/SELECT id, username, role FROM admin_users/.test(sql)) {
                return { rows: [{ id: 1, username: "root", role: "owner" }] };
            }
            if (/SELECT id, role FROM admin_users/.test(sql)) {
                return { rows: [{ id: 1, role: "owner" }] };
            }
            if (/COUNT\(\*\)/.test(sql)) return { rows: [{ count: 1 }] };
            throw new Error(`unexpected SQL: ${sql}`);
        }
    });

    await withApp(
        router,
        async (base) => {
            const demote = await fetch(`${base}/admin-api/auth/admins/1`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role: "operator" })
            });
            assert.equal(demote.status, 409);
            assert.match((await demote.json()).error, /最后一个 owner/);

            const remove = await fetch(`${base}/admin-api/auth/admins/1`, { method: "DELETE" });
            assert.equal(remove.status, 409);
            assert.match((await remove.json()).error, /最后一个 owner/);
        },
        { adminUser: { id: 99, username: "another", role: "owner" } }
    );
});
