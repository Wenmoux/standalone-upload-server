const fs = require("fs/promises");
const { createWriteStream } = require("fs");
const os = require("os");
const path = require("path");

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
    let chapterNo = 0;
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
                chapterNo += 1;
                const chapterHeading = `第 ${chapterNo} 章 ${chapter.title || chapter.chapter_id}`;
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

async function buildExport(bookOrId, format, from = null) {
    const book = typeof bookOrId === "object" && bookOrId ? bookOrId : (await client.getBook(bookOrId)).book;
    const bookId = String(book.book_id || book.bookId || bookOrId).trim();
    const chapters = await client.getChapters(bookId, true);
    let rows = (chapters.rows || []).slice(0, exportMaxChapters);
    if (!rows.length && from) {
        const account = await client.po18Account(from.id).catch(() => null);
        if (account?.cookies?.length && hasPo18Auth(account.cookies)) {
            rows = (await fetchPo18PurchasedChapters(bookId, account.cookies)).slice(0, exportMaxChapters);
        }
    }
    if (!rows.length) throw asExportError("EXPORT_NO_CONTENT", "本地没有正文缓存，无法导出");
    const base = safeFileName(`${book.title || book.book_id}_${book.book_id}`);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "po18-bot-"));
    const readableCount = rows.filter((chapter) => !isVolumeChapter(chapter)).length;
    if (format === "txt") {
        const filePath = path.join(dir, `${base}.txt`);
        await writeTxtExport(filePath, book, rows);
        return { filePath, book, chapters: readableCount, paidChapters: paidExportChapterCount(book, rows) };
    }
    const filePath = path.join(dir, `${base}.epub`);
    const files = await makeEpubFiles(book, rows);
    await fs.writeFile(filePath, await buildZip(files));
    return { filePath, book, chapters: readableCount, paidChapters: paidExportChapterCount(book, rows) };
}

    return { buildExport, writeTxtExport };
}

module.exports = { createExportBuilder };
