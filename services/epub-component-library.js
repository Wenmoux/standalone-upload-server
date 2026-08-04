/**
 * [INPUT]: 依赖下载目录样书与知识库共同验证的安全 CSS/XHTML 组件定义、样式配置和生成器转义/段落能力
 * [OUTPUT]: 对外提供模板工坊四类十七个组件、4 字符短状态、规范化、CSS 生成和卷章页面渲染
 * [POS]: services 的组件模板库边界；运行时不读取用户本地 EPUB，不携带固定书名正文，供 Bot 与 EPUB 插件共同消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const COMPONENTS = Object.freeze({
    chapter: Object.freeze([
        { id: "yunwen", alias: "y", name: "云纹托题", source: "云空行", description: "赭金楷体居中章题，保留大片留白。" },
        { id: "zhuti", alias: "z", name: "朱题宠章", source: "宠魅", description: "黑色章次与朱红章名双行排列。" },
        { id: "hesu", alias: "h", name: "褐影素题", source: "1870叛逆者的告白书", description: "赭石棕楷体章题，轻微白色阴影。" },
        { id: "yanzhu", alias: "r", name: "胭朱雨书", source: "麒麟", description: "胭朱楷体单行章题，简洁醒目。" },
        { id: "mozhi", alias: "m", name: "墨紫书简", source: "[K] Kindle 模板家族", description: "墨紫主标题与朱红章次双行排列。" },
        { id: "danxia", alias: "d", name: "丹霞双题", source: "丹青制作模板家族", description: "丹红章名与深紫小号章次双行排列。" }
    ]),
    volume: Object.freeze([
        { id: "qinglan", alias: "q", name: "青阑铭卷", source: "1870叛逆者的告白书", description: "左侧竖线和中式卷名。" },
        { id: "shuanglan", alias: "s", name: "双阑朱铭", source: "麒麟", description: "朱红竖排卷名和双边竖线。" },
        { id: "xuanmu", alias: "x", name: "玄幕横匾", source: "1870叛逆者的告白书", description: "米白边框横匾，适合长卷名。" },
        { id: "danjuan", alias: "d", name: "丹墨卷签", source: "丹青制作模板家族", description: "双线框内分列卷次与卷名，不依赖固定分卷图。" }
    ]),
    intro: Object.freeze([
        { id: "xuanhe", alias: "x", name: "玄盒蜜语", source: "宠魅", description: "暖色底与半透明圆角简介盒。" },
        { id: "huihan", alias: "h", name: "灰函铭版", source: "云空行", description: "淡灰信息函盒，克制留白。" },
        { id: "qingmo", alias: "q", name: "青墨引言", source: "[K] Kindle 模板家族", description: "青墨左对齐标题与清爽正文，兼顾 Kindle。" }
    ]),
    ornament: Object.freeze([
        { id: "sanxing", alias: "s", name: "三星换景", source: "云空行", description: "赭金三点场景分隔符。" },
        { id: "qingjian", alias: "q", name: "青笺诗函", source: "1870叛逆者的告白书", description: "青绿边框题记卡片。" },
        { id: "zhuqian", alias: "z", name: "朱签终卷", source: "1870叛逆者的告白书", description: "红底白字的全书完标记。" },
        { id: "danhen", alias: "d", name: "丹痕分章", source: "丹青制作模板家族", description: "丹红菱点场景分隔，不依赖专属图片。" }
    ])
});

const DEFAULT_STUDIO_CONFIG = Object.freeze({ chapter: "yunwen", volume: "qinglan", intro: "huihan", ornament: "sanxing" });
const CATEGORIES = Object.freeze(["chapter", "volume", "intro", "ornament"]);

function component(category, id) {
    return COMPONENTS[category]?.find((item) => item.id === id) || COMPONENTS[category]?.[0];
}

function normalizeStudioConfig(value = {}) {
    const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return Object.fromEntries(CATEGORIES.map((category) => [category, component(category, String(input[category] || DEFAULT_STUDIO_CONFIG[category]))?.id]));
}

function encodeStudioConfig(value = {}) {
    const config = normalizeStudioConfig(value);
    return CATEGORIES.map((category) => component(category, config[category]).alias).join("");
}

function decodeStudioConfig(value = "") {
    const encoded = String(value || "");
    return normalizeStudioConfig(
        Object.fromEntries(
            CATEGORIES.map((category, index) => [category, COMPONENTS[category].find((item) => item.alias === encoded[index])?.id])
        )
    );
}

function cycleStudioConfig(value = {}, category = "") {
    const config = normalizeStudioConfig(value);
    if (!COMPONENTS[category]) return config;
    const options = COMPONENTS[category];
    const index = options.findIndex((item) => item.id === config[category]);
    config[category] = options[(index + 1) % options.length].id;
    return config;
}

function cssForChapter(id) {
    if (id === "zhuti") return `h2.studio-chapter{font-family:"黑体",sans-serif;text-align:center;font-size:1.1em;margin:1.5em 1em 4em;color:#b50a02;line-height:140%;}h2.studio-chapter b{font-size:.7em;font-weight:normal;color:#111;}`;
    if (id === "hesu") return `h2.studio-chapter{margin:0 0 1.5em;font-family:"StudioKaiti","楷体",serif;font-size:.8em;color:#7d593f;text-shadow:0 1px 1px #fff;font-weight:normal;text-align:center;line-height:110%;}h2.studio-chapter b{color:#7d593f;font-size:1.1em;}`;
    if (id === "yanzhu") return `h2.studio-chapter{font-family:"StudioKaiti","楷体",serif;text-align:center;font-weight:900;font-size:1.2em;margin:1em 0 2em;color:#c2181e;line-height:130%;}`;
    if (id === "mozhi") return `h2.studio-chapter{font-family:"StudioKaiti","黑体",sans-serif;text-align:center;font-weight:900;font-size:1em;margin:1em 0 2em;color:#413245;line-height:130%;}h2.studio-chapter .studio-number{font-size:1.2em;color:#c2181e;}`;
    if (id === "danxia") return `h2.studio-chapter{margin:0 0 1.8em;color:#a3151a;font-size:1.1em;line-height:130%;text-align:center;font-family:"StudioKaiti","楷体",serif;}h2.studio-chapter .studio-number{font-size:.7em;font-weight:bold;color:#413245;}`;
    return `h2.studio-chapter{margin:30% auto 2em;padding:1.5em;text-align:center;font-family:"StudioKaiti","楷体",serif;font-size:1.3em;color:#8a6927;background:url("../Images/studio-cloud.png") no-repeat center;background-size:contain;}`;
}

function cssForVolume(id) {
    if (id === "shuanglan") return `h2.studio-volume{font-family:"黑体",sans-serif;font-size:1.5em;width:1em;color:#b11e31;margin:20% 8% 2em auto;border-right:3px solid #b11e31;border-left:3px solid #b11e31;padding:6px 3px;text-align:center;}`;
    if (id === "xuanmu") return `h1.studio-volume{font-size:1.2em;line-height:130%;text-align:center;margin:45% 5% 0;padding:5%;color:#fcfbf6;font-family:"宋体",serif;font-weight:normal;background:rgba(0,0,0,.53);border:2px solid #fcfbf6;}`;
    if (id === "danjuan") return `div.studio-volume{width:60%;margin:15% auto 0;text-align:center;border:4px double #8f292d;padding:1.2em 0;}div.studio-volume .studio-volume-number{font-family:"StudioKaiti","黑体",sans-serif;font-size:1em;margin:.5em auto;line-height:100%;color:#413245;}div.studio-volume .studio-volume-title{font-family:"StudioKaiti","黑体",sans-serif;font-size:2em;margin:.5em auto 0;color:#a3151a;line-height:130%;}`;
    return `h1.studio-volume{font-family:"宋体",serif;margin:25% 0 0 12%;padding:5px 5px 5px .5em;color:#2f4f4f;font-size:1.2em;width:12em;border-left:3px solid #2f4f4f;}`;
}

function cssForIntro(id) {
    if (id === "xuanhe") return `body.studio-intro{background:#f5ede5;}div.studio-intro-box{padding:1.2em;width:90%;margin:25% auto 2px;background:rgba(0,0,0,.6);border-radius:20px;}div.studio-intro-box h1{font-size:100%;color:#f9d2a7;padding:15px 0 10px;text-align:center;}div.studio-intro-box p{font-size:70%;color:#bddec1;padding:0 10px;text-indent:0;}`;
    if (id === "qingmo") return `div.studio-intro-box{margin:18% 6% 0;padding:1em 0;border-top:1px solid #2d4843;border-bottom:1px solid #2d4843;}div.studio-intro-box h1{font-family:"StudioKaiti","黑体",sans-serif;text-align:left;font-weight:normal;font-size:1.4em;margin:0 0 1em;color:#2d4843;line-height:130%;}div.studio-intro-box p{font-size:.9em;line-height:170%;text-indent:2em;color:#333;}`;
    return `div.studio-intro-box{margin-top:20%;margin-left:3%;margin-right:3%;padding:1em;border:1px solid rgba(238,238,238,.33);border-radius:25px;background:rgba(246,246,246,.3);box-shadow:1px 1px 3px rgba(0,0,0,.13);}div.studio-intro-box h1{font-weight:bold;font-size:70%;color:#808080;text-indent:0;}div.studio-intro-box p{color:#808080;font-size:60%;text-indent:0;}`;
}

function cssForOrnament(id) {
    if (id === "qingjian") return `div.studio-ornament{font-size:.9em;padding:.5em;margin:2em .5em 1em;border-radius:13px;background:#fffef8;box-shadow:4px 4px 5px #a49d9d;border:1px solid #207f4c;}div.studio-ornament p{color:#248067;line-height:170%;text-indent:0;margin:.5em;font-size:.9em;}`;
    if (id === "zhuqian") return `p.studio-ornament{text-align:center;margin:2em 0;}p.studio-ornament span{color:#fff;padding:.2em .35em;font-size:1em;background:#f00;border-radius:5px;}`;
    if (id === "danhen") return `p.studio-ornament{margin:2em 0;text-align:center;font-size:1em;color:#a3151a;text-indent:0;}`;
    return `p.studio-ornament{margin:2em 0;text-align:center;font-size:14px;color:#8a6927;text-indent:0;}`;
}

function buildStudioCss(value = {}) {
    const config = normalizeStudioConfig(value);
    return `@font-face{font-family:"StudioKaiti";src:url("../Fonts/studio-stkaiti.ttf");}body{margin:0;padding:0;line-height:180%;text-align:justify;font-family:"宋体","SimSun",serif;}p{margin:.6em .5%;text-indent:2em;}div{margin:0;padding:0;line-height:130%;}a{color:inherit;text-decoration:none;}\n${cssForChapter(config.chapter)}\n${cssForVolume(config.volume)}\n${cssForIntro(config.intro)}\n${cssForOrnament(config.ornament)}`;
}

function renderStudioIntro(context, title, content) {
    const { paragraphs } = context;
    const safeTitle = paragraphs.escape(title);
    const body = paragraphs(content, "studio-intro-text");
    return `<body class="studio-intro"><div class="studio-intro-box"><h1>${safeTitle}</h1>${body}</div></body>`;
}

function renderStudioVolume({ config, header }) {
    const title = header.number ? `${header.number}　${header.name}` : header.name;
    if (config.studio.volume === "shuanglan") return `<body><h2 class="studio-volume">${title}</h2></body>`;
    if (config.studio.volume === "danjuan") {
        const number = header.number ? `<p class="studio-volume-number">${header.number}</p>` : "";
        return `<body><div class="studio-volume">${number}<p class="studio-volume-title">${header.name}</p></div></body>`;
    }
    return `<body><h1 class="studio-volume">${title}</h1></body>`;
}

function renderStudioChapter({ config, header, bodyHtml, chapterNo, chapterCount }) {
    let heading = `<h2 class="studio-chapter">${header.name}</h2>`;
    if (config.studio.chapter === "zhuti" && header.number) heading = `<h2 class="studio-chapter"><b>${header.number}</b><br/>${header.name}</h2>`;
    if (config.studio.chapter === "hesu" && header.number) heading = `<h2 class="studio-chapter"><b>${header.number}</b><br/><b>${header.name}</b></h2>`;
    if (["mozhi", "danxia"].includes(config.studio.chapter) && header.number) {
        heading = `<h2 class="studio-chapter"><span class="studio-number">${header.number}</span><br/>${header.name}</h2>`;
    }
    const ornament =
        config.studio.ornament === "zhuqian" && chapterNo === chapterCount
            ? '<p class="studio-ornament"><span>全书完</span></p>'
            : config.studio.ornament === "qingjian"
              ? '<div class="studio-ornament"><p>※</p></div>'
              : config.studio.ornament === "danhen"
                ? '<p class="studio-ornament">◆　◇　◆</p>'
                : '<p class="studio-ornament">※　※　※</p>';
    return `<body>${heading}${bodyHtml}${ornament}</body>`;
}

function componentCatalog() {
    return CATEGORIES.flatMap((category) => COMPONENTS[category].map((item) => ({ ...item, category })));
}

module.exports = {
    CATEGORIES,
    COMPONENTS,
    DEFAULT_STUDIO_CONFIG,
    buildStudioCss,
    component,
    componentCatalog,
    cycleStudioConfig,
    decodeStudioConfig,
    encodeStudioConfig,
    normalizeStudioConfig,
    renderStudioChapter,
    renderStudioIntro,
    renderStudioVolume
};
