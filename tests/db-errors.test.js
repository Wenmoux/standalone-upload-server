/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供PostgreSQL 错误到 HTTP 语义的规范化的自动化回归断言
 * [POS]: tests 的PostgreSQL 错误到 HTTP 语义的规范化守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供PostgreSQL 错误到 HTTP 语义的规范化的自动化回归断言
 * [POS]: tests 的PostgreSQL 错误到 HTTP 语义的规范化守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { dbUnavailableMessage, isPgUnavailableError } = require("../services/db-errors");

test("PostgreSQL resource errors are treated as temporarily unavailable", () => {
    assert.equal(isPgUnavailableError({ code: "53100", message: "could not write file: No space left on device" }), true);
    assert.equal(isPgUnavailableError({ code: "53300", message: "too many connections" }), true);
    assert.equal(isPgUnavailableError({ code: "55P03", message: "migration lock unavailable" }), true);
    assert.equal(isPgUnavailableError({ code: "08006", message: "connection failure" }), true);
    assert.equal(isPgUnavailableError({ code: "42P01", message: "relation does not exist" }), false);
});

test("database unavailable messages distinguish storage and recovery failures", () => {
    assert.match(dbUnavailableMessage({ code: "53100" }), /storage is full/i);
    assert.match(dbUnavailableMessage({ code: "57P03" }), /starting or recovering/i);
    assert.match(dbUnavailableMessage({ code: "ECONNREFUSED" }), /temporarily unavailable/i);
});
