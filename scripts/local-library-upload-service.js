/**
 * [INPUT]: 依赖本地书库解析核心、manifest 文件、Upload API、可选数据库查询与内容写入回调
 * [OUTPUT]: 提供 manifest 读写、章节上传载荷、HTTP 批量上传和服务内直连上传
 * [POS]: scripts 的本地书库传输边界，把纯扫描结果映射到持久化协议，不负责目录发现与 CLI 交互
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const {
    DEFAULT_PLATFORM,
    DEFAULT_UPLOADER,
    htmlToText,
    looksLikeHtml,
    normalizeText,
    readTextFile,
    splitNovelText,
    summarizeBooks,
    textToHtml
} = require("./local-library-core");

function csvEscape(value = "") {
    const text = String(value ?? "");
    if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

function manifestOutputPath(options) {
    if (options.out) return path.resolve(options.out);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
    return path.resolve("tmp", `local-library-upload-${stamp}.json`);
}

async function writeManifest(manifest, options) {
    const outPath = manifestOutputPath(options);
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    await fsp.writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const csvPath = outPath.replace(/\.json$/i, ".csv");
    await fsp.writeFile(csvPath, toCsv(manifest.books), "utf8");
    return { outPath, csvPath };
}

function toCsv(books = []) {
    const header = [
        "bookId",
        "title",
        "author",
        "category",
        "tags",
        "wordCount",
        "chapterCount",
        "mode",
        "fileCount",
        "sourcePath",
        "description",
        "warnings"
    ];
    const rows = [header];
    for (const book of books) {
        rows.push([
            book.metadata.bookId,
            book.metadata.title,
            book.metadata.author,
            book.metadata.category,
            book.metadata.tags,
            book.metadata.wordCount,
            book.metadata.chapterCount,
            book.mode,
            book.fileCount,
            book.sourcePath,
            book.metadata.description,
            book.warnings.join("; ")
        ]);
    }
    return `\uFEFF${rows.map((row) => row.map(csvEscape).join(",")).join("\r\n")}\r\n`;
}

async function loadManifest(filePath) {
    const raw = await fsp.readFile(path.resolve(filePath), "utf8");
    const manifest = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (!manifest || !Array.isArray(manifest.books)) throw new Error("Invalid manifest: books array missing");
    manifest.summary = summarizeBooks(manifest.books);
    return manifest;
}

async function buildChapterPayload(book, chapter, options = {}) {
    let body;
    if (chapter.bodyOverride !== undefined && chapter.bodyOverride !== null) {
        body = String(chapter.bodyOverride);
    } else {
        const raw = await readTextFile(chapter.sourcePath);
        body = raw;
        if (chapter.sourceType === "split") {
            const sections = splitNovelText(raw);
            body = sections[chapter.splitIndex]?.body || "";
        }
    }
    const isHtml = chapter.bodyFormat === "html" || chapter.extension === ".html" || chapter.extension === ".htm" || looksLikeHtml(body);
    const html = isHtml ? body : textToHtml(body);
    const text = isHtml ? htmlToText(body) : normalizeText(body);
    return {
        bookId: book.metadata.bookId,
        chapterId: chapter.chapterId,
        title: chapter.title,
        html,
        text,
        chapterOrder: chapter.chapterOrder,
        fromUserScript: true,
        platform: book.metadata.platform || options.platform || DEFAULT_PLATFORM,
        source: chapter.sourcePath,
        uploader: book.metadata.uploader || options.uploader || DEFAULT_UPLOADER,
        uploaderId: book.metadata.uploaderId || options.uploaderId || DEFAULT_UPLOADER
    };
}

async function postJson(url, body, token) {
    if (typeof fetch !== "function") throw new Error("This script needs Node.js 18+ for global fetch");
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Upload-Token": token,
            "X-PO18-Upload-Token": token
        },
        body: JSON.stringify(body)
    });
    const text = await response.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = { raw: text };
    }
    if (!response.ok) {
        const message = data?.error || data?.raw || response.statusText;
        throw new Error(`${response.status} ${message}`);
    }
    return data;
}

async function checkCachedChapters(baseUrl, bookId) {
    const response = await fetch(`${baseUrl}/api/parse/check-cache`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId })
    });
    if (!response.ok) return new Set();
    const data = await response.json();
    return new Set((data.chapterIds || data.cachedChapters || []).map((item) => String(item)));
}

async function uploadManifest(manifest, options) {
    const baseUrl = String(options.baseUrl || "").replace(/\/+$/, "");
    const token = options.token || process.env.PO18_UPLOAD_API_TOKEN || "";
    if (!baseUrl) throw new Error("Missing --base-url");
    if (!token) throw new Error("Missing --token or PO18_UPLOAD_API_TOKEN");

    const stats = {
        metadataSuccess: 0,
        metadataFailed: 0,
        chaptersUploaded: 0,
        chaptersSkipped: 0,
        chapterFailed: 0,
        errors: []
    };

    const batchSize = Math.max(1, Number(options.metadataBatchSize || 50));
    for (let i = 0; i < manifest.books.length; i += batchSize) {
        const chunk = manifest.books.slice(i, i + batchSize).map((book) => book.metadata);
        const result = await postJson(`${baseUrl}/api/metadata/batch`, { books: chunk }, token);
        const batchStats = result?.stats || {};
        stats.metadataSuccess += Number(batchStats.success || 0);
        stats.metadataFailed += Number(batchStats.failed || 0);
        for (const error of batchStats.errors || []) stats.errors.push(error);
    }

    for (const book of manifest.books) {
        let cached = new Set();
        if (options.skipCached) cached = await checkCachedChapters(baseUrl, book.metadata.bookId);
        for (const chapter of book.chapters) {
            if (cached.has(String(chapter.chapterId))) {
                stats.chaptersSkipped += 1;
                continue;
            }
            try {
                const payload = await buildChapterPayload(book, chapter, options);
                await postJson(`${baseUrl}/api/parse/chapter-content`, payload, token);
                stats.chaptersUploaded += 1;
            } catch (err) {
                stats.chapterFailed += 1;
                stats.errors.push(`${book.metadata.bookId}/${chapter.chapterId}: ${err.message}`);
            }
        }
        process.stdout.write(
            `\rUploaded books: ${stats.metadataSuccess}/${manifest.books.length}; chapters: ${stats.chaptersUploaded}; failed: ${stats.chapterFailed}`
        );
    }
    process.stdout.write(os.EOL);
    return stats;
}

async function cachedChapterIdsFromDb(query, bookId) {
    if (!query) return new Set();
    const result = await query("SELECT chapter_id FROM chapter_cache WHERE book_id = $1", [String(bookId)]);
    return new Set((result.rows || []).map((row) => String(row.chapter_id)));
}

async function uploadManifestDirect(manifest, options = {}) {
    const { upsertBook, saveChapter, query } = options;
    if (typeof upsertBook !== "function") throw new Error("uploadManifestDirect requires upsertBook");
    if (typeof saveChapter !== "function") throw new Error("uploadManifestDirect requires saveChapter");

    const stats = {
        metadataSuccess: 0,
        metadataFailed: 0,
        chaptersUploaded: 0,
        chaptersSkipped: 0,
        chapterFailed: 0,
        errors: []
    };

    for (const book of manifest.books || []) {
        try {
            await upsertBook(book.metadata);
            stats.metadataSuccess += 1;
        } catch (err) {
            stats.metadataFailed += 1;
            stats.errors.push(`${book?.metadata?.bookId || "unknown"} metadata: ${err.message || String(err)}`);
        }
    }

    for (const book of manifest.books || []) {
        const cached = options.skipCached ? await cachedChapterIdsFromDb(query, book.metadata.bookId) : new Set();
        for (const chapter of book.chapters || []) {
            if (cached.has(String(chapter.chapterId))) {
                stats.chaptersSkipped += 1;
                continue;
            }
            try {
                const payload = await buildChapterPayload(book, chapter, options);
                await saveChapter(payload);
                stats.chaptersUploaded += 1;
            } catch (err) {
                stats.chapterFailed += 1;
                stats.errors.push(`${book.metadata.bookId}/${chapter.chapterId}: ${err.message || String(err)}`);
            }
        }
    }

    return stats;
}

module.exports = {
    buildChapterPayload,
    loadManifest,
    uploadManifest,
    uploadManifestDirect,
    writeManifest
};
