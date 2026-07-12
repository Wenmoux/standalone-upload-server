<template>
  <div class="epub-style-editor">
    <div class="epub-workspace" :class="{ 'has-preview': hasPreview }">
      <div class="epub-settings">
        <div class="split">
          <label class="field">
            <span>默认样式</span>
            <select v-model="model.styleId">
              <option v-for="style in styles" :key="style.id" :value="style.id">{{ style.name }}</option>
            </select>
          </label>
          <label class="field"><span>简介页标题</span><input v-model.trim="model.introTitle" maxlength="80" /></label>
          <label class="field"><span>制作说明标题</span><input v-model.trim="model.colophonTitle" maxlength="80" /></label>
        </div>
        <p class="section-desc epub-style-description">{{ selectedDescription }}</p>

        <div class="tag-row epub-switches">
          <label class="check-row"><input v-model="model.includeColophon" type="checkbox" /><span>生成制作说明页</span></label>
          <label v-if="isStyle1" class="check-row"><input v-model="model.showTopImage" type="checkbox" /><span>显示样式头图</span></label>
        </div>

        <label v-if="!isStyle2 && model.includeColophon" class="field">
          <span>制作说明正文</span>
          <textarea v-model.trim="model.colophonText" rows="5" maxlength="4000"></textarea>
        </label>

        <template v-if="isStyle2">
          <div class="style2-fields">
            <label class="field"><span>标题页副标题</span><input v-model.trim="style2.subtitle" maxlength="80" /></label>
            <label class="field"><span>版本文本</span><input v-model.trim="style2.versionText" maxlength="160" /></label>
            <label class="field field-span"><span>字体族</span><input v-model.trim="style2.fontFamily" maxlength="320" /></label>
            <label class="field field-span"><span>制作来源文本</span><textarea v-model.trim="style2.sourceText" rows="3" maxlength="2000"></textarea></label>
            <label class="field field-span"><span>版权文本</span><textarea v-model.trim="style2.copyrightText" rows="3" maxlength="2000"></textarea></label>
            <label class="field field-span"><span>阅读提示</span><textarea v-model.trim="style2.readingTip" rows="2" maxlength="1000"></textarea></label>
            <label class="field field-span"><span>追加 CSS</span><textarea v-model="style2.customCss" rows="10" maxlength="30000" spellcheck="false"></textarea></label>
          </div>
        </template>

        <label v-if="hasPreview" class="field effective-css-field">
          <span>完整样式 CSS</span>
          <textarea :value="effectiveCss" rows="14" readonly spellcheck="false"></textarea>
          <small>{{ effectiveCssHint }}</small>
        </label>

        <div class="button-row epub-actions">
          <button type="button" @click="$emit('save')">保存导出配置</button>
          <button class="secondary" type="button" @click="$emit('refresh')">刷新配置</button>
        </div>
      </div>

      <aside v-if="hasPreview" class="epub-preview-panel">
        <div class="preview-head">
          <div>
            <strong>{{ previewTitle }}</strong>
            <small>{{ previewLabel }}</small>
            <small v-if="previewHint" class="preview-hint">{{ previewHint }}</small>
          </div>
          <div class="preview-tabs" role="tablist" aria-label="预览页面">
            <button
              v-for="page in previewPages"
              :key="page.id"
              type="button"
              :class="{ active: previewPage === page.id }"
              @click="previewPage = page.id"
            >{{ page.label }}</button>
          </div>
        </div>
        <div class="preview-device">
          <iframe :title="previewTitle" sandbox="allow-same-origin" :srcdoc="previewDocument"></iframe>
        </div>
      </aside>
    </div>

    <section v-if="isStyle2" class="asset-section">
      <div class="asset-section-head">
        <div>
          <strong>图片资源</strong>
          <small>自定义文件保存在 /config/epub-style2</small>
        </div>
        <button class="secondary" type="button" @click="loadAssets">刷新图片</button>
      </div>
      <div class="asset-grid">
        <article v-for="asset in assets" :key="asset.slot" class="asset-item">
          <div class="asset-thumb"><img :src="assetSrc(asset)" :alt="asset.label" /></div>
          <div class="asset-copy">
            <div class="asset-title-row">
              <strong>{{ asset.label }}</strong>
              <span :class="asset.custom ? 'custom' : 'builtin'">{{ asset.custom ? "自定义" : "内置" }}</span>
            </div>
            <small>推荐 {{ asset.recommendedWidth }} × {{ asset.recommendedHeight }}</small>
            <small>当前 {{ asset.width || "-" }} × {{ asset.height || "-" }} · {{ assetBytes(asset.bytes) }}</small>
            <small v-if="dimensionMismatch(asset)" class="dimension-warning">当前比例与原图不同</small>
            <div class="asset-actions">
              <label class="asset-upload" :class="{ disabled: uploadingSlot === asset.slot }">
                <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" :disabled="uploadingSlot === asset.slot" @change="uploadAsset(asset, $event)" />
                <span>{{ uploadingSlot === asset.slot ? "上传中..." : "替换图片" }}</span>
              </label>
              <button v-if="asset.custom" class="secondary" type="button" :disabled="uploadingSlot === asset.slot" @click="restoreAsset(asset)">恢复内置</button>
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup>
/**
 * [INPUT]: 依赖 Vue、内置 EPUB CSS/章头资产、Admin API 及父级传入的样式配置模型
 * [OUTPUT]: 提供 EPUB 样式选择、实时预览、模板参数编辑和自定义资产上传/删除界面
 * [POS]: admin-ui/src/components 的导出样式工作台，由 TelegramView 组合进导出配置流程
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { computed, inject, onMounted, ref, watch } from "vue";
import style1TopImage from "../../../bot/epub-styles/assets/jianghu-top.png";
import style3PlumShadow from "../../../bot/epub-styles/assets/style3-plum-shadow.svg";
import style1Css from "../../../ui/epub-style1.css?raw";
import style3Css from "../../../ui/epub-style3.css?raw";
import { api } from "../services/api";

const model = defineModel({ type: Object, required: true });
const props = defineProps({ styles: { type: Array, default: () => [] } });
defineEmits(["save", "refresh"]);

const toast = inject("toast", () => {});
const assets = ref([]);
const baseCss = ref("");
const templateDefaults = ref({});
const assetVersion = ref(Date.now());
const uploadingSlot = ref("");
const previewPage = ref("title");
const previewPageDefs = [
  { id: "title", label: "标题" },
  { id: "colophon", label: "说明" },
  { id: "intro", label: "简介" },
  { id: "volume", label: "分卷" },
  { id: "chapter", label: "正文" }
];

const fallbackStyle2 = {
  subtitle: "内部群版",
  versionText: "PO18 Reader 自动排版",
  sourceText: "本书由 PO18 Reader 根据本地缓存内容生成，封面使用书籍元信息中的图片，页面结构与内置样式保持一致。",
  copyrightText: "本书仅供个人阅读、备份与排版学习，请勿用于商业用途。请支持正版。",
  readingTip: "为获得最佳阅读效果，建议关闭阅读器自带排版增强，并允许 EPUB 使用内嵌样式。",
  fontFamily: '"DK-SONGTI","Songti SC","STSong","SimSun","Noto Serif CJK SC",serif',
  customCss: ""
};

const style2EpubAssetUrls = {
  "title-background": "../Images/style2-title-background.jpg",
  "colophon-background": "../Images/style2-colophon-background.jpg",
  "intro-background": "../Images/style2-intro-background.jpg"
};
const previewEmbeddedAssetSlots = new Set([
  "title-background",
  "colophon-background",
  "intro-background"
]);

function ensureStyle2() {
  const defaults = { ...fallbackStyle2, ...(templateDefaults.value || {}) };
  model.value.style2 = { ...defaults, ...(model.value.style2 || {}) };
}

watch(() => model.value, ensureStyle2, { immediate: true });

const style2 = computed(() => model.value.style2);
const isStyle1 = computed(() => model.value.styleId === "style1");
const isStyle2 = computed(() => model.value.styleId === "style2");
const isStyle3 = computed(() => model.value.styleId === "style3");
const hasPreview = computed(() => isStyle1.value || isStyle2.value || isStyle3.value);
const previewPages = computed(() => previewPageDefs.map((item) => (item.id === "title" && (isStyle1.value || isStyle3.value) ? { ...item, label: "封面" } : item)));
const selectedDescription = computed(() => props.styles.find((item) => item.id === model.value.styleId)?.description || "选择后应用于下一次 EPUB 导出。");
const previewLabel = computed(() => previewPages.value.find((item) => item.id === previewPage.value)?.label || "");
const previewTitle = computed(() => {
  if (isStyle1.value) return "样式 1 预览";
  if (isStyle2.value) return "老二次元预览";
  return "疏影横斜预览";
});
const effectiveCssHint = computed(() => isStyle2.value
  ? "只读预览；内置基础 CSS 与追加 CSS 已合并，保存后用于下一次 EPUB 导出。"
  : `只读预览；内容与${isStyle3.value ? "疏影横斜" : "样式一"}内置样式包 CSS 保持一致。`);
const previewHint = computed(() => {
  if (previewPage.value === "volume") return "这里只展示分卷版式；导出时仅在章节数据包含真实分卷时生成。";
  if (previewPage.value === "colophon" && !model.value.includeColophon) return "制作说明已关闭，导出时不会生成此页。";
  return "";
});

function escapeHtml(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function safeFontFamily(value = "") {
  return String(value || "").replace(/[^\w\u3400-\u9fff\s,"'\-]/g, " ").replace(/\s+/g, " ").slice(0, 320).trim() || fallbackStyle2.fontFamily;
}

function safeCustomCss(value = "") {
  return String(value || "")
    .replace(/<\/?(?:style|script)\b[^>]*>/gi, "")
    .replace(/@import\s+[^;]+;?/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/[<>]/g, "")
    .slice(0, 30000);
}

function assetBySlot(slot) {
  return assets.value.find((item) => item.slot === slot);
}

function assetSrc(asset) {
  if (asset?.previewUrl) return asset.previewUrl;
  if (!asset?.url) return "";
  return `${asset.url}?v=${assetVersion.value}`;
}

function assetUrl(slot) {
  return assetSrc(assetBySlot(slot));
}

function previewParagraphs(value, className = "") {
  return String(value || "")
    .split(/\n\s*\n|\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `<p${className ? ` class="${className}"` : ""}>${escapeHtml(item)}</p>`)
    .join("");
}

const style1PreviewCss = `${style1Css}
html,body{min-height:100%;}
body.style1-cover-preview{display:flex;align-items:center;justify-content:center;padding:1.4em;background:radial-gradient(circle at 25% 18%,#fff8eb 0,#ead2b3 42%,#c9996f 100%);}
.style1-cover-card{box-sizing:border-box;width:100%;min-height:88%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2em 1.2em;border:1px solid rgba(112,52,24,.38);background:rgba(255,249,237,.72);box-shadow:0 14px 30px rgba(91,48,24,.2);text-align:center;}
.style1-cover-seal{padding:.28em .65em;border:1px solid #a80000;color:#a80000;font:700 .72em/1.2 "PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:.14em;}
.style1-cover-card h1{max-width:8em;margin:2.1em auto .8em;color:#6f1712;font-size:1.7em;line-height:1.55;text-align:center;}
.style1-cover-author{color:#3e2a1d;text-indent:0;duokan-text-indent:0;text-align:center;}
.style1-cover-note{margin-top:auto;color:#795f4d;font-size:.72em;line-height:1.45;text-align:center;}
`.replace(/<\/style/gi, "<\\/style");

function resolveStyle2Css(assetUrlForSlot) {
  const css = String(baseCss.value || "")
    .replaceAll("__STYLE2_FONT__", safeFontFamily(style2.value.fontFamily))
    .replaceAll("__STYLE2_TITLE_BACKGROUND__", `"${assetUrlForSlot("title-background")}"`)
    .replaceAll("__STYLE2_COLOPHON_BACKGROUND__", `"${assetUrlForSlot("colophon-background")}"`)
    .replaceAll("__STYLE2_INTRO_BACKGROUND__", `"${assetUrlForSlot("intro-background")}"`);
  return `${css}\n${safeCustomCss(style2.value.customCss)}`.trim();
}

const style2EffectiveCss = computed(() => resolveStyle2Css((slot) => style2EpubAssetUrls[slot] || ""));
const style2PreviewCss = computed(() => `${resolveStyle2Css(assetUrl)}\nhtml,body{min-height:100%;}`.replace(/<\/style/gi, "<\\/style"));
const style3PreviewCss = `${style3Css}
html,body{min-height:100%;}
body.style3-cover-preview{box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:1.5em;background:#f2efe9;}
.style3-cover-card{position:relative;box-sizing:border-box;width:100%;min-height:90%;overflow:hidden;padding:3em 1.5em 2em;border:1px solid #d9d4cd;background:#fcfbf7;text-align:left;box-shadow:0 14px 30px rgba(71,66,60,.12);}
.style3-cover-branch{width:112%;max-width:none;margin:-2em -18% 2.2em 5%;opacity:.72;}
.style3-cover-kicker{margin:0;color:#8c8780;font:500 .66em/1.4 "PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:.26em;text-indent:0;duokan-text-indent:0;text-align:left;}
.style3-cover-card h1{max-width:8em;margin:.9em 0 .65em;color:#252321;font-size:1.72em;font-weight:600;line-height:1.52;letter-spacing:.1em;text-align:left;}
.style3-cover-author{margin:0;color:#6f6962;font-size:.82em;letter-spacing:.08em;text-indent:0;duokan-text-indent:0;text-align:left;}
.style3-cover-note{position:absolute;right:1.7em;bottom:1.8em;color:#99938b;font-size:.66em;line-height:1.5;text-align:right;}
`.replace(/<\/style/gi, "<\\/style");
const effectiveCss = computed(() => {
  if (isStyle1.value) return style1Css.trim();
  if (isStyle3.value) return style3Css.trim();
  return style2EffectiveCss.value;
});

const style1PreviewBody = computed(() => {
  const title = "原来，她们才是主角";
  const author = "ccc";
  const art = model.value.showTopImage
    ? `<div class="top-img-box"><img alt="江湖纸卷人物头图" class="top-img" src="${style1TopImage}"/></div>`
    : "";
  if (previewPage.value === "title") {
    return `<body class="style1-cover-preview"><div class="style1-cover-card"><span class="style1-cover-seal">PO18 READER</span><h1>${title}</h1><p class="style1-cover-author">${author} · 著</p><small class="style1-cover-note">正式导出时使用当前书籍封面</small></div></body>`;
  }
  if (previewPage.value === "colophon") {
    if (!model.value.includeColophon) {
      return `<body><div class="design-box"><h1 class="design-title">制作说明未生成</h1><p class="design-content"><span class="design-icon">◆</span>当前已关闭“生成制作说明页”。</p></div></body>`;
    }
    const blocks = String(model.value.colophonText || "本书由 PO18 Reader 根据本地缓存内容生成。\n\n仅供个人阅读与备份，请支持正版。")
      .split(/\n\s*\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    const content = blocks
      .map((item, index) => `<p class="design-content"><span class="design-icon">${index ? "●" : "◆"}</span>${escapeHtml(item)}</p>`)
      .join('<hr class="design-line"/>');
    return `<body><div class="design-box"><h1 class="design-title">${escapeHtml(model.value.colophonTitle)}</h1>${content}</div></body>`;
  }
  if (previewPage.value === "intro") {
    return `<body><h1 class="introduction-title">${escapeHtml(model.value.introTitle)}</h1>${previewParagraphs("牧知安穿越到了仙侠世界，成为了一名注定要被主角当作踏脚石的配角。\n\n围绕在身边的人们都有自己的故事，而命运也正悄然改变。", "intro-text")}</body>`;
  }
  if (previewPage.value === "volume") {
    const verticalTitle = Array.from("少年游").map((char) => escapeHtml(char)).join("<br/>");
    return `<body>${art}<h1 class="volume-sequence-number">第一卷</h1><p class="volume-title">${verticalTitle}</p></body>`;
  }
  return `<body>${art}<h2 class="chapter-title"><span class="chapter-sequence-number">第1章</span><br/>配角竟是我自己</h2>${previewParagraphs("马车伴随着清脆的声音，沿着街道缓缓前行。\n\n窗外细雨飘落，湿润的地面映着灯火，故事从这里开始。\n\n他抬起头，终于意识到自己正站在命运改变的路口。")}</body>`;
});

const style2PreviewBody = computed(() => {
  const title = "原来，她们才是主角";
  const author = "ccc";
  const note = assetUrl("note");
  const marker = note ? `<sup><span class="duokan-footnote"><img alt="note" src="${note}"/></span></sup>` : "";
  if (previewPage.value === "title") {
    return `<body class="ver"><h3 class="booktitle">${title}</h3><p class="booksubtitle">${escapeHtml(style2.value.subtitle)}</p><p class="bookauthor">${author}<span style="color:#e70014;">著</span></p><div class="chubanshe"><img class="chubanshe" alt="publisher" src="${assetUrl("publisher")}"/></div></body>`;
  }
  if (previewPage.value === "colophon") {
    if (!model.value.includeColophon) {
      return `<body class="bg"><div class="ff"><h3 class="ff-title"><u>制作说明未生成</u></h3><p class="ff-text">当前已关闭“生成制作说明页”。</p></div></body>`;
    }
    return `<body class="bg"><div class="ff"><h3 class="ff-title"><u>${escapeHtml(model.value.colophonTitle)}${marker}</u></h3><p class="cc-pot"><b>${title}</b></p><p class="ff-pot">${author}◎著</p><p class="ff-pot">${escapeHtml(style2.value.versionText)}</p><p class="xx"></p><p class="ff-text">${escapeHtml(style2.value.sourceText)}</p><p class="ff-text">${escapeHtml(style2.value.copyrightText)}</p><p class="xx"></p><p class="ff-duokan">${escapeHtml(style2.value.readingTip)}</p></div></body>`;
  }
  if (previewPage.value === "intro") {
    return `<body class="babala"><div class="frame"><div class="cover"><img class="cover" alt="cover" src="${assetUrl("volume-1")}"/></div><h3 class="title">${title}${marker}</h3><p class="author">${author}◎著</p><p class="XD"></p></div><div class="frame2"><table class="block"><tbody><tr><td class="p2">刺猬猫小说</td><td class="p2">仙侠武侠</td></tr><tr><td class="p1">658章</td><td class="p1">324.3万字</td></tr><tr><td class="p2">章节</td><td class="p2">已完结</td></tr></tbody></table><p class="XD"></p><p class="RP">${escapeHtml(model.value.introTitle)}</p><p class="PL">牧知安穿越到了仙侠世界，成为了一名注定要被主角当作踏脚石的配角。</p><p class="PL">围绕在身边的人们都有自己的故事，而命运也正悄然改变。</p></div></body>`;
  }
  if (previewPage.value === "volume") {
    return `<body><div class="volume-cover"><div class="images image-single"><img class="volume-art" alt="volume" src="${assetUrl("volume-1")}"/></div><div class="img-name-1"><h1>少年游</h1></div></div></body>`;
  }
  return `<body><div class="top"><div class="logo"><img class="logo" alt="chapter" src="${assetUrl("chapter-1")}"/></div><h2 class="head"><span class="num">第1章</span><br/><b>配角竟是我自己</b></h2><p>马车伴随着清脆的声音，沿着街道缓缓前行。</p><p>窗外细雨飘落，湿润的地面映着灯火，故事从这里开始。</p><p>他抬起头，终于意识到自己正站在命运改变的路口。</p></div></body>`;
});

const style3PreviewBody = computed(() => {
  const title = "原来，她们才是主角";
  const author = "ccc";
  const branch = (className) => `<img alt="" class="style3-art ${className}" src="${style3PlumShadow}"/>`;
  if (previewPage.value === "title") {
    return `<body class="style3-cover-preview"><div class="style3-cover-card">${branch("style3-cover-branch")}<p class="style3-cover-kicker">PO18 READER</p><h1>${title}</h1><p class="style3-cover-author">${author} · 著</p><small class="style3-cover-note">正式导出时<br/>使用当前书籍封面</small></div></body>`;
  }
  if (previewPage.value === "colophon") {
    if (!model.value.includeColophon) {
      return `<body class="style3-colophon-page"><div class="style3-colophon-box"><p class="style3-eyebrow">PO18 READER</p><h1 class="style3-colophon-title">制作说明未生成</h1><div class="style3-colophon-rule"></div><p class="style3-colophon-text">当前已关闭“生成制作说明页”。</p><p class="style3-colophon-mark">疏影横斜</p></div>${branch("style3-colophon-branch")}</body>`;
    }
    const text = model.value.colophonText || "本书由 PO18 Reader 根据本地缓存内容生成。\n\n仅供个人阅读与备份，请支持正版。";
    return `<body class="style3-colophon-page"><div class="style3-colophon-box"><p class="style3-eyebrow">PO18 READER</p><h1 class="style3-colophon-title">${escapeHtml(model.value.colophonTitle)}</h1><div class="style3-colophon-rule"></div>${previewParagraphs(text, "style3-colophon-text")}<p class="style3-colophon-mark">疏影横斜</p></div>${branch("style3-colophon-branch")}</body>`;
  }
  if (previewPage.value === "intro") {
    return `<body class="style3-intro-page">${branch("style3-intro-branch")}<p class="style3-eyebrow">一卷清读</p><h1 class="style3-intro-title">${escapeHtml(model.value.introTitle)}</h1><p class="style3-intro-book">《${title}》 · ${author}</p><div class="style3-intro-rule"></div>${previewParagraphs("牧知安穿越到了仙侠世界，成为了一名注定要被主角当作踏脚石的配角。\n\n围绕在身边的人们都有自己的故事，而命运也正悄然改变。", "style3-intro-text")}</body>`;
  }
  if (previewPage.value === "volume") {
    return `<body class="style3-volume-page"><div class="style3-volume-copy"><p class="style3-volume-index">卷次 · 01</p><h1 class="style3-volume-title"><span class="style3-volume-number">第一卷</span><span class="style3-volume-name">少年游</span></h1><div class="style3-volume-rule"></div></div>${branch("style3-volume-branch")}</body>`;
  }
  return `<body class="style3-chapter-page"><div class="style3-chapter-lead"><p class="style3-chapter-number">第1章</p><h2 class="style3-chapter-title">配角竟是我自己</h2><div class="style3-chapter-rule"><span class="style3-chapter-dot">·</span></div></div>${previewParagraphs("马车伴随着清脆的声音，沿着街道缓缓前行。\n\n窗外细雨飘落，湿润的地面映着灯火，故事从这里开始。\n\n他抬起头，终于意识到自己正站在命运改变的路口。")}</body>`;
});

const previewCss = computed(() => {
  if (isStyle1.value) return style1PreviewCss;
  if (isStyle3.value) return style3PreviewCss;
  return style2PreviewCss.value;
});
const previewBody = computed(() => {
  if (isStyle1.value) return style1PreviewBody.value;
  if (isStyle3.value) return style3PreviewBody.value;
  return style2PreviewBody.value;
});

const previewDocument = computed(() => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${previewCss.value}</style></head>${previewBody.value}</html>`);

async function loadTemplate() {
  const data = await api("/admin-api/config/export/style2-template");
  baseCss.value = data.baseCss || "";
  templateDefaults.value = data.defaults || {};
  ensureStyle2();
}

async function loadAssets() {
  const data = await api("/admin-api/config/export/style2-assets");
  assetVersion.value = Date.now();
  assets.value = await Promise.all((data.rows || []).map(loadPreviewAsset));
}

function blobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function loadPreviewAsset(asset) {
  if (!asset?.url || !previewEmbeddedAssetSlots.has(asset.slot)) return asset;
  try {
    const response = await fetch(`${asset.url}?v=${assetVersion.value}`, { credentials: "include", cache: "no-store" });
    if (!response.ok) return asset;
    return { ...asset, previewUrl: await blobAsDataUrl(await response.blob()) };
  } catch {
    return asset;
  }
}

async function uploadAsset(asset, event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  uploadingSlot.value = asset.slot;
  try {
    const response = await fetch(asset.url, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `上传失败：${response.status}`);
    await loadAssets();
    toast(`${asset.label}已更新`);
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    uploadingSlot.value = "";
  }
}

async function restoreAsset(asset) {
  uploadingSlot.value = asset.slot;
  try {
    await api(asset.url, { method: "DELETE" });
    await loadAssets();
    toast(`${asset.label}已恢复内置图`);
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    uploadingSlot.value = "";
  }
}

function assetBytes(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

function dimensionMismatch(asset) {
  if (!asset.width || !asset.height || !asset.recommendedWidth || !asset.recommendedHeight) return false;
  const current = asset.width / asset.height;
  const recommended = asset.recommendedWidth / asset.recommendedHeight;
  return Math.abs(current - recommended) / recommended > 0.03;
}

async function loadStyle2Resources() {
  const tasks = [];
  if (!baseCss.value) tasks.push(loadTemplate());
  if (!assets.value.length) tasks.push(loadAssets());
  await Promise.all(tasks);
}

function loadStyle2ResourcesWithToast() {
  loadStyle2Resources().catch((err) => toast(err.message || String(err)));
}

onMounted(() => {
  if (isStyle2.value) loadStyle2ResourcesWithToast();
});

watch(isStyle2, (active) => {
  if (active) loadStyle2ResourcesWithToast();
});
</script>

<style scoped>
.epub-style-editor { margin-top: 14px; }
.epub-workspace { display: grid; gap: 18px; }
.epub-workspace.has-preview { grid-template-columns: minmax(0, 1fr) minmax(380px, 470px); align-items: start; }
.epub-settings { min-width: 0; }
.epub-style-description { margin-top: 8px; }
.epub-switches { margin: 12px 0; }
.style2-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; margin-top: 16px; }
.field-span { grid-column: 1 / -1; }
.effective-css-field { margin-top: 16px; }
.effective-css-field textarea { min-height: 250px; font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace; font-size: 12px; line-height: 1.55; white-space: pre; tab-size: 2; }
.effective-css-field small { margin-top: 5px; color: var(--muted); font-size: 11px; line-height: 1.45; }
.epub-actions { margin-top: 14px; }
.epub-preview-panel { position: sticky; top: 86px; min-width: 0; border-left: 1px solid var(--line); padding-left: 18px; }
.preview-head { display: grid; gap: 10px; margin-bottom: 12px; }
.preview-head strong, .asset-section-head strong { display: block; color: var(--text); font-size: 14px; }
.preview-head small, .asset-section-head small { display: block; margin-top: 3px; color: var(--muted); font-size: 12px; }
.preview-head .preview-hint { color: #9a5d16; line-height: 1.4; }
.preview-tabs { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
.preview-tabs button { min-width: 0; min-height: 32px; padding: 0 7px; border: 1px solid #d7e0ea; background: #fff; color: #526579; box-shadow: none; font-size: 12px; }
.preview-tabs button.active { border-color: var(--primary); background: #e8f8f4; color: var(--primary); }
.preview-device { width: min(390px, 100%); aspect-ratio: 9 / 16; margin: 0 auto; overflow: hidden; border: 8px solid #172033; border-radius: 24px; background: #f3eadc; box-shadow: 0 18px 36px rgba(15, 23, 42, .2); }
.preview-device iframe { width: 100%; height: 100%; border: 0; display: block; background: #f3eadc; }
.asset-section { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--line); }
.asset-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.asset-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.asset-item { min-width: 0; display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 12px; padding: 10px; border: 1px solid #d6e0ea; border-radius: 8px; background: #f8fafc; }
.asset-thumb { width: 92px; aspect-ratio: 3 / 4; overflow: hidden; border: 1px solid #d3dde7; border-radius: 6px; background: #e8edf3; }
.asset-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.asset-copy { min-width: 0; display: flex; flex-direction: column; }
.asset-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.asset-title-row strong { min-width: 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-title-row span { flex: 0 0 auto; padding: 2px 6px; border-radius: 999px; font-size: 10px; font-weight: 800; }
.asset-title-row .custom { color: #0f5f58; background: #d9f4ef; }
.asset-title-row .builtin { color: #526579; background: #e7edf3; }
.asset-copy small { margin-top: 4px; color: var(--muted); font-size: 11px; line-height: 1.35; }
.asset-copy .dimension-warning { color: var(--warn); font-weight: 750; }
.asset-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: auto; padding-top: 9px; }
.asset-actions button, .asset-upload { min-height: 30px; padding: 0 9px; border-radius: 7px; font-size: 12px; }
.asset-upload { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #cbd6e5; background: #fff; color: #315071; font-weight: 760; cursor: pointer; }
.asset-upload input { display: none; }
.asset-upload.disabled { opacity: .56; cursor: wait; }
@media (max-width: 1180px) { .epub-workspace.has-preview { grid-template-columns: 1fr; } .epub-preview-panel { position: static; border-left: 0; border-top: 1px solid var(--line); padding: 18px 0 0; } }
@media (max-width: 900px) { .style2-fields, .asset-grid { grid-template-columns: 1fr; } .preview-device { width: min(360px, 100%); } }
</style>
