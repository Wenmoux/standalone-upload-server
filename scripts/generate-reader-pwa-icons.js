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
