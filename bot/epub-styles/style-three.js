/**
 * [INPUT]: 依赖 Node path、独立 Style3 CSS/XHTML 模板、参考 EPUB 拆出的字体/三张已去除样例文字的分部装饰图/阅读提示图和生成器安全文本上下文
 * [OUTPUT]: 对外提供 style3 疏影横斜的原版 CSS、字体资源、只叠加当前书籍动态卷名的全屏分部页及制作说明、简介、数字章题渲染器
 * [POS]: epub-styles 的文艺简约视觉插件，以原始资源和动态文本复现样例并服从上层 EPUB 结构契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require("path");
const { loadEpubTemplate, renderEpubTemplate } = require("../../services/epub-template-files");

const READER_MARK_NAME = "Images/style3-reader-mark.png";
const VOLUME_ART_NAMES = Object.freeze(["Images/style3-volume-1.jpg", "Images/style3-volume-2.jpg", "Images/style3-volume-3.jpg"]);
const FONT_ASSETS = Object.freeze([
    ["style3-stkaiti", "Fonts/style3-stkaiti.ttf", "application/x-font-ttf", "style3-stkaiti.ttf"],
    ["style3-stsongti-bold", "Fonts/style3-stsongti-bold.ttf", "application/x-font-ttf", "style3-stsongti-bold.ttf"],
    ["style3-roboto-medium-numbers", "Fonts/style3-roboto-medium-numbers.ttf", "application/x-font-ttf", "style3-roboto-medium-numbers.ttf"]
]);

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
    description: "参考样例的原版字体、浅灰说明框、全屏留白分部底图与居中数字章题。",
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
            id: "style3-reader-mark",
            name: READER_MARK_NAME,
            mediaType: "image/png",
            paths: [path.resolve(__dirname, "assets/style3-reader-mark.png")]
        },
        ...VOLUME_ART_NAMES.map((name, index) => ({
            id: `style3-volume-${index + 1}`,
            name,
            mediaType: "image/jpeg",
            paths: [path.resolve(__dirname, `assets/style3-volume-${index + 1}.jpg`)]
        })),
        ...FONT_ASSETS.map(([id, name, mediaType, file]) => ({
            id,
            name,
            mediaType,
            paths: [path.resolve(__dirname, `assets/${file}`)]
        }))
    ],
    renderColophon({ config, paragraphs, hasAsset }) {
        const mark = hasAsset(READER_MARK_NAME) ? `<img alt="" class="design-icon-dk" src="../${READER_MARK_NAME}"/>` : "";
        return renderEpubTemplate("style3-colophon.xhtml", {
            TITLE: paragraphs.escape(config.colophonTitle),
            MARK: mark,
            CONTENT: escapedWithBreaks(config.colophonText, paragraphs.escape)
        });
    },
    renderIntro({ config, descriptionText, paragraphs }) {
        return renderEpubTemplate("style3-intro.xhtml", {
            TITLE: paragraphs.escape(config.introTitle),
            CONTENT: paragraphs(descriptionText)
        });
    },
    renderVolume({ header, rawHeader, volumeNo, paragraphs, hasAsset }) {
        const escape = paragraphs?.escape || ((value) => String(value || ""));
        const rawName = rawHeader?.name || header.name;
        const volumeName = volumeNameTspans(rawName, escape);
        const partY = 730 + Math.max(0, volumeName.lineCount - 1) * 126;
        const artName = VOLUME_ART_NAMES[(Math.max(1, Number(volumeNo) || 1) - 1) % VOLUME_ART_NAMES.length];
        const art =
            typeof hasAsset === "function" && hasAsset(artName)
                ? `<image width="1536" height="2048" xlink:href="../${artName}"/>`
                : "";
        return renderEpubTemplate("style3-volume.xhtml", {
            NUMBER: header.number,
            TITLE: header.name,
            TITLE_LINES: volumeName.markup,
            PART_Y: partY,
            PART: romanVolume(volumeNo),
            ART: art
        });
    },
    renderChapter({ header, bodyHtml }) {
        return renderEpubTemplate("style3-chapter.xhtml", {
            HEADING: [header.number, header.name].filter(Boolean).join("　"),
            CONTENT: bodyHtml
        });
    }
};
