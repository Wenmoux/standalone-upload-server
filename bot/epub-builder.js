const zlib = require("zlib");

const fs = require("fs");
const path = require("path");

const DEFAULT_CRANE_HEADER_PATHS = [
    path.resolve(__dirname, "assets/reader-crane-header.png"),
    path.resolve(__dirname, "../cirno-src/src/assets/reader-crane-header.png")
];
const EPUB_CRANE_HEADER_NAME = "Images/reader-crane-header.png";
const CUSTOM_HEADER_CHAPTER_REGEX = /第\s*[0-9０-９零一二三四五六七八九十百千万两〇○壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节回卷篇话节集]/i;

let defaultCraneHeaderCache;

function createEpubBuilder(deps = {}) {
    const cleanText = deps.cleanText || ((value = "") => String(value || "").replace(/<[^>]+>/g, ""));
    const escapeHtml = deps.escapeHtml || ((value = "") => String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])));
    const chapterPlainText = deps.chapterPlainText || ((chapter = {}) => cleanText(chapter.text || chapter.html || ""));
    const isVolumeChapter = deps.isVolumeChapter || ((chapter = {}) => Boolean(chapter.is_volume || chapter.isVolume || chapter.type === "volume"));
    const yieldToEventLoop = deps.yieldToEventLoop || (() => new Promise((resolve) => setImmediate(resolve)));
    const fetchImpl = deps.fetchImpl === undefined ? globalThis.fetch : deps.fetchImpl;
    const craneHeaderImageBytes = deps.craneHeaderImageBytes === undefined ? readDefaultCraneHeaderImage() : deps.craneHeaderImageBytes;
    const craneHeaderImage = normalizeImageBuffer(craneHeaderImageBytes);

async function makeEpubFiles(book, chapters) {
    const rawTitle = book.title || book.book_id || "未知书名";
    const rawAuthor = book.author || "未知作者";
    const title = escapeXml(rawTitle);
    const author = escapeXml(rawAuthor);
    const descriptionHtml = String(book.description_html || book.description || "").trim();
    const descriptionText = cleanText(descriptionHtml) || "暂无简介";
    const manifest = [
        `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
        `<item id="main" href="Styles/main.css" media-type="text/css"/>`,
        `<item id="intro-page" href="Text/chapter_1.html" media-type="text/html"/>`
    ];
    const spine = [`<itemref idref="intro-page"/>`];
    const navPoints = [{ order: 1, title: "简介", href: "Text/chapter_1.html" }];
    const files = [
        { name: "mimetype", content: Buffer.from("application/epub+zip"), store: true },
        { name: "META-INF/container.xml", content: Buffer.from(`<?xml version="1.0" encoding="utf-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`) },
        { name: "OEBPS/Styles/main.css", content: Buffer.from(EPUB_STYLE_CSS) }
    ];
    if (craneHeaderImage) {
        files.push({ name: `OEBPS/${EPUB_CRANE_HEADER_NAME}`, content: craneHeaderImage });
        manifest.push(`<item id="chapter-header-crane" href="${EPUB_CRANE_HEADER_NAME}" media-type="image/png"/>`);
    }

    const cover = await fetchCoverFile(book.cover);
    if (cover) {
        const coverName = `Images/cover${cover.ext}`;
        files.push({ name: `OEBPS/${coverName}`, content: cover.bytes });
        manifest.push(`<item id="cover" href="${coverName}" media-type="${cover.mime}"/>`);
        manifest.push(`<item id="cover-page" href="Text/cover.html" media-type="text/html"/>`);
        spine.unshift(`<itemref idref="cover-page"/>`);
        files.push({
            name: "OEBPS/Text/cover.html",
            content: Buffer.from(`<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><link href="../Styles/main.css" type="text/css" rel="stylesheet"/></head><body><div class="cover"><img alt="cover" src="../${coverName}"/></div></body></html>`)
        });
    }

    files.push({
        name: "OEBPS/Text/chapter_1.html",
        content: Buffer.from(`<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><head><title>简介</title><link href="../Styles/main.css" type="text/css" rel="stylesheet"/></head><body class="intro-page"><h2>简介</h2>${descriptionToHtml(descriptionHtml, descriptionText)}</body></html>`)
    });

    let chapterNo = 0;
    for (let index = 0; index < chapters.length; index += 1) {
        const chapter = chapters[index];
        const textIndex = index + 2;
        const itemId = `chapter_${textIndex}`;
        const href = `Text/chapter_${textIndex}.html`;
        const rawChapterTitle = chapter.title || `第${index + 1}章`;
        const chapterTitle = escapeXml(rawChapterTitle);
        manifest.push(`<item id="${itemId}" href="${href}" media-type="text/html"/>`);
        spine.push(`<itemref idref="${itemId}"/>`);
        navPoints.push({ order: textIndex, title: rawChapterTitle, href });
        if (isVolumeChapter(chapter)) {
            files.push({
                name: `OEBPS/${href}`,
                content: Buffer.from(`<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${chapterTitle}</title><link href="../Styles/main.css" type="text/css" rel="stylesheet"/></head><body class="volume-page"><h2>${chapterTitle}</h2></body></html>`)
            });
            if ((index + 1) % 20 === 0) await yieldToEventLoop();
            continue;
        }
        chapterNo += 1;
        const body = chapterPlainText(chapter);
        const chapterIndex = chapterNo - 1;
        const chapterHeader = chapterHeaderToHtml(rawChapterTitle, chapterIndex + 1, Boolean(craneHeaderImage));
        files.push({
            name: `OEBPS/${href}`,
            content: Buffer.from(`<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${chapterTitle}</title><link href="../Styles/main.css" type="text/css" rel="stylesheet"/></head><body>${chapterHeader}${textToParagraphs(body)}</body></html>`)
        });
        if ((index + 1) % 20 === 0) await yieldToEventLoop();
    }

    files.push({
        name: "OEBPS/toc.ncx",
        content: Buffer.from(`<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="po18-${escapeXml(book.book_id)}"/></head><docTitle><text>${title}</text></docTitle><navMap>${navPoints.map((item) => `<navPoint id="navPoint-${item.order}" playOrder="${item.order}"><navLabel><text>${escapeXml(item.title)}</text></navLabel><content src="${item.href}"/></navPoint>`).join("")}</navMap></ncx>`)
    });

    files.push({
        name: "OEBPS/content.opf",
        content: Buffer.from(`<?xml version="1.0" encoding="utf-8"?><package version="2.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:identifier id="bookid">po18-${escapeXml(book.book_id)}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>zh-CN</dc:language><dc:description>${escapeXml(descriptionText.slice(0, 2000))}</dc:description></metadata><manifest>${manifest.join("")}</manifest><spine toc="ncx">${spine.join("")}</spine></package>`)
    });

    return files;
}

function descriptionToHtml(descriptionHtml, descriptionText) {
    const html = sanitizeEpubBody(descriptionHtml);
    if (html) return html;
    return textToParagraphs(descriptionText || "暂无简介");
}

function textToParagraphs(value = "") {
    const lines = String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.length ? lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("") : "<p></p>";
}

function sanitizeEpubBody(value = "") {
    return String(value || "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/\son\w+="[^"]*"/gi, "")
        .replace(/\son\w+='[^']*'/gi, "")
        .trim();
}

function readDefaultCraneHeaderImage() {
    if (defaultCraneHeaderCache !== undefined) return defaultCraneHeaderCache;
    for (const imagePath of DEFAULT_CRANE_HEADER_PATHS) {
        try {
            defaultCraneHeaderCache = fs.readFileSync(imagePath);
            return defaultCraneHeaderCache;
        } catch {
            // Try the next packaged location.
        }
    }
    defaultCraneHeaderCache = null;
    return defaultCraneHeaderCache;
}

function normalizeImageBuffer(value) {
    if (!value) return null;
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return buffer.length ? buffer : null;
}

function splitChapterHeaderTitle(rawTitle = "", chapterNo = 1) {
    const title = String(rawTitle || "").trim();
    const match = title.match(CUSTOM_HEADER_CHAPTER_REGEX);
    const number = match ? match[0].replace(/\s+/g, "") : `第${chapterNo}章`;
    const name = title
        .replace(CUSTOM_HEADER_CHAPTER_REGEX, "")
        .replace(/^[\s:：·.。-]+/, "")
        .replace(/[\s:：·.。-]+$/, "")
        .trim();
    return {
        number,
        name: name || title || "正文"
    };
}

function chapterHeaderToHtml(rawTitle, chapterNo, hasCraneHeaderImage) {
    const header = splitChapterHeaderTitle(rawTitle, chapterNo);
    return [
        `<div class="chapter-header">`,
        hasCraneHeaderImage ? `<div class="chapter-header-art"><img alt="chapter header" src="../${EPUB_CRANE_HEADER_NAME}"/></div>` : "",
        `<div class="chapter-header-copy">`,
        `<div class="chapter-header-number">${escapeXml(header.number)}</div>`,
        `<div class="chapter-header-name">${escapeXml(header.name)}</div>`,
        `</div>`,
        `</div>`
    ].join("");
}

async function fetchCoverFile(url = "") {
    const coverUrl = String(url || "").trim();
    if (!/^https?:\/\//i.test(coverUrl)) return null;
    try {
        if (!fetchImpl) return null;
        const response = await fetchImpl(coverUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!response.ok) return null;
        const contentType = String(response.headers.get("content-type") || "").toLowerCase();
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.length) return null;
        const isPng = contentType.includes("png") || /\.png(?:$|\?)/i.test(coverUrl);
        return {
            bytes,
            ext: isPng ? ".png" : ".jpg",
            mime: isPng ? "image/png" : "image/jpeg"
        };
    } catch {
        return null;
    }
}

const EPUB_STYLE_CSS = `/*基础样式*/
body{padding:0%;margin-top:0%;margin-bottom:5%;margin-left:1%;margin-right:1%;line-height:1.2;text-align:justify;background:#fffdf8;color:#222;}
h1{line-height:1.2;text-align:center;font-family:"DK-HEITI","方正兰亭黑简体","黑体",sans-serif;font-weight:bold;font-size:1.65em;}
h2{text-align:center;font-family:"DK-FANGSONG","方正仿宋","华文仿宋","仿宋",serif;font-weight:light;font-size:1.05em;margin:0.2em 0 1.1em 0;padding-right:0;border-right:0;color:#222;text-indent:0;}
h2 c{line-height:1.2;font-family:"DK-FANGSONG","方正仿宋","华文仿宋","仿宋",serif;font-weight:light;font-size:1.12em;color:#dc143c;}
div{margin:0;padding:0;text-align:justify;}
p{font-family:"DK-SONGTI","方正宋三简体","方正书宋","宋体",serif;text-indent:2em;duokan-text-indent:2em;display:block;line-height:1.3em;margin-top:0.4em;margin-bottom:0.4em;}
ol{font-size:16px;padding:0;list-style:none;}
li{clear:both;display:block;list-style:none;margin:0.3em 0;}
a:link,a:visited{color:black;text-decoration:none;}a:hover{color:blue;}
.cover{margin:0em;padding:0em;text-indent:0em;text-align:center;}
.cover img{width:100%;height:auto;display:block;}
.intro-page{padding:0;margin:0;}
.volume-page{padding-top:35%;text-align:center;}
.chapter-header{min-height:13em;margin:0 0 1.8em 0;padding:2.6em 0 0 0;display:table;width:100%;page-break-inside:avoid;}
.chapter-header-art{display:table-cell;width:48%;vertical-align:bottom;text-align:left;}
.chapter-header-art img{max-width:100%;max-height:12em;width:auto;height:auto;}
.chapter-header-copy{display:table-cell;vertical-align:bottom;text-align:right;padding:0 0 0.8em 1em;}
.chapter-header-number{font-family:"PingFang SC","DK-HEITI","方正兰亭黑简体","黑体",sans-serif;font-size:1.5em;font-weight:200;color:#3a4654;line-height:1.2;margin:0 0 2.4em 0;text-align:right;text-indent:0;}
.chapter-header-name{display:inline-block;background-color:rgba(58,70,84,0.8);border-radius:16px;margin:0 0 3.5em 0;padding:0.5em 2em;color:#cbba75;font-weight:200;font-size:1em;font-family:"CKYHDY","DK-FANGSONG","方正仿宋","华文仿宋","仿宋",serif;box-shadow:0 15px 10px -15px #000;text-align:right;line-height:1.2;text-indent:0;}
.nodeco{text-decoration:none;}
`;

function escapeXml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[m]));
}

function crc32(buffer) {
    let crc = -1;
    for (const byte of buffer) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
    }
    return (crc ^ -1) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function dosTime(date = new Date()) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
}

async function buildZip(files) {
    const locals = [];
    const centrals = [];
    let offsetBytes = 0;
    const { time, day } = dosTime();
    for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const name = Buffer.from(file.name);
        const raw = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
        const compressed = file.store ? raw : zlib.deflateRawSync(raw);
        const method = file.store ? 0 : 8;
        const crc = crc32(raw);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(day, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(name.length, 26);
        locals.push(local, name, compressed);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(time, 12);
        central.writeUInt16LE(day, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(raw.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offsetBytes, 42);
        centrals.push(central, name);
        offsetBytes += local.length + name.length + compressed.length;
        if ((i + 1) % 20 === 0) await yieldToEventLoop();
    }
    const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offsetBytes, 16);
    return Buffer.concat([...locals, ...centrals, end]);
}

    return {
        makeEpubFiles,
        buildZip,
        textToParagraphs,
        sanitizeEpubBody
    };
}

module.exports = { createEpubBuilder };
