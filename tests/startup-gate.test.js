/**
 * [INPUT]: 依赖 node:test、assert 与 startup-gate 服务的受控请求/响应替身
 * [OUTPUT]: 提供启动前业务拒绝、健康放行和就绪后全量放行的自动化回归断言
 * [POS]: tests 的启动竞态守卫，确保迁移提交前不会再接收数据库业务请求
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createStartupGate } = require("../services/startup-gate");

function invoke(gate, path) {
    const output = { headers: {}, next: false, status: 200, body: null };
    const req = { path };
    const res = {
        setHeader(name, value) { output.headers[name] = value; },
        status(value) { output.status = value; return this; },
        json(value) { output.body = value; return this; }
    };
    gate.middleware(req, res, () => { output.next = true; });
    return output;
}

test("startup gate rejects business traffic until initialization completes", () => {
    const gate = createStartupGate({ retryAfterSeconds: 7 });
    const blocked = invoke(gate, "/api/metadata/batch");
    assert.equal(blocked.next, false);
    assert.equal(blocked.status, 503);
    assert.equal(blocked.headers["Retry-After"], "7");
    assert.equal(blocked.body.success, false);
    assert.equal(blocked.body.code, "SERVICE_STARTING");
});

test("startup gate keeps health visible and opens business traffic when ready", () => {
    const gate = createStartupGate();
    assert.equal(invoke(gate, "/health/ready").next, true);
    gate.markReady();
    assert.equal(gate.snapshot().ready, true);
    assert.equal(invoke(gate, "/api/metadata/batch").next, true);
});
