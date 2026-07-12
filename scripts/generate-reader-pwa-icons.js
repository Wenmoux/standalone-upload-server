/**
 * [INPUT]: 依赖 Reader 图标源、目标尺寸集合与本地文件系统
 * [OUTPUT]: 生成 PWA manifest 所需标准和 maskable 图标资源
 * [POS]: scripts 的 Reader 资源生成器，使安装图标可由单一来源重复构建
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");

const root = path.join(__dirname, "..", "cirno-src", "public");
const svg = fs.readFileSync(path.join(root, "pwa-icon.svg"));

for (const size of [192, 512]) {
    const renderer = new Resvg(svg, { fitTo: { mode: "width", value: size } });
    fs.writeFileSync(path.join(root, `pwa-icon-${size}.png`), renderer.render().asPng());
}

console.log("Generated Reader PWA icons: 192px, 512px");
