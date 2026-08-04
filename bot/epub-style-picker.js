/**
 * [INPUT]: 依赖 services 的模板元数据、组件目录/短状态和 Telegram 64 字节 callback_data 约束
 * [OUTPUT]: 对外提供公开模板、先预览后生成的基础自定义、288 种工坊组合的规范化/解析及 inline keyboard 构造能力
 * [POS]: bot 交互层的 EPUB 模板库边界，统一 Telegram/QQ 实时预览选择语义并隐藏仅用于历史兼容的生成器样式
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { DEFAULT_EPUB_EXPORT_CONFIG, EPUB_STYLE_OPTIONS, normalizeEpubExportConfig } = require("../services/epub-style-config");
const {
    CATEGORIES: EPUB_STUDIO_CATEGORIES,
    component,
    cycleStudioConfig,
    decodeStudioConfig,
    encodeStudioConfig,
    normalizeStudioConfig
} = require("../services/epub-component-library");

const EPUB_EXPORT_STYLE_CHOICES = Object.freeze(
    EPUB_STYLE_OPTIONS.filter((item) => item.public).map((item) => ({
        id: item.id,
        label: item.name,
        description: item.description,
        direct: item.direct !== false,
        capabilities: { ...(item.capabilities || {}) }
    }))
);

const EPUB_EXPORT_STYLE_IDS = new Set(EPUB_EXPORT_STYLE_CHOICES.map((item) => item.id));

function normalizeEpubStyleChoice(value = "") {
    const id = String(value || "").trim();
    return EPUB_EXPORT_STYLE_IDS.has(id) ? id : "";
}

function normalizeEpubCustomConfig(value = {}) {
    const config = normalizeEpubExportConfig(value);
    const styleId = normalizeEpubStyleChoice(config.styleId) || DEFAULT_EPUB_EXPORT_CONFIG.styleId;
    const choice = EPUB_EXPORT_STYLE_CHOICES.find((item) => item.id === styleId);
    return {
        styleId,
        includeColophon: !!config.includeColophon,
        showTopImage: choice?.capabilities?.chapterArt === "optional" ? !!config.showTopImage : false,
        ...(styleId === "studio" ? { studio: normalizeStudioConfig(config.studio) } : {})
    };
}

function customFlags(config = {}) {
    const normalized = normalizeEpubCustomConfig(config);
    return `${normalized.includeColophon ? "1" : "0"}${normalized.showTopImage ? "1" : "0"}`;
}

function parseEpubCustomState(styleId = "", flags = "") {
    const bits = /^[01]{2}$/.test(String(flags || "")) ? String(flags) : "11";
    return normalizeEpubCustomConfig({
        styleId,
        includeColophon: bits[0] === "1",
        showTopImage: bits[1] === "1"
    });
}

function chunk(values, size) {
    const rows = [];
    for (let index = 0; index < values.length; index += size) rows.push(values.slice(index, index + size));
    return rows;
}

function epubStyleSelectionMarkup(bookId, callback = (parts) => parts.join("|")) {
    const id = String(bookId || "").trim();
    const directChoices = EPUB_EXPORT_STYLE_CHOICES.filter((style) => style.direct);
    return {
        inline_keyboard: [
            ...chunk(
                directChoices.map((style) => ({
                    text: style.label,
                    callback_data: callback(["epubcustom", "open", style.id, "11", id])
                })),
                2
            ),
            [
                { text: "基础自定义", callback_data: callback(["epubcustom", "open", "style1", "11", id]) },
                {
                    text: "模板工坊",
                    callback_data: callback(["epubstudio", "open", encodeStudioConfig(), id])
                }
            ]
        ]
    };
}

function epubCustomSelectionMarkup(bookId, value = {}, callback = (parts) => parts.join("|")) {
    const id = String(bookId || "").trim();
    const config = normalizeEpubCustomConfig(value);
    const choice = EPUB_EXPORT_STYLE_CHOICES.find((item) => item.id === config.styleId);
    const state = (operation, styleId = config.styleId, next = config) =>
        callback(["epubcustom", operation, styleId, customFlags({ ...next, styleId }), id]);
    const styleRows = chunk(
        EPUB_EXPORT_STYLE_CHOICES.filter((style) => style.direct).map((style) => ({
            text: `${style.id === config.styleId ? "✓ " : ""}${style.label}`,
            callback_data: state("base", style.id, { ...config, styleId: style.id })
        })),
        2
    );
    const toggles = [
        {
            text: `${config.includeColophon ? "✓" : "○"} 制作说明`,
            callback_data: state("colophon", config.styleId, { ...config, includeColophon: !config.includeColophon })
        }
    ];
    if (choice?.capabilities?.chapterArt === "optional") {
        toggles.push({
            text: `${config.showTopImage ? "✓" : "○"} 章头装饰`,
            callback_data: state("top", config.styleId, { ...config, showTopImage: !config.showTopImage })
        });
    }
    return {
        inline_keyboard: [
            ...styleRows,
            toggles,
            [
                { text: "生成 EPUB", callback_data: state("export") },
                { text: "返回模板库", callback_data: state("back") }
            ]
        ]
    };
}

function epubCustomSummary(bookId, value = {}, escape = (input) => String(input ?? "")) {
    const config = normalizeEpubCustomConfig(value);
    const choice = EPUB_EXPORT_STYLE_CHOICES.find((item) => item.id === config.styleId);
    const art = choice?.capabilities?.chapterArt;
    return [
        "自定义 EPUB",
        `<code>${escape(bookId)}</code>`,
        `底板：${escape(choice?.label || config.styleId)}`,
        `制作说明：${config.includeColophon ? "保留" : "移除"}`,
        `章头装饰：${art === "optional" ? (config.showTopImage ? "显示" : "隐藏") : art === "fixed" ? "模板固定" : "无"}`,
        "确认后才会开始生成和计算导出费用。"
    ].join("\n");
}

function epubStudioSelectionMarkup(bookId, value = {}, callback = (parts) => parts.join("|")) {
    const id = String(bookId || "").trim();
    const studio = normalizeStudioConfig(value);
    const state = encodeStudioConfig(studio);
    const categoryLabels = { chapter: "章题", volume: "分卷", intro: "简介", ornament: "装饰" };
    return {
        inline_keyboard: [
            ...EPUB_STUDIO_CATEGORIES.map((category) => {
                const next = cycleStudioConfig(studio, category);
                return [
                    {
                        text: `${categoryLabels[category]}：${component(category, studio[category]).name}`,
                        callback_data: callback(["epubstudio", category, encodeStudioConfig(next), id])
                    }
                ];
            }),
            [
                { text: "生成 EPUB", callback_data: callback(["epubstudio", "export", state, id]) },
                { text: "返回模板库", callback_data: callback(["epubstudio", "back", state, id]) }
            ]
        ]
    };
}

function epubStudioSummary(bookId, value = {}, escape = (input) => String(input ?? "")) {
    const studio = normalizeStudioConfig(value);
    return [
        "EPUB 模板工坊",
        `<code>${escape(bookId)}</code>`,
        `章题：${escape(component("chapter", studio.chapter).name)}`,
        `分卷：${escape(component("volume", studio.volume).name)}`,
        `简介：${escape(component("intro", studio.intro).name)}`,
        `装饰：${escape(component("ornament", studio.ornament).name)}`,
        "点击某一项会循环切换同类组件，确认后才开始生成。"
    ].join("\n");
}

function parseEpubStudioState(value = "") {
    return normalizeEpubCustomConfig({ styleId: "studio", studio: decodeStudioConfig(value) });
}

module.exports = {
    EPUB_EXPORT_STYLE_CHOICES,
    epubCustomSelectionMarkup,
    epubCustomSummary,
    epubStudioSelectionMarkup,
    epubStudioSummary,
    epubStyleSelectionMarkup,
    normalizeEpubCustomConfig,
    normalizeEpubStyleChoice,
    parseEpubCustomState,
    parseEpubStudioState
};
