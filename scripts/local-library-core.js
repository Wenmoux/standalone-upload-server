/**
 * [INPUT]: 依赖本地 TXT/目录结构、文本编码、元数据推断规则与文件系统
 * [OUTPUT]: 提供文本规范化、书库扫描、稳定书/章 ID、章节描述与结果汇总
 * [POS]: scripts 的本地书库纯解析核心，被上传服务、CLI 与浏览器工作台间接复用，不承担网络和交互
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const crypto = require("crypto");
const fsp = require("fs/promises");
const path = require("path");
const { TextDecoder } = require("util");

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".html", ".htm"]);
const SKIP_DIRS = new Set([".git", "node_modules", "tmp", "test-results", ".cache"]);
const DEFAULT_PLATFORM = "alice";
const DEFAULT_UPLOADER = "local_library";
const DEFAULT_TAG = "成人";

function uniqueTokens(values = []) {
    const result = [];
    const seen = new Set();
    const push = (value) => {
        if (Array.isArray(value)) {
            value.forEach(push);
            return;
        }
        for (const token of String(value || "").split(/[,，、|/]+/)) {
            const clean = token.trim();
            const key = clean.toLowerCase();
            if (!clean || seen.has(key)) continue;
            seen.add(key);
            result.push(clean);
        }
    };
    (Array.isArray(values) ? values : [values]).forEach(push);
    return result;
}

function stableHash(value, length = 12) {
    return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, length);
}

function safeIdPart(value = "") {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24);
}

function makeBookId(prefix, title, author, relativePath) {
    const cleanPrefix = safeIdPart(prefix) || DEFAULT_PLATFORM;
    const hint = safeIdPart(`${title}-${author}`);
    const hash = stableHash(`${title}\0${author}\0${relativePath}`, 14);
    return hint ? `${cleanPrefix}-${hint}-${hash}` : `${cleanPrefix}-${hash}`;
}

function decodeBuffer(buffer) {
    if (!buffer || !buffer.length) return "";
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return new TextDecoder("utf-8").decode(buffer.slice(3));
    }
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
        return new TextDecoder("utf-16le").decode(buffer.slice(2));
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
        const swapped = Buffer.alloc(buffer.length - 2);
        for (let i = 2; i + 1 < buffer.length; i += 2) {
            swapped[i - 2] = buffer[i + 1];
            swapped[i - 1] = buffer[i];
        }
        return new TextDecoder("utf-16le").decode(swapped);
    }
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
        try {
            return new TextDecoder("gb18030").decode(buffer);
        } catch {
            return buffer.toString("utf8");
        }
    }
}

async function readTextFile(filePath) {
    const buffer = await fsp.readFile(filePath);
    return normalizeText(decodeBuffer(buffer));
}

function normalizeText(value = "") {
    return String(value || "")
        .replace(/^\uFEFF/, "")
        .replace(/\r\n?/g, "\n")
        .replace(/\u0000/g, "")
        .trim();
}

function stripExtension(filename = "") {
    return path.basename(filename, path.extname(filename));
}

function stripLeadingSerial(value = "") {
    return String(value || "")
        .replace(/^\s*\d{1,5}\s*[-_.、．]\s*/u, "")
        .replace(/^\s*第\s*[0-9零〇一二三四五六七八九十百千万两]+\s*[章回节篇]\s*[-_、．:：]?\s*/u, "")
        .trim();
}

function splitTitleAuthor(rawName = "") {
    let name = stripExtension(rawName).replace(/\s+/g, " ").trim();
    name = stripLeadingSerial(name);
    const metadataAuthor = name.match(/作者[:：]\s*([^,，;；]+)$/u);
    if (metadataAuthor) {
        const title = name.slice(0, metadataAuthor.index).trim();
        return { title: cleanupTitle(title), author: cleanupAuthor(metadataAuthor[1]) };
    }

    const separators = ["-", "－", "–", "—"];
    let bestIndex = -1;
    let bestSep = "";
    for (const sep of separators) {
        const index = name.lastIndexOf(sep);
        if (index > bestIndex) {
            bestIndex = index;
            bestSep = sep;
        }
    }

    if (bestIndex > 0) {
        const left = name.slice(0, bestIndex).trim();
        const right = name.slice(bestIndex + bestSep.length).trim();
        if (left && right && right.length <= 80) {
            return { title: cleanupTitle(left), author: cleanupAuthor(right) };
        }
    }
    return { title: cleanupTitle(name), author: "佚名" };
}

function cleanupTitle(value = "") {
    return (
        String(value || "")
            .replace(/\.(txt|md|html?)$/i, "")
            .replace(/\s+/g, " ")
            .trim() || "未命名作品"
    );
}

function cleanupAuthor(value = "") {
    return (
        String(value || "")
            .replace(/^作者[:：]\s*/u, "")
            .replace(/\s+/g, " ")
            .trim() || "佚名"
    );
}

function firstLines(text = "", count = 80) {
    return String(text || "")
        .split("\n")
        .slice(0, count);
}

function extractInlineMetadata(text = "") {
    const meta = {};
    const lines = firstLines(text, 80);
    for (const line of lines) {
        const clean = line.trim();
        if (!clean) continue;
        const match = clean.match(/^(书名|标题|题名|作者|分类|类别|标签|简介|内容简介|书号|bookId|book_id)\s*[:：]\s*(.+)$/iu);
        if (!match) continue;
        const key = match[1].toLowerCase();
        const value = match[2].trim();
        if (!value) continue;
        if (key === "书名" || key === "标题" || key === "题名") meta.title = value;
        else if (key === "作者") meta.author = value;
        else if (key === "分类" || key === "类别") meta.category = value;
        else if (key === "标签") meta.tags = uniqueTokens(value);
        else if (key === "简介" || key === "内容简介") meta.description = value;
        else if (key === "书号" || key === "bookid" || key === "book_id") meta.bookId = value;
    }
    return meta;
}

function wordCount(text = "") {
    const normalized = htmlToText(text)
        .replace(/\s+/g, "")
        .replace(/[，。！？、；：“”‘’（）《》【】…—·,.!?;:'"()[\]{}<>~`@#$%^&*_+=|\\/ -]/g, "");
    const cjk = normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || [];
    const latinWords = htmlToText(text).match(/[A-Za-z0-9]+/g) || [];
    return cjk.length + latinWords.length;
}

function htmlToText(html = "") {
    return String(html || "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(?:p|div|section|article|li|tr|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function escapeHtml(value = "") {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function textToHtml(text = "") {
    const normalized = normalizeText(text);
    if (!normalized) return "";
    const blocks = normalized
        .split(/\n{2,}/)
        .map((block) =>
            block
                .split("\n")
                .map((line) => escapeHtml(line.trimEnd()))
                .join("<br>")
        )
        .map((block) => block.trim())
        .filter(Boolean);
    return blocks.map((block) => `<p>${block}</p>`).join("\n");
}

function looksLikeHtml(value = "") {
    return /<\/?(?:html|body|p|div|br|section|article|h[1-6])\b/i.test(String(value || ""));
}

function chapterHeading(line = "") {
    const clean = line.trim();
    if (!clean || clean.length > 90) return "";
    const patterns = [
        /^第\s*[0-9零〇一二三四五六七八九十百千万两]+\s*[章节回卷篇部][^\n]{0,70}$/u,
        /^(序章|楔子|终章|尾声|番外[^\n]{0,70})$/u,
        /^[0-9]{1,5}\s*[、.．]\s*\S.{0,70}$/u,
        /^chapter\s+[0-9ivxlcdm]+[^\n]{0,60}$/iu
    ];
    return patterns.some((pattern) => pattern.test(clean)) ? clean : "";
}

function splitNovelText(text = "") {
    const normalized = normalizeText(text);
    const lines = normalized.split("\n");
    const headings = [];
    for (let i = 0; i < lines.length; i++) {
        const title = chapterHeading(lines[i]);
        if (title) headings.push({ index: i, title });
    }
    if (headings.length < 2) return [];

    const sections = [];
    const preface = lines.slice(0, headings[0].index).join("\n").trim();
    for (let i = 0; i < headings.length; i++) {
        const start = headings[i].index;
        const end = i + 1 < headings.length ? headings[i + 1].index : lines.length;
        let body = lines
            .slice(start + 1, end)
            .join("\n")
            .trim();
        if (i === 0 && preface && wordCount(preface) > 80) body = `${preface}\n\n${body}`.trim();
        sections.push({ title: headings[i].title, body });
    }
    return sections.filter((section) => section.body || section.title);
}

function inferCategory(title = "", author = "", sample = "", fallback = DEFAULT_TAG) {
    const haystack = `${title} ${author} ${sample}`.toLowerCase();
    const rules = [
        ["同人", /(同人|方舟|原神|崩坏|舰娘|宝可梦|海贼|火影|死神|碧蓝|fgo|明日方舟|lovelive|vtuber|东方|型月|赛马娘|王者|英雄联盟|lol)/i],
        ["科幻", /(科幻|机甲|克隆|复制体|实验室|ai|人工智能|星际|赛博|末日|丧尸|机器人)/i],
        ["玄幻奇幻", /(异世界|魔法|魔界|勇者|骑士|魔王|龙娘|精灵|兽人|地下城|奇幻|玄幻|修仙|仙侠)/i],
        ["古代历史", /(皇后|皇帝|王朝|宫廷|古代|武侠|江湖|三国|大唐|宋朝|明朝|清朝)/i],
        ["现代都市", /(都市|校园|老师|同学|主播|总裁|公司|大学|高中|邻家|富婆|白领|职场)/i],
        ["悬疑惊悚", /(悬疑|惊悚|恐怖|案件|侦探|调查|阴谋|推理)/i],
        ["短篇合集", /(合集|短篇|篇合集|系列)/i]
    ];
    const found = rules.find(([, pattern]) => pattern.test(haystack));
    return found ? found[0] : fallback;
}

function inferTags(title = "", category = "") {
    const tags = [];
    const value = `${title} ${category}`;
    const pushIf = (tag, pattern) => {
        if (pattern.test(value)) tags.push(tag);
    };
    pushIf("同人", /同人|方舟|原神|崩坏|舰娘|宝可梦|海贼|火影|fgo|东方/i);
    pushIf("异世界", /异世界|魔界|勇者|魔王|骑士|精灵|兽人/i);
    pushIf("都市", /都市|校园|总裁|主播|职场|大学|高中/i);
    pushIf("短篇", /短篇|短文|一发完/i);
    pushIf("合集", /合集|系列/i);
    return tags;
}

function chapterTitleFromFilename(filename = "", order = 1, bookTitle = "") {
    const raw = stripExtension(filename);
    const clean = stripLeadingSerial(raw).replace(/\s+/g, " ").trim();
    if (!clean || clean === bookTitle) return order === 1 ? "全文" : `第${order}章`;
    return clean;
}

function jsonClone(value) {
    return JSON.parse(JSON.stringify(value));
}

async function collectTextFiles(root) {
    const files = [];
    async function walk(dir) {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith(".")) continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name)) await walk(fullPath);
                continue;
            }
            if (!entry.isFile()) continue;
            if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
        }
    }
    await walk(root);
    return naturalSort(files);
}

function naturalSort(values = []) {
    return values.slice().sort((a, b) => String(a).localeCompare(String(b), "zh-Hans-CN", { numeric: true, sensitivity: "base" }));
}

function cleanExcerpt(text = "", maxLength = 260) {
    const normalized = htmlToText(text)
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !chapterHeading(line) && !/^(作者|标签|分类|简介|书名|标题)\s*[:：]/u.test(line))
        .join(" ");
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function pickDescription(meta, title, chapterCount, count, sampleText) {
    if (meta.description) return meta.description;
    const excerpt = cleanExcerpt(sampleText);
    const prefix = `本地导入：${title}。共 ${chapterCount} 章，约 ${count} 字。`;
    if (!excerpt) return prefix;
    return `${prefix}开篇：${excerpt}`;
}

async function buildChapterDescriptors(files, title, options) {
    const descriptors = [];
    if (files.length === 1) {
        const filePath = files[0];
        const text = await readTextFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const sections = options.splitSingleFile && !looksLikeHtml(text) ? splitNovelText(text) : [];
        if (sections.length >= 2) {
            sections.forEach((section, index) => {
                descriptors.push({
                    chapterId: String(index + 1),
                    chapterOrder: index + 1,
                    title: section.title || `第${index + 1}章`,
                    sourcePath: filePath,
                    sourceType: "split",
                    splitIndex: index,
                    wordCount: wordCount(section.body),
                    byteLength: Buffer.byteLength(section.body, "utf8"),
                    extension: ext
                });
            });
        } else {
            descriptors.push({
                chapterId: "1",
                chapterOrder: 1,
                title: chapterTitleFromFilename(path.basename(filePath), 1, title),
                sourcePath: filePath,
                sourceType: "file",
                splitIndex: null,
                wordCount: wordCount(text),
                byteLength: Buffer.byteLength(text, "utf8"),
                extension: ext
            });
        }
        return descriptors;
    }

    for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        const text = await readTextFile(filePath);
        const order = i + 1;
        descriptors.push({
            chapterId: String(order),
            chapterOrder: order,
            title: chapterTitleFromFilename(path.basename(filePath), order, title),
            sourcePath: filePath,
            sourceType: "file",
            splitIndex: null,
            wordCount: wordCount(text),
            byteLength: Buffer.byteLength(text, "utf8"),
            extension: path.extname(filePath).toLowerCase()
        });
    }
    return descriptors;
}

async function sampleTextForChapter(chapter) {
    if (!chapter?.sourcePath) return "";
    const text = await readTextFile(chapter.sourcePath);
    if (chapter.sourceType !== "split") return text;
    const sections = splitNovelText(text);
    return sections[chapter.splitIndex]?.body || "";
}

async function readChapterEditableText(book, chapter) {
    if (chapter?.bodyOverride !== undefined && chapter?.bodyOverride !== null) return String(chapter.bodyOverride);
    if (!chapter?.sourcePath) return "";
    const raw = await readTextFile(chapter.sourcePath);
    let body = raw;
    if (chapter.sourceType === "split") {
        const sections = splitNovelText(raw);
        body = sections[chapter.splitIndex]?.body || "";
    }
    const isHtml = chapter.extension === ".html" || chapter.extension === ".htm" || looksLikeHtml(body);
    return isHtml ? htmlToText(body) : normalizeText(body);
}

async function fileStats(files = []) {
    const stats = await Promise.all(files.map((file) => fsp.stat(file)));
    const latest = stats.reduce((max, item) => (item.mtime > max ? item.mtime : max), new Date(0));
    return { latestMtime: latest, totalBytes: stats.reduce((sum, item) => sum + item.size, 0) };
}

function isoDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime()) || date.getTime() <= 0) return "";
    return date.toISOString().slice(0, 10);
}

function normalizeOverrideMap(value) {
    if (!value || typeof value !== "object") return {};
    return value.overrides && typeof value.overrides === "object" ? value.overrides : value;
}

async function loadOverrides(filePath) {
    if (!filePath) return {};
    const raw = await fsp.readFile(filePath, "utf8");
    return normalizeOverrideMap(JSON.parse(raw));
}

function applyOverrides(book, overrides = {}) {
    const keys = [book.metadata.bookId, book.metadata.title, book.sourceName].filter(Boolean);
    const overrideKey = keys.find((key) => Object.prototype.hasOwnProperty.call(overrides, key));
    if (!overrideKey) return book;
    const override = overrides[overrideKey] || {};
    const next = jsonClone(book);
    const metadata = next.metadata;
    const allowed = [
        "bookId",
        "title",
        "author",
        "category",
        "tags",
        "description",
        "descriptionHtml",
        "description_html",
        "wordCount",
        "chapterCount",
        "status",
        "detailUrl",
        "platform",
        "uploader",
        "uploaderId"
    ];
    for (const key of allowed) {
        if (override[key] !== undefined)
            metadata[key] = Array.isArray(override[key]) ? uniqueTokens(override[key]).join(",") : override[key];
    }
    if (override.addTags) metadata.tags = uniqueTokens([metadata.tags, override.addTags]).join(",");
    next.overrideKey = overrideKey;
    return next;
}

async function scanBookFromFiles(sourceName, sourcePath, files, root, options, overrides) {
    const rel = path.relative(root, sourcePath || files[0]);
    const firstText = files[0] ? await readTextFile(files[0]) : "";
    const inline = extractInlineMetadata(firstText);
    const parsed = splitTitleAuthor(sourceName);
    const title = cleanupTitle(inline.title || parsed.title);
    const author = cleanupAuthor(inline.author || parsed.author);
    const chapters = await buildChapterDescriptors(files, title, options);
    if (!chapters.length) return null;
    const firstChapterText = await sampleTextForChapter(chapters[0]);
    const sample = `${sourceName}\n${firstChapterText.slice(0, 4000)}`;
    const category = inline.category || inferCategory(title, author, sample, options.defaultCategory);
    const tags = uniqueTokens([options.defaultTags, inline.tags || [], category, inferTags(title, category)]).join(",");
    const chapterCount = chapters.length;
    const totalWords = chapters.reduce((sum, item) => sum + Number(item.wordCount || 0), 0);
    const latest = chapters[chapters.length - 1]?.title || "";
    const stats = await fileStats(files);
    const bookId = inline.bookId || makeBookId(options.idPrefix, title, author, rel);
    const description = pickDescription(inline, title, chapterCount, totalWords, firstChapterText);
    const mode = files.length > 1 ? "chapter-files" : chapters.length > 1 ? "single-file-split" : "single-file";
    const book = {
        sourceName,
        sourcePath,
        mode,
        fileCount: files.length,
        totalBytes: stats.totalBytes,
        metadata: {
            bookId,
            title,
            author,
            category,
            tags,
            description,
            descriptionHtml: textToHtml(description),
            wordCount: totalWords,
            chapterCount,
            freeChapters: chapterCount,
            paidChapters: 0,
            totalChapters: chapterCount,
            subscribedChapters: chapterCount,
            status: options.status,
            latestChapterName: latest,
            latestChapterDate: isoDate(stats.latestMtime),
            platform: options.platform,
            detailUrl: `local-library://${encodeURIComponent(bookId)}`,
            uploader: options.uploader,
            uploaderId: options.uploaderId
        },
        chapters,
        warnings: []
    };
    if (author === "佚名") book.warnings.push("未从文件名或正文元信息解析到作者");
    if (category === options.defaultCategory) book.warnings.push("分类使用默认值");
    return applyOverrides(book, overrides);
}

async function scanLibrary(options) {
    const root = path.resolve(options.root);
    const stat = await fsp.stat(root).catch(() => null);
    if (!stat || !stat.isDirectory()) throw new Error(`Root directory not found: ${root}`);
    const overrides = await loadOverrides(options.overrides);
    const entries = naturalSort(await fsp.readdir(root));
    const books = [];

    for (const name of entries) {
        if (options.limit && books.length >= options.limit) break;
        if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
        const fullPath = path.join(root, name);
        const itemStat = await fsp.stat(fullPath);
        if (itemStat.isDirectory()) {
            const files = await collectTextFiles(fullPath);
            if (!files.length) continue;
            const book = await scanBookFromFiles(name, fullPath, files, root, options, overrides);
            if (book) books.push(book);
            continue;
        }
        if (!itemStat.isFile() || !TEXT_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
        const book = await scanBookFromFiles(name, fullPath, [fullPath], root, options, overrides);
        if (book) books.push(book);
    }

    ensureUniqueBookIds(books, options.idPrefix);
    const summary = summarizeBooks(books);
    return {
        version: 1,
        generatedAt: new Date().toISOString(),
        root,
        options: {
            platform: options.platform,
            uploader: options.uploader,
            uploaderId: options.uploaderId,
            defaultTags: options.defaultTags,
            defaultCategory: options.defaultCategory,
            status: options.status,
            splitSingleFile: options.splitSingleFile
        },
        summary,
        books
    };
}

function ensureUniqueBookIds(books = [], prefix = DEFAULT_PLATFORM) {
    const used = new Map();
    for (const book of books) {
        const base = String(book.metadata.bookId || makeBookId(prefix, book.metadata.title, book.metadata.author, book.sourcePath)).trim();
        let next = base;
        let count = used.get(base) || 0;
        while (used.has(next)) {
            count += 1;
            next = `${base}-${count}`;
        }
        used.set(base, count);
        used.set(next, 1);
        book.metadata.bookId = next;
        for (let i = 0; i < book.chapters.length; i++) {
            book.chapters[i].chapterId = String(i + 1);
            book.chapters[i].chapterOrder = i + 1;
        }
    }
}

function summarizeBooks(books = []) {
    const categories = {};
    const modes = {};
    let chapters = 0;
    let words = 0;
    let warnings = 0;
    for (const book of books) {
        const category = book.metadata.category || "";
        categories[category] = (categories[category] || 0) + 1;
        modes[book.mode] = (modes[book.mode] || 0) + 1;
        chapters += book.chapters.length;
        words += Number(book.metadata.wordCount || 0);
        warnings += book.warnings.length;
    }
    return { books: books.length, chapters, words, categories, modes, warnings };
}

module.exports = {
    DEFAULT_PLATFORM,
    DEFAULT_TAG,
    DEFAULT_UPLOADER,
    decodeBuffer,
    htmlToText,
    inferCategory,
    looksLikeHtml,
    normalizeText,
    readChapterEditableText,
    readTextFile,
    scanLibrary,
    splitNovelText,
    splitTitleAuthor,
    summarizeBooks,
    textToHtml,
    uniqueTokens,
    wordCount
};
