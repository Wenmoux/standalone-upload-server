const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MAX_CONTEXT_BYTES = Number(process.env.PO18_CONTEXT_MAX_BYTES || 80 * 1024 * 1024);
const TOP_LIMIT = Number(process.env.PO18_CONTEXT_TOP_LIMIT || 20);

function posix(relativePath) {
    return relativePath.split(path.sep).join("/");
}

function readDockerIgnore() {
    const file = path.join(ROOT, ".dockerignore");
    return fs.readFileSync(file, "utf8")
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

const files = walk(ROOT);
const total = files.reduce((sum, file) => sum + file.bytes, 0);
const top = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, TOP_LIMIT);

console.log(`Docker build context estimate: ${files.length} files, ${formatBytes(total)}`);
console.log(`Limit: ${formatBytes(MAX_CONTEXT_BYTES)}`);
console.log("Largest included files:");
for (const file of top) {
    console.log(`${formatBytes(file.bytes).padStart(10)}  ${file.path}`);
}

if (total > MAX_CONTEXT_BYTES) {
    console.error(`Build context is too large: ${formatBytes(total)} > ${formatBytes(MAX_CONTEXT_BYTES)}`);
    process.exit(1);
}
