/**
 * [INPUT]: 依赖原始 Cookie 字符串、Set-Cookie 响应和多账户 Cookie profile 配置
 * [OUTPUT]: 对外提供 Cookie 解析、合并、请求头生成、Profile 规范化/脱敏及稳定键函数
 * [POS]: services 的 PO18 Cookie 纯函数边界，使 HTTP 客户端与后台配置共享同一演进和脱敏语义
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function boolValue(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "boolean") return value;
    return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseCookieString(cookieString = "") {
    const cookies = String(cookieString || "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const index = part.indexOf("=");
            if (index <= 0) return null;
            const name = part.slice(0, index).trim();
            const value = part.slice(index + 1).trim();
            return name ? { name, value, domain: ".po18.tw", path: "/" } : null;
        })
        .filter(Boolean);
    return mergeCookies([], cookies);
}

function cookieHeader(cookies = []) {
    const byName = new Map();
    for (const cookie of mergeCookies([], cookies)) {
        if (!cookie?.name || !cookie.value || cookie.value === "deleted") continue;
        byName.delete(cookie.name);
        byName.set(cookie.name, cookie);
    }
    return [...byName.values()].map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function cookieProfileToHeader(profile = {}) {
    if (Array.isArray(profile.cookies) && profile.cookies.length) return cookieHeader(profile.cookies);
    const cookie = String(profile.cookie || "").trim();
    if (cookie) return cookie;
    return cookieHeader(Array.isArray(profile.cookies) ? profile.cookies : []);
}

function parseSetCookieHeaders(headers) {
    if (!headers) return [];
    const raw = typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : String(headers.get?.("set-cookie") || "").split(/,(?=\s*[^;,\s]+=)/);
    return raw.map((line) => {
        const parts = String(line || "").split(";").map((part) => part.trim()).filter(Boolean);
        const first = parts.shift() || "";
        const index = first.indexOf("=");
        if (index <= 0) return null;
        const cookie = { name: first.slice(0, index).trim(), value: first.slice(index + 1), domain: ".po18.tw", path: "/" };
        for (const part of parts) {
            const [rawKey, ...rest] = part.split("=");
            const key = String(rawKey || "").toLowerCase();
            if (key === "domain") cookie.domain = rest.join("=") || cookie.domain;
            if (key === "path") cookie.path = rest.join("=") || cookie.path;
        }
        return cookie.name ? cookie : null;
    }).filter(Boolean);
}

function mergeCookies(current = [], incoming = []) {
    const map = new Map();
    for (const cookie of current || []) {
        if (!cookie?.name) continue;
        map.set(`${cookie.name}|${cookie.domain || ""}|${cookie.path || "/"}`, cookie);
    }
    for (const cookie of incoming || []) {
        if (!cookie?.name) continue;
        map.set(`${cookie.name}|${cookie.domain || ""}|${cookie.path || "/"}`, cookie);
    }
    return [...map.values()].filter((cookie) => cookie.value && cookie.value !== "deleted");
}

function normalizeCookieProfile(profile = {}, index = 0) {
    const name = String(profile.name || profile.label || profile.id || `cookie-${index + 1}`).trim().slice(0, 80) || `cookie-${index + 1}`;
    const rawCookie = String(profile.cookie || "").trim();
    const cookies = mergeCookies([], Array.isArray(profile.cookies) ? profile.cookies : parseCookieString(rawCookie));
    const cookie = cookieHeader(cookies) || rawCookie;
    return {
        id: String(profile.id || name).trim().slice(0, 100) || name,
        name,
        cookie,
        cookies,
        enabled: boolValue(profile.enabled, true),
        lastStatus: String(profile.lastStatus || "").slice(0, 160),
        lastUsedAt: profile.lastUsedAt || null,
        updatedAt: profile.updatedAt || new Date().toISOString()
    };
}

function normalizeCookieProfiles(value = [], legacyCookie = "") {
    const input = Array.isArray(value) ? value : [];
    const profiles = input.map(normalizeCookieProfile).filter((profile) => cookieProfileToHeader(profile));
    const legacy = String(legacyCookie || "").trim();
    if (legacy && !profiles.some((profile) => cookieProfileToHeader(profile) === legacy)) {
        profiles.unshift(normalizeCookieProfile({ id: "default", name: "default", cookie: legacy, enabled: true }, 0));
    }
    return profiles.slice(0, 20);
}

function maskCookieProfiles(profiles = []) {
    return profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        enabled: profile.enabled !== false,
        cookieConfigured: !!cookieProfileToHeader(profile),
        cookieLength: cookieProfileToHeader(profile).length,
        cookieCount: parseCookieString(cookieProfileToHeader(profile)).length,
        lastStatus: profile.lastStatus || "",
        lastUsedAt: profile.lastUsedAt || null,
        updatedAt: profile.updatedAt || null
    }));
}

function profileKey(profile = {}) {
    return String(profile.id || profile.name || "").trim();
}

module.exports = {
    cookieHeader,
    cookieProfileToHeader,
    maskCookieProfiles,
    mergeCookies,
    normalizeCookieProfile,
    normalizeCookieProfiles,
    parseCookieString,
    parseSetCookieHeaders,
    profileKey
};
