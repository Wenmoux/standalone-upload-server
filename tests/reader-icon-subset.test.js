const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const readerRoot = path.join(__dirname, "..", "cirno-src");
const sourceRoot = path.join(readerRoot, "src");
const generatedCssPath = path.join(sourceRoot, "assets", "icons", "po18-icons.css");
const generatedFontPath = path.join(sourceRoot, "assets", "icons", "po18-icons.woff2");

function usedIconClasses(directory, names = new Set()) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            usedIconClasses(filePath, names);
            continue;
        }
        if (filePath === generatedCssPath || !/\.(vue|js|css|less)$/i.test(entry.name)) continue;
        const text = fs.readFileSync(filePath, "utf8");
        for (const match of text.matchAll(/\bri-[a-z0-9-]+/g)) names.add(match[0]);
    }
    return names;
}

test("Reader icon subset contains every icon class used by the source", () => {
    const used = [...usedIconClasses(sourceRoot)].sort();
    const css = fs.readFileSync(generatedCssPath, "utf8");
    const generated = [...css.matchAll(/\.(ri-[a-z0-9-]+):before/g)].map((match) => match[1]).sort();
    assert.deepEqual(generated, used, "run cirno-src/scripts/build-icon-subset.py after changing icon classes");
    assert.equal(used.length, 33);
});

test("Reader icon assets stay within the subset budget", () => {
    const cssBytes = fs.statSync(generatedCssPath).size;
    const fontBytes = fs.statSync(generatedFontPath).size;
    assert.ok(cssBytes < 5 * 1024, `icon CSS is ${cssBytes} bytes`);
    assert.ok(fontBytes < 10 * 1024, `icon font is ${fontBytes} bytes`);
    const entry = fs.readFileSync(path.join(sourceRoot, "main.js"), "utf8");
    assert.match(entry, /assets\/icons\/po18-icons\.css/);
    assert.doesNotMatch(entry, /remixicon\/fonts\/remixicon\.css/);
});
