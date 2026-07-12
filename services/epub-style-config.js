/**
 * [INPUT]: 依赖 Style2 默认配置以及来自 admin_config/请求的 EPUB 通用、Style2 与附加 CSS 数据
 * [OUTPUT]: 对外提供样式选项、默认导出配置和 EPUB 配置解析、规范化、CSS 清洗函数
 * [POS]: services 的 EPUB 样式契约层，在持久配置、后台表单和导出器之间维持同一配置模型
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { DEFAULT_STYLE2_CONFIG } = require("./epub-style2-template");

const EPUB_STYLE_OPTIONS = Object.freeze([
    {
        id: "style1",
        name: "江湖纸卷",
        description: "暖纸底、红黑章头、圆形人物头图、竖排分卷和独立制作说明。"
    },
    {
        id: "style2",
        name: "老二次元",
        description: "1:1 复刻参考 EPUB 的插画标题页、制作说明、书籍信息、分卷图和正文章头。"
    },
    {
        id: "style3",
        name: "疏影横斜",
        description: "暖白留白、淡墨梅影、宋体标题与居中章序的文艺简约排版。"
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

function cleanFontFamily(value, fallback = DEFAULT_STYLE2_CONFIG.fontFamily) {
    const text = String(value ?? "")
        .replace(/[^\w\u3400-\u9fff\s,"'\-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return (text || fallback).slice(0, 320);
}

function cleanCss(value, maxLength = 30000) {
    return String(value ?? "")
        .replace(/<\/?(?:style|script)\b[^>]*>/gi, "")
        .replace(/@import\s+[^;]+;?/gi, "")
        .replace(/url\s*\([^)]*\)/gi, "")
        .replace(/expression\s*\([^)]*\)/gi, "")
        .replace(/[<>]/g, "")
        .trim()
        .slice(0, maxLength);
}

function normalizeStyle2Config(value = {}) {
    const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
        subtitle: cleanText(input.subtitle, 80, DEFAULT_STYLE2_CONFIG.subtitle),
        versionText: cleanText(input.versionText ?? input.version_text, 160, DEFAULT_STYLE2_CONFIG.versionText),
        sourceText: cleanText(input.sourceText ?? input.source_text, 2000, DEFAULT_STYLE2_CONFIG.sourceText),
        copyrightText: cleanText(input.copyrightText ?? input.copyright_text, 2000, DEFAULT_STYLE2_CONFIG.copyrightText),
        readingTip: cleanText(input.readingTip ?? input.reading_tip, 1000, DEFAULT_STYLE2_CONFIG.readingTip),
        fontFamily: cleanFontFamily(input.fontFamily ?? input.font_family, DEFAULT_STYLE2_CONFIG.fontFamily),
        customCss: cleanCss(input.customCss ?? input.custom_css)
    };
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
        showTopImage: booleanValue(input.showTopImage ?? input.show_top_image, DEFAULT_EPUB_EXPORT_CONFIG.showTopImage),
        style2: normalizeStyle2Config(input.style2 || input.style_two || {})
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
    DEFAULT_STYLE2_CONFIG,
    EPUB_STYLE_OPTIONS,
    cleanCss,
    normalizeEpubExportConfig,
    normalizeStyle2Config,
    parseEpubExportConfig
};
