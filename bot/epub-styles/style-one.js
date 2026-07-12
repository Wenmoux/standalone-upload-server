/**
 * [INPUT]: 依赖 Node path、江湖纸卷内置头图和生成器提供的转义、段落及资源可用性上下文
 * [OUTPUT]: 对外提供 style1 江湖纸卷的 CSS、资源声明和制作说明、简介、分卷、章页渲染器
 * [POS]: epub-styles 的古典纸卷视觉插件，只描述页面语义与装饰，不负责 EPUB 容器装配
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require("path");

const TOP_IMAGE_NAME = "Images/style-one-top.png";

module.exports = {
    id: "style1",
    name: "江湖纸卷",
    description: "暖纸底、红黑章头、圆形人物头图、竖排分卷和独立制作说明。",
    css: `@charset "UTF-8";
/*
 * [INPUT]: 依赖江湖纸卷 EPUB XHTML 语义类名与兼容 Reader 的内嵌 CSS 能力
 * [OUTPUT]: 提供 Style1 标题页、制作说明、简介、分卷与正文的统一排版规则
 * [POS]: ui 的 Style1 规范 CSS，Bot 内嵌镜像与 Admin 预览必须通过测试保持字节一致
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
body{margin:0;padding:0;text-align:justify;font-family:"Songti SC","Noto Serif CJK SC","Source Han Serif SC","STSong","SimSun",serif;background:#f3e6d4;color:#17120e;}
p{line-height:1.4em;text-align:justify;text-justify:inter-ideograph;text-indent:2em;duokan-text-indent:2em;margin:.7em 0;}
div{margin:0;padding:0;line-height:1.3;text-align:justify;}
.cover{margin:0;padding:0;text-indent:0;text-align:center;background:#000;}.cover svg,.cover img{width:100%;height:100%;display:block;}
.top-img-box{max-width:42em;margin:0 auto;text-align:center;duokan-bleed:lefttopright;page-break-inside:avoid;}.top-img{display:block;width:100%;height:auto;}
.volume-sequence-number{margin:1em auto .5em;padding:4px;width:1em;border:2px solid #a80000;line-height:1.1;font-family:"Noto Serif CJK SC","Source Han Serif SC","Songti SC",serif;text-align:center;font-size:1em;color:#a80000;}
.volume-title{margin:0 auto;width:1em;font-family:"Noto Serif CJK SC","Source Han Serif SC","Songti SC",serif;text-align:center;font-size:1.3em;color:#a80000;text-indent:0;duokan-text-indent:0;}
.chapter-title{margin:0 12% 2em;padding:0 4px;line-height:1.3;font-family:"Noto Serif CJK SC","Source Han Serif SC","Songti SC",serif;text-align:center;font-size:1.08em;color:#a80000;text-indent:0;page-break-after:avoid;}
.chapter-sequence-number{font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:x-small;font-weight:400;color:#676767;}
.introduction-title{margin:3em auto;font-family:"Noto Serif CJK SC","Source Han Serif SC","Songti SC",serif;text-align:center;font-size:1.35em;color:#000;}
.intro-text{font-family:"Kaiti SC","STKaiti","KaiTi",serif;color:#54236d;text-indent:0;duokan-text-indent:0;font-size:1.06em;line-height:1.7;background:rgba(255,255,255,.18);padding:.08em .15em;}
.end{margin:2em auto;text-align:center;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:small;color:#000;text-indent:0;duokan-text-indent:0;}
.design-box{margin:20% 2% 0;padding:.8em;border:2px solid rgba(246,246,246,.3);border-radius:7px;background:rgba(246,246,246,.3);}
.design-title{margin:1em auto;padding:0 4px;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:.9em;font-weight:400;color:#808080;text-align:center;}
.design-content{margin:1em 0;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:.82em;color:#808080;text-indent:0;duokan-text-indent:0;}
.design-icon{color:#ec902e;font-weight:700;margin-right:.25em;}.design-line{border-style:dashed;border-width:1px 0 0;border-color:rgba(120,120,110,.15);}
@media (max-width:480px){p{line-height:1.55em}.chapter-title{margin-left:8%;margin-right:8%}.design-box{margin-top:12%}}`,
    assets: [
        {
            id: "style-one-top",
            name: TOP_IMAGE_NAME,
            mediaType: "image/png",
            paths: [path.resolve(__dirname, "assets/jianghu-top.png")],
            dependency: "styleOneTopImageBytes",
            when: (config) => config.showTopImage
        }
    ],
    renderColophon({ config, paragraphs }) {
        const blocks = String(config.colophonText || "")
            .split(/\n\s*\n/)
            .filter(Boolean);
        const content = blocks
            .map(
                (block, index) =>
                    `<p class="design-content"><span class="design-icon">${index ? "●" : "◆"}</span>${paragraphs.escape(block)}</p>`
            )
            .join('<hr class="design-line"/>');
        return `<body><div class="design-box"><h1 class="design-title">${config.colophonTitle}</h1>${content}</div></body>`;
    },
    renderIntro({ config, descriptionText, paragraphs }) {
        return `<body><h1 class="introduction-title">${config.introTitle}</h1>${paragraphs(descriptionText, "intro-text")}</body>`;
    },
    renderVolume({ header, hasAsset, config, paragraphs }) {
        const art =
            config.showTopImage && hasAsset(TOP_IMAGE_NAME)
                ? `<div class="top-img-box"><img alt="chapter art" class="top-img" src="../${TOP_IMAGE_NAME}"/></div>`
                : "";
        const verticalTitle = Array.from(header.name.replace(/\s+/g, ""))
            .map((char) => paragraphs.escape(char))
            .join("<br/>");
        return `<body>${art}<h1 class="volume-sequence-number">${header.number}</h1><p class="volume-title">${verticalTitle}</p></body>`;
    },
    renderChapter({ header, bodyHtml, hasAsset, config }) {
        const art =
            config.showTopImage && hasAsset(TOP_IMAGE_NAME)
                ? `<div class="top-img-box"><img alt="chapter art" class="top-img" src="../${TOP_IMAGE_NAME}"/></div>`
                : "";
        return `<body>${art}<h2 class="chapter-title"><span class="chapter-sequence-number">${header.number}</span><br/>${header.name}</h2>${bodyHtml}</body>`;
    }
};
