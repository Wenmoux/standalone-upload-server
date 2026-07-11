const NETWORK_ERROR_CODES = new Set([
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "ENOTFOUND"
]);

function isPgUnavailableError(err) {
    const code = String(err?.code || "");
    const message = String(err?.message || "");
    return (
        code.startsWith("08") ||
        code.startsWith("53") ||
        code === "57P03" ||
        NETWORK_ERROR_CODES.has(code) ||
        /terminat|timeout|connect|connection|ECONN|ETIMEDOUT|recovery mode|not yet accepting connections|no space left on device/i.test(message)
    );
}

function dbUnavailableMessage(err) {
    const code = String(err?.code || "");
    const message = String(err?.message || "");
    if (code === "53100" || /no space left on device/i.test(message)) {
        return "Database storage is full, free disk space and retry later";
    }
    if (code === "57P03" || /recovery mode|not yet accepting connections/i.test(message)) {
        return "Database is starting or recovering, please retry later";
    }
    return "Database temporarily unavailable, please retry later";
}

module.exports = { dbUnavailableMessage, isPgUnavailableError };
