/**
 * [INPUT]: 依赖 services/platforms 的共享平台语义及 Reader 动态平台配置响应
 * [OUTPUT]: 对外提供默认平台、共享后缀/展示表及可吸收后台平台的查询注册表
 * [POS]: bot 搜索域的平台适配层，把 Telegram 后缀语法投影到服务端平台别名集合
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const {
    DEFAULT_PLATFORM_LABELS,
    PLATFORM_DEFINITIONS,
    PLATFORM_SUFFIXES,
    cleanPlatformKey,
    normalizePlatformKey
} = require("../services/platforms");

const DEFAULT_SEARCH_PLATFORM = "";
const DEFAULT_RECOMMEND_PLATFORM = "po18";

const SEARCH_PLATFORM_SUFFIXES = Object.freeze(
    Object.fromEntries(Object.entries(PLATFORM_SUFFIXES).filter(([, canonical]) => !["local", "unknown"].includes(canonical)))
);
const SEARCH_PLATFORM_LABELS = Object.freeze(
    Object.fromEntries(PLATFORM_DEFINITIONS.map((definition) => [definition.canonical, definition.label]))
);

function createSearchPlatformRegistry(initialPayload = null) {
    const suffixes = new Map(Object.entries(SEARCH_PLATFORM_SUFFIXES));
    const labels = new Map(Object.entries(DEFAULT_PLATFORM_LABELS));

    function update(payload = {}) {
        for (const [platform, label] of Object.entries(payload.labels || {})) {
            const cleanPlatform = cleanPlatformKey(platform);
            const cleanLabel = String(label || "").trim();
            if (cleanPlatform && cleanLabel) labels.set(cleanPlatform, cleanLabel);
        }
        for (const item of Array.isArray(payload.platforms) ? payload.platforms : []) {
            const value = cleanPlatformKey(item?.value);
            if (!value) continue;
            const suffix = normalizePlatformKey(value);
            if (suffix && !suffixes.has(suffix)) suffixes.set(suffix, value);
            const label = String(item?.label || "").trim();
            if (label) labels.set(value, label);
        }
        return snapshot();
    }

    function resolveSuffix(value = "") {
        return suffixes.get(normalizePlatformKey(value)) || "";
    }

    function platformLabel(platform = DEFAULT_SEARCH_PLATFORM) {
        const raw = cleanPlatformKey(platform);
        if (!raw) return "全部站点";
        const exact = labels.get(raw);
        if (exact) return exact;
        const normalized = normalizePlatformKey(raw);
        for (const [key, label] of labels) {
            if (normalizePlatformKey(key) === normalized) return label;
        }
        return raw;
    }

    function parsePlatformSuffix(value = "", options = {}) {
        const raw = String(value || "").trim();
        const defaultPlatform = Object.prototype.hasOwnProperty.call(options, "defaultPlatform")
            ? options.defaultPlatform
            : DEFAULT_SEARCH_PLATFORM;
        const match = raw.match(/-([A-Za-z][A-Za-z0-9_-]*)\s*$/);
        if (!match) return { query: raw, platform: defaultPlatform, suffix: "" };
        const platform = resolveSuffix(match[1]);
        if (!platform) return { query: raw, platform: defaultPlatform, suffix: "" };
        return {
            query: raw.slice(0, match.index).trim(),
            platform,
            suffix: `-${match[1].toLowerCase()}`
        };
    }

    function snapshot() {
        return {
            labels: Object.fromEntries(labels),
            suffixes: Object.fromEntries(suffixes)
        };
    }

    if (initialPayload) update(initialPayload);
    return { parsePlatformSuffix, platformLabel, resolveSuffix, snapshot, update };
}

const defaultRegistry = createSearchPlatformRegistry();

function platformLabel(platform = DEFAULT_SEARCH_PLATFORM) {
    return defaultRegistry.platformLabel(platform);
}

function parsePlatformSuffix(value = "", options = {}) {
    return defaultRegistry.parsePlatformSuffix(value, options);
}

module.exports = {
    DEFAULT_SEARCH_PLATFORM,
    DEFAULT_RECOMMEND_PLATFORM,
    SEARCH_PLATFORM_SUFFIXES,
    SEARCH_PLATFORM_LABELS,
    createSearchPlatformRegistry,
    platformLabel,
    parsePlatformSuffix
};
