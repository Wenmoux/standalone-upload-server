/**
 * [INPUT]: 依赖 Express 应用路由栈与 services/openapi 运行时索引生成器
 * [OUTPUT]: 对外提供 /openapi.json 与轻量 /api-docs 路由
 * [POS]: routes 的自省入口，暴露当前实际挂载端点索引但不冒充完整客户端契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const express = require("express");
const { buildOpenApiDocument } = require("../services/openapi");

function createOpenApiRoutes(options = {}) {
    const router = express.Router();
    const app = options.app;
    const versionProvider = options.versionProvider || (() => "2.0.0");

    router.get("/openapi.json", (req, res) => {
        res.setHeader("Cache-Control", "no-cache");
        res.json(buildOpenApiDocument(app, { version: versionProvider() }));
    });

    router.get("/api-docs", (req, res) => {
        res.type("html").send(
            `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PO18 API</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:64px auto;padding:0 24px;color:#17202a}a{color:#1769aa}code{background:#eef2f5;padding:2px 6px;border-radius:4px}</style></head><body><h1>PO18 Reader API</h1><p>机器可读端点索引：<a href="/openapi.json"><code>/openapi.json</code></a></p><p>字段说明与兼容约定见项目 <code>API.md</code>。</p></body></html>`
        );
    });

    return router;
}

module.exports = { createOpenApiRoutes };
