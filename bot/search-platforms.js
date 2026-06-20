const DEFAULT_SEARCH_PLATFORM = "";
const DEFAULT_RECOMMEND_PLATFORM = "po18";

const SEARCH_PLATFORM_SUFFIXES = {
    po18: "po18",
    p18: "po18",
    qd: "qidian",
    qidian: "qidian",
    fq: "fanqie",
    fanqie: "fanqie",
    tomato: "fanqie",
    popo: "popo",
    myrics: "myrics",
    mgd: "myrics",
    miguodu: "myrics",
    haitang: "haitang",
    ht: "haitang",
    hotupub: "hotupub"
};

const SEARCH_PLATFORM_LABELS = {
    po18: "PO18",
    qidian: "起点",
    fanqie: "番茄",
    popo: "POPO",
    myrics: "米国度",
    haitang: "海棠",
    hotupub: "HotUpub"
};

function platformLabel(platform = DEFAULT_SEARCH_PLATFORM) {
    return SEARCH_PLATFORM_LABELS[platform] || platform || "全部站点";
}

function parsePlatformSuffix(value = "", options = {}) {
    const raw = String(value || "").trim();
    const defaultPlatform = Object.prototype.hasOwnProperty.call(options, "defaultPlatform")
        ? options.defaultPlatform
        : DEFAULT_SEARCH_PLATFORM;
    const match = raw.match(/-([A-Za-z][A-Za-z0-9_-]*)\s*$/);
    if (!match) return { query: raw, platform: defaultPlatform, suffix: "" };
    const key = match[1].toLowerCase().replace(/[_-]+/g, "");
    const platform = SEARCH_PLATFORM_SUFFIXES[key];
    if (!platform) return { query: raw, platform: defaultPlatform, suffix: "" };
    return {
        query: raw.slice(0, match.index).trim(),
        platform,
        suffix: `-${match[1].toLowerCase()}`
    };
}

module.exports = {
    DEFAULT_SEARCH_PLATFORM,
    DEFAULT_RECOMMEND_PLATFORM,
    SEARCH_PLATFORM_SUFFIXES,
    SEARCH_PLATFORM_LABELS,
    platformLabel,
    parsePlatformSuffix
};
