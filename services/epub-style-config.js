/**
 * [INPUT]: 依赖 Style2 默认配置、组件模板库以及来自 admin_config/请求的 EPUB 通用、Style2、studio 与附加 CSS 数据
 * [OUTPUT]: 对外提供模板库元数据、默认导出配置和 EPUB 配置解析、规范化、CSS 清洗函数
 * [POS]: services 的 EPUB 模板库契约层，在持久配置、后台、Bot 交互和导出器之间维持同一配置模型
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { DEFAULT_STYLE2_CONFIG } = require("./epub-style2-template");
const { DEFAULT_STUDIO_CONFIG, normalizeStudioConfig } = require("./epub-component-library");

const LEGACY_STYLE2_DEFAULT_FONT_FAMILY = '"DK-SONGTI","Songti SC","STSong","SimSun","Noto Serif CJK SC",serif';

const EPUB_STYLE_OPTIONS = Object.freeze([
    {
        id: "style1",
        name: "江湖纸卷",
        description: "纯白阅读底、原版字体、红黑章头、人物头图、竖排分卷和独立制作说明。",
        public: true,
        capabilities: { colophon: true, chapterArt: "optional", bookInfo: false, volume: "vertical" }
    },
    {
        id: "style2",
        name: "老二次元",
        description: "复刻独立模板的插画标题页、制作说明、书籍信息、统一分卷图和正文章头。",
        public: true,
        capabilities: { colophon: true, chapterArt: "optional", bookInfo: true, volume: "illustrated" }
    },
    {
        id: "style3",
        name: "空门夜雨",
        description: "参考样例的完整楷体与粗宋字体、轻灰说明框、下划线分卷标题和居中章题。",
        public: true,
        capabilities: { colophon: true, chapterArt: "none", bookInfo: false, volume: "typographic" }
    },
    {
        id: "style4",
        name: "丹青云卷",
        description: "彩墨长屏前置页、双原字体、独立书籍信息、竖排分卷和无头图正文。",
        public: true,
        capabilities: { colophon: true, chapterArt: "none", bookInfo: true, volume: "illustrated" }
    },
    {
        id: "studio",
        name: "模板工坊",
        description: "自由组合知识库提炼的章题、分卷、简介和装饰组件。",
        public: true,
        direct: false,
        capabilities: { colophon: true, chapterArt: "none", bookInfo: false, volume: "component", componentLibrary: true }
    },
    {
        id: "crane",
        name: "仙鹤章头",
        description: "原有仙鹤头图与深色圆角标题条。",
        public: false,
        capabilities: { colophon: true, chapterArt: "fixed", bookInfo: false, volume: "typographic" }
    }
]);

const DEFAULT_EPUB_EXPORT_CONFIG = Object.freeze({
    styleId: "style1",
    includeColophon: true,
    colophonTitle: "制作说明",
    colophonText:
        "本书由 PO18 Reader 根据本地缓存内容生成，仅供个人阅读与备份使用。\n\n建议使用支持 EPUB 2、内嵌样式和自定义字体的阅读器，以获得更稳定的排版效果。",
    introTitle: "作品简介",
    showTopImage: true,
    studio: DEFAULT_STUDIO_CONFIG
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
    const inputFontFamily = input.fontFamily ?? input.font_family;
    return {
        subtitle: cleanText(input.subtitle, 80, DEFAULT_STYLE2_CONFIG.subtitle),
        versionText: cleanText(input.versionText ?? input.version_text, 160, DEFAULT_STYLE2_CONFIG.versionText),
        sourceText: cleanText(input.sourceText ?? input.source_text, 2000, DEFAULT_STYLE2_CONFIG.sourceText),
        copyrightText: cleanText(input.copyrightText ?? input.copyright_text, 2000, DEFAULT_STYLE2_CONFIG.copyrightText),
        readingTip: cleanText(input.readingTip ?? input.reading_tip, 1000, DEFAULT_STYLE2_CONFIG.readingTip),
        fontFamily: cleanFontFamily(
            inputFontFamily === LEGACY_STYLE2_DEFAULT_FONT_FAMILY ? DEFAULT_STYLE2_CONFIG.fontFamily : inputFontFamily,
            DEFAULT_STYLE2_CONFIG.fontFamily
        ),
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
        style2: normalizeStyle2Config(input.style2 || input.style_two || {}),
        studio: normalizeStudioConfig(input.studio || input.templateStudio || input.template_studio || {})
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
    DEFAULT_STUDIO_CONFIG,
    EPUB_STYLE_OPTIONS,
    cleanCss,
    normalizeEpubExportConfig,
    normalizeStyle2Config,
    parseEpubExportConfig
};
