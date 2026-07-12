const path = require("path");

const PLUM_SHADOW_NAME = "Images/style3-plum-shadow.svg";

const STYLE3_CSS = `@charset "UTF-8";
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
.style3-colophon-page{padding-top:14%;}
.style3-colophon-box{padding:1.45em 1.25em 1.25em;border:1px solid #e5e1da;border-radius:14px;background:#f8f6f1;}
.style3-colophon-title{margin:.8em 0 1.5em;font-size:1.08em;font-weight:600;letter-spacing:.16em;text-align:left;}
.style3-colophon-rule{width:100%;margin:0 0 1.25em;border-top:1px solid #ded9d2;}
.style3-colophon-text{color:#67635e;font-family:"Kaiti SC","STKaiti","KaiTi",serif;font-size:.84em;line-height:1.7;text-indent:0;duokan-text-indent:0;}
.style3-colophon-mark{margin:1.8em 0 0;color:#99938b;font-size:.68em;letter-spacing:.32em;text-indent:0;duokan-text-indent:0;text-align:right;}
.style3-colophon-branch{width:72%;margin:2.6em -5% 0 auto;opacity:.62;}
.style3-volume-page{padding:13% 7% 0;overflow:hidden;}
.style3-volume-copy{margin-left:2%;text-align:left;}
.style3-volume-index{margin:0 0 2.2em;color:#918b84;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:.65em;letter-spacing:.24em;text-indent:0;duokan-text-indent:0;text-align:left;}
.style3-volume-title{margin:0;color:#252321;font-size:1.76em;font-weight:600;line-height:1.42;letter-spacing:.08em;text-align:left;}
.style3-volume-number{display:block;margin-bottom:.52em;color:#77716a;font-size:.48em;font-weight:400;letter-spacing:.18em;}
.style3-volume-name{display:block;}
.style3-volume-rule{width:3.8em;margin:1.65em 0 0;border-top:1px solid #9d9790;}
.style3-volume-branch{width:116%;max-width:none;margin:6.4em -14% 0 4%;opacity:.78;}
.style3-chapter-lead{margin:2.5em 6% 2.2em;text-align:center;page-break-after:avoid;}
.style3-chapter-number{margin:0;color:#8c8780;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:.68em;letter-spacing:.14em;text-indent:0;duokan-text-indent:0;text-align:center;}
.style3-chapter-title{margin:.68em auto .9em;color:#252321;font-size:1.2em;font-weight:600;line-height:1.5;letter-spacing:.08em;text-align:center;}
.style3-chapter-rule{width:3.2em;margin:0 auto;border-top:1px solid #aaa49d;text-align:center;}
.style3-chapter-dot{display:inline-block;position:relative;top:-.72em;padding:0 .45em;background:#fcfbf7;color:#99938b;font-size:.72em;line-height:1;}
@media (max-width:480px){body{padding-left:7%;padding-right:7%;}p{line-height:1.72;}.style3-volume-page{padding-left:9%;padding-right:9%;}.style3-volume-branch{margin-top:5em;}.style3-chapter-lead{margin-left:3%;margin-right:3%;}}`;

function plumShadow(hasAsset, className) {
    return hasAsset(PLUM_SHADOW_NAME)
        ? `<img alt="" class="style3-art ${className}" src="../${PLUM_SHADOW_NAME}"/>`
        : `<div class="style3-art ${className} style3-art-fallback"></div>`;
}

module.exports = {
    id: "style3",
    name: "疏影横斜",
    description: "暖白留白、淡墨梅影、宋体标题与居中章序的文艺简约排版。",
    nestedVolumeToc: true,
    css: STYLE3_CSS,
    assets: [
        {
            id: "style3-plum-shadow",
            name: PLUM_SHADOW_NAME,
            mediaType: "image/svg+xml",
            paths: [path.resolve(__dirname, "assets/style3-plum-shadow.svg")]
        }
    ],
    renderColophon({ config, paragraphs, hasAsset }) {
        return `<body class="style3-colophon-page"><div class="style3-colophon-box"><p class="style3-eyebrow">PO18 READER</p><h1 class="style3-colophon-title">${paragraphs.escape(config.colophonTitle)}</h1><div class="style3-colophon-rule"></div>${paragraphs(config.colophonText, "style3-colophon-text")}<p class="style3-colophon-mark">疏影横斜</p></div>${plumShadow(hasAsset, "style3-colophon-branch")}</body>`;
    },
    renderIntro({ config, descriptionText, rawTitle, rawAuthor, paragraphs, hasAsset }) {
        return `<body class="style3-intro-page">${plumShadow(hasAsset, "style3-intro-branch")}<p class="style3-eyebrow">一卷清读</p><h1 class="style3-intro-title">${paragraphs.escape(config.introTitle)}</h1><p class="style3-intro-book">《${paragraphs.escape(rawTitle)}》 · ${paragraphs.escape(rawAuthor)}</p><div class="style3-intro-rule"></div>${paragraphs(descriptionText, "style3-intro-text")}</body>`;
    },
    renderVolume({ header, volumeNo, hasAsset }) {
        const index = String(volumeNo || 1).padStart(2, "0");
        return `<body class="style3-volume-page"><div class="style3-volume-copy"><p class="style3-volume-index">卷次 · ${index}</p><h1 class="style3-volume-title"><span class="style3-volume-number">${header.number}</span><span class="style3-volume-name">${header.name}</span></h1><div class="style3-volume-rule"></div></div>${plumShadow(hasAsset, "style3-volume-branch")}</body>`;
    },
    renderChapter({ header, bodyHtml }) {
        return `<body class="style3-chapter-page"><div class="style3-chapter-lead"><p class="style3-chapter-number">${header.number}</p><h2 class="style3-chapter-title">${header.name}</h2><div class="style3-chapter-rule"><span class="style3-chapter-dot">·</span></div></div>${bodyHtml}</body>`;
    }
};
