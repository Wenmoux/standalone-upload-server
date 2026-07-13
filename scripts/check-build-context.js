/**
 * [INPUT]: 依赖 Dockerfile、.dockerignore、构建产物与镜像各阶段运行时文件清单
 * [OUTPUT]: 提供构建上下文遍历/忽略匹配工具，并拒绝缺文件、超预算或泄密风险上下文
 * [POS]: scripts 的 Docker 静态门禁，在真正 build 前证明不可变镜像输入闭合
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MAX_CONTEXT_BYTES = Number(process.env.PO18_CONTEXT_MAX_BYTES || 80 * 1024 * 1024);
const TOP_LIMIT = Number(process.env.PO18_CONTEXT_TOP_LIMIT || 20);
const REQUIRED_CONTEXT_FILES = Object.freeze([
    "telegram-push-contract.js",
    "cirno-src/scripts/reader-pwa-plugin.mjs",
    "cirno-src/public/manifest.webmanifest",
    "cirno-src/public/pwa-icon-192.png",
    "cirno-src/public/pwa-icon-512.png",
    "ui/design-tokens.css",
    "assets/epub-templates/style1.css",
    "assets/epub-templates/style2.css",
    "assets/epub-templates/style3.css",
    "assets/epub-templates/style1-colophon.xhtml",
    "assets/epub-templates/style2-colophon.xhtml",
    "assets/epub-templates/style3-colophon.xhtml",
    "bot/epub-styles/assets/jianghu-top.png",
    "bot/epub-styles/assets/style1-asheng.ttf",
    "bot/epub-styles/assets/style1-fzlanting.ttf",
    "bot/epub-styles/assets/style1-source-han-serif-bold.otf",
    "bot/epub-styles/assets/style1-stkaiti.ttf",
    "bot/epub-styles/assets/style3-plum-shadow.svg",
    "bot/epub-styles/assets/style3-reader-mark.png",
    "bot/epub-styles/assets/style3-roboto-medium-numbers.ttf",
    "bot/epub-styles/assets/style3-stkaiti.ttf",
    "bot/epub-styles/assets/style3-stsongti-bold.ttf",
    "bot/epub-styles/assets/style3-volume-1.jpg",
    "bot/epub-styles/assets/style3-volume-2.jpg",
    "bot/epub-styles/assets/style3-volume-3.jpg"
]);

function posix(relativePath) {
    return relativePath.split(path.sep).join("/");
}

function readDockerIgnore() {
    const file = path.join(ROOT, ".dockerignore");
    return fs
        .readFileSync(file, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => ({ negate: line.startsWith("!"), pattern: line.replace(/^!/, "").replace(/\\/g, "/") }));
}

function wildcardToRegExp(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`(^|/)${escaped}($|/)`);
}

function matcher(rule) {
    let pattern = rule.pattern.replace(/\/+$/, "");
    if (!pattern) return () => false;
    const hasSlash = pattern.includes("/");
    const regex = pattern.includes("*") ? wildcardToRegExp(pattern) : null;
    return (relativePath, isDirectory) => {
        const value = relativePath.replace(/\/+$/, "");
        if (regex) return regex.test(value);
        if (hasSlash) return value === pattern || value.startsWith(`${pattern}/`);
        const parts = value.split("/");
        return parts.includes(pattern) || (isDirectory && parts[parts.length - 1] === pattern);
    };
}

const rules = readDockerIgnore().map((rule) => ({ ...rule, matches: matcher(rule) }));

function ignored(relativePath, isDirectory = false) {
    let result = false;
    for (const rule of rules) {
        if (rule.matches(relativePath, isDirectory)) result = !rule.negate;
    }
    return result;
}

function walk(dir, base = "") {
    const rows = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = posix(path.join(base, entry.name));
        if (ignored(rel, entry.isDirectory())) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            rows.push(...walk(full, rel));
        } else {
            const stat = fs.statSync(full);
            rows.push({ path: rel, bytes: stat.size });
        }
    }
    return rows;
}

function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${bytes} B`;
}

function main() {
    const files = walk(ROOT);
    const total = files.reduce((sum, file) => sum + file.bytes, 0);
    const top = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, TOP_LIMIT);
    const paths = new Set(files.map((file) => file.path));
    const missing = REQUIRED_CONTEXT_FILES.filter((file) => !paths.has(file));

    console.log(`Docker build context estimate: ${files.length} files, ${formatBytes(total)}`);
    console.log(`Limit: ${formatBytes(MAX_CONTEXT_BYTES)}`);
    console.log("Largest included files:");
    for (const file of top) {
        console.log(`${formatBytes(file.bytes).padStart(10)}  ${file.path}`);
    }
    if (missing.length) {
        console.error(`Required Docker build inputs are excluded: ${missing.join(", ")}`);
        process.exitCode = 1;
    }
    if (total > MAX_CONTEXT_BYTES) {
        console.error(`Build context is too large: ${formatBytes(total)} > ${formatBytes(MAX_CONTEXT_BYTES)}`);
        process.exitCode = 1;
    }
}

if (require.main === module) main();

module.exports = { REQUIRED_CONTEXT_FILES, formatBytes, ignored, matcher, readDockerIgnore, walk };
