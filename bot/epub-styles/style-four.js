/**
 * [INPUT]: 依赖 Node path、独立 Style4 CSS/XHTML 模板、参考 EPUB 拆出的两种字体与四张非正文资源，以及生成器安全文本上下文
 * [OUTPUT]: 对外提供 style4 丹青云卷的长屏封面、前置页、竖排分卷和保留源标题的无头图正文渲染器
 * [POS]: epub-styles 的彩墨古风视觉插件，保留参考 EPUB 的前置页与目录层级，同时明确排除含固定文本的正文章头图
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require("path");
const { loadEpubTemplate, renderEpubTemplate } = require("../../services/epub-template-files");

const ASSETS = Object.freeze([
    ["style4-volume", "Images/style4-volume.jpg", "image/jpeg", "style4-volume.jpg"],
    ["style4-colophon", "Images/style4-colophon.jpg", "image/jpeg", "style4-colophon.jpg"],
    ["style4-info", "Images/style4-info.jpg", "image/jpeg", "style4-info.jpg"],
    ["style4-intro", "Images/style4-intro.png", "image/png", "style4-intro.png"],
    ["style4-cc", "Fonts/style4-cc.ttf", "application/x-font-ttf", "style4-cc.ttf"],
    ["style4-llf", "Fonts/style4-llf.ttf", "application/x-font-ttf", "style4-llf.ttf"]
]);

function escapedWithBreaks(value, escape) {
    return String(value || "")
        .split(/\r?\n/)
        .map((line) => escape(line))
        .join("<br/>");
}

function firstValue(source, keys, fallback = "") {
    for (const key of keys) {
        const value = source?.[key];
        if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return fallback;
}

function compactWordCount(value) {
    const count = Number(value);
    if (!Number.isFinite(count) || count <= 0) return "字数未知";
    if (count >= 10000) return `${(count / 10000).toFixed(count >= 100000 ? 1 : 2).replace(/\.0+$/, "")}万字`;
    return `${Math.trunc(count)}字`;
}

module.exports = {
    id: "style4",
    name: "丹青云卷",
    description: "彩墨长屏前置页、双原字体、独立书籍信息、竖排分卷和无头图正文。",
    nestedVolumeToc: true,
    useSlimCover: true,
    coverPageNavTitle: "封面",
    coverPageSpineProperties: "duokan-page-fullscreen",
    bookInfoPageNavTitle: "书籍信息",
    css: loadEpubTemplate("style4.css"),
    assets: ASSETS.map(([id, name, mediaType, file]) => ({
        id,
        name,
        mediaType,
        paths: [path.resolve(__dirname, `assets/${file}`)]
    })),
    renderColophon({ config, rawTitle, rawAuthor, paragraphs }) {
        return renderEpubTemplate("style4-colophon.xhtml", {
            TITLE: paragraphs.escape(config.colophonTitle),
            BOOK: paragraphs.escape(rawTitle),
            AUTHOR: paragraphs.escape(rawAuthor),
            CONTENT: escapedWithBreaks(config.colophonText, paragraphs.escape)
        });
    },
    renderBookInfo({ book, rawTitle, rawAuthor, descriptionText, coverName, chapterCount, paragraphs }) {
        const escape = paragraphs.escape;
        const platform = firstValue(book, ["platform_name", "platformName", "platform"], "书库");
        const category = firstValue(book, ["category", "tags"], "小说");
        const status = firstValue(book, ["status"], "状态未知");
        const words = compactWordCount(firstValue(book, ["word_count", "wordCount", "words"], 0));
        const cover = coverName ? `<div class="cover"><img alt="cover" class="cover" src="../${coverName}"/></div>` : "";
        return renderEpubTemplate("style4-info.xhtml", {
            COVER: cover,
            TITLE: escape(rawTitle),
            AUTHOR: escape(rawAuthor),
            PLATFORM: escape(platform),
            CATEGORY: escape(category),
            CHAPTERS: `${Math.max(0, Number(chapterCount) || 0)}章`,
            WORDS: escape(words),
            STATUS: escape(status),
            DESCRIPTION: escape(descriptionText)
        });
    },
    renderIntro({ config, descriptionText, paragraphs }) {
        return renderEpubTemplate("style4-intro.xhtml", {
            TITLE: paragraphs.escape(config.introTitle),
            CONTENT: paragraphs(descriptionText)
        });
    },
    renderVolume({ header, rawHeader, paragraphs }) {
        const escape = paragraphs.escape;
        const rawParts = [rawHeader?.number, rawHeader?.name].filter(
            (value, index, values) => value && values.indexOf(value) === index
        );
        const escapedParts = [header.number, header.name].filter((value, index, values) => value && values.indexOf(value) === index);
        const rawTitle = rawParts.join(" ") || escapedParts.join(" ");
        const verticalTitle = Array.from(rawTitle)
            .filter((character) => !/\s/.test(character))
            .map((character) => escape(character))
            .join("<br/>");
        return renderEpubTemplate("style4-volume.xhtml", { TITLE: verticalTitle });
    },
    renderChapter({ header, bodyHtml }) {
        return renderEpubTemplate("style4-chapter.xhtml", {
            NUMBER_LINE: header.number ? `${header.number}<br/>` : "",
            TITLE: header.name,
            CONTENT: bodyHtml
        });
    }
};
