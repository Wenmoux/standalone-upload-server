/**
 * [INPUT]: 依赖 Node path、独立 Style2 CSS/XHTML 模板、样式配置、书籍元数据与章节/分卷内容
 * [OUTPUT]: 对外提供老二次元 EPUB 的精简资源槽、基础 CSS、配置默认值和标题页/简介/分卷/正文渲染器
 * [POS]: services 的 Style2 模板内核，集中定义视觉结构并供 Bot 导出与 Admin 预览共享
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require("path");
const { loadEpubTemplate, renderEpubTemplate } = require("./epub-template-files");

const STYLE2_ASSET_DEFINITIONS = Object.freeze([
    {
        slot: "title-background",
        label: "标题页背景",
        width: 687,
        height: 1415,
        name: "Images/style2-title-background.jpg",
        file: "title-background.jpg",
        mediaType: "image/jpeg"
    },
    {
        slot: "colophon-background",
        label: "制作说明背景",
        width: 994,
        height: 2048,
        name: "Images/style2-colophon-background.jpg",
        file: "colophon-background.jpg",
        mediaType: "image/jpeg"
    },
    {
        slot: "intro-background",
        label: "简介页背景",
        width: 1678,
        height: 3456,
        name: "Images/style2-intro-background.jpg",
        file: "intro-background.jpg",
        mediaType: "image/jpeg"
    },
    {
        slot: "volume",
        label: "统一分卷图",
        width: 1000,
        height: 1414,
        name: "Images/style2-volume.jpg",
        file: "volume.jpg",
        mediaType: "image/jpeg"
    },
    {
        slot: "chapter",
        label: "统一正文章头图",
        width: 1000,
        height: 625,
        name: "Images/style2-chapter.jpg",
        file: "chapter.jpg",
        mediaType: "image/jpeg"
    }
]);

const STYLE2_ASSET_BY_SLOT = new Map(STYLE2_ASSET_DEFINITIONS.map((item) => [item.slot, item]));
const STYLE2_ASSET_BY_NAME = new Map(STYLE2_ASSET_DEFINITIONS.map((item) => [item.name, item]));

const DEFAULT_STYLE2_CONFIG = Object.freeze({
    subtitle: "内部群版",
    versionText: "PO18 Reader 自动排版",
    sourceText: "本书由 PO18 Reader 根据本地缓存内容生成，封面使用书籍元信息中的图片，页面结构与内置样式保持一致。",
    copyrightText: "本书仅供个人阅读、备份与排版学习，请勿用于商业用途。请支持正版，任何修改、加工与传播行为由使用者自行负责。",
    readingTip: "为获得最佳阅读效果，建议关闭阅读器自带排版增强，并允许 EPUB 使用内嵌样式。",
    fontFamily: '"DK-SONGTI","Songti SC","STSong","SimSun","Noto Serif CJK SC",serif',
    customCss: ""
});

const STYLE2_BASE_CSS = loadEpubTemplate("style2.css");

function style2BuiltInAssetDir() {
    return path.resolve(__dirname, "../assets/epub-style2");
}

function style2CustomAssetDir(configFile = process.env.PO18_CONFIG_FILE || "/config/app.env") {
    return process.env.PO18_EPUB_STYLE2_ASSET_DIR || path.join(path.dirname(configFile), "epub-style2");
}

function style2AssetPaths(definition, configFile, customDirOverride) {
    const customDir = customDirOverride || style2CustomAssetDir(configFile);
    const legacySlot = { volume: "volume-1", chapter: "chapter-1" }[definition.slot];
    return [
        path.join(customDir, `${definition.slot}.asset`),
        ...(legacySlot ? [path.join(customDir, `${legacySlot}.asset`)] : []),
        path.join(style2BuiltInAssetDir(), definition.file)
    ];
}

function assetHref(context, name) {
    return typeof context.assetHref === "function" ? context.assetHref(name) : `../${name}`;
}

function escapeCssUrl(value = "") {
    return String(value || "").replace(/["'()\\\n\r]/g, (char) => `\\${char}`);
}

function buildStyle2Css(config = {}, options = {}) {
    const style2 = config.style2 || config;
    const assetUrl = (slot) => {
        const definition = STYLE2_ASSET_BY_SLOT.get(slot);
        const fallback = definition ? `../${definition.name}` : "";
        return options.assetUrls?.[slot] || fallback;
    };
    return `${STYLE2_BASE_CSS.replaceAll("__STYLE2_FONT__", style2.fontFamily || DEFAULT_STYLE2_CONFIG.fontFamily)
        .replaceAll("__STYLE2_TITLE_BACKGROUND__", `"${escapeCssUrl(assetUrl("title-background"))}"`)
        .replaceAll("__STYLE2_COLOPHON_BACKGROUND__", `"${escapeCssUrl(assetUrl("colophon-background"))}"`)
        .replaceAll("__STYLE2_INTRO_BACKGROUND__", `"${escapeCssUrl(assetUrl("intro-background"))}"`)}\n${style2.customCss || ""}`;
}

function renderStyle2TitlePage(context) {
    const { config, rawTitle, rawAuthor, paragraphs } = context;
    const style2 = config.style2;
    return renderEpubTemplate("style2-title.xhtml", {
        TITLE: paragraphs.escape(rawTitle),
        SUBTITLE: paragraphs.escape(style2.subtitle),
        AUTHOR: paragraphs.escape(rawAuthor)
    });
}

function renderStyle2Colophon(context) {
    const { config, rawTitle, rawAuthor, paragraphs } = context;
    const style2 = config.style2;
    return renderEpubTemplate("style2-colophon.xhtml", {
        TITLE: paragraphs.escape(config.colophonTitle),
        BOOK: paragraphs.escape(rawTitle),
        AUTHOR: paragraphs.escape(rawAuthor),
        VERSION: paragraphs.escape(style2.versionText),
        SOURCE: paragraphs.escape(style2.sourceText),
        COPYRIGHT: paragraphs.escape(style2.copyrightText),
        TIP: paragraphs.escape(style2.readingTip)
    });
}

function compactNumber(value, suffix = "") {
    const number = Math.max(0, Number(value || 0));
    if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 1 : 2).replace(/\.0+$/, "")}万${suffix}`;
    return `${Math.trunc(number)}${suffix}`;
}

function renderStyle2Intro(context) {
    const { config, rawTitle, rawAuthor, descriptionText, paragraphs, book, coverName, chapterCount } = context;
    const cover = coverName ? `<img alt="cover" class="cover" src="${assetHref(context, coverName)}"/>` : "";
    const platform = String(book.platform || "PO18 Reader").trim() || "PO18 Reader";
    const category = String(book.category || (Array.isArray(book.tags) ? book.tags[0] : "") || "网络小说").trim();
    const status = String(book.status || "连载中").trim();
    const wordCount = Number(book.word_count || book.wordCount || 0);
    return renderEpubTemplate("style2-intro.xhtml", {
        COVER: cover,
        TITLE: paragraphs.escape(rawTitle),
        AUTHOR: paragraphs.escape(rawAuthor),
        PLATFORM: paragraphs.escape(platform),
        CATEGORY: paragraphs.escape(category),
        CHAPTERS: compactNumber(chapterCount, "章"),
        WORDS: compactNumber(wordCount, "字"),
        STATUS: paragraphs.escape(status),
        INTRO_TITLE: paragraphs.escape(config.introTitle),
        DESCRIPTION: paragraphs(descriptionText, "PL")
    });
}

function renderStyle2Volume(context) {
    const { header } = context;
    const definition = STYLE2_ASSET_BY_SLOT.get("volume");
    const image = context.hasAsset(definition.name)
        ? `<div class="images image-single"><img alt="" class="volume-art" src="${assetHref(context, definition.name)}"/></div>`
        : "";
    return renderEpubTemplate("style2-volume.xhtml", { IMAGE: image, TITLE: header.name });
}

function renderStyle2Chapter(context) {
    const { header, bodyHtml } = context;
    const definition = STYLE2_ASSET_BY_SLOT.get("chapter");
    const image = context.hasAsset(definition.name)
        ? `<div class="logo"><img alt="" class="logo" src="${assetHref(context, definition.name)}"/></div>`
        : "";
    return renderEpubTemplate("style2-chapter.xhtml", {
        IMAGE: image,
        NUMBER: header.number,
        TITLE: header.name,
        CONTENT: bodyHtml
    });
}

module.exports = {
    DEFAULT_STYLE2_CONFIG,
    STYLE2_BASE_CSS,
    STYLE2_ASSET_BY_NAME,
    STYLE2_ASSET_BY_SLOT,
    STYLE2_ASSET_DEFINITIONS,
    buildStyle2Css,
    renderStyle2Chapter,
    renderStyle2Colophon,
    renderStyle2Intro,
    renderStyle2TitlePage,
    renderStyle2Volume,
    style2AssetPaths,
    style2BuiltInAssetDir,
    style2CustomAssetDir
};
