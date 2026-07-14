/**
 * [INPUT]: 依赖 PostgreSQL int4/boolean/text 接受范围与任意上传 JSON 值
 * [OUTPUT]: 对外提供安全整数/布尔转换、空字节清理、递归值清洗和 SQL 时间文本
 * [POS]: services 的 PostgreSQL 值边界，供配置、事件、书籍章节和上传协议统一复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function safePgInt(value, fallback = 0) {
    const num = Number.parseInt(value, 10);
    if (!Number.isFinite(num)) return fallback;
    if (num < -2147483648 || num > 2147483647) return fallback;
    return num;
}

function safePgBool(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const text = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "y", "on", "volume"].includes(text)) return true;
    if (["0", "false", "no", "n", "off"].includes(text)) return false;
    return fallback;
}

function nowSql() {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function cleanPgText(value) {
    if (typeof value !== "string") return value;
    return value.replace(/\u0000/g, "");
}

function cleanPgValue(value) {
    if (typeof value === "string") return cleanPgText(value);
    if (Array.isArray(value)) return value.map(cleanPgValue);
    if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanPgValue(item)]));
    }
    return value;
}

function cleanPgObject(data = {}) {
    for (const key of Object.keys(data)) {
        data[key] = cleanPgValue(data[key]);
    }
    return data;
}

module.exports = {
    cleanPgObject,
    cleanPgText,
    cleanPgValue,
    nowSql,
    safePgBool,
    safePgInt
};
