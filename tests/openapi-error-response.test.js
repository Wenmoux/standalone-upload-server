const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { buildOpenApiDocument, collectExpressRoutes } = require("../services/openapi");
const { normalizeErrorPayload, statusErrorCode } = require("../services/error-response");

test("OpenAPI index is generated from mounted Express routes", () => {
    const app = express();
    const router = express.Router();
    router.get("/reader-api/books/:id", () => {});
    router.post("/admin-api/books/:id/delete", () => {});
    app.use(router);
    const routes = collectExpressRoutes(app);
    assert.deepEqual(routes, [
        { method: "post", path: "/admin-api/books/{id}/delete" },
        { method: "get", path: "/reader-api/books/{id}" }
    ]);
    const spec = buildOpenApiDocument(app, { version: "2.0.0-test" });
    assert.equal(spec.openapi, "3.1.0");
    assert.equal(spec.info.version, "2.0.0-test");
    assert.deepEqual(spec.paths["/admin-api/books/{id}/delete"].post.security, [{ AdminSession: [] }]);
    assert.equal(spec.paths["/reader-api/books/{id}"].get.parameters[0].name, "id");
});

test("error response normalization preserves old fields and adds trace fields", () => {
    assert.deepEqual(normalizeErrorPayload({ error: "invalid id", expectedConfirm: "DELETE" }, 400, "req-1"), {
        error: "invalid id",
        expectedConfirm: "DELETE",
        code: "BAD_REQUEST",
        request_id: "req-1"
    });
    assert.deepEqual(normalizeErrorPayload({ error: "db", code: "57P03" }, 503, "req-2"), {
        error: "db",
        code: "57P03",
        request_id: "req-2"
    });
    assert.equal(statusErrorCode(429), "RATE_LIMITED");
    assert.deepEqual(normalizeErrorPayload({ ok: true }, 200, "req-3"), { ok: true });
});
