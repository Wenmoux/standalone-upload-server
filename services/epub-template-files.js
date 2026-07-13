/**
 * [INPUT]: 依赖 Node fs/path 与 assets/epub-templates 中按样式拆分的 CSS/XHTML 文件
 * [OUTPUT]: 对外提供缓存读取模板与受控占位符替换能力
 * [POS]: services 的 EPUB 文件模板边界，让样式实现消费独立文件而非在 JavaScript 中内嵌大段页面源码
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require("fs");
const path = require("path");

const TEMPLATE_DIR = path.resolve(__dirname, "../assets/epub-templates");
const TEMPLATE_NAME_PATTERN = /^style[123](?:-[a-z]+)?\.(?:css|xhtml)$/;
const cache = new Map();

function templatePath(name) {
    const normalized = String(name || "").trim();
    if (!TEMPLATE_NAME_PATTERN.test(normalized)) throw new Error(`Invalid EPUB template name: ${normalized}`);
    return path.join(TEMPLATE_DIR, normalized);
}

function loadEpubTemplate(name) {
    if (!cache.has(name)) cache.set(name, fs.readFileSync(templatePath(name), "utf8").trim());
    return cache.get(name);
}

function renderEpubTemplate(name, values = {}) {
    return loadEpubTemplate(name).replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => String(values[key] ?? ""));
}

module.exports = { TEMPLATE_DIR, loadEpubTemplate, renderEpubTemplate };
