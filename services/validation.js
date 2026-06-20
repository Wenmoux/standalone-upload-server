function httpError(status, message, extra = {}) {
    const err = new Error(message);
    err.status = status;
    Object.assign(err, extra);
    return err;
}

function badRequest(message, extra = {}) {
    return httpError(400, message, extra);
}

function trimString(value, maxLength = 0) {
    const text = String(value ?? "").trim();
    return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function firstBodyValue(body = {}, keys = []) {
    for (const key of keys) {
        if (body[key] !== undefined) return body[key];
    }
    return undefined;
}

function bodyString(body, keys, options = {}) {
    const value = firstBodyValue(body, Array.isArray(keys) ? keys : [keys]);
    const text = trimString(value, options.maxLength || 0);
    if (options.required && !text) throw badRequest(options.message || `missing ${Array.isArray(keys) ? keys[0] : keys}`);
    if (options.minLength && text.length < options.minLength) throw badRequest(options.message || `invalid ${Array.isArray(keys) ? keys[0] : keys}`);
    if (options.pattern && text && !options.pattern.test(text)) throw badRequest(options.message || `invalid ${Array.isArray(keys) ? keys[0] : keys}`);
    return text || (options.defaultValue ?? "");
}

function bodyNumber(body, keys, options = {}) {
    const raw = firstBodyValue(body, Array.isArray(keys) ? keys : [keys]);
    if (raw === undefined || raw === null || raw === "") {
        if (options.required) throw badRequest(options.message || `missing ${Array.isArray(keys) ? keys[0] : keys}`);
        return options.defaultValue ?? 0;
    }
    const number = Number(raw);
    if (!Number.isFinite(number)) throw badRequest(options.message || `invalid ${Array.isArray(keys) ? keys[0] : keys}`);
    if (options.integer && !Number.isInteger(number)) throw badRequest(options.message || `invalid ${Array.isArray(keys) ? keys[0] : keys}`);
    if (options.min !== undefined && number < options.min) throw badRequest(options.message || `invalid ${Array.isArray(keys) ? keys[0] : keys}`);
    if (options.max !== undefined && number > options.max) throw badRequest(options.message || `invalid ${Array.isArray(keys) ? keys[0] : keys}`);
    return options.integer ? Math.trunc(number) : number;
}

function paramPositiveInt(value, name = "id") {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw badRequest(`invalid ${name}`);
    return id;
}

function enumValue(value, allowed, options = {}) {
    const normalized = trimString(value || options.defaultValue || "", options.maxLength || 0);
    if (!normalized) {
        if (options.required) throw badRequest(options.message || "missing value");
        return "";
    }
    if (!allowed.includes(normalized)) throw badRequest(options.message || `invalid ${options.name || "value"}`);
    return normalized;
}

function requireConfirm(value, expected, message = "confirmation phrase mismatch") {
    if (String(value || "") !== expected) throw badRequest(message, { expectedConfirm: expected });
    return true;
}

function compactJson(value, options = {}) {
    const fallback = options.fallback ?? {};
    if (!value || typeof value !== "object") return fallback;
    const json = JSON.stringify(value);
    const maxBytes = options.maxBytes || 20000;
    if (Buffer.byteLength(json) <= maxBytes) return value;
    return {
        truncated: true,
        original_bytes: Buffer.byteLength(json),
        keys: Array.isArray(value) ? [] : Object.keys(value).slice(0, options.maxKeys || 50)
    };
}

module.exports = {
    httpError,
    badRequest,
    trimString,
    bodyString,
    bodyNumber,
    paramPositiveInt,
    enumValue,
    requireConfirm,
    compactJson
};
