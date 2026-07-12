/**
 * [INPUT]: 依赖 Express response 的 json 发送路径及既有 status/error 响应载荷
 * [OUTPUT]: 对外提供错误响应规范化中间件、错误载荷补全与 HTTP 状态码映射函数
 * [POS]: services 的 HTTP 错误兼容层，为遗留路由补齐稳定 code 和 request_id 而不重写领域错误
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function statusErrorCode(status = 500) {
    const codes = {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        405: "METHOD_NOT_ALLOWED",
        409: "CONFLICT",
        413: "PAYLOAD_TOO_LARGE",
        429: "RATE_LIMITED",
        503: "SERVICE_UNAVAILABLE"
    };
    return codes[Number(status)] || (Number(status) >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED");
}

function normalizeErrorPayload(payload, status, requestId = "") {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Number(status) < 400 || !payload.error) return payload;
    return {
        ...payload,
        code: payload.code || statusErrorCode(status),
        request_id: payload.request_id || String(requestId || "")
    };
}

function createErrorResponseNormalizer() {
    return function errorResponseNormalizer(req, res, next) {
        const originalJson = res.json.bind(res);
        res.json = function normalizedJson(payload) {
            return originalJson(normalizeErrorPayload(payload, res.statusCode, req.requestId || res.getHeader("X-Request-Id") || ""));
        };
        next();
    };
}

module.exports = { createErrorResponseNormalizer, normalizeErrorPayload, statusErrorCode };
