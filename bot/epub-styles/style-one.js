/**
 * [INPUT]: 依赖 Node path、独立 Style1 CSS/XHTML 模板、参考 EPUB 拆出的头图/字体和生成器提供的转义、段落及资源上下文
 * [OUTPUT]: 对外提供 style1 江湖纸卷的长屏封面声明、原版字体资源和制作说明、无底色简介、分卷、章页渲染器
 * [POS]: epub-styles 的古典纸卷视觉插件，保持参考 EPUB 的页面语义和数值，不负责 EPUB 容器装配
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require("path");
const { loadEpubTemplate, renderEpubTemplate } = require("../../services/epub-template-files");

const TOP_IMAGE_NAME = "Images/style-one-top.png";
const FONT_ASSETS = Object.freeze([
    ["style1-asheng", "Fonts/style1-asheng.ttf", "application/x-font-ttf", "style1-asheng.ttf"],
    ["style1-fzlanting", "Fonts/style1-fzlanting.ttf", "application/x-font-ttf", "style1-fzlanting.ttf"],
    ["style1-stkaiti", "Fonts/style1-stkaiti.ttf", "application/x-font-ttf", "style1-stkaiti.ttf"],
    [
        "style1-source-han-serif-bold",
        "Fonts/style1-source-han-serif-bold.otf",
        "application/vnd.ms-opentype",
        "style1-source-han-serif-bold.otf"
    ]
]);

module.exports = {
    id: "style1",
    name: "江湖纸卷",
    description: "纯白阅读底、原版字体、红黑章头、人物头图、竖排分卷和独立制作说明。",
    useSlimCover: true,
    css: loadEpubTemplate("style1.css"),
    assets: [
        {
            id: "style-one-top",
            name: TOP_IMAGE_NAME,
            mediaType: "image/png",
            paths: [path.resolve(__dirname, "assets/jianghu-top.png")],
            dependency: "styleOneTopImageBytes",
            when: (config) => config.showTopImage
        },
        ...FONT_ASSETS.map(([id, name, mediaType, file]) => ({
            id,
            name,
            mediaType,
            paths: [path.resolve(__dirname, `assets/${file}`)]
        }))
    ],
    renderColophon({ config, paragraphs }) {
        const blocks = String(config.colophonText || "")
            .split(/\n\s*\n/)
            .filter(Boolean);
        const content = blocks
            .map(
                (block, index) =>
                    `<p class="design-content"><span class="duokanicon">${index ? "󰐏" : "󰐋"}</span>${paragraphs.escape(block)}</p>`
            )
            .join('<hr class="design-line"/>');
        return renderEpubTemplate("style1-colophon.xhtml", { TITLE: paragraphs.escape(config.colophonTitle), CONTENT: content });
    },
    renderIntro({ config, descriptionText, paragraphs }) {
        return renderEpubTemplate("style1-intro.xhtml", {
            TITLE: paragraphs.escape(config.introTitle),
            CONTENT: paragraphs(descriptionText, "intro-text")
        });
    },
    renderVolume({ header, hasAsset, config, paragraphs }) {
        const art =
            config.showTopImage && hasAsset(TOP_IMAGE_NAME)
                ? `<div class="top-img-box"><img alt="chapter art" class="top-img" src="../${TOP_IMAGE_NAME}"/></div>`
                : "";
        const verticalTitle = Array.from(header.name.replace(/\s+/g, ""))
            .map((char) => paragraphs.escape(char))
            .join("<br/>");
        return renderEpubTemplate("style1-volume.xhtml", { ART: art, NUMBER: header.number, TITLE: verticalTitle });
    },
    renderChapter({ header, bodyHtml, hasAsset, config }) {
        const art =
            config.showTopImage && hasAsset(TOP_IMAGE_NAME)
                ? `<div class="top-img-box"><img alt="chapter art" class="top-img" src="../${TOP_IMAGE_NAME}"/></div>`
                : "";
        return renderEpubTemplate("style1-chapter.xhtml", {
            ART: art,
            NUMBER: header.number,
            TITLE: header.name,
            CONTENT: bodyHtml
        });
    }
};
