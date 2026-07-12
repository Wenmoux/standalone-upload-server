/**
 * [INPUT]: 依赖 Node.js 文件系统、项目 Markdown 文档与 GEB CLAUDE.md 协议标记
 * [OUTPUT]: 提供 Markdown 链接、必需模块地图和多语言源码 L3 契约的命令行完整性检查
 * [POS]: scripts 静态质量门禁，在 CI 构建前阻止断链或失去 GEB 回环约束的变更进入主分支
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EXCLUDED_DIRECTORIES = new Set([
    ".git",
    "backups",
    "coverage",
    "dist",
    "dist-reader",
    "node_modules",
    "public",
    "test-results",
    "tmp"
]);
const PROTOCOL = "[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md";
const SOURCE_EXTENSIONS = new Set([".css", ".js", ".mjs", ".ps1", ".py", ".sh", ".ts", ".vue"]);
const L3_MARKERS = ["[INPUT]:", "[OUTPUT]:", "[POS]:", PROTOCOL];
const REQUIRED_MODULE_MAPS = [
    ".github/CLAUDE.md",
    ".github/workflows/CLAUDE.md",
    "admin-ui/CLAUDE.md",
    "admin-ui/src/CLAUDE.md",
    "assets/CLAUDE.md",
    "benchmarks/CLAUDE.md",
    "bot/CLAUDE.md",
    "bot/commands/CLAUDE.md",
    "bot/epub-styles/CLAUDE.md",
    "cirno-src/CLAUDE.md",
    "cirno-src/scf/CLAUDE.md",
    "cirno-src/scripts/CLAUDE.md",
    "cirno-src/src/CLAUDE.md",
    "db/CLAUDE.md",
    "db/migrations/CLAUDE.md",
    "db/rollbacks/CLAUDE.md",
    "docker/CLAUDE.md",
    "docs/CLAUDE.md",
    "monitoring/CLAUDE.md",
    "public/CLAUDE.md",
    "routes/CLAUDE.md",
    "scripts/CLAUDE.md",
    "services/CLAUDE.md",
    "tests/CLAUDE.md",
    "tests/smoke/CLAUDE.md",
    "types/CLAUDE.md",
    "ui/CLAUDE.md"
];

function walkFiles(directory, accept, output = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) walkFiles(absolute, accept, output);
        else if (entry.isFile() && accept(absolute)) output.push(absolute);
    }
    return output;
}

function walkMarkdown(directory) {
    return walkFiles(directory, (file) => file.toLowerCase().endsWith(".md"));
}

function walkContractSources(directory) {
    return walkFiles(directory, (file) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()));
}

function lineNumber(source, offset) {
    return source.slice(0, offset).split(/\r?\n/u).length;
}

function localLinkTarget(rawTarget) {
    let target = String(rawTarget || "").trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1).trim();
    if (!target || target.startsWith("#") || /^(?:https?:|mailto:|data:|javascript:)/iu.test(target)) return "";
    target = target.split("#", 1)[0].split("?", 1)[0];
    try {
        return decodeURIComponent(target);
    } catch {
        return target;
    }
}

function markdownLinks(source) {
    const links = [];
    const pattern = /!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\)/gu;
    for (const match of source.matchAll(pattern)) links.push({ target: match[1], offset: match.index || 0 });
    return links;
}

function validateFile(file) {
    const source = fs.readFileSync(file, "utf8");
    const failures = [];
    for (const link of markdownLinks(source)) {
        const target = localLinkTarget(link.target);
        if (!target) continue;
        const resolved = target.startsWith("/") ? path.join(ROOT, target.slice(1)) : path.resolve(path.dirname(file), target);
        if (!fs.existsSync(resolved)) {
            failures.push(`${path.relative(ROOT, file)}:${lineNumber(source, link.offset)} -> ${target}`);
        }
    }
    if (path.basename(file) === "CLAUDE.md" && !source.includes(PROTOCOL)) {
        failures.push(`${path.relative(ROOT, file)} -> missing GEB protocol marker`);
    }
    return failures;
}

function validateSourceContract(file) {
    const source = fs.readFileSync(file, "utf8");
    const missing = L3_MARKERS.filter((marker) => !source.includes(marker));
    return missing.length ? [`${path.relative(ROOT, file)} -> missing L3 markers: ${missing.join(", ")}`] : [];
}

function main() {
    const required = ["AGENTS.md", "CLAUDE.md", path.join("docs", "README.md"), ...REQUIRED_MODULE_MAPS];
    const failures = required.filter((file) => !fs.existsSync(path.join(ROOT, file))).map((file) => `${file} -> missing required document`);
    const files = walkMarkdown(ROOT).sort();
    for (const file of files) failures.push(...validateFile(file));
    const scannedMarkdown = new Set(files.map((file) => path.resolve(file)));
    for (const relative of required) {
        const file = path.join(ROOT, relative);
        if (file.toLowerCase().endsWith(".md") && fs.existsSync(file) && !scannedMarkdown.has(path.resolve(file))) {
            failures.push(...validateFile(file));
        }
    }
    const sources = walkContractSources(ROOT).sort();
    for (const file of sources) failures.push(...validateSourceContract(file));
    if (failures.length) {
        console.error(`Documentation check failed (${failures.length}):`);
        for (const failure of failures) console.error(`- ${failure}`);
        process.exitCode = 1;
        return;
    }
    console.log(`Documentation check passed (${files.length} Markdown files, ${sources.length} source contracts).`);
}

if (require.main === module) main();

module.exports = { localLinkTarget, markdownLinks, validateFile, validateSourceContract, walkContractSources, walkMarkdown };
