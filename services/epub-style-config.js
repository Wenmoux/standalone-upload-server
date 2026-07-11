const EPUB_STYLE_OPTIONS = Object.freeze([
    {
        id: "style1",
        name: "样式一 · 江湖纸卷",
        description: "暖纸底、红黑章头、圆形人物头图、竖排分卷和独立制作说明。"
    },
    {
        id: "crane",
        name: "仙鹤章头",
        description: "原有仙鹤头图与深色圆角标题条。"
    }
]);

const DEFAULT_EPUB_EXPORT_CONFIG = Object.freeze({
    styleId: "style1",
    includeColophon: true,
    colophonTitle: "制作说明",
    colophonText:
        "本书由 PO18 Reader 根据本地缓存内容生成，仅供个人阅读与备份使用。\n\n建议使用支持 EPUB 2、内嵌样式和自定义字体的阅读器，以获得更稳定的排版效果。",
    introTitle: "作品简介",
    showTopImage: true
});

const STYLE_IDS = new Set(EPUB_STYLE_OPTIONS.map((item) => item.id));

function cleanText(value, maxLength, fallback = "") {
    const text = String(value ?? "")
        .replace(/\r\n?/g, "\n")
        .trim();
    return (text || fallback).slice(0, maxLength);
}

function booleanValue(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "string") return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
    return !!value;
}

function normalizeEpubExportConfig(value = {}) {
    const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const requestedStyle = String(input.styleId ?? input.style_id ?? input.style ?? DEFAULT_EPUB_EXPORT_CONFIG.styleId).trim();
    return {
        styleId: STYLE_IDS.has(requestedStyle) ? requestedStyle : DEFAULT_EPUB_EXPORT_CONFIG.styleId,
        includeColophon: booleanValue(input.includeColophon ?? input.include_colophon, DEFAULT_EPUB_EXPORT_CONFIG.includeColophon),
        colophonTitle: cleanText(input.colophonTitle ?? input.colophon_title, 80, DEFAULT_EPUB_EXPORT_CONFIG.colophonTitle),
        colophonText: cleanText(input.colophonText ?? input.colophon_text, 4000, DEFAULT_EPUB_EXPORT_CONFIG.colophonText),
        introTitle: cleanText(input.introTitle ?? input.intro_title, 80, DEFAULT_EPUB_EXPORT_CONFIG.introTitle),
        showTopImage: booleanValue(input.showTopImage ?? input.show_top_image, DEFAULT_EPUB_EXPORT_CONFIG.showTopImage)
    };
}

function parseEpubExportConfig(value = "") {
    if (value && typeof value === "object") return normalizeEpubExportConfig(value);
    try {
        return normalizeEpubExportConfig(JSON.parse(String(value || "{}")));
    } catch {
        return normalizeEpubExportConfig();
    }
}

module.exports = {
    DEFAULT_EPUB_EXPORT_CONFIG,
    EPUB_STYLE_OPTIONS,
    normalizeEpubExportConfig,
    parseEpubExportConfig
};
