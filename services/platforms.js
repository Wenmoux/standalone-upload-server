/**
 * [INPUT]: 依赖项目内稳定的平台主键、历史上传别名与展示名称约定
 * [OUTPUT]: 对外提供共享平台定义、标签表、后缀映射、规范键和等价查询值解析能力
 * [POS]: services 的平台语义事实源，让 Bot、Reader API 与后台配置共享同一别名集合而不改写历史数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const PLATFORM_DEFINITIONS = Object.freeze(
    [
        { canonical: "po18", label: "PO18", aliases: ["p18"] },
        { canonical: "popo", label: "POPO", aliases: [] },
        { canonical: "qidian", label: "起点", aliases: ["qd"] },
        { canonical: "fanqie", label: "番茄", aliases: ["fq", "tomato"] },
        { canonical: "myrics", label: "米国度", aliases: ["mgd", "miguodu", "migudu", "miguo"] },
        { canonical: "hetu", label: "河图", aliases: [] },
        { canonical: "haitang", label: "海棠", aliases: ["ht"] },
        { canonical: "longma", label: "龙马", aliases: [] },
        { canonical: "lianhongxintiao", label: "脸红心跳", aliases: ["lianhong", "lhxt"] },
        { canonical: "hotupub", label: "HotUpub", aliases: [] },
        { canonical: "ihuaben", label: "话本", aliases: [] },
        { canonical: "local", label: "本地导入", aliases: [] },
        { canonical: "unknown", label: "未知", aliases: [] }
    ].map((definition) => Object.freeze({ ...definition, aliases: Object.freeze(definition.aliases.slice()) }))
);

function cleanPlatformKey(value = "") {
    return String(value || "").trim();
}

function normalizePlatformKey(value = "") {
    return cleanPlatformKey(value)
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
}

const DEFINITION_BY_ALIAS = new Map();
for (const definition of PLATFORM_DEFINITIONS) {
    for (const value of [definition.canonical, ...definition.aliases]) {
        DEFINITION_BY_ALIAS.set(normalizePlatformKey(value), definition);
    }
}

const DEFAULT_PLATFORM_LABELS = Object.freeze(
    Object.fromEntries(
        PLATFORM_DEFINITIONS.flatMap((definition) =>
            [definition.canonical, ...definition.aliases].map((value) => [value, definition.label])
        )
    )
);

const PLATFORM_SUFFIXES = Object.freeze(
    Object.fromEntries(
        PLATFORM_DEFINITIONS.flatMap((definition) =>
            [definition.canonical, ...definition.aliases].map((value) => [normalizePlatformKey(value), definition.canonical])
        )
    )
);

function canonicalPlatformKey(value = "") {
    const clean = cleanPlatformKey(value);
    if (!clean) return "";
    return DEFINITION_BY_ALIAS.get(normalizePlatformKey(clean))?.canonical || clean;
}

function platformQueryValues(value = "") {
    const clean = cleanPlatformKey(value);
    if (!clean) return [];
    const definition = DEFINITION_BY_ALIAS.get(normalizePlatformKey(clean));
    return definition ? [definition.canonical, ...definition.aliases] : [clean];
}

function defaultPlatformLabel(value = "") {
    const clean = cleanPlatformKey(value);
    if (!clean) return "";
    return DEFINITION_BY_ALIAS.get(normalizePlatformKey(clean))?.label || clean;
}

module.exports = {
    DEFAULT_PLATFORM_LABELS,
    PLATFORM_DEFINITIONS,
    PLATFORM_SUFFIXES,
    canonicalPlatformKey,
    cleanPlatformKey,
    defaultPlatformLabel,
    normalizePlatformKey,
    platformQueryValues
};
