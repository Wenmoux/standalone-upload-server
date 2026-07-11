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
