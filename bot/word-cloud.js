/**
 * [INPUT]: 依赖词频行、画布尺寸与字体选项，并在 PNG 路径按需加载 @resvg/resvg-js
 * [OUTPUT]: 对外提供确定性词云布局、SVG 文本/字节和 PNG 字节渲染能力
 * [POS]: bot 搜索展示层的无状态图像生成器，为词云命令提供可测试的布局与双格式输出
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const CLOUD_COLORS = [
    "#0ea5e9",
    "#22c55e",
    "#f97316",
    "#a855f7",
    "#14b8a6",
    "#eab308",
    "#ef4444",
    "#6366f1",
    "#84cc16",
    "#ec4899"
];

const DEFAULT_FONT_FAMILY = "WenQuanYi Zen Hei, Noto Sans CJK SC, Microsoft YaHei, PingFang SC, Arial, sans-serif";

function escapeXml(value = "") {
    return String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[m]));
}

function hashText(value = "") {
    let hash = 2166136261;
    const text = String(value || "");
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function charWidthRatio(text = "") {
    let units = 0;
    for (const char of String(text || "")) {
        units += /[\u2e80-\u9fff]/.test(char) ? 1 : 0.58;
    }
    return Math.max(1, units);
}

function normalizeCloudRows(rows = []) {
    return (Array.isArray(rows) ? rows : [])
        .map((row) => ({
            text: String(row.text || row.keyword || "").trim(),
            weight: Math.max(1, Number(row.weight || row.count || 1))
        }))
        .filter((row) => row.text)
        .sort((a, b) => b.weight - a.weight || a.text.localeCompare(b.text, "zh-CN"));
}

function overlaps(a, b, padding = 4) {
    return !(a.right + padding < b.left || a.left - padding > b.right || a.bottom + padding < b.top || a.top - padding > b.bottom);
}

function wordBox(text, fontSize, x, y, rotate = 0) {
    const width = charWidthRatio(text) * fontSize;
    const height = fontSize * 1.16;
    const rotated = Math.abs(rotate) === 90;
    const boxWidth = rotated ? height : width * (Math.abs(rotate) ? 1.12 : 1);
    const boxHeight = rotated ? width : height * (Math.abs(rotate) ? 1.3 : 1);
    return {
        left: x - boxWidth / 2,
        right: x + boxWidth / 2,
        top: y - boxHeight / 2,
        bottom: y + boxHeight / 2
    };
}

function layoutWordCloud(rows = [], options = {}) {
    const width = Number(options.width || 1200);
    const height = Number(options.height || 760);
    const top = Number(options.top || 120);
    const bottom = Number(options.bottom || 58);
    const left = Number(options.left || 72);
    const right = Number(options.right || 72);
    const cloudRows = normalizeCloudRows(rows).slice(0, Math.max(1, Number(options.limit || 70)));
    const maxWeight = Math.max(...cloudRows.map((row) => row.weight), 1);
    const minWeight = Math.min(...cloudRows.map((row) => row.weight), maxWeight);
    const minFont = Number(options.minFont || 22);
    const maxFont = Number(options.maxFont || 88);
    const centerX = width / 2;
    const centerY = top + (height - top - bottom) / 2 + 12;
    const placed = [];
    const rotations = [-45, -28, 0, 0, 0, 24, 42, 90];

    for (let index = 0; index < cloudRows.length; index += 1) {
        const row = cloudRows[index];
        const ratio = maxWeight === minWeight ? 0.65 : (Math.sqrt(row.weight) - Math.sqrt(minWeight)) / (Math.sqrt(maxWeight) - Math.sqrt(minWeight));
        const fontSize = Math.round(minFont + ratio * (maxFont - minFont));
        const hash = hashText(row.text);
        const rotate = rotations[(hash + index) % rotations.length];
        let chosen = null;
        for (let step = 0; step < 280; step += 1) {
            const angle = (step * 0.56 + (hash % 360)) * Math.PI / 180;
            const radius = step * 3.8;
            const x = centerX + Math.cos(angle) * radius * 1.42;
            const y = centerY + Math.sin(angle) * radius * 0.82;
            const box = wordBox(row.text, fontSize, x, y, rotate);
            if (box.left < left || box.right > width - right || box.top < top || box.bottom > height - bottom) continue;
            if (placed.some((item) => overlaps(box, item.box))) continue;
            chosen = { row, fontSize, x, y, rotate, box };
            break;
        }
        if (chosen) placed.push(chosen);
    }
    return { width, height, placed };
}

function renderWordCloudSvg(rows = [], options = {}) {
    const width = Number(options.width || 1200);
    const height = Number(options.height || 760);
    const title = String(options.title || "热搜词云").trim();
    const subtitle = String(options.subtitle || "").trim();
    const fontFamily = String(options.fontFamily || DEFAULT_FONT_FAMILY).trim();
    const { placed } = layoutWordCloud(rows, { ...options, width, height });
    const generatedAt = String(options.generatedAt || "").trim();
    const words = placed.map((item, index) => {
        const color = CLOUD_COLORS[(hashText(item.row.text) + index) % CLOUD_COLORS.length];
        const opacity = Math.max(0.78, Math.min(1, item.fontSize / 92));
        const rotate = item.rotate ? ` rotate(${item.rotate})` : "";
        return `<text x="${item.x.toFixed(1)}" y="${item.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" transform="translate(${item.x.toFixed(1)} ${item.y.toFixed(1)})${rotate} translate(${-item.x.toFixed(1)} ${-item.y.toFixed(1)})" font-size="${item.fontSize}" font-weight="${item.fontSize > 54 ? 750 : 650}" fill="${color}" opacity="${opacity.toFixed(2)}">${escapeXml(item.row.text)}</text>`;
    }).join("\n");
    const empty = placed.length ? "" : `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="34" fill="#64748b">暂无可生成词云的数据</text>`;
    return [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${escapeXml(fontFamily)}">`,
        `<rect width="100%" height="100%" rx="34" fill="#f8fafc"/>`,
        `<rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="28" fill="#ffffff" stroke="#e2e8f0"/>`,
        `<text x="60" y="74" font-size="34" font-weight="800" fill="#0f172a">${escapeXml(title)}</text>`,
        subtitle ? `<text x="60" y="112" font-size="18" fill="#64748b">${escapeXml(subtitle)}</text>` : "",
        words,
        empty,
        generatedAt ? `<text x="${width - 60}" y="${height - 42}" text-anchor="end" font-size="16" fill="#94a3b8">${escapeXml(generatedAt)}</text>` : "",
        `</svg>`
    ].filter(Boolean).join("\n");
}

function renderWordCloudSvgBuffer(rows = [], options = {}) {
    return Buffer.from(renderWordCloudSvg(rows, options), "utf8");
}

function renderWordCloudPngBuffer(rows = [], options = {}) {
    let Resvg;
    try {
        ({ Resvg } = require("@resvg/resvg-js"));
    } catch (err) {
        throw new Error(`word cloud PNG renderer is unavailable: ${err.message || String(err)}`);
    }
    const svg = renderWordCloudSvg(rows, options);
    const resvg = new Resvg(svg, {
        fitTo: { mode: "original" },
        font: {
            loadSystemFonts: true,
            defaultFontFamily: String(options.defaultFontFamily || "WenQuanYi Zen Hei")
        }
    });
    return Buffer.from(resvg.render().asPng());
}

module.exports = {
    layoutWordCloud,
    renderWordCloudPngBuffer,
    renderWordCloudSvg,
    renderWordCloudSvgBuffer
};
