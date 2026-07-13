/**
 * [INPUT]: 依赖 Node path、疏影横斜梅影 SVG 和生成器提供的安全文本、真实卷章、全屏 spine 及资源上下文
 * [OUTPUT]: 对外提供 style3 疏影横斜的 CSS、全屏页声明、资源清单和参考样例结构的制作说明、简介、分卷、章页渲染器
 * [POS]: epub-styles 的文艺简约视觉插件，以动态 XHTML/SVG 复现样例的说明框与全屏分卷语义并服从上层 EPUB 结构契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require("path");

const PLUM_SHADOW_NAME = "Images/style3-plum-shadow.svg";

const STYLE3_CSS = `@charset "UTF-8";
/*
 * [INPUT]: 依赖疏影横斜 EPUB XHTML/SVG 语义类名、淡墨梅影装饰与兼容 Reader 的全屏页、内嵌 CSS 能力
 * [OUTPUT]: 提供 Style3 样例式浅灰说明框、全屏分卷画布、简介和正文的文艺简约排版规则
 * [POS]: ui 的 Style3 规范 CSS，Bot 内嵌镜像与 Admin 预览必须通过测试保持字节一致
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
html{background:#fcfbf7;}
body{margin:0;padding:0 6% 5%;background:#fcfbf7;color:#252321;font-family:"Songti SC","Noto Serif CJK SC","Source Han Serif SC","STSong","SimSun",serif;text-align:justify;text-justify:inter-ideograph;}
p{margin:.72em 0;line-height:1.68;text-indent:2em;duokan-text-indent:2em;text-align:justify;text-justify:inter-ideograph;}
img{max-width:100%;height:auto;}
.style3-art{display:block;height:auto;page-break-inside:avoid;}
.style3-art-fallback{height:1px;border-top:1px solid #d8d3cc;}
.style3-eyebrow{margin:0;color:#8c8780;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:.66em;letter-spacing:.28em;text-indent:0;duokan-text-indent:0;text-align:left;}
.style3-intro-page{padding-top:9%;}
.style3-intro-branch{width:64%;margin:0 -4% 1.2em auto;opacity:.82;}
.style3-intro-title{margin:.7em 0 .35em;font-size:1.55em;font-weight:600;line-height:1.45;letter-spacing:.12em;text-align:left;}
.style3-intro-book{margin:.15em 0 0;color:#736e67;font-size:.78em;letter-spacing:.08em;text-indent:0;duokan-text-indent:0;text-align:left;}
.style3-intro-rule{width:3.4em;margin:1.6em 0 1.8em;border-top:1px solid #aca69f;}
.style3-intro-text{font-size:1em;line-height:1.76;}
.style3-semantic-title{display:none;}
.style3-colophon-page{margin:0;padding:0;background:#fff;}
.style3-design-box{margin:20% 3% auto;padding:1em;border:4px solid #fafafa;border-radius:14px;background:#fcfcfc;}
.style3-design-content{margin:1em 0 0;color:#808080;font-family:"Microsoft YaHei","PingFang SC","STYuan",sans-serif;font-size:60%;line-height:1.5;text-indent:0;duokan-text-indent:0;}
.style3-design-icon{display:inline-block;width:1.25em;height:1.25em;margin:0 .28em 1px 0;border-radius:2px;background:#808080;color:#fff;font-size:.82em;font-weight:700;line-height:1.25em;text-align:center;vertical-align:middle;}
.style3-volume-page{margin:0;padding:0;background:#fff;overflow:hidden;}
.style3-volume-canvas{display:block;width:100%;height:100%;margin:0;padding:0;line-height:0;text-align:center;}
.style3-volume-svg{display:block;width:100%;height:100%;margin:0;padding:0;}
.style3-volume-number,.style3-volume-name{display:inline;}
.style3-chapter-lead{margin:2.5em 6% 2.2em;text-align:center;page-break-after:avoid;}
.style3-chapter-number{margin:0;color:#8c8780;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:.68em;letter-spacing:.14em;text-indent:0;duokan-text-indent:0;text-align:center;}
.style3-chapter-title{margin:.68em auto .9em;color:#252321;font-size:1.2em;font-weight:600;line-height:1.5;letter-spacing:.08em;text-align:center;}
.style3-chapter-rule{width:3.2em;margin:0 auto;border-top:1px solid #aaa49d;text-align:center;}
.style3-chapter-dot{display:inline-block;position:relative;top:-.72em;padding:0 .45em;background:#fcfbf7;color:#99938b;font-size:.72em;line-height:1;}
@media (max-width:480px){body{padding-left:7%;padding-right:7%;}p{line-height:1.72;}.style3-colophon-page,.style3-volume-page{padding-left:0;padding-right:0;}.style3-chapter-lead{margin-left:3%;margin-right:3%;}}`;

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
    css: STYLE3_CSS,
    assets: [
        {
            id: "style3-plum-shadow",
            name: PLUM_SHADOW_NAME,
            mediaType: "image/svg+xml",
            paths: [path.resolve(__dirname, "assets/style3-plum-shadow.svg")]
        }
    ],
    renderColophon({ config, paragraphs }) {
        return `<body class="style3-colophon-page"><h1 class="style3-semantic-title">${paragraphs.escape(config.colophonTitle)}</h1><div class="style3-design-box"><p class="style3-design-content"><span class="style3-design-icon">阅</span>${escapedWithBreaks(config.colophonText, paragraphs.escape)}</p></div></body>`;
    },
    renderIntro({ config, descriptionText, rawTitle, rawAuthor, paragraphs, hasAsset }) {
        return `<body class="style3-intro-page">${plumShadow(hasAsset, "style3-intro-branch")}<p class="style3-eyebrow">一卷清读</p><h1 class="style3-intro-title">${paragraphs.escape(config.introTitle)}</h1><p class="style3-intro-book">《${paragraphs.escape(rawTitle)}》 · ${paragraphs.escape(rawAuthor)}</p><div class="style3-intro-rule"></div>${paragraphs(descriptionText, "style3-intro-text")}</body>`;
    },
    renderVolume({ header, rawHeader, paragraphs, hasAsset }) {
        const escape = paragraphs?.escape || ((value) => String(value || ""));
        const rawName = rawHeader?.name || header.name;
        const volumeName = volumeNameTspans(rawName, escape);
        const dividerY = 760 + Math.max(0, volumeName.lineCount - 2) * 126;
        const branch =
            typeof hasAsset === "function" && hasAsset(PLUM_SHADOW_NAME)
                ? `<image x="230" y="1530" width="1420" height="450" opacity=".7" xlink:href="../${PLUM_SHADOW_NAME}"/>`
                : '<line x1="150" y1="1670" x2="560" y2="1670" stroke="#d8d3cc" stroke-width="2"/>';
        return `<body class="fullscreen-page style3-volume-page"><h1 class="style3-semantic-title"><span class="style3-volume-number">${header.number}</span> <span class="style3-volume-name">${header.name}</span></h1><div class="style3-volume-canvas"><svg class="style3-volume-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" height="100%" preserveAspectRatio="xMidYMid meet" viewBox="0 0 1536 2048" width="100%"><rect width="1536" height="2048" fill="#ffffff"/><text x="150" y="300" fill="#5f5a55" font-family="STSong,SimSun,serif" font-size="52" letter-spacing="8">${header.number}</text><text x="150" y="500" fill="#211f1d" font-family="STSong,SimSun,serif" font-size="112" font-weight="600" letter-spacing="10">${volumeName.markup}</text><line x1="150" y1="${dividerY}" x2="365" y2="${dividerY}" stroke="#98918a" stroke-width="2"/>${branch}</svg></div></body>`;
    },
    renderChapter({ header, bodyHtml }) {
        return `<body class="style3-chapter-page"><div class="style3-chapter-lead"><p class="style3-chapter-number">${header.number}</p><h2 class="style3-chapter-title">${header.name}</h2><div class="style3-chapter-rule"><span class="style3-chapter-dot">·</span></div></div>${bodyHtml}</body>`;
    }
};
