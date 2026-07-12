const fs = require("fs");
const zlib = require("zlib");
const { listEpubStyles, resolveEpubStyle } = require("./epub-styles");

const COVER_PAGE_CSS = `
html.cover-document,html.cover-document body.cover-page{margin:0!important;padding:0!important;width:100%!important;height:100%!important;min-height:100%!important;overflow:hidden!important;background:#000!important;}
body.cover-page .cover{margin:0!important;padding:0!important;width:100%!important;height:100%!important;min-height:100%!important;display:block!important;text-align:center!important;text-indent:0!important;line-height:0!important;background:#000!important;}
body.cover-page .cover-svg{margin:0!important;padding:0!important;width:100%!important;height:100%!important;display:block!important;}
`;

const CHAPTER_LABEL_REGEX = /第\s*[0-9０-９零一二三四五六七八九十百千万两〇○壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节回卷篇话节集]/i;
const VOLUME_LABEL_REGEX = /第\s*[0-9０-９零一二三四五六七八九十百千万两〇○壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[卷部篇集]/i;

function createEpubBuilder(deps = {}) {
    const cleanText = deps.cleanText || ((value = "") => String(value || "").replace(/<[^>]+>/g, ""));
    const escapeHtml = deps.escapeHtml || defaultEscapeHtml;
    const chapterPlainText = deps.chapterPlainText || ((chapter = {}) => cleanText(chapter.text || chapter.html || ""));
    const isVolumeChapter =
        deps.isVolumeChapter || ((chapter = {}) => Boolean(chapter.is_volume || chapter.isVolume || chapter.type === "volume"));
    const yieldToEventLoop = deps.yieldToEventLoop || (() => new Promise((resolve) => setImmediate(resolve)));
    const fetchImpl = deps.fetchImpl === undefined ? globalThis.fetch : deps.fetchImpl;
    const assetCache = new Map();

    async function makeEpubFiles(book, chapters, options = {}) {
        const rawTitle = book.title || book.book_name || book.book_id || "未知书名";
        const rawAuthor = book.author || "未知作者";
        const title = escapeXml(rawTitle);
        const author = escapeXml(rawAuthor);
        const descriptionHtml = String(book.description_html || book.description || "").trim();
        const descriptionText = cleanText(descriptionHtml) || "暂无简介";
        const { style, config } = resolveEpubStyle(options.epub || options);
        const styleCss = typeof style.css === "function" ? style.css(config) : style.css;
        const loadedAssets = loadStyleAssets(style, config, options);
        const assetNames = new Set(loadedAssets.map((asset) => asset.name));
        const manifest = [
            `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
            `<item id="main-style" href="Styles/main.css" media-type="text/css"/>`
        ];
        const spine = [];
        const navPoints = [];
        const files = [
            { name: "mimetype", content: Buffer.from("application/epub+zip"), store: true },
            {
                name: "META-INF/container.xml",
                content: Buffer.from(
                    '<?xml version="1.0" encoding="utf-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
                )
            },
            { name: "OEBPS/Styles/main.css", content: Buffer.from(`${styleCss}\n${COVER_PAGE_CSS}`) }
        ];

        for (const asset of loadedAssets) {
            files.push({ name: `OEBPS/${asset.name}`, content: asset.content });
            manifest.push(`<item id="${escapeXml(asset.id)}" href="${escapeXml(asset.name)}" media-type="${escapeXml(asset.mediaType)}"/>`);
        }

        let pageOrder = 0;
        function addPage({ id, href, pageTitle, body, navTitle = "", navParent = null, linear = true, documentOptions = {} }) {
            const itemId = cleanId(id);
            manifest.push(`<item id="${itemId}" href="${href}" media-type="application/xhtml+xml"/>`);
            spine.push(`<itemref idref="${itemId}"${linear ? "" : ' linear="no"'}/>`);
            files.push({ name: `OEBPS/${href}`, content: Buffer.from(xhtmlDocument(pageTitle, body, documentOptions)) });
            if (navTitle) {
                pageOrder += 1;
                const navPoint = { order: pageOrder, title: navTitle, href, children: [] };
                if (navParent) navParent.children.push(navPoint);
                else navPoints.push(navPoint);
                return navPoint;
            }
            return null;
        }

        let coverName = "";
        let coverPageAdded = false;
        const cover = await fetchCoverFile(book.cover || book.cover_url || book.coverUrl);
        if (cover) {
            coverName = `Images/cover${cover.ext}`;
            files.push({ name: `OEBPS/${coverName}`, content: cover.bytes });
            manifest.push(`<item id="cover-image" href="${coverName}" media-type="${cover.mime}"/>`);
            if (!style.skipVisibleCoverPage) {
                addPage({
                    id: "cover-page",
                    href: "Text/cover.xhtml",
                    pageTitle: rawTitle,
                    body: `<body class="cover-page"><div class="cover"><svg class="cover-svg" xmlns="http://www.w3.org/2000/svg" height="100%" preserveAspectRatio="xMidYMid meet" version="1.1" viewBox="0 0 ${cover.width || 1200} ${cover.height || 1600}" width="100%" xmlns:xlink="http://www.w3.org/1999/xlink"><image width="${cover.width || 1200}" height="${cover.height || 1600}" preserveAspectRatio="xMidYMid meet" xlink:href="../${coverName}"/></svg></div></body>`,
                    linear: true,
                    documentOptions: { cover: true }
                });
                coverPageAdded = true;
            }
        }

        const paragraphRenderer = Object.assign((value, className = "") => textToParagraphs(value, className), { escape: escapeHtml });
        const chapterCount = chapters.filter((chapter) => !isVolumeChapter(chapter)).length;
        const pageContext = {
            book,
            config,
            rawTitle,
            rawAuthor,
            descriptionText,
            coverName,
            chapterCount,
            paragraphs: paragraphRenderer,
            hasAsset: (name) => assetNames.has(name),
            assetHref: (name) => `../${name}`
        };

        if (typeof style.renderTitlePage === "function") {
            addPage({
                id: "title-page",
                href: "Text/title.xhtml",
                pageTitle: rawTitle,
                navTitle: style.titlePageNavTitle || rawTitle,
                body: style.renderTitlePage(pageContext)
            });
        }

        if (config.includeColophon && typeof style.renderColophon === "function") {
            addPage({
                id: "colophon-page",
                href: "Text/colophon.xhtml",
                pageTitle: config.colophonTitle,
                navTitle: config.colophonTitle,
                body: style.renderColophon(pageContext)
            });
        }

        addPage({
            id: "intro-page",
            href: "Text/intro.xhtml",
            pageTitle: config.introTitle,
            navTitle: config.introTitle,
            body: style.renderIntro(pageContext)
        });

        let chapterNo = 0;
        let volumeNo = 0;
        let currentVolumeNav = null;
        for (let index = 0; index < chapters.length; index += 1) {
            const chapter = chapters[index];
            if (isVolumeChapter(chapter)) {
                const rawVolumeTitle = String(chapter.title || chapter.chapter_title || "").trim();
                if (!rawVolumeTitle) continue;
                volumeNo += 1;
                const header = escapedHeader(splitHeading(rawVolumeTitle, volumeNo, VOLUME_LABEL_REGEX, "卷"));
                currentVolumeNav = addPage({
                    id: `volume-${volumeNo}`,
                    href: `Text/volume_${padNumber(volumeNo)}.xhtml`,
                    pageTitle: rawVolumeTitle,
                    navTitle: rawVolumeTitle,
                    body: style.renderVolume({ ...pageContext, header, title: escapeXml(rawVolumeTitle), volumeNo })
                });
            } else {
                const rawChapterTitle = chapter.title || chapter.chapter_title || chapter.chapter_id || `第${index + 1}章`;
                chapterNo += 1;
                const header = escapedHeader(splitHeading(rawChapterTitle, chapterNo, CHAPTER_LABEL_REGEX, "章"));
                const bodyText = stripDuplicateLeadingChapterTitle(chapterPlainText(chapter), rawChapterTitle);
                addPage({
                    id: `chapter-${chapterNo}`,
                    href: `Text/chapter_${padNumber(chapterNo)}.xhtml`,
                    pageTitle: rawChapterTitle,
                    navTitle: rawChapterTitle,
                    navParent: style.nestedVolumeToc ? currentVolumeNav : null,
                    body: style.renderChapter({
                        ...pageContext,
                        header,
                        chapterNo,
                        bodyHtml: textToParagraphs(bodyText)
                    })
                });
            }
            if ((index + 1) % 20 === 0) await yieldToEventLoop();
        }

        files.push({
            name: "OEBPS/toc.ncx",
            content: Buffer.from(
                `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="po18-${escapeXml(book.book_id)}"/></head><docTitle><text>${title}</text></docTitle><navMap>${navPoints.map(renderNavPoint).join("")}</navMap></ncx>`
            )
        });

        const coverMeta = cover ? '<meta name="cover" content="cover-image"/>' : "";
        const coverGuide = coverPageAdded ? '<guide><reference type="cover" title="Cover" href="Text/cover.xhtml"/></guide>' : "";
        files.push({
            name: "OEBPS/content.opf",
            content: Buffer.from(
                `<?xml version="1.0" encoding="utf-8"?><package version="2.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:identifier id="bookid">po18-${escapeXml(book.book_id)}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>zh-CN</dc:language><dc:description>${escapeXml(descriptionText.slice(0, 2000))}</dc:description>${coverMeta}<meta name="po18-epub-style" content="${escapeXml(style.id)}"/></metadata><manifest>${manifest.join("")}</manifest><spine toc="ncx">${spine.join("")}</spine>${coverGuide}</package>`
            )
        });

        return files;
    }

    function loadStyleAssets(style, config, options) {
        const result = [];
        for (const asset of style.assets || []) {
            if (typeof asset.when === "function" && !asset.when(config)) continue;
            let content = options.assetBytes?.[asset.id] ?? options[asset.dependency] ?? deps[asset.dependency];
            if (content === undefined && asset.legacyDependency) content = options[asset.legacyDependency] ?? deps[asset.legacyDependency];
            if (content === undefined) {
                const cacheKey = `${style.id}:${asset.id}`;
                if (assetCache.has(cacheKey)) content = assetCache.get(cacheKey);
                else {
                    content = readFirstFile(asset.paths || []);
                    assetCache.set(cacheKey, content);
                }
            }
            const buffer = normalizeBuffer(content);
            if (buffer) result.push({ ...asset, mediaType: detectImageMediaType(buffer) || asset.mediaType, content: buffer });
        }
        return result;
    }

    function textToParagraphs(value = "", className = "") {
        const classAttr = className ? ` class="${escapeHtml(className)}"` : "";
        const lines = String(value || "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        return lines.length ? lines.map((line) => `<p${classAttr}>${escapeHtml(line)}</p>`).join("") : `<p${classAttr}></p>`;
    }

    async function fetchCoverFile(url = "") {
        const coverUrl = String(url || "").trim();
        if (!/^https?:\/\//i.test(coverUrl) || !fetchImpl) return null;
        try {
            const response = await fetchImpl(coverUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
            if (!response.ok) return null;
            const contentType = String(response.headers.get("content-type") || "").toLowerCase();
            const bytes = Buffer.from(await response.arrayBuffer());
            if (!bytes.length) return null;
            const isPng = contentType.includes("png") || /\.png(?:$|\?)/i.test(coverUrl);
            const dimensions = imageDimensions(bytes, isPng);
            return { bytes, ext: isPng ? ".png" : ".jpg", mime: isPng ? "image/png" : "image/jpeg", ...dimensions };
        } catch {
            return null;
        }
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
        const centralSize = centrals.reduce((sum, buffer) => sum + buffer.length, 0);
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(files.length, 8);
        end.writeUInt16LE(files.length, 10);
        end.writeUInt32LE(centralSize, 12);
        end.writeUInt32LE(offsetBytes, 16);
        return Buffer.concat([...locals, ...centrals, end]);
    }

    return { buildZip, listEpubStyles, makeEpubFiles, textToParagraphs };
}

function splitHeading(rawTitle = "", sequence = 1, regex = CHAPTER_LABEL_REGEX, unit = "章") {
    const title = String(rawTitle || "").trim();
    const match = title.match(regex);
    const number = match ? match[0].replace(/\s+/g, "") : `第${sequence}${unit}`;
    const name = title
        .replace(regex, "")
        .replace(/^[\s:：·.。-]+/, "")
        .replace(/[\s:：·.。-]+$/, "")
        .trim();
    return { number, name: name || title || "正文" };
}

function comparableHeading(value = "") {
    return String(value || "")
        .normalize("NFKC")
        .replace(/[\u200b-\u200d\ufeff]/g, "")
        .replace(/\s+/g, "");
}

function stripDuplicateLeadingChapterTitle(value = "", rawTitle = "") {
    const text = String(value || "").replace(/\r\n?/g, "\n");
    const lines = text.split("\n");
    const firstContent = lines.findIndex((line) => line.trim());
    if (firstContent < 0 || comparableHeading(lines[firstContent]) !== comparableHeading(rawTitle)) return text;
    lines.splice(firstContent, 1);
    return lines.join("\n").replace(/^\s*\n+/, "").trim();
}

function escapedHeader(header) {
    return { number: escapeXml(header.number), name: escapeXml(header.name) };
}

function renderNavPoint(item) {
    const children = Array.isArray(item.children) ? item.children.map(renderNavPoint).join("") : "";
    return `<navPoint id="navPoint-${item.order}" playOrder="${item.order}"><navLabel><text>${escapeXml(item.title)}</text></navLabel><content src="${item.href}"/>${children}</navPoint>`;
}

function xhtmlDocument(title, body, options = {}) {
    const cover = options.cover === true;
    const htmlClass = cover ? ' class="cover-document"' : "";
    const viewport = cover ? '<meta name="viewport" content="width=device-width,height=device-height,initial-scale=1.0"/>' : "";
    return `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html${htmlClass} xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(title)}</title>${viewport}<link href="../Styles/main.css" type="text/css" rel="stylesheet"/></head>${body}</html>`;
}

function readFirstFile(paths) {
    for (const filePath of paths) {
        try {
            return fs.readFileSync(filePath);
        } catch {
            // Continue through packaged fallbacks.
        }
    }
    return null;
}

function normalizeBuffer(value) {
    if (!value) return null;
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return buffer.length ? buffer : null;
}

function imageDimensions(bytes, isPng) {
    if (isPng && bytes.length >= 24 && bytes.toString("ascii", 1, 4) === "PNG") {
        return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (!isPng) {
        let offset = 2;
        while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
            const marker = bytes[offset + 1];
            const length = bytes.readUInt16BE(offset + 2);
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
                return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
            }
            if (length < 2) break;
            offset += 2 + length;
        }
    }
    return {};
}

function detectImageMediaType(bytes) {
    if (!Buffer.isBuffer(bytes) || !bytes.length) return "";
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
    if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
    return "";
}

function padNumber(value) {
    return String(value).padStart(4, "0");
}

function cleanId(value) {
    return String(value || "item").replace(/[^A-Za-z0-9_.-]+/g, "-");
}

function defaultEscapeHtml(value = "") {
    return String(value ?? "").replace(
        /[&<>"']/g,
        (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
    );
}

function escapeXml(value) {
    return String(value ?? "").replace(
        /[&<>"']/g,
        (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]
    );
}

function crc32(buffer) {
    let crc = -1;
    for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
    return (crc ^ -1) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, number) => {
    let value = number;
    for (let index = 0; index < 8; index += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});

function dosTime(date = new Date()) {
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
        day: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
}

module.exports = { createEpubBuilder };
