<template>
  <div class="epub-style-editor">
    <div class="epub-workspace" :class="{ 'has-preview': isStyle2 }">
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
          <label v-if="!isStyle2" class="check-row"><input v-model="model.showTopImage" type="checkbox" /><span>显示样式头图</span></label>
        </div>

        <label v-if="!isStyle2 && model.includeColophon" class="field">
          <span>制作说明正文</span>
          <textarea v-model.trim="model.colophonText" rows="5" maxlength="4000"></textarea>
        </label>

        <template v-if="isStyle2">
          <div class="style2-fields">
            <label class="field"><span>标题页副标题</span><input v-model.trim="style2.subtitle" maxlength="80" /></label>
            <label class="field"><span>版本文本</span><input v-model.trim="style2.versionText" maxlength="160" /></label>
            <label class="field"><span>默认分卷标题</span><input v-model.trim="style2.volumeTitle" maxlength="80" /></label>
            <label class="field field-span"><span>字体族</span><input v-model.trim="style2.fontFamily" maxlength="320" /></label>
            <label class="field field-span"><span>制作来源文本</span><textarea v-model.trim="style2.sourceText" rows="3" maxlength="2000"></textarea></label>
            <label class="field field-span"><span>版权文本</span><textarea v-model.trim="style2.copyrightText" rows="3" maxlength="2000"></textarea></label>
            <label class="field field-span"><span>阅读提示</span><textarea v-model.trim="style2.readingTip" rows="2" maxlength="1000"></textarea></label>
            <label class="field field-span"><span>追加 CSS</span><textarea v-model="style2.customCss" rows="10" maxlength="30000" spellcheck="false"></textarea></label>
          </div>
        </template>

        <div class="button-row epub-actions">
          <button type="button" @click="$emit('save')">保存导出配置</button>
          <button class="secondary" type="button" @click="$emit('refresh')">刷新配置</button>
        </div>
      </div>

      <aside v-if="isStyle2" class="epub-preview-panel">
        <div class="preview-head">
          <div>
            <strong>样式 2 预览</strong>
            <small>{{ previewLabel }}</small>
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
          <iframe title="EPUB 样式 2 预览" sandbox="allow-same-origin" :srcdoc="previewDocument"></iframe>
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
import { computed, inject, onMounted, ref, watch } from "vue";
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
const previewPages = [
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
  volumeTitle: "正文",
  fontFamily: '"DK-SONGTI","Songti SC","STSong","SimSun","Noto Serif CJK SC",serif',
  customCss: ""
};

function ensureStyle2() {
  const defaults = { ...fallbackStyle2, ...(templateDefaults.value || {}) };
  model.value.style2 = { ...defaults, ...(model.value.style2 || {}) };
}

watch(() => model.value, ensureStyle2, { immediate: true });

const style2 = computed(() => model.value.style2);
const isStyle2 = computed(() => model.value.styleId === "style2");
const selectedDescription = computed(() => props.styles.find((item) => item.id === model.value.styleId)?.description || "选择后应用于下一次 EPUB 导出。");
const previewLabel = computed(() => previewPages.find((item) => item.id === previewPage.value)?.label || "");

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
  if (!asset?.url) return "";
  return `${asset.url}?v=${assetVersion.value}`;
}

function assetUrl(slot) {
  return assetSrc(assetBySlot(slot));
}

const previewCss = computed(() => {
  const css = String(baseCss.value || "")
    .replaceAll("__STYLE2_FONT__", safeFontFamily(style2.value.fontFamily))
    .replaceAll("__STYLE2_TITLE_BACKGROUND__", `"${assetUrl("title-background")}"`)
    .replaceAll("__STYLE2_COLOPHON_BACKGROUND__", `"${assetUrl("colophon-background")}"`)
    .replaceAll("__STYLE2_INTRO_BACKGROUND__", `"${assetUrl("intro-background")}"`);
  return `${css}\n${safeCustomCss(style2.value.customCss)}`.replace(/<\/style/gi, "<\\/style");
});

const previewBody = computed(() => {
  const title = "原来，她们才是主角";
  const author = "ccc";
  const note = assetUrl("note");
  const marker = note ? `<sup><span class="duokan-footnote"><img alt="note" src="${note}"/></span></sup>` : "";
  if (previewPage.value === "title") {
    return `<body class="ver"><h3 class="booktitle">${title}</h3><p class="booksubtitle">${escapeHtml(style2.value.subtitle)}</p><p class="bookauthor">${author}<span style="color:#e70014;">著</span></p><div class="chubanshe"><img class="chubanshe" alt="publisher" src="${assetUrl("publisher")}"/></div></body>`;
  }
  if (previewPage.value === "colophon") {
    return `<body class="bg"><div class="ff"><h3 class="ff-title"><u>${escapeHtml(model.value.colophonTitle)}${marker}</u></h3><p class="cc-pot"><b>${title}</b></p><p class="ff-pot">${author}◎著</p><p class="ff-pot">${escapeHtml(style2.value.versionText)}</p><p class="xx"></p><p class="ff-text">${escapeHtml(style2.value.sourceText)}</p><p class="ff-text">${escapeHtml(style2.value.copyrightText)}</p><p class="xx"></p><p class="ff-duokan">${escapeHtml(style2.value.readingTip)}</p></div></body>`;
  }
  if (previewPage.value === "intro") {
    return `<body class="babala"><div class="frame"><div class="cover"><img class="cover" alt="cover" src="${assetUrl("volume-1")}"/></div><h3 class="title">${title}${marker}</h3><p class="author">${author}◎著</p><p class="XD"></p></div><div class="frame2"><table class="block"><tbody><tr><td class="p2">刺猬猫小说</td><td class="p2">仙侠武侠</td></tr><tr><td class="p1">658章</td><td class="p1">324.3万字</td></tr><tr><td class="p2">章节</td><td class="p2">已完结</td></tr></tbody></table><p class="XD"></p><p class="RP">${escapeHtml(model.value.introTitle)}</p><p class="PL">牧知安穿越到了仙侠世界，成为了一名注定要被主角当作踏脚石的配角。</p><p class="PL">围绕在身边的人们都有自己的故事，而命运也正悄然改变。</p></div></body>`;
  }
  if (previewPage.value === "volume") {
    return `<body><div class="volume-cover"><div class="images image-single"><img class="volume-art" alt="volume" src="${assetUrl("volume-1")}"/></div><div class="img-name-1"><h1>${escapeHtml(style2.value.volumeTitle)}</h1></div></div></body>`;
  }
  return `<body><div class="top"><div class="logo"><img class="logo" alt="chapter" src="${assetUrl("chapter-1")}"/></div><h2 class="head"><span class="num">第1章</span><br/><b>配角竟是我自己</b></h2><p>马车伴随着清脆的声音，沿着街道缓缓前行。</p><p>窗外细雨飘落，湿润的地面映着灯火，故事从这里开始。</p><p>他抬起头，终于意识到自己正站在命运改变的路口。</p></div></body>`;
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
  assets.value = data.rows || [];
  assetVersion.value = Date.now();
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

onMounted(() => {
  loadTemplate().catch((err) => toast(err.message || String(err)));
  loadAssets().catch((err) => toast(err.message || String(err)));
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
.epub-actions { margin-top: 14px; }
.epub-preview-panel { position: sticky; top: 86px; min-width: 0; border-left: 1px solid var(--line); padding-left: 18px; }
.preview-head { display: grid; gap: 10px; margin-bottom: 12px; }
.preview-head strong, .asset-section-head strong { display: block; color: var(--text); font-size: 14px; }
.preview-head small, .asset-section-head small { display: block; margin-top: 3px; color: var(--muted); font-size: 12px; }
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
