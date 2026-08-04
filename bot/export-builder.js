/**
 * [INPUT]: 依赖 Node 临时目录、文件流与路径能力，以及注入的 server API 客户端、文本工具、EPUB 生成器和 ZIP 构建器
 * [OUTPUT]: 对外提供按书号合并缓存与账号可读章节并生成保留来源标题/顺序、按实际正文数命名的临时 TXT/EPUB 文件
 * [POS]: bot 导出域的格式编排层，在鉴权正文分页、PO18 缺章补全与具体 TXT/EPUB 序列化之间建立稳定边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require("fs/promises");
const { createWriteStream } = require("fs");
const os = require("os");
const path = require("path");

function chapterIdentity(chapter = {}) {
    return String(chapter.chapter_id ?? chapter.chapterId ?? chapter.id ?? "").trim();
}

function hasChapterBody(chapter = {}) {
    return !!String(chapter.html || chapter.text || chapter.txt_content || "").trim();
}

function mergeExportChapters(cachedRows = [], fetchedRows = [], maxRows = 5000) {
    const rows = [];
    const indexById = new Map();
    for (const chapter of [...cachedRows, ...fetchedRows]) {
        if (!chapter || typeof chapter !== "object") continue;
        const id = chapterIdentity(chapter);
        if (id && indexById.has(id)) {
            const index = indexById.get(id);
            if (!hasChapterBody(rows[index]) && hasChapterBody(chapter)) {
                rows[index] = { ...rows[index], ...chapter, title: chapter.title || rows[index].title };
            }
            continue;
        }
        if (id) indexById.set(id, rows.length);
        rows.push({ ...chapter, __source_index: rows.length });
    }
    rows.sort((left, right) => {
        const leftOrder = Number(left.chapter_order ?? left.chapterOrder);
        const rightOrder = Number(right.chapter_order ?? right.chapterOrder);
        const leftRank = Number.isFinite(leftOrder) && leftOrder > 0 ? leftOrder : Number.MAX_SAFE_INTEGER;
        const rightRank = Number.isFinite(rightOrder) && rightOrder > 0 ? rightOrder : Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank || left.__source_index - right.__source_index;
    });
    return rows.slice(0, Math.max(1, Number(maxRows) || 5000)).map(({ __source_index, ...chapter }) => chapter);
}

function expectedChapterCount(book = {}) {
    const values = [
        book.total_chapters,
        book.chapter_count,
        book.subscribed_chapters,
        Number(book.free_chapters || 0) + Number(book.paid_chapters || 0)
    ].map(Number);
    return Math.max(0, ...values.filter((value) => Number.isFinite(value) && value > 0));
}

function createExportBuilder(deps = {}) {
    const {
        client,
        exportMaxChapters = 5000,
        isVolumeChapter,
        hasPo18Auth,
        fetchPo18PurchasedChapters,
        asExportError,
        safeFileName,
        writeStreamChunk,
        finishWriteStream,
        yieldToEventLoop,
        chapterPlainText,
        paidExportChapterCount,
        makeEpubFiles,
        buildZip
    } = deps;

async function writeTxtExport(filePath, book, rows) {
    const stream = createWriteStream(filePath, { encoding: "utf8" });
    try {
        await writeStreamChunk(
            stream,
            [
                `${book.title || book.book_id}`,
                `作者：${book.author || "佚名"}`,
                `书号：${book.book_id}`,
                "",
                ""
            ].join("\n")
        );
        for (let i = 0; i < rows.length; i += 1) {
            const chapter = rows[i];
            if (isVolumeChapter(chapter)) {
                await writeStreamChunk(stream, `${chapter.title || chapter.chapter_id}\n\n`);
            } else {
                const sourceOrder = Number(chapter.chapter_order ?? chapter.chapterOrder);
                const chapterHeading = String(chapter.title || "").trim() ||
                    (Number.isFinite(sourceOrder) && sourceOrder > 0
                        ? `第 ${sourceOrder} 章`
                        : `章节 ${chapter.chapter_id || chapter.chapterId || i + 1}`);
                await writeStreamChunk(stream, `${chapterHeading}\n\n${chapterPlainText(chapter)}\n\n`);
            }
            if ((i + 1) % 20 === 0) await yieldToEventLoop();
        }
        await finishWriteStream(stream);
    } catch (err) {
        stream.destroy();
        throw err;
    }
}

async function buildExport(bookOrId, format, from = null, exportOptions = {}) {
    const book = typeof bookOrId === "object" && bookOrId ? bookOrId : (await client.getBook(bookOrId)).book;
    const bookId = String(book.book_id || book.bookId || bookOrId).trim();
    const chapters = await client.getChapters(bookId, true, { maxRows: exportMaxChapters });
    let rows = (chapters.rows || []).slice(0, exportMaxChapters);
    const expected = expectedChapterCount(book);
    const cachedReadable = rows.filter((chapter) => !isVolumeChapter(chapter) && hasChapterBody(chapter)).length;
    const isPo18Book = !book.platform || /^po18(?:_|$)/i.test(String(book.platform));
    if (from && isPo18Book && (!rows.length || !expected || cachedReadable < expected)) {
        const account = await client.po18Account(from.id).catch(() => null);
        if (account?.cookies?.length && hasPo18Auth(account.cookies)) {
            const cachedContentIds = rows.filter(hasChapterBody).map(chapterIdentity).filter(Boolean);
            const fetchedRows = await fetchPo18PurchasedChapters(bookId, account.cookies, {
                skipChapterIds: cachedContentIds,
                freeChapterCount: Number(book.free_chapters || 0),
                includeMissingFree: true
            });
            rows = mergeExportChapters(rows, fetchedRows, exportMaxChapters);
        }
    }
    if (!rows.length) throw asExportError("EXPORT_NO_CONTENT", "本地没有正文缓存，无法导出");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "po18-bot-"));
    const readableCount = rows.filter((chapter) => !isVolumeChapter(chapter)).length;
    const base = safeFileName(`${book.title || book.book_id}_${readableCount}章`);
    if (format === "txt") {
        const filePath = path.join(dir, `${base}.txt`);
        await writeTxtExport(filePath, book, rows);
        return { filePath, book, chapters: readableCount, paidChapters: paidExportChapterCount(book, rows) };
    }
    const filePath = path.join(dir, `${base}.epub`);
    const files = await makeEpubFiles(book, rows, exportOptions);
    await fs.writeFile(filePath, await buildZip(files));
    return { filePath, book, chapters: readableCount, paidChapters: paidExportChapterCount(book, rows) };
}

    return { buildExport, writeTxtExport };
}

module.exports = { createExportBuilder, expectedChapterCount, mergeExportChapters };
