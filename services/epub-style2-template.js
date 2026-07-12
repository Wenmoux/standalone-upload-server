/**
 * [INPUT]: 依赖 Node path、Style2 配置、书籍元数据与章节/分卷内容
 * [OUTPUT]: 对外提供老二次元 EPUB 的资源槽、基础 CSS、配置默认值和标题页/简介/分卷/正文渲染器
 * [POS]: services 的 Style2 模板内核，集中定义视觉结构并供 Bot 导出与 Admin 预览共享
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require("path");

const STYLE2_ASSET_DEFINITIONS = Object.freeze([
    { slot: "title-background", label: "标题页背景", width: 687, height: 1415, name: "Images/style2-title-background.jpg", file: "title-background.jpg", mediaType: "image/jpeg" },
    { slot: "colophon-background", label: "制作说明背景", width: 994, height: 2048, name: "Images/style2-colophon-background.jpg", file: "colophon-background.jpg", mediaType: "image/jpeg" },
    { slot: "intro-background", label: "简介页背景", width: 1678, height: 3456, name: "Images/style2-intro-background.jpg", file: "intro-background.jpg", mediaType: "image/jpeg" },
    { slot: "volume-1", label: "分卷图一", width: 1000, height: 1414, name: "Images/style2-volume-1.jpg", file: "volume-1.jpg", mediaType: "image/jpeg" },
    { slot: "volume-2", label: "分卷图二", width: 2480, height: 3507, name: "Images/style2-volume-2.jpg", file: "volume-2.jpg", mediaType: "image/jpeg" },
    { slot: "chapter-1", label: "正文章头图一", width: 1000, height: 625, name: "Images/style2-chapter-1.jpg", file: "chapter-1.jpg", mediaType: "image/jpeg" },
    { slot: "chapter-2", label: "正文章头图二", width: 1264, height: 533, name: "Images/style2-chapter-2.jpg", file: "chapter-2.jpg", mediaType: "image/jpeg" },
    { slot: "chapter-3", label: "正文章头图三", width: 1500, height: 844, name: "Images/style2-chapter-3.jpg", file: "chapter-3.jpg", mediaType: "image/jpeg" },
    { slot: "note", label: "太极注记图", width: 695, height: 727, name: "Images/style2-note.gif", file: "note.gif", mediaType: "image/gif" },
    { slot: "publisher", label: "标题页标志", width: 200, height: 195, name: "Images/style2-publisher.png", file: "publisher.png", mediaType: "image/png" }
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

const STYLE2_BASE_CSS = `@charset "UTF-8";
@font-face{font-family:"DK-SONGTI";src:local("Songti SC"),local("STSong"),local("SimSun");}
@font-face{font-family:"DK-HEITI";src:local("PingFang SC"),local("Microsoft YaHei"),local("SimHei");}
@font-face{font-family:"DK-KAITI";src:local("Kaiti SC"),local("STKaiti"),local("KaiTi");}
*{margin:0;padding:0;border:none;}
ul,ol{list-style:none;}
a{text-decoration:none;}
body{padding:0;margin-top:0;margin-bottom:0;margin-left:1%;margin-right:1%;line-height:130%;text-align:justify;font-family:__STYLE2_FONT__;}
p{text-align:justify;text-indent:2em;line-height:150%;margin-right:1%;margin-left:1%;font-family:__STYLE2_FONT__;}
div{margin:0;padding:0;line-height:130%;text-align:center;font-family:__STYLE2_FONT__;}
body.ver{background-image:url(__STYLE2_TITLE_BACKGROUND__);background-position:top center;background-repeat:no-repeat;background-attachment:fixed;background-size:cover;}
h3.booktitle{color:#29aeff;font-weight:bold;font-size:1.2em;font-family:"DK-HEITI","Microsoft YaHei","SimHei",sans-serif;text-indent:0!important;text-align:center;padding:25% 5px 5px;}
p.booksubtitle{margin-top:3em;color:#f6f7f9;font-weight:bold;font-size:medium;font-family:"DK-HEITI","Microsoft YaHei","SimHei",sans-serif;text-indent:0!important;text-align:center;text-shadow:1px 1px #000;}
p.bookauthor{margin-top:1em;font-family:"DK-KAITI","Kaiti SC","KaiTi",serif;text-indent:0!important;text-align:center;color:#f6f7f9;text-shadow:1px 1px #000;}
div.chubanshe{margin-top:12em;text-align:center;}
img.chubanshe{width:70px;height:65px;border:3px solid #fab400;object-fit:contain;background:rgba(255,255,255,.72);}
div.ff{margin:15% 5%;padding:1em;background-color:rgba(212,211,209,.5);border:1px solid rgba(0,0,0,.8);border-radius:28px;box-shadow:0 0 2px rgba(25,25,112,.1);}
body.bg{background-color:#fff;background-image:url(__STYLE2_COLOPHON_BACKGROUND__);background-repeat:no-repeat;background-size:cover;}
.xx{border-top-style:solid;border-color:#fff;border-width:1px;margin:1em 0 .5em auto;}
h3.ff-title{margin:1em auto;padding:0 4px;font-family:"DK-HEITI","Microsoft YaHei","SimHei",sans-serif;font-size:100%;color:#3d99f5;text-align:center;}
p.cc-pot{font-family:"DK-HEITI","SimHei",sans-serif;text-indent:0;duokan-text-indent:0;text-align:left;color:#fff;font-size:80%;text-shadow:1px 1px #000;}
p.ff-pot{font-family:"DK-HEITI","Microsoft YaHei",sans-serif;color:#000;font-size:65%;text-align:left;text-indent:0;duokan-text-indent:0;}
p.ff-text{margin-top:1em;font-family:"DK-HEITI","Microsoft YaHei",sans-serif;font-size:65%;color:#fff;text-indent:0;duokan-text-indent:0;text-shadow:1px 1px rgba(0,0,0,.24);}
p.ff-duokan{font-family:"DK-HEITI","Microsoft YaHei",sans-serif;font-size:50%;text-indent:0;text-align:left;duokan-text-indent:0;padding-bottom:15px;color:#ff2525;}
.duokan-footnote img{width:1.5em;vertical-align:middle;}
.babala{background:#253142 no-repeat center;background-size:cover;background-attachment:fixed;background-repeat:no-repeat;background-position:top center;background-image:url(__STYLE2_INTRO_BACKGROUND__);}
div.frame{padding:.5em 15px 15px;margin:3em 5px 1em;border-top:1px solid #000;border-left:1px solid #000;border-right:1px solid #000;border-radius:15px 15px 0 0;background:rgba(12,23,37,.28);text-shadow:0 1px 2px rgba(0,0,0,.78);}
div.cover{text-align:center;margin:0 auto;padding-top:1em;text-indent:0;duokan-text-indent:0;}
img.cover{margin:0;width:60px;max-height:92px;object-fit:cover;border:1px solid #fff;box-shadow:4px 4px 5px #a49d9d;}
h3.title{margin:.7em auto .4em;font-family:"FangSong","DK-SONGTI",serif;font-size:.8em;text-indent:0;text-align:center;color:#ffc500;line-height:100%;font-weight:bold;}
p.author{margin:.5em 0;color:#fff;font-size:.7em;text-align:center;font-family:"DK-KAITI","Kaiti SC","KaiTi",serif;}
.p1{font-family:"FangSong",sans-serif;font-size:100%;font-weight:bold;text-align:center;color:#f23e5b;}
.p2{font-family:"FangSong",sans-serif;font-size:57%;text-align:center;text-indent:0;color:#fff;}
.XD{border-top-style:solid;border-color:#000;border-width:1px;margin:1em 0 .5em auto;}
.RP{margin:.5em 0;text-indent:2em;duokan-text-indent:5em 2em;font-family:"FangSong",sans-serif;font-size:50%;font-weight:bold;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.9);}
.PL{font-family:"KaiTi",sans-serif;font-size:30%;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.9);}
div.frame2{padding:2.5em 10px 1em;margin:-3em 5px auto;border-bottom:1px solid #000;border-left:1px solid #000;border-right:1px solid #000;border-radius:0 0 15px 15px;background:rgba(12,23,37,.4);}
table.block{margin-bottom:.5em;width:100%;text-align:center;}
.volume-cover{margin:0;padding:0;text-indent:0;text-align:center;}
.image-single{text-indent:0;border:0;display:block;line-height:1;margin:1em 0;padding:0;text-decoration:none;width:100%;}
.img-name-1{border-bottom:1px solid #000;float:right;text-align:right;margin:0 0 auto;padding-right:.5em;color:#ff6699;font-size:.7em;font-family:"DK-HEITI","SimHei",sans-serif;}
.volume-art{display:block;width:100%;height:auto;border:3px solid #000;}
h2.head{font-family:"DK-KAITI","Kaiti SC","KaiTi",sans-serif;text-align:center;font-weight:bold;font-size:1.2em;margin:1em;color:#fff;line-height:140%;page-break-after:avoid;}
span.num{font-family:"DK-HEITI","SimHei",sans-serif;font-size:.65em;background-color:#ee82a4;border-radius:10px;padding:5px;color:#fff;}
h2.head b{font-family:"DK-HEITI","SimHei",sans-serif;font-size:1em;border-radius:5px;font-weight:900;padding:5px;color:#496dc6;}
div.logo{margin:0;text-align:center;text-indent:0;duokan-text-indent:0;duokan-bleed:lefttopright;}
img.logo{width:100%;height:auto;border:3px solid #000;display:block;}
img.logo1{width:40%;}
`;

function style2BuiltInAssetDir() {
    return path.resolve(__dirname, "../assets/epub-style2");
}

function style2CustomAssetDir(configFile = process.env.PO18_CONFIG_FILE || "/config/app.env") {
    return process.env.PO18_EPUB_STYLE2_ASSET_DIR || path.join(path.dirname(configFile), "epub-style2");
}

function style2AssetPaths(definition, configFile) {
    return [
        path.join(style2CustomAssetDir(configFile), `${definition.slot}.asset`),
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
    return `${STYLE2_BASE_CSS
        .replaceAll("__STYLE2_FONT__", style2.fontFamily || DEFAULT_STYLE2_CONFIG.fontFamily)
        .replaceAll("__STYLE2_TITLE_BACKGROUND__", `"${escapeCssUrl(assetUrl("title-background"))}"`)
        .replaceAll("__STYLE2_COLOPHON_BACKGROUND__", `"${escapeCssUrl(assetUrl("colophon-background"))}"`)
        .replaceAll("__STYLE2_INTRO_BACKGROUND__", `"${escapeCssUrl(assetUrl("intro-background"))}"`)}\n${style2.customCss || ""}`;
}

function renderStyle2TitlePage(context) {
    const { config, rawTitle, rawAuthor, paragraphs } = context;
    const style2 = config.style2;
    const publisher = STYLE2_ASSET_BY_SLOT.get("publisher");
    const logo = context.hasAsset(publisher.name)
        ? `<div class="chubanshe"><img alt="publisher" class="chubanshe" src="${assetHref(context, publisher.name)}"/></div>`
        : "";
    return `<body class="ver"><h3 class="booktitle" title="版权声明">${paragraphs.escape(rawTitle)}</h3><p class="booksubtitle">${paragraphs.escape(style2.subtitle)}</p><p class="bookauthor">${paragraphs.escape(rawAuthor)}<span style="color:#e70014;">著</span></p>${logo}</body>`;
}

function renderStyle2Colophon(context) {
    const { config, rawTitle, rawAuthor, paragraphs } = context;
    const style2 = config.style2;
    const note = STYLE2_ASSET_BY_SLOT.get("note");
    const marker = context.hasAsset(note.name)
        ? `<sup><span class="duokan-footnote"><img alt="note" src="${assetHref(context, note.name)}"/></span></sup>`
        : "";
    return `<body class="bg"><div class="ff"><h3 class="ff-title"><u>${paragraphs.escape(config.colophonTitle)}${marker}</u></h3><p class="cc-pot"><b>${paragraphs.escape(rawTitle)}</b></p><p class="ff-pot">${paragraphs.escape(rawAuthor)}◎著</p><p class="ff-pot">${paragraphs.escape(style2.versionText)}</p><p class="xx"></p><p class="ff-text">${paragraphs.escape(style2.sourceText)}</p><p class="ff-text">${paragraphs.escape(style2.copyrightText)}</p><p class="xx"></p><p class="ff-duokan">${paragraphs.escape(style2.readingTip)}</p></div></body>`;
}

function compactNumber(value, suffix = "") {
    const number = Math.max(0, Number(value || 0));
    if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 1 : 2).replace(/\.0+$/, "")}万${suffix}`;
    return `${Math.trunc(number)}${suffix}`;
}

function renderStyle2Intro(context) {
    const { config, rawTitle, rawAuthor, descriptionText, paragraphs, book, coverName, chapterCount } = context;
    const note = STYLE2_ASSET_BY_SLOT.get("note");
    const marker = context.hasAsset(note.name)
        ? `<sup><span class="duokan-footnote"><img alt="note" src="${assetHref(context, note.name)}"/></span></sup>`
        : "";
    const cover = coverName ? `<img alt="cover" class="cover" src="${assetHref(context, coverName)}"/>` : "";
    const platform = String(book.platform || "PO18 Reader").trim() || "PO18 Reader";
    const category = String(book.category || (Array.isArray(book.tags) ? book.tags[0] : "") || "网络小说").trim();
    const status = String(book.status || "连载中").trim();
    const wordCount = Number(book.word_count || book.wordCount || 0);
    return `<body class="babala"><div class="frame"><div class="cover">${cover}</div><h3 title="书籍信息" class="title">${paragraphs.escape(rawTitle)}${marker}</h3><p class="author">${paragraphs.escape(rawAuthor)}◎著</p><p class="XD"></p></div><div class="frame2"><table class="block"><tbody><tr><td class="p2">${paragraphs.escape(platform)}</td><td class="p2">${paragraphs.escape(category)}</td></tr><tr><td class="p1">${compactNumber(chapterCount, "章")}</td><td class="p1">${compactNumber(wordCount, "字")}</td></tr><tr><td class="p2">章节</td><td class="p2">${paragraphs.escape(status)}</td></tr></tbody></table><p class="XD"></p><p class="RP">${paragraphs.escape(config.introTitle)}</p>${paragraphs(descriptionText, "PL")}</div></body>`;
}

function renderStyle2Volume(context) {
    const { header, volumeNo } = context;
    const slot = volumeNo % 2 === 0 ? "volume-2" : "volume-1";
    const definition = STYLE2_ASSET_BY_SLOT.get(slot);
    const image = context.hasAsset(definition.name)
        ? `<div class="images image-single"><img alt="" class="volume-art" src="${assetHref(context, definition.name)}"/></div>`
        : "";
    return `<body><div class="volume-cover">${image}<div class="img-name-1"><h1>${header.name}</h1></div></div></body>`;
}

function renderStyle2Chapter(context) {
    const { header, bodyHtml, chapterNo } = context;
    const slot = `chapter-${(Math.floor((Math.max(1, chapterNo) - 1) / 325) % 3) + 1}`;
    const definition = STYLE2_ASSET_BY_SLOT.get(slot) || STYLE2_ASSET_BY_SLOT.get("chapter-1");
    const image = context.hasAsset(definition.name)
        ? `<div class="logo"><img alt="" class="logo" src="${assetHref(context, definition.name)}"/></div>`
        : "";
    return `<body><div class="top">${image}<h2 class="head"><span class="num">${header.number}</span><br/><b>${header.name}</b></h2>${bodyHtml}</div></body>`;
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
