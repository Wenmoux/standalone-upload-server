/**
 * [INPUT]: 依赖 Ajv、按 method/path 注册的请求 Schema 策略和 Express 请求体
 * [OUTPUT]: 对外提供请求策略表、Book Manifest Schema、编译器、紧凑错误转换及验证中间件
 * [POS]: services 的机器可执行 API 输入契约，在路由业务逻辑前拒绝结构错误并为 OpenAPI 提供同一 Schema 真源
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const Ajv = require("ajv");

const identifier = { type: "string", minLength: 1, maxLength: 240 };
const boundedText = (maxLength) => ({ type: "string", maxLength });
const registrationCode = { type: "string", minLength: 1, maxLength: 256 };
const sha256Checksum = {
    type: "object",
    required: ["algorithm", "value"],
    properties: {
        algorithm: { const: "sha256" },
        value: { type: "string", pattern: "^[0-9a-f]{64}$" }
    },
    additionalProperties: false
};
const bookManifestSchema = {
    type: "object",
    required: ["format", "version", "generated_at", "source", "book", "chapters", "checksum"],
    properties: {
        format: { const: "po18-reader-book" },
        version: { const: 1 },
        generated_at: boundedText(64),
        source: {
            type: "object",
            required: ["app_version", "identity_model", "platform", "book_id"],
            properties: {
                app_version: boundedText(128),
                identity_model: { const: "legacy-platform-external-id" },
                platform: boundedText(80),
                book_id: identifier
            },
            additionalProperties: true
        },
        book: {
            type: "object",
            required: ["book_id", "platform"],
            properties: { book_id: identifier, platform: boundedText(80), title: boundedText(2000) },
            additionalProperties: true
        },
        chapters: {
            type: "array",
            maxItems: 20000,
            items: {
                type: "object",
                required: ["chapter_id", "checksum"],
                properties: {
                    chapter_id: identifier,
                    title: boundedText(2000),
                    html: boundedText(4 * 1024 * 1024),
                    text: boundedText(4 * 1024 * 1024),
                    platform: boundedText(80),
                    checksum: sha256Checksum
                },
                additionalProperties: true
            }
        },
        summary: { type: "object", additionalProperties: true },
        checksum: sha256Checksum
    },
    additionalProperties: true
};
const manifestRequestSchema = {
    anyOf: [
        bookManifestSchema,
        {
            type: "object",
            required: ["manifest"],
            properties: {
                manifest: bookManifestSchema,
                confirmation: boundedText(512),
                confirm: boundedText(512)
            },
            additionalProperties: true
        }
    ]
};

const REQUEST_SCHEMA_POLICIES = Object.freeze([
    {
        name: "admin-login",
        method: "POST",
        path: /^\/admin-api\/auth\/login$/,
        schema: {
            type: "object",
            required: ["username", "password"],
            properties: { username: boundedText(128), password: boundedText(1024) },
            additionalProperties: true
        }
    },
    {
        name: "reader-login",
        method: "POST",
        path: /^\/reader-auth\/login$/,
        schema: {
            type: "object",
            required: ["username", "password"],
            properties: { username: boundedText(128), password: boundedText(1024) },
            additionalProperties: true
        }
    },
    {
        name: "reader-register",
        method: "POST",
        path: /^\/reader-auth\/register$/,
        schema: {
            type: "object",
            required: ["username", "password"],
            anyOf: [{ required: ["cdk"] }, { required: ["code"] }],
            properties: {
                username: boundedText(128),
                password: boundedText(1024),
                nickname: boundedText(128),
                cdk: registrationCode,
                code: registrationCode
            },
            additionalProperties: true
        }
    },
    {
        name: "check-cache",
        method: "POST",
        path: /^\/api\/parse\/check-cache$/,
        schema: {
            type: "object",
            required: ["bookId"],
            properties: { bookId: identifier },
            additionalProperties: true
        }
    },
    {
        name: "chapter-upload",
        method: "POST",
        path: /^\/api\/parse\/chapter-content$/,
        schema: {
            type: "object",
            required: ["bookId", "chapterId"],
            properties: {
                bookId: identifier,
                chapterId: identifier,
                title: boundedText(2000),
                html: boundedText(10 * 1024 * 1024),
                text: boundedText(10 * 1024 * 1024),
                platform: boundedText(80)
            },
            additionalProperties: true
        }
    },
    {
        name: "metadata-batch",
        method: "POST",
        path: /^\/api\/metadata\/batch$/,
        schema: {
            type: "object",
            required: ["books"],
            properties: {
                books: {
                    type: "array",
                    maxItems: 500,
                    items: {
                        type: "object",
                        properties: {
                            bookId: identifier,
                            book_id: identifier,
                            title: boundedText(2000),
                            description: boundedText(256 * 1024),
                            platform: boundedText(80)
                        },
                        anyOf: [{ required: ["bookId"] }, { required: ["book_id"] }],
                        additionalProperties: true
                    }
                }
            },
            additionalProperties: true
        }
    },
    {
        name: "tts-proxy",
        method: "POST",
        path: /^\/reader-api\/tts\/proxy$/,
        schema: {
            type: "object",
            required: ["url"],
            properties: {
                url: boundedText(4096),
                method: { type: "string", enum: ["POST", "PUT", "post", "put"] },
                body: boundedText(48 * 1024),
                headers: { type: "object", maxProperties: 64, additionalProperties: boundedText(8192) }
            },
            additionalProperties: true
        }
    },
    {
        name: "tts-text",
        method: "POST",
        path: /^\/reader-api\/tts\/(?:edge|provider)$/,
        schema: {
            type: "object",
            required: ["text"],
            properties: { text: boundedText(12000), provider: boundedText(80), engine: boundedText(80) },
            additionalProperties: true
        }
    },
    {
        name: "book-manifest",
        method: "POST",
        path: /^\/admin-api\/books\/manifests\/(?:validate|import)$/,
        schema: manifestRequestSchema
    },
    {
        name: "review-report",
        method: "POST",
        path: /^\/(?:reader|bot)-api\/book-reviews\/[^/]+\/report$/,
        schema: {
            type: "object",
            required: ["reason"],
            properties: {
                reason: { type: "string", enum: ["spam", "abuse", "spoiler", "illegal", "other"] },
                details: boundedText(2000),
                telegram_id: boundedText(100),
                telegramId: boundedText(100)
            },
            additionalProperties: true
        }
    },
    {
        name: "review-appeal",
        method: "POST",
        path: /^\/(?:reader|bot)-api\/book-reviews\/[^/]+\/appeals$/,
        schema: {
            type: "object",
            required: ["content"],
            properties: {
                content: { type: "string", minLength: 6, maxLength: 2000 },
                telegram_id: boundedText(100),
                telegramId: boundedText(100)
            },
            additionalProperties: true
        }
    },
    {
        name: "review-moderation",
        method: "POST",
        path: /^\/admin-api\/review-moderation\/(?:reports|appeals)\/[^/]+\/resolve$/,
        schema: {
            type: "object",
            required: ["action"],
            properties: {
                action: { type: "string", enum: ["hide", "restore", "dismiss", "accept", "reject"] },
                note: boundedText(2000),
                reason: boundedText(2000)
            },
            anyOf: [{ required: ["note"] }, { required: ["reason"] }],
            additionalProperties: true
        }
    }
]);

function compactAjvErrors(errors = []) {
    return errors.slice(0, 12).map((item) => ({
        path: item.dataPath || item.instancePath || "",
        rule: item.keyword || "invalid",
        message: item.message || "invalid value"
    }));
}

function compileRequestSchemas({ policies = REQUEST_SCHEMA_POLICIES, ajv } = {}) {
    const validator = ajv || new Ajv({ allErrors: true, jsonPointers: true, removeAdditional: false, coerceTypes: false });
    return policies.map((policy) => ({ ...policy, validate: validator.compile(policy.schema) }));
}

function createRequestSchemaValidation(options = {}) {
    const compiled = options.compiled || compileRequestSchemas(options);
    return function requestSchemaValidation(req, res, next) {
        const method = String(req.method || "GET").toUpperCase();
        const requestPath = String(req.path || req.url || "").split("?")[0];
        const policy = compiled.find((item) => item.method === method && item.path.test(requestPath));
        if (!policy || policy.validate(req.body || {})) return next();
        return res.status(400).json({
            error: "请求参数不符合接口约束",
            code: "VALIDATION_ERROR",
            details: compactAjvErrors(policy.validate.errors),
            schema: policy.name
        });
    };
}

module.exports = {
    REQUEST_SCHEMA_POLICIES,
    bookManifestSchema,
    compactAjvErrors,
    compileRequestSchemas,
    createRequestSchemaValidation
};
