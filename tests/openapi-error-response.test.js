/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供OpenAPI 索引与统一错误响应契约的自动化回归断言
 * [POS]: tests 的OpenAPI 索引与统一错误响应契约守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
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
    assert.equal(spec.paths["/admin-api/books/{id}/delete"].post.requestBody["x-validation-policy"], "route-handler");
    assert.equal(spec.paths["/reader-api/books/{id}"].get.parameters[0].name, "id");
    assert.ok(spec.components.schemas.BookManifest);
    assert.ok(spec.components.responses.RateLimited);
});

test("OpenAPI binds registered Ajv request contracts to matching runtime routes", () => {
    const app = express();
    const router = express.Router();
    router.post("/reader-api/book-reviews/:reviewId/report", () => {});
    router.post("/api/parse/chapter-content", () => {});
    router.get("/reader-api/search", () => {});
    app.use(router);
    const spec = buildOpenApiDocument(app);
    assert.equal(spec.paths["/reader-api/book-reviews/{reviewId}/report"].post.requestBody["x-validation-policy"], "review-report");
    assert.deepEqual(spec.paths["/api/parse/chapter-content"].post.requestBody.content["application/json"].schema.required, [
        "bookId",
        "chapterId"
    ]);
    assert.equal(
        spec.paths["/reader-api/search"].get.responses[200].content["application/json"].schema.$ref,
        "#/components/schemas/SearchResponse"
    );
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
