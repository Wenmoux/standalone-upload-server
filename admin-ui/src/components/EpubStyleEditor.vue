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
                    <label v-if="isStyle1" class="check-row"
                        ><input v-model="model.showTopImage" type="checkbox" /><span>显示样式头图</span></label
                    >
                </div>

                <label v-if="!isStyle2 && model.includeColophon" class="field">
                    <span>制作说明正文</span>
                    <textarea v-model.trim="model.colophonText" rows="5" maxlength="4000"></textarea>
                </label>

                <template v-if="isStyle2">
                    <div class="style2-fields">
                        <label class="field"><span>标题页副标题</span><input v-model.trim="style2.subtitle" maxlength="80" /></label>
                        <label class="field"><span>版本文本</span><input v-model.trim="style2.versionText" maxlength="160" /></label>
                        <label class="field field-span"
                            ><span>字体族</span><input v-model.trim="style2.fontFamily" maxlength="320"
                        /></label>
                        <label class="field field-span"
                            ><span>制作来源文本</span><textarea v-model.trim="style2.sourceText" rows="3" maxlength="2000"></textarea>
                        </label>
                        <label class="field field-span"
                            ><span>版权文本</span><textarea v-model.trim="style2.copyrightText" rows="3" maxlength="2000"></textarea>
                        </label>
                        <label class="field field-span"
                            ><span>阅读提示</span><textarea v-model.trim="style2.readingTip" rows="2" maxlength="1000"></textarea>
                        </label>
                        <label class="field field-span"
                            ><span>追加 CSS</span
                            ><textarea v-model="style2.customCss" rows="10" maxlength="30000" spellcheck="false"></textarea>
                        </label>
                    </div>
                </template>

                <label v-if="hasPreview" class="field effective-css-field">
                    <span>内置完整 CSS（只读）</span>
                    <textarea :value="effectiveCss" rows="14" readonly spellcheck="false"></textarea>
                    <small>{{ effectiveCssHint }}</small>
                </label>

                <label v-if="hasPreview" class="field effective-template-field">
                    <span>{{ effectiveTemplateName }}</span>
                    <textarea :value="effectiveTemplate" rows="8" readonly spellcheck="false"></textarea>
                    <small>这是实际导出读取的 XHTML 骨架；双花括号内容会在导出时替换为当前书籍数据。</small>
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
                        >
                            {{ page.label }}
                        </button>
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
                                <input
                                    type="file"
                                    accept="image/jpeg,image/png,image/gif,image/webp"
                                    :disabled="uploadingSlot === asset.slot"
                                    @change="uploadAsset(asset, $event)"
                                />
                                <span>{{ uploadingSlot === asset.slot ? "上传中..." : "替换图片" }}</span>
                            </label>
                            <button
                                v-if="asset.custom"
                                class="secondary"
                                type="button"
                                :disabled="uploadingSlot === asset.slot"
                                @click="restoreAsset(asset)"
                            >
                                恢复内置
                            </button>
                        </div>
                    </div>
                </article>
            </div>
        </section>
    </div>
</template>

<script setup>
/**
 * [INPUT]: 依赖 Vue、独立 EPUB CSS/XHTML 模板、内置章头资产、Admin API 及父级传入的样式配置模型
 * [OUTPUT]: 提供 EPUB 样式选择、完整 CSS/页面骨架查看、与导出同构的实时预览、参数编辑和精简资产替换界面
 * [POS]: admin-ui/src/components 的导出样式工作台，由 TelegramView 组合进导出配置流程并承担配置与最终 EPUB 视觉契约的一致性反馈
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { computed, inject, onMounted, ref, watch } from "vue";
import style1TopImage from "../../../bot/epub-styles/assets/jianghu-top.png";
import style1AshengFont from "../../../bot/epub-styles/assets/style1-asheng.ttf";
import style1FzLantingFont from "../../../bot/epub-styles/assets/style1-fzlanting.ttf";
import style1SourceHanFont from "../../../bot/epub-styles/assets/style1-source-han-serif-bold.otf";
import style1StKaitiFont from "../../../bot/epub-styles/assets/style1-stkaiti.ttf";
import style3PlumShadow from "../../../bot/epub-styles/assets/style3-plum-shadow.svg";
import style3RobotoNumbersFont from "../../../bot/epub-styles/assets/style3-roboto-medium-numbers.ttf";
import style3ReaderMark from "../../../bot/epub-styles/assets/style3-reader-mark.png";
import style3StKaitiFont from "../../../bot/epub-styles/assets/style3-stkaiti.ttf";
import style3StSongtiFont from "../../../bot/epub-styles/assets/style3-stsongti-bold.ttf";
import style3VolumeArt from "../../../bot/epub-styles/assets/style3-volume-1.jpg";
import style1Css from "../../../assets/epub-templates/style1.css?raw";
import style1ChapterTemplate from "../../../assets/epub-templates/style1-chapter.xhtml?raw";
import style1ColophonTemplate from "../../../assets/epub-templates/style1-colophon.xhtml?raw";
import style1IntroTemplate from "../../../assets/epub-templates/style1-intro.xhtml?raw";
import style1VolumeTemplate from "../../../assets/epub-templates/style1-volume.xhtml?raw";
import style2ChapterTemplate from "../../../assets/epub-templates/style2-chapter.xhtml?raw";
import style2ColophonTemplate from "../../../assets/epub-templates/style2-colophon.xhtml?raw";
import style2IntroTemplate from "../../../assets/epub-templates/style2-intro.xhtml?raw";
import style2TitleTemplate from "../../../assets/epub-templates/style2-title.xhtml?raw";
import style2VolumeTemplate from "../../../assets/epub-templates/style2-volume.xhtml?raw";
import style3Css from "../../../assets/epub-templates/style3.css?raw";
import style3ChapterTemplate from "../../../assets/epub-templates/style3-chapter.xhtml?raw";
import style3ColophonTemplate from "../../../assets/epub-templates/style3-colophon.xhtml?raw";
import style3IntroTemplate from "../../../assets/epub-templates/style3-intro.xhtml?raw";
import style3VolumeTemplate from "../../../assets/epub-templates/style3-volume.xhtml?raw";
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
const pageTemplates = {
    style1: {
        colophon: style1ColophonTemplate,
        intro: style1IntroTemplate,
        volume: style1VolumeTemplate,
        chapter: style1ChapterTemplate
    },
    style2: {
        title: style2TitleTemplate,
        colophon: style2ColophonTemplate,
        intro: style2IntroTemplate,
        volume: style2VolumeTemplate,
        chapter: style2ChapterTemplate
    },
    style3: {
        colophon: style3ColophonTemplate,
        intro: style3IntroTemplate,
        volume: style3VolumeTemplate,
        chapter: style3ChapterTemplate
    }
};

const fallbackStyle2 = {
    subtitle: "内部群版",
    versionText: "PO18 Reader 自动排版",
    sourceText: "本书由 PO18 Reader 根据本地缓存内容生成，封面使用书籍元信息中的图片，页面结构与内置样式保持一致。",
    copyrightText: "本书仅供个人阅读、备份与排版学习，请勿用于商业用途。请支持正版。",
    readingTip: "为获得最佳阅读效果，建议关闭阅读器自带排版增强，并允许 EPUB 使用内嵌样式。",
    fontFamily: '"DK-SONGTI","st","宋体","zw",sans-serif',
    customCss: ""
};

const style2EpubAssetUrls = {
    "title-background": "../Images/style2-title-background.jpg",
    "colophon-background": "../Images/style2-colophon-background.jpg",
    "intro-background": "../Images/style2-intro-background.jpg"
};
const previewEmbeddedAssetSlots = new Set(["title-background", "colophon-background", "intro-background"]);

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
const previewPages = computed(() =>
    previewPageDefs.map((item) => (item.id === "title" && (isStyle1.value || isStyle3.value) ? { ...item, label: "封面" } : item))
);
const selectedDescription = computed(
    () => props.styles.find((item) => item.id === model.value.styleId)?.description || "选择后应用于下一次 EPUB 导出。"
);
const previewLabel = computed(() => previewPages.value.find((item) => item.id === previewPage.value)?.label || "");
const previewTitle = computed(() => {
    if (isStyle1.value) return "江湖纸卷预览";
    if (isStyle2.value) return "老二次元预览";
    return "疏影横斜预览";
});
const effectiveCssHint = computed(() =>
    isStyle2.value
        ? "只读预览；内置基础 CSS 与追加 CSS 已合并，保存后用于下一次 EPUB 导出。"
        : `只读预览；内容与${isStyle3.value ? "疏影横斜" : "江湖纸卷"}内置样式包 CSS 保持一致。`
);
const effectiveTemplate = computed(
    () =>
        pageTemplates[model.value.styleId]?.[previewPage.value]?.trim() ||
        "封面页由 EPUB 生成器按当前书籍封面动态创建，不保存固定书名或固定封面模板。"
);
const effectiveTemplateName = computed(() => {
    const page = previewPages.value.find((item) => item.id === previewPage.value)?.label || "页面";
    return `${page} XHTML 模板（只读）`;
});
const previewHint = computed(() => {
    if (previewPage.value === "volume") return "这里只展示分卷版式；导出时仅在章节数据包含真实分卷时生成。";
    if (previewPage.value === "colophon" && !model.value.includeColophon) return "制作说明已关闭，导出时不会生成此页。";
    return "";
});

function escapeHtml(value = "") {
    return String(value ?? "").replace(
        /[&<>"']/g,
        (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
    );
}

function safeFontFamily(value = "") {
    return (
        String(value || "")
            .replace(/[^\w\u3400-\u9fff\s,"'\-]/g, " ")
            .replace(/\s+/g, " ")
            .slice(0, 320)
            .trim() || fallbackStyle2.fontFamily
    );
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

function renderPreviewTemplate(template, values = {}) {
    return String(template || "").replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => String(values[key] ?? ""));
}

const style1PreviewCss = `${style1Css
    .replace("../Fonts/style1-asheng.ttf", style1AshengFont)
    .replace("../Fonts/style1-fzlanting.ttf", style1FzLantingFont)
    .replace("../Fonts/style1-stkaiti.ttf", style1StKaitiFont)
    .replace("../Fonts/style1-source-han-serif-bold.otf", style1SourceHanFont)}
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
const style3PreviewCss = `${style3Css
    .replace("../Fonts/style3-stkaiti.ttf", style3StKaitiFont)
    .replace("../Fonts/style3-stsongti-bold.ttf", style3StSongtiFont)
    .replace("../Fonts/style3-roboto-medium-numbers.ttf", style3RobotoNumbersFont)}
html,body{height:100%;min-height:100%;}
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
    const title = "示例书名";
    const author = "示例作者";
    const art = model.value.showTopImage
        ? `<div class="top-img-box"><img alt="江湖纸卷人物头图" class="top-img" src="${style1TopImage}"/></div>`
        : "";
    if (previewPage.value === "title") {
        return `<body class="style1-cover-preview"><div class="style1-cover-card"><span class="style1-cover-seal">PO18 READER</span><h1>${title}</h1><p class="style1-cover-author">${author} · 著</p><small class="style1-cover-note">正式导出时使用当前书籍封面</small></div></body>`;
    }
    if (previewPage.value === "colophon") {
        if (!model.value.includeColophon) {
            return renderPreviewTemplate(style1ColophonTemplate, {
                TITLE: "制作说明未生成",
                CONTENT: '<p class="design-content"><span class="duokanicon">󰐋</span>当前已关闭“生成制作说明页”。</p>'
            });
        }
        const blocks = String(model.value.colophonText || "本书由 PO18 Reader 根据本地缓存内容生成。\n\n仅供个人阅读与备份，请支持正版。")
            .split(/\n\s*\n/)
            .map((item) => item.trim())
            .filter(Boolean);
        const content = blocks
            .map((item, index) => `<p class="design-content"><span class="duokanicon">${index ? "󰐏" : "󰐋"}</span>${escapeHtml(item)}</p>`)
            .join('<hr class="design-line"/>');
        return renderPreviewTemplate(style1ColophonTemplate, { TITLE: escapeHtml(model.value.colophonTitle), CONTENT: content });
    }
    if (previewPage.value === "intro") {
        return renderPreviewTemplate(style1IntroTemplate, {
            TITLE: escapeHtml(model.value.introTitle),
            CONTENT: previewParagraphs("这里展示导出时写入的作品简介内容。\n\n段落、缩进和字体会使用当前样式的完整 CSS。", "intro-text")
        });
    }
    if (previewPage.value === "volume") {
        const verticalTitle = Array.from("少年游")
            .map((char) => escapeHtml(char))
            .join("<br/>");
        return renderPreviewTemplate(style1VolumeTemplate, { ART: art, NUMBER: "第一卷", TITLE: verticalTitle });
    }
    return renderPreviewTemplate(style1ChapterTemplate, {
        ART: art,
        NUMBER: "第1章",
        TITLE: "示例章节",
        CONTENT: previewParagraphs("这里展示导出后的正文排版效果。\n\n实际内容来自当前书籍章节。")
    });
});

const style2PreviewBody = computed(() => {
    const title = "示例书名";
    const author = "示例作者";
    if (previewPage.value === "title") {
        return renderPreviewTemplate(style2TitleTemplate, {
            TITLE: title,
            SUBTITLE: escapeHtml(style2.value.subtitle),
            AUTHOR: author
        });
    }
    if (previewPage.value === "colophon") {
        if (!model.value.includeColophon) {
            return `<body class="bg"><div class="ff"><h3 class="ff-title"><u>制作说明未生成</u></h3><p class="ff-text">当前已关闭“生成制作说明页”。</p></div></body>`;
        }
        return renderPreviewTemplate(style2ColophonTemplate, {
            TITLE: escapeHtml(model.value.colophonTitle),
            BOOK: title,
            AUTHOR: author,
            VERSION: escapeHtml(style2.value.versionText),
            SOURCE: escapeHtml(style2.value.sourceText),
            COPYRIGHT: escapeHtml(style2.value.copyrightText),
            TIP: escapeHtml(style2.value.readingTip)
        });
    }
    if (previewPage.value === "intro") {
        return renderPreviewTemplate(style2IntroTemplate, {
            COVER: "",
            TITLE: title,
            AUTHOR: author,
            PLATFORM: "来源站点",
            CATEGORY: "作品分类",
            CHAPTERS: "658章",
            WORDS: "324.3万字",
            STATUS: "已完结",
            INTRO_TITLE: escapeHtml(model.value.introTitle),
            DESCRIPTION: '<p class="PL">这里展示导出时写入的作品简介内容。</p>'
        });
    }
    if (previewPage.value === "volume") {
        return renderPreviewTemplate(style2VolumeTemplate, {
            IMAGE: `<div class="images image-single"><img class="logo" alt="volume" src="${assetUrl("volume")}"/></div>`,
            TITLE: "少年游"
        });
    }
    return renderPreviewTemplate(style2ChapterTemplate, {
        IMAGE: `<div class="logo"><img class="logo" alt="chapter" src="${assetUrl("chapter")}"/></div>`,
        NUMBER: "第1章",
        TITLE: "示例章节",
        CONTENT: "<p>这里展示导出后的正文排版效果。</p>"
    });
});

const style3PreviewBody = computed(() => {
    const title = "示例书名";
    const author = "示例作者";
    const branch = (className) => `<img alt="" class="style3-art ${className}" src="${style3PlumShadow}"/>`;
    if (previewPage.value === "title") {
        return `<body class="style3-cover-preview"><div class="style3-cover-card">${branch("style3-cover-branch")}<p class="style3-cover-kicker">PO18 READER</p><h1>${title}</h1><p class="style3-cover-author">${author} · 著</p><small class="style3-cover-note">正式导出时<br/>使用当前书籍封面</small></div></body>`;
    }
    if (previewPage.value === "colophon") {
        if (!model.value.includeColophon) {
            return renderPreviewTemplate(style3ColophonTemplate, {
                MARK: `<img alt="" class="design-icon-dk" src="${style3ReaderMark}"/>`,
                CONTENT: "当前已关闭“生成制作说明页”。"
            });
        }
        const text = model.value.colophonText || "本书由 PO18 Reader 根据本地缓存内容生成。\n\n仅供个人阅读与备份，请支持正版。";
        return renderPreviewTemplate(style3ColophonTemplate, {
            MARK: `<img alt="" class="design-icon-dk" src="${style3ReaderMark}"/>`,
            CONTENT: escapeHtml(text).replace(/\r?\n/g, "<br/>")
        });
    }
    if (previewPage.value === "intro") {
        return renderPreviewTemplate(style3IntroTemplate, {
            TITLE: escapeHtml(model.value.introTitle),
            CONTENT: previewParagraphs("这里展示导出时写入的作品简介内容。\n\n段落、缩进和字体会使用当前样式的完整 CSS。")
        });
    }
    if (previewPage.value === "volume") {
        return renderPreviewTemplate(style3VolumeTemplate, {
            NUMBER: "第一部",
            TITLE: "少年游",
            TITLE_LINES: '<tspan x="150" dy="0">少年游</tspan>',
            PART_Y: "730",
            PART: "I",
            ART: `<image width="1536" height="2048" clip-path="url(#style3-volume-art-clip)" xlink:href="${style3VolumeArt}"/>`
        });
    }
    return renderPreviewTemplate(style3ChapterTemplate, {
        HEADING: "第1章　示例章节",
        CONTENT: previewParagraphs("这里展示导出后的正文排版效果。\n\n实际内容来自当前书籍章节。")
    });
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

const previewDocument = computed(
    () =>
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${previewCss.value}</style></head>${previewBody.value}</html>`
);

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

<style scoped src="./epub-style-editor.css"></style>
