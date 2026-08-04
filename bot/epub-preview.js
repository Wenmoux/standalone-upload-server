/**
 * [INPUT]: 依赖 Node path、EPUB 公开配置、工坊组件目录、项目内楷体与 @resvg/resvg-js 的 SVG 渲染能力
 * [OUTPUT]: 对外提供确定性 EPUB 三联 SVG/PNG 预览和有界内存缓存
 * [POS]: bot 的跨平台 EPUB 视觉预览层，以简介/分卷/正文缩略页投影当前配置，不参与正式 EPUB 生成或计费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { Resvg } = require("@resvg/resvg-js");
const path = require("path");
const { normalizeEpubExportConfig, EPUB_STYLE_OPTIONS } = require("../services/epub-style-config");
const { component } = require("../services/epub-component-library");

const FONT_FAMILY = "STKaiti, KaiTi, serif";
const PREVIEW_FONT = path.resolve(__dirname, "epub-styles/assets/style3-stkaiti.ttf");
const CACHE_LIMIT = 48;
const pngCache = new Map();

function escapeXml(value = "") {
    return String(value ?? "").replace(
        /[&<>"']/g,
        (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]
    );
}

function text(x, y, value, options = {}) {
    return `<text x="${x}" y="${y}"${options.anchor ? ` text-anchor="${options.anchor}"` : ""} font-size="${options.size || 20}" font-weight="${options.weight || 400}" fill="${options.fill || "#20242a"}">${escapeXml(value)}</text>`;
}

function lines(x, y, values, options = {}) {
    const lineHeight = Number(options.lineHeight || 28);
    return values.map((value, index) => text(x, y + index * lineHeight, value, options)).join("");
}

function wrap(value, limit = 12, maxLines = 4) {
    const chars = Array.from(String(value || ""));
    const output = [];
    while (chars.length && output.length < maxLines) {
        const chunk = chars.splice(0, limit).join("");
        output.push(chars.length && output.length === maxLines - 1 ? `${chunk.slice(0, -1)}…` : chunk);
    }
    return output.length ? output : ["暂无内容"];
}

function styleName(styleId) {
    return EPUB_STYLE_OPTIONS.find((item) => item.id === styleId)?.name || "EPUB 模板";
}

function previewModel(value = {}) {
    const config = normalizeEpubExportConfig(value);
    const models = {
        style1: {
            paper: "#fffefa",
            ink: "#18181b",
            accent: "#9f1d24",
            soft: "#f4ebe8",
            intro: "plain",
            volume: "vertical",
            chapter: "red-split",
            ornament: "人物章头"
        },
        style2: {
            paper: "#ffffff",
            ink: "#231f20",
            accent: "#b50a02",
            soft: "#e8edf3",
            intro: "book-card",
            volume: "illustrated",
            chapter: "red-split",
            ornament: "插画章头"
        },
        style3: {
            paper: "#ffffff",
            ink: "#202124",
            accent: "#64686d",
            soft: "#f3f4f6",
            intro: "gray-box",
            volume: "underlined",
            chapter: "centered",
            ornament: "纯排版"
        },
        style4: {
            paper: "#fcfcfa",
            ink: "#17211c",
            accent: "#a3151a",
            soft: "#dfe8e1",
            intro: "ink-card",
            volume: "vertical-ink",
            chapter: "danqing",
            ornament: "无头图"
        }
    };
    const model = { ...(models[config.styleId] || models.style1), config, name: styleName(config.styleId) };
    if (config.styleId !== "studio") return model;
    const chapterId = config.studio.chapter;
    const volumeId = config.studio.volume;
    const introId = config.studio.intro;
    const ornamentId = config.studio.ornament;
    return {
        ...model,
        name: "模板工坊",
        paper: introId === "xuanhe" ? "#f5ede5" : "#ffffff",
        ink: "#252525",
        accent: ["zhuti", "yanzhu", "danxia"].includes(chapterId) ? "#a3151a" : chapterId === "mozhi" ? "#413245" : "#7d593f",
        soft: introId === "xuanhe" ? "#463f3c" : "#eef1f2",
        intro: introId,
        volume: volumeId,
        chapter: chapterId,
        ornament: component("ornament", ornamentId).name,
        componentNames: [
            component("chapter", chapterId).name,
            component("volume", volumeId).name,
            component("intro", introId).name,
            component("ornament", ornamentId).name
        ]
    };
}

function pageFrame(x, label, model, body) {
    return [
        `<g transform="translate(${x} 126)">`,
        `<rect width="326" height="500" rx="6" fill="${model.paper}" stroke="#cfd4da"/>`,
        `<rect width="326" height="40" rx="6" fill="#f8fafc"/>`,
        `<path d="M0 40H326" stroke="#d8dde3"/>`,
        text(18, 27, label, { size: 16, weight: 700, fill: "#4b5563" }),
        body,
        `</g>`
    ].join("");
}

function introPage(model) {
    const title = text(163, 105, "作品简介", { anchor: "middle", size: 24, weight: 700, fill: model.accent });
    const copy = wrap("山河入卷，旧事随风而来。故事从此处开始。", 13, 4);
    if (["xuanhe", "book-card"].includes(model.intro)) {
        return `${title}<rect x="34" y="135" width="258" height="210" rx="18" fill="${model.intro === "xuanhe" ? "#45413f" : model.soft}"/>${lines(56, 182, copy, { size: 18, lineHeight: 34, fill: model.intro === "xuanhe" ? "#d9eadc" : model.ink })}`;
    }
    if (["huihan", "gray-box"].includes(model.intro)) {
        return `${title}<rect x="28" y="130" width="270" height="220" rx="20" fill="${model.soft}" stroke="#d5d8dc"/>${lines(50, 178, copy, { size: 18, lineHeight: 34, fill: model.accent })}`;
    }
    if (model.intro === "qingmo") {
        return `${title}<path d="M35 132H291M35 348H291" stroke="#2d4843"/>${lines(48, 180, copy, { size: 18, lineHeight: 34, fill: model.ink })}`;
    }
    return `${title}<rect x="30" y="132" width="266" height="4" fill="${model.accent}"/>${lines(42, 180, copy, { size: 18, lineHeight: 34, fill: model.ink })}`;
}

function volumePage(model) {
    if (["vertical", "vertical-ink", "shuanglan"].includes(model.volume)) {
        return `<path d="M205 95V365" stroke="${model.accent}" stroke-width="4"/>${lines(171, 125, ["第", "一", "卷", "山", "河"], { size: 28, lineHeight: 48, weight: 700, fill: model.accent })}`;
    }
    if (["illustrated", "xuanmu"].includes(model.volume)) {
        return `<rect x="28" y="72" width="270" height="350" rx="4" fill="${model.soft}"/><path d="M48 92L278 402M278 92L48 402" stroke="${model.accent}" opacity=".22"/>${text(163, 245, "第一卷  山河", { anchor: "middle", size: 26, weight: 700, fill: model.accent })}`;
    }
    if (model.volume === "danjuan") {
        return `<rect x="62" y="115" width="202" height="220" fill="none" stroke="${model.accent}" stroke-width="4"/><rect x="68" y="121" width="190" height="208" fill="none" stroke="${model.accent}"/>${text(163, 190, "第一卷", { anchor: "middle", size: 20, fill: model.ink })}${text(163, 250, "山 河", { anchor: "middle", size: 32, weight: 700, fill: model.accent })}`;
    }
    const y = model.volume === "underlined" ? 245 : 185;
    return `${text(42, y, "第一卷  山河", { size: 28, weight: 700, fill: model.accent })}<path d="M42 ${y + 18}H284" stroke="${model.accent}" stroke-width="2"/>`;
}

function chapterHeading(model) {
    if (["danqing", "danxia", "zhuti", "red-split"].includes(model.chapter)) {
        return `${text(163, 150, "第十二章", { anchor: "middle", size: 17, weight: 600, fill: model.ink })}${text(163, 192, "云 开", { anchor: "middle", size: 29, weight: 700, fill: model.accent })}`;
    }
    if (model.chapter === "mozhi") {
        return `${text(163, 150, "第十二章", { anchor: "middle", size: 28, weight: 700, fill: "#c2181e" })}${text(163, 192, "云 开", { anchor: "middle", size: 22, weight: 700, fill: model.accent })}`;
    }
    if (model.chapter === "yunwen") {
        return `<path d="M55 148C95 108 231 108 271 148C231 188 95 188 55 148Z" fill="${model.soft}" stroke="${model.accent}"/>${text(163, 157, "第十二章  云开", { anchor: "middle", size: 21, weight: 700, fill: model.accent })}`;
    }
    return text(163, 168, "第十二章  云开", { anchor: "middle", size: 25, weight: 700, fill: model.accent });
}

function chapterPage(model) {
    const art = model.config.showTopImage && ["style1", "style2"].includes(model.config.styleId);
    const artBlock = art
        ? `<rect x="34" y="58" width="258" height="58" rx="4" fill="${model.soft}"/><path d="M55 105L102 70L145 103L193 66L271 106" fill="none" stroke="${model.accent}" stroke-width="3"/>`
        : "";
    const bodyY = art ? 250 : 235;
    const body = [0, 1, 2, 3, 4]
        .map(
            (index) =>
                `<rect x="38" y="${bodyY + index * 32}" width="${index === 4 ? 180 : 250}" height="7" rx="3" fill="#aeb5bd" opacity=".72"/>`
        )
        .join("");
    const ornament = model.ornament.includes("丹痕") ? "◆  ◇  ◆" : model.ornament.includes("三星") ? "※  ※  ※" : "—  ·  —";
    return `${artBlock}${chapterHeading(model)}${body}${text(163, 430, ornament, { anchor: "middle", size: 17, fill: model.accent })}`;
}

function renderEpubPreviewSvg(value = {}) {
    const model = previewModel(value);
    const config = model.config;
    const colophon = config.includeColophon ? "制作说明开启" : "制作说明关闭";
    const details = model.componentNames ? `${model.componentNames.join(" / ")} / ${colophon}` : `${model.ornament} / ${colophon}`;
    return [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="680" viewBox="0 0 1120 680" font-family="${escapeXml(FONT_FAMILY)}">`,
        `<rect width="1120" height="680" fill="#eef1f4"/>`,
        text(42, 52, model.name, { size: 30, weight: 800, fill: "#111827" }),
        text(42, 84, details, { size: 16, fill: "#667085" }),
        `<rect x="900" y="37" width="176" height="38" rx="6" fill="${model.accent}"/>`,
        text(988, 62, "实时样式预览", { anchor: "middle", size: 16, weight: 700, fill: "#ffffff" }),
        pageFrame(38, "简介页", model, introPage(model)),
        pageFrame(397, "分卷页", model, volumePage(model)),
        pageFrame(756, "正文页", model, chapterPage(model)),
        `</svg>`
    ].join("");
}

function previewKey(value = {}) {
    const config = normalizeEpubExportConfig(value);
    return JSON.stringify({
        styleId: config.styleId,
        includeColophon: config.includeColophon,
        showTopImage: config.showTopImage,
        studio: config.styleId === "studio" ? config.studio : null
    });
}

function renderEpubPreviewPng(value = {}) {
    const key = previewKey(value);
    if (pngCache.has(key)) return pngCache.get(key);
    const png = Buffer.from(
        new Resvg(renderEpubPreviewSvg(value), {
            fitTo: { mode: "original" },
            font: { loadSystemFonts: false, fontFiles: [PREVIEW_FONT], defaultFontFamily: "STKaiti" }
        })
            .render()
            .asPng()
    );
    pngCache.set(key, png);
    if (pngCache.size > CACHE_LIMIT) pngCache.delete(pngCache.keys().next().value);
    return png;
}

module.exports = { previewModel, renderEpubPreviewPng, renderEpubPreviewSvg };
