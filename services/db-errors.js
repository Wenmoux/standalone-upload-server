/**
 * [INPUT]: 依赖 PostgreSQL 驱动、网络与启动阶段抛出的错误对象及错误码链
 * [OUTPUT]: 对外提供数据库不可用分类器和面向用户的稳定提示生成函数
 * [POS]: services 的数据库故障翻译边界，隔离底层驱动差异并统一启动与 API 错误语义
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
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
        code === "55P03" ||
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
