const assert = require("assert/strict");
const { EventEmitter } = require("events");
const test = require("node:test");
const {
    auditAction,
    createAdminAuditMiddleware,
    listAdminAuditLogs,
    sanitizeAuditValue
} = require("../services/admin-audit");

test("admin audit sanitizer redacts nested credentials", () => {
    const value = sanitizeAuditValue({
        username: "reader",
        password: "plain",
        nested: { botToken: "secret", count: 2 },
        list: [{ cookie: "session", title: "book" }]
    });
    assert.equal(value.username, "reader");
    assert.equal(value.password, "<redacted>");
    assert.equal(value.nested.botToken, "<redacted>");
    assert.equal(value.nested.count, 2);
    assert.equal(value.list[0].cookie, "<redacted>");
    assert.equal(value.list[0].title, "book");
});

test("admin audit middleware records write actions after the response", async () => {
    const calls = [];
    const middleware = createAdminAuditMiddleware({
        query: async (sql, params) => { calls.push({ sql, params }); }
    });
    const req = {
        method: "PUT",
        path: "/admin-api/users/42",
        url: "/admin-api/users/42",
        body: { reason: "manual correction", password: "never-log", copper_delta: 10 },
        query: { token: "never-log-query", page: "1" },
        headers: { "user-agent": "unit-test" },
        session: { adminUser: { id: 7, username: "owner" } },
        requestId: "request-123",
        ip: "127.0.0.1"
    };
    const res = new EventEmitter();
    res.statusCode = 200;
    let continued = false;
    middleware(req, res, () => { continued = true; });
    assert.equal(continued, true);
    res.emit("finish");
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /INSERT INTO admin_audit_logs/);
    assert.equal(calls[0].params[0], 7);
    assert.equal(calls[0].params[1], "owner");
    assert.equal(calls[0].params[4], "put.users.:id");
    assert.equal(calls[0].params[6], "manual correction");
    assert.equal(calls[0].params[7], "request-123");
    const details = JSON.parse(calls[0].params[10]);
    assert.equal(details.body.password, "<redacted>");
    assert.equal(details.query.token, "<redacted>");
    assert.equal(details.query.page, "1");
});

test("admin audit ignores read-only requests and reports write failures", async () => {
    const events = [];
    const middleware = createAdminAuditMiddleware({
        query: async () => { throw new Error("database offline"); },
        logEvent: (...args) => events.push(args)
    });
    const readRes = new EventEmitter();
    middleware({ method: "GET", path: "/admin-api/books" }, readRes, () => {});
    readRes.emit("finish");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(events.length, 0);

    const writeRes = new EventEmitter();
    writeRes.statusCode = 500;
    middleware({
        method: "DELETE",
        path: "/admin-api/books/9",
        body: {},
        query: {},
        headers: {},
        session: { adminUser: { id: 1, username: "admin" } }
    }, writeRes, () => {});
    writeRes.emit("finish");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(events.length, 1);
    assert.equal(events[0][2], "admin-audit-write-failed");
});

test("admin audit action normalizes numeric resource ids", () => {
    assert.equal(auditAction({ method: "DELETE", path: "/admin-api/books/123/chapters" }), "delete.books.:id.chapters");
});

test("admin audit list applies bounded filters and paging", async () => {
    const calls = [];
    const query = async (sql, params) => {
        calls.push({ sql, params });
        if (/COUNT/.test(sql)) return { rows: [{ total: 73 }] };
        return { rows: [{ id: 9, actor_username: "owner" }] };
    };
    const result = await listAdminAuditLogs(query, {
        page: "2",
        limit: "500",
        actor: "owner",
        action: "delete",
        method: "delete",
        status: "200",
        requestId: "req-1"
    });
    assert.equal(result.page, 2);
    assert.equal(result.limit, 200);
    assert.equal(result.total, 73);
    assert.equal(result.rows[0].id, 9);
    assert.match(calls[0].sql, /actor_username ILIKE/);
    assert.match(calls[0].sql, /status_code = \$5/);
    assert.deepEqual(calls[1].params.slice(-2), [200, 200]);
});
