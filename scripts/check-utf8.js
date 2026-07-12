#!/usr/bin/env node

/**
 * [INPUT]: 依赖受控源码/文档目录、UTF-8 解码器与已知乱码特征
 * [OUTPUT]: 扫描文本编码和异常字符并以文件/位置报告失败
 * [POS]: scripts 的编码门禁，防止中文文档和界面文本在跨平台提交中损坏
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const roots = ["admin-ui/src", "bot", "cirno-src/src", "docker", "routes", "services", "scripts", "tests"];
const textExtensions = new Set([".js", ".mjs", ".cjs", ".vue", ".css", ".less", ".html", ".json", ".md", ".sql", ".sh", ".ps1"]);
const ignoredNames = new Set(["chinese-convert.js", "check-utf8.js"]);
const suspicious = [
    { name: "replacement character", pattern: /\uFFFD/ },
    { name: "common UTF-8 mojibake", pattern: /(?:锛|銆|浼樺寲|璇锋眰|鏁版嵁|鐢ㄦ埛|绔犺妭|鍚庡彴|鏄剧ず)/ }
];

function filesUnder(dir) {
    const output = [];
    if (!fs.existsSync(dir)) return output;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", "dist", "dist-reader", "public", "test-results", "tmp"].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) output.push(...filesUnder(full));
        else if (textExtensions.has(path.extname(entry.name).toLowerCase()) && !ignoredNames.has(entry.name)) output.push(full);
    }
    return output;
}

const failures = [];
for (const relativeRoot of roots) {
    for (const file of filesUnder(path.join(root, relativeRoot))) {
        const content = fs.readFileSync(file, "utf8");
        for (const check of suspicious) {
            const match = content.match(check.pattern);
            if (!match) continue;
            const line = content.slice(0, match.index).split(/\r?\n/).length;
            failures.push(`${path.relative(root, file)}:${line}: ${check.name}: ${match[0]}`);
        }
    }
}

if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
}
console.log("UTF-8 source scan passed");
