const path = require("path");

const ASSET_NAME = "Images/reader-crane-header.png";

module.exports = {
    id: "crane",
    name: "仙鹤章头",
    description: "原有仙鹤头图与深色圆角标题条。",
    css: `body{padding:0;margin:0 1% 5%;line-height:1.2;text-align:justify;background:#fffdf8;color:#222;}
h1{line-height:1.2;text-align:center;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-weight:bold;font-size:1.65em;}
h2{text-align:center;font-family:"FangSong","STFangsong",serif;font-weight:400;font-size:1.05em;margin:.2em 0 1.1em;color:#222;text-indent:0;}
div{margin:0;padding:0;text-align:justify;}
p{font-family:"Songti SC","Noto Serif CJK SC","SimSun",serif;text-indent:2em;duokan-text-indent:2em;display:block;line-height:1.3em;margin:.4em 0;}
a:link,a:visited{color:black;text-decoration:none;}
.cover{margin:0;padding:0;text-indent:0;text-align:center;}.cover svg,.cover img{width:100%;height:auto;display:block;}
.intro-page{padding:0;margin:0;}.intro-page h1{margin:3em auto 2em;}.intro-text{white-space:pre-wrap;}
.volume-page{padding-top:35%;text-align:center;}.volume-page h1{color:#3a4654;}
.chapter-header{min-height:13em;margin:0 0 1.8em;padding:2.6em 0 0;display:table;width:100%;page-break-inside:avoid;}
.chapter-header-art{display:table-cell;width:48%;vertical-align:bottom;text-align:left;}.chapter-header-art img{max-width:100%;max-height:12em;width:auto;height:auto;}
.chapter-header-copy{display:table-cell;vertical-align:bottom;text-align:right;padding:0 0 .8em 1em;}
.chapter-header-number{font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:1.5em;font-weight:300;color:#3a4654;line-height:1.2;margin:0 0 2.4em;text-align:right;text-indent:0;}
.chapter-header-name{display:inline-block;background-color:rgba(58,70,84,.8);border-radius:16px;margin:0 0 3.5em;padding:.5em 2em;color:#cbba75;font-weight:300;font-size:1em;font-family:"FangSong","STFangsong",serif;box-shadow:0 15px 10px -15px #000;text-align:right;line-height:1.2;text-indent:0;}
.colophon-page{padding:18% 3% 0;}.colophon-box{padding:1em;border:2px solid rgba(80,80,80,.08);border-radius:7px;background:rgba(246,246,246,.34);}.colophon-title{text-align:center;color:#777;font-size:.9em;}.colophon-content{color:#777;font-size:.82em;text-indent:0;}`,
    assets: [
        {
            id: "chapter-header-crane",
            name: ASSET_NAME,
            mediaType: "image/png",
            paths: [
                path.resolve(__dirname, "../assets/reader-crane-header.png"),
                path.resolve(__dirname, "../../cirno-src/src/assets/reader-crane-header.png")
            ],
            legacyDependency: "craneHeaderImageBytes"
        }
    ],
    renderColophon({ config, paragraphs }) {
        return `<body class="colophon-page"><div class="colophon-box"><h1 class="colophon-title">${config.colophonTitle}</h1>${paragraphs(config.colophonText, "colophon-content")}</div></body>`;
    },
    renderIntro({ config, descriptionText, paragraphs }) {
        return `<body class="intro-page"><h1>${config.introTitle}</h1>${paragraphs(descriptionText, "intro-text")}</body>`;
    },
    renderVolume({ title }) {
        return `<body class="volume-page"><h1>${title}</h1></body>`;
    },
    renderChapter({ header, bodyHtml, hasAsset }) {
        return `<body><div class="chapter-header">${hasAsset(ASSET_NAME) ? `<div class="chapter-header-art"><img alt="chapter header" src="../${ASSET_NAME}"/></div>` : ""}<div class="chapter-header-copy"><div class="chapter-header-number">${header.number}</div><div class="chapter-header-name">${header.name}</div></div></div>${bodyHtml}</body>`;
    }
};
