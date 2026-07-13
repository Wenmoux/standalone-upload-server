/**
 * [INPUT]: 依赖 Node path、独立 Style3 CSS/XHTML 模板、梅影/原始阅读提示图和生成器提供的安全文本、真实卷章及全屏上下文
 * [OUTPUT]: 对外提供 style3 疏影横斜的 CSS、全屏页声明、资源清单和参考样例结构的制作说明、简介、分卷、章页渲染器
 * [POS]: epub-styles 的文艺简约视觉插件，以动态 XHTML/SVG 复现样例的说明框与全屏分卷语义并服从上层 EPUB 结构契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require("path");
const { loadEpubTemplate, renderEpubTemplate } = require("../../services/epub-template-files");

const PLUM_SHADOW_NAME = "Images/style3-plum-shadow.svg";
const READER_MARK_NAME = "Images/style3-reader-mark.png";

function plumShadow(hasAsset, className) {
    return hasAsset(PLUM_SHADOW_NAME)
        ? `<img alt="" class="style3-art ${className}" src="../${PLUM_SHADOW_NAME}"/>`
        : `<div class="style3-art ${className} style3-art-fallback"></div>`;
}

function escapedWithBreaks(value, escape) {
    return String(value || "")
        .split(/\r?\n/)
        .map((line) => escape(line))
        .join("<br/>");
}

function volumeNameTspans(value, escape) {
    const characters = Array.from(String(value || "正文"));
    const lines = [];
    while (characters.length) lines.push(characters.splice(0, 8).join(""));
    return {
        markup: lines.map((line, index) => `<tspan x="150" dy="${index ? 126 : 0}">${escape(line)}</tspan>`).join(""),
        lineCount: lines.length
    };
}

function romanVolume(value) {
    let number = Math.max(1, Math.min(3999, Math.trunc(Number(value) || 1)));
    const pairs = [
        [1000, "M"],
        [900, "CM"],
        [500, "D"],
        [400, "CD"],
        [100, "C"],
        [90, "XC"],
        [50, "L"],
        [40, "XL"],
        [10, "X"],
        [9, "IX"],
        [5, "V"],
        [4, "IV"],
        [1, "I"]
    ];
    let result = "";
    for (const [unit, token] of pairs) {
        while (number >= unit) {
            result += token;
            number -= unit;
        }
    }
    return result;
}

module.exports = {
    id: "style3",
    name: "疏影横斜",
    description: "参考样例的浅灰说明框、全屏留白分卷、淡墨梅影与宋体章序。",
    nestedVolumeToc: true,
    useSlimCover: true,
    includeAppleDisplayOptions: true,
    coverPageNavTitle: "书封",
    coverPageSpineProperties: "duokan-page-fullscreen",
    volumePageSpineProperties: "duokan-page-fullscreen",
    volumeDocumentOptions: Object.freeze({ fullscreen: true }),
    css: loadEpubTemplate("style3.css"),
    assets: [
        {
            id: "style3-plum-shadow",
            name: PLUM_SHADOW_NAME,
            mediaType: "image/svg+xml",
            paths: [path.resolve(__dirname, "assets/style3-plum-shadow.svg")]
        },
        {
            id: "style3-reader-mark",
            name: READER_MARK_NAME,
            mediaType: "image/png",
            paths: [path.resolve(__dirname, "assets/style3-reader-mark.png")]
        }
    ],
    renderColophon({ config, paragraphs, hasAsset }) {
        const mark = hasAsset(READER_MARK_NAME) ? `<img alt="" class="style3-design-icon" src="../${READER_MARK_NAME}"/>` : "";
        return renderEpubTemplate("style3-colophon.xhtml", {
            TITLE: paragraphs.escape(config.colophonTitle),
            MARK: mark,
            CONTENT: escapedWithBreaks(config.colophonText, paragraphs.escape)
        });
    },
    renderIntro({ config, descriptionText, rawTitle, rawAuthor, paragraphs, hasAsset }) {
        return renderEpubTemplate("style3-intro.xhtml", {
            ART: plumShadow(hasAsset, "style3-intro-branch"),
            TITLE: paragraphs.escape(config.introTitle),
            BOOK: paragraphs.escape(rawTitle),
            AUTHOR: paragraphs.escape(rawAuthor),
            CONTENT: paragraphs(descriptionText, "style3-intro-text")
        });
    },
    renderVolume({ header, rawHeader, volumeNo, paragraphs, hasAsset }) {
        const escape = paragraphs?.escape || ((value) => String(value || ""));
        const rawName = rawHeader?.name || header.name;
        const volumeName = volumeNameTspans(rawName, escape);
        const partY = 730 + Math.max(0, volumeName.lineCount - 1) * 126;
        const branch =
            typeof hasAsset === "function" && hasAsset(PLUM_SHADOW_NAME)
                ? `<image x="230" y="1530" width="1420" height="450" opacity=".7" xlink:href="../${PLUM_SHADOW_NAME}"/>`
                : '<line x1="150" y1="1670" x2="560" y2="1670" stroke="#d8d3cc" stroke-width="2"/>';
        return renderEpubTemplate("style3-volume.xhtml", {
            NUMBER: header.number,
            TITLE: header.name,
            TITLE_LINES: volumeName.markup,
            PART_Y: partY,
            PART: romanVolume(volumeNo),
            ART: branch
        });
    },
    renderChapter({ header, bodyHtml }) {
        return renderEpubTemplate("style3-chapter.xhtml", {
            NUMBER: header.number,
            TITLE: header.name,
            CONTENT: bodyHtml
        });
    }
};
