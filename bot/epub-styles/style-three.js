/**
 * [INPUT]: 依赖 Node path、独立 Style3 CSS/XHTML 模板、参考 EPUB 拆出的完整楷体/粗宋字体与阅读提示图，以及生成器安全文本上下文
 * [OUTPUT]: 对外提供 style3 空门夜雨的原版 CSS、字体资源、轻灰说明框、下划线分卷标题、居中章题和简介渲染器
 * [POS]: epub-styles 的素雅文学视觉插件，以纯排版复现样例并服从上层 EPUB 结构契约，不引入固定书名或分卷图片
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require("path");
const { loadEpubTemplate, renderEpubTemplate } = require("../../services/epub-template-files");

const READER_MARK_NAME = "Images/style3-reader-mark.png";
const FONT_ASSETS = Object.freeze([
    ["style3-stkaiti", "Fonts/style3-stkaiti.ttf", "application/x-font-ttf", "style3-stkaiti.ttf"],
    ["style3-stsongti-bold", "Fonts/style3-stsongti-bold.ttf", "application/x-font-ttf", "style3-stsongti-bold.ttf"]
]);

function escapedWithBreaks(value, escape) {
    return String(value || "")
        .split(/\r?\n/)
        .map((line) => escape(line))
        .join("<br/>");
}

module.exports = {
    id: "style3",
    name: "空门夜雨",
    description: "参考样例的完整楷体与粗宋字体、轻灰说明框、下划线分卷标题和居中章题。",
    nestedVolumeToc: true,
    useSlimCover: true,
    includeAppleDisplayOptions: true,
    coverPageSpineProperties: "duokan-page-fullscreen",
    css: loadEpubTemplate("style3.css"),
    assets: [
        {
            id: "style3-reader-mark",
            name: READER_MARK_NAME,
            mediaType: "image/png",
            paths: [path.resolve(__dirname, "assets/style3-reader-mark.png")]
        },
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
            CONTENT: paragraphs(descriptionText, "copyright-text")
        });
    },
    renderVolume({ header }) {
        return renderEpubTemplate("style3-volume.xhtml", {
            HEADING: [header.number, header.name].filter(Boolean).join("　")
        });
    },
    renderChapter({ header, bodyHtml }) {
        return renderEpubTemplate("style3-chapter.xhtml", {
            HEADING: [header.number, header.name].filter(Boolean).join("　"),
            CONTENT: bodyHtml
        });
    }
};
