/**
 * [INPUT]: 依赖 Express 路由栈、schema-validation 的请求策略以及运行时已注册的端点元数据
 * [OUTPUT]: 对外提供 OpenAPI 文档构建、Express 路由收集、路径转换、安全策略和请求/响应 Schema 推导函数
 * [POS]: services 的运行时 API 索引生成器，从真实路由装配提取文档以减少人工端点清单漂移
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function expressPathToOpenApi(value = "") {
    return (
        String(value || "")
            .replace(/:([A-Za-z0-9_]+)/g, "{$1}")
            .replace(/\/$/, "") || "/"
    );
}

function operationId(method, routePath) {
    const suffix = String(routePath || "root")
        .replace(/[{}]/g, "")
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return `${String(method || "get").toLowerCase()}_${suffix || "root"}`;
}

function routeTag(routePath = "") {
    if (routePath.startsWith("/admin-api/")) return "Admin";
    if (routePath.startsWith("/bot-api/")) return "Bot";
    if (routePath.startsWith("/reader-api/") || routePath.startsWith("/reader-auth/")) return "Reader";
    if (routePath.startsWith("/api/parse/") || routePath.startsWith("/api/metadata/")) return "Upload";
    if (routePath.startsWith("/health") || routePath === "/metrics") return "Operations";
    return "Public";
}

function routeSecurity(routePath = "") {
    if (routePath === "/admin-api/auth/login") return [];
    if (routePath.startsWith("/admin-api/")) return [{ AdminSession: [] }];
    if (routePath.startsWith("/bot-api/")) return [{ BotToken: [] }];
    if (routePath === "/api/parse/chapter-content" || routePath === "/api/metadata/batch") return [{ UploadToken: [] }];
    if (routePath === "/metrics") return [{ MetricsToken: [] }];
    return [];
}

function pathParameters(routePath = "") {
    return [...String(routePath).matchAll(/\{([^}]+)\}/g)].map((match) => ({
        name: match[1],
        in: "path",
        required: true,
        schema: { type: "string" }
    }));
}

function requestPolicyForRoute(method, routePath, policies = REQUEST_SCHEMA_POLICIES) {
    const upperMethod = String(method || "").toUpperCase();
    return policies.find((policy) => policy.method === upperMethod && policy.path.test(routePath)) || null;
}

function requestBodyForRoute(method, routePath) {
    if (!["post", "put", "patch"].includes(String(method || "").toLowerCase())) return null;
    const policy = requestPolicyForRoute(method, routePath);
    return {
        required: true,
        content: {
            "application/json": {
                schema: policy?.schema || { type: "object", additionalProperties: true }
            }
        },
        ...(policy ? { "x-validation-policy": policy.name } : { "x-validation-policy": "route-handler" })
    };
}

function successSchemaForRoute(routePath = "") {
    if (/\/admin-api\/books\/(?:\{metadataId\}|[^/]+)\/manifest$/.test(routePath)) return { $ref: "#/components/schemas/BookManifest" };
    if (routePath === "/reader-api/search") return { $ref: "#/components/schemas/SearchResponse" };
    if (routePath === "/admin-api/review-moderation") return { $ref: "#/components/schemas/ModerationQueue" };
    return { type: "object", additionalProperties: true };
}

function routeRecords(stack = [], rows = []) {
    for (const layer of stack || []) {
        if (layer.route) {
            const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
            for (const routePath of paths) {
                for (const method of Object.keys(layer.route.methods || {}).filter((key) => layer.route.methods[key])) {
                    rows.push({ method: method.toLowerCase(), path: expressPathToOpenApi(routePath) });
                }
            }
        }
        if (layer.handle?.stack) routeRecords(layer.handle.stack, rows);
    }
    return rows;
}

function collectExpressRoutes(app) {
    const rows = routeRecords(app?._router?.stack || app?.router?.stack || []);
    const unique = new Map();
    for (const row of rows) unique.set(`${row.method} ${row.path}`, row);
    return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function buildOpenApiDocument(app, options = {}) {
    const version = String(options.version || "2.0.0");
    const paths = {};
    for (const route of collectExpressRoutes(app)) {
        if (!paths[route.path]) paths[route.path] = {};
        const security = routeSecurity(route.path);
        const requestBody = requestBodyForRoute(route.method, route.path);
        paths[route.path][route.method] = {
            operationId: operationId(route.method, route.path),
            tags: [routeTag(route.path)],
            summary: `${route.method.toUpperCase()} ${route.path}`,
            parameters: pathParameters(route.path),
            ...(requestBody ? { requestBody } : {}),
            ...(security.length ? { security } : {}),
            responses: {
                200: {
                    description: "Success",
                    content: { "application/json": { schema: successSchemaForRoute(route.path) } }
                },
                400: { $ref: "#/components/responses/BadRequest" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { $ref: "#/components/responses/NotFound" },
                409: { $ref: "#/components/responses/Conflict" },
                413: { $ref: "#/components/responses/PayloadTooLarge" },
                422: { $ref: "#/components/responses/Unprocessable" },
                429: { $ref: "#/components/responses/RateLimited" },
                500: { $ref: "#/components/responses/ServerError" },
                503: { $ref: "#/components/responses/ServiceUnavailable" }
            }
        };
    }
    return {
        openapi: "3.1.0",
        info: {
            title: "PO18 Reader API",
            version,
            description: "由运行中的 Express 路由栈生成端点索引。现有请求和响应字段以 API.md 与实现为准。"
        },
        servers: [{ url: "/" }],
        paths,
        components: {
            securitySchemes: {
                AdminSession: { type: "apiKey", in: "cookie", name: "po18_upload_admin_pg" },
                BotToken: { type: "apiKey", in: "header", name: "X-Bot-Token" },
                UploadToken: { type: "apiKey", in: "header", name: "X-Upload-Token" },
                MetricsToken: { type: "apiKey", in: "header", name: "Authorization" }
            },
            schemas: {
                Error: {
                    type: "object",
                    required: ["error", "code", "request_id"],
                    properties: {
                        error: { type: "string" },
                        code: { type: "string" },
                        request_id: { type: "string" }
                    },
                    additionalProperties: true
                },
                Checksum: {
                    type: "object",
                    required: ["algorithm", "value"],
                    properties: {
                        algorithm: { const: "sha256" },
                        value: { type: "string", pattern: "^[0-9a-f]{64}$" }
                    },
                    additionalProperties: false
                },
                BookManifest: {
                    type: "object",
                    required: ["format", "version", "generated_at", "source", "book", "chapters", "summary", "checksum"],
                    properties: {
                        format: { const: "po18-reader-book" },
                        version: { const: 1 },
                        generated_at: { type: "string", format: "date-time" },
                        source: {
                            type: "object",
                            required: ["app_version", "identity_model", "platform", "book_id"],
                            additionalProperties: true
                        },
                        book: { type: "object", required: ["platform", "book_id"], additionalProperties: true },
                        chapters: {
                            type: "array",
                            items: { type: "object", required: ["chapter_id", "checksum"], additionalProperties: true }
                        },
                        summary: { type: "object", required: ["chapters", "content_included"], additionalProperties: true },
                        checksum: { $ref: "#/components/schemas/Checksum" }
                    },
                    additionalProperties: false
                },
                SearchResponse: {
                    type: "object",
                    required: ["rows", "total", "page", "limit"],
                    properties: {
                        rows: { type: "array", items: { type: "object", additionalProperties: true } },
                        total: { type: "integer", minimum: 0 },
                        page: { type: "integer", minimum: 1 },
                        limit: { type: "integer", minimum: 1 },
                        has_more: { type: "boolean" },
                        next_cursor: { type: ["string", "null"] }
                    },
                    additionalProperties: true
                },
                ModerationQueue: {
                    type: "object",
                    required: ["kind", "page", "limit", "total", "rows"],
                    properties: {
                        kind: { enum: ["reports", "appeals"] },
                        page: { type: "integer", minimum: 1 },
                        limit: { type: "integer", minimum: 1 },
                        total: { type: "integer", minimum: 0 },
                        rows: { type: "array", items: { type: "object", additionalProperties: true } }
                    },
                    additionalProperties: true
                }
            },
            responses: {
                BadRequest: {
                    description: "Invalid request",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
                },
                Unauthorized: {
                    description: "Authentication required",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
                },
                Forbidden: {
                    description: "Permission denied",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
                },
                NotFound: {
                    description: "Resource not found",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
                },
                Conflict: {
                    description: "State conflict",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
                },
                PayloadTooLarge: {
                    description: "Payload too large",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
                },
                Unprocessable: {
                    description: "Checksum or semantic validation failed",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
                },
                RateLimited: {
                    description: "Rate limit exceeded",
                    headers: { "Retry-After": { schema: { type: "integer" } } },
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
                },
                ServerError: {
                    description: "Server error",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
                },
                ServiceUnavailable: {
                    description: "Dependency or service unavailable",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
                }
            }
        }
    };
}

module.exports = {
    buildOpenApiDocument,
    collectExpressRoutes,
    expressPathToOpenApi,
    operationId,
    requestBodyForRoute,
    requestPolicyForRoute,
    routeSecurity,
    successSchemaForRoute,
    routeTag
};
const { REQUEST_SCHEMA_POLICIES } = require("./schema-validation");
