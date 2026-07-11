const dns = require("dns");
const net = require("net");

const blockedAddresses = new net.BlockList();

for (const [address, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4]
]) blockedAddresses.addSubnet(address, prefix, "ipv4");

for (const [address, prefix] of [
    ["::", 128],
    ["::1", 128],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
    ["2001:db8::", 32]
]) blockedAddresses.addSubnet(address, prefix, "ipv6");

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

function normalizeHostname(value) {
    const hostname = String(value || "").trim().toLowerCase().replace(/\.$/, "");
    return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function allowedHostRules(value = process.env.PO18_TTS_PROXY_ALLOWED_HOSTS || "") {
    return String(value || "")
        .split(/[\s,]+/)
        .map(normalizeHostname)
        .filter(Boolean);
}

function hostMatchesRule(hostname, rule) {
    const host = normalizeHostname(hostname);
    const normalizedRule = normalizeHostname(rule);
    if (!host || !normalizedRule) return false;
    if (normalizedRule.startsWith("*.")) {
        const suffix = normalizedRule.slice(1);
        return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === normalizedRule;
}

function isBlockedAddress(input) {
    let address = String(input || "").trim().split("%")[0];
    if (address.toLowerCase().startsWith("::ffff:")) address = address.slice(7);
    const family = net.isIP(address);
    if (!family) return true;
    return blockedAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
}

async function defaultLookup(hostname) {
    return dns.promises.lookup(hostname, { all: true, verbatim: true });
}

async function assertSafeHttpTarget(input, options = {}) {
    let target;
    try {
        target = input instanceof URL ? new URL(input.href) : new URL(String(input || "").trim());
    } catch {
        throw httpError(400, "TTS API 地址无效");
    }
    if (!["http:", "https:"].includes(target.protocol)) throw httpError(400, "TTS API 只支持 http/https");
    if (target.username || target.password) throw httpError(400, "TTS API 地址不能包含账号或密码");

    const hostname = normalizeHostname(target.hostname);
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
        throw httpError(403, "TTS API 不允许访问本机或内网地址");
    }

    const rules = Array.isArray(options.allowedHosts)
        ? options.allowedHosts.map(normalizeHostname).filter(Boolean)
        : allowedHostRules(options.allowedHosts);
    if (rules.length && !rules.some((rule) => hostMatchesRule(hostname, rule))) {
        throw httpError(403, "TTS API 域名不在允许列表中");
    }

    const family = net.isIP(hostname);
    let addresses;
    try {
        addresses = family ? [{ address: hostname, family }] : await (options.lookup || defaultLookup)(hostname);
    } catch {
        throw httpError(502, "TTS API 域名无法解析");
    }
    if (!Array.isArray(addresses) || !addresses.length) throw httpError(502, "TTS API 域名无法解析");
    if (addresses.some((item) => isBlockedAddress(item?.address || item))) {
        throw httpError(403, "TTS API 不允许访问本机或内网地址");
    }
    return target;
}

module.exports = {
    allowedHostRules,
    assertSafeHttpTarget,
    hostMatchesRule,
    isBlockedAddress,
    normalizeHostname
};
