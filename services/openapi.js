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
        paths[route.path][route.method] = {
            operationId: operationId(route.method, route.path),
            tags: [routeTag(route.path)],
            summary: `${route.method.toUpperCase()} ${route.path}`,
            parameters: pathParameters(route.path),
            ...(security.length ? { security } : {}),
            responses: {
                200: {
                    description: "Success",
                    content: { "application/json": { schema: { type: "object", additionalProperties: true } } }
                },
                400: { $ref: "#/components/responses/BadRequest" },
                401: { $ref: "#/components/responses/Unauthorized" },
                500: { $ref: "#/components/responses/ServerError" }
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
                ServerError: {
                    description: "Server error",
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
    routeSecurity,
    routeTag
};
