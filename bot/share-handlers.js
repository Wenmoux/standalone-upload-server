function createShareHandlers(options = {}) {
    const {
        client,
        sendMessage,
        editMessage,
        ensureRegistered,
        escapeHtml,
        isVolumeChapter,
        userDisplayName,
        bookToSharePayload,
        extractCacheIds,
        chapterToSharePayload,
        fetchPo18PurchasedChapters,
        fetchPo18Bookshelf,
        hasPo18Auth,
        rewardCopper = 1000,
        rewardMinChapters = 20,
        logger = console
    } = options;

    function shareBookId(book = {}) {
        return String(book.book_id || book.bookId || book.bid || "").trim();
    }

    function shareBookTitle(book = {}) {
        return book.title || shareBookId(book) || "-";
    }

    function isPo18ShareBook(book = {}) {
        return /po18/i.test(String(book.platform || ""))
            || /po18\.tw/i.test(String(book.detail_url || book.detailUrl || ""));
    }

    function normalizeShareBook(input = {}, fallbackId = "") {
        const bookId = shareBookId(input) || String(fallbackId || "").trim();
        return {
            ...input,
            book_id: bookId,
            platform: input.platform || "po18",
            detail_url: input.detail_url || input.detailUrl || (bookId ? `https://www.po18.tw/books/${bookId}/articles` : "")
        };
    }

    function positiveNumber(value) {
        const n = Number(value || 0);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function shareChapterOrder(chapter = {}, fallback = 0) {
        const order = positiveNumber(chapter.chapter_order ?? chapter.chapterOrder ?? chapter.order);
        return order || positiveNumber(fallback);
    }

    function boolish(value) {
        if (value === true || value === 1) return true;
        const text = String(value ?? "").trim().toLowerCase();
        if (!text) return false;
        return ["1", "true", "yes", "paid", "vip", "charge", "needpay"].includes(text)
            || /付费|付費|收费|收費|订阅|訂閱|订购|訂購|购买|購買|vip/i.test(text);
    }

    function explicitFreeChapter(chapter = {}) {
        if (chapter.is_free === true || chapter.isFree === true || chapter.free === true) return true;
        for (const key of ["price", "chapterPrice", "chapter_price", "cost", "fee"]) {
            if (chapter[key] !== undefined && Number(chapter[key]) === 0) return true;
        }
        const text = String(chapter.access || chapter.accessText || chapter.status || chapter.mark || "");
        return /免费|免費/.test(text) && !/付费|付費|订阅|訂閱|订购|訂購|购买|購買/.test(text);
    }

    function explicitPaidChapter(chapter = {}) {
        if (explicitFreeChapter(chapter)) return false;
        for (const key of ["is_paid", "isPaid", "paid", "vip", "isVip", "is_vip", "requiresPayment", "requires_payment"]) {
            if (chapter[key] !== undefined && boolish(chapter[key])) return true;
        }
        for (const key of ["price", "chapterPrice", "chapter_price", "cost", "fee"]) {
            if (chapter[key] !== undefined && Number(chapter[key]) > 0) return true;
        }
        const text = String(chapter.access || chapter.accessText || chapter.status || chapter.mark || "");
        return /付费|付費|收费|收費|订阅|訂閱|订购|訂購|购买|購買|vip/i.test(text);
    }

    function rewardableShareChapter(book = {}, chapter = {}, index = 0) {
        if (isVolumeChapter(chapter) || explicitFreeChapter(chapter)) return false;
        if (explicitPaidChapter(chapter)) return true;
        const freeChapters = positiveNumber(book.free_chapters ?? book.freeChapters);
        const paidChapters = positiveNumber(book.paid_chapters ?? book.paidChapters);
        const totalChapters = positiveNumber(book.total_chapters ?? book.totalChapters ?? book.chapter_count ?? book.chapterCount);
        const inferredFree = !freeChapters && paidChapters && totalChapters > paidChapters ? totalChapters - paidChapters : freeChapters;
        if (inferredFree > 0) return shareChapterOrder(chapter, index) > inferredFree;
        if (paidChapters > 0 && totalChapters > 0) return true;
        return false;
    }

    async function resolveShareBook(bookId, fallbackBook = null) {
        const fallback = fallbackBook ? normalizeShareBook(fallbackBook, bookId) : null;
        try {
            const data = await client.getBook(bookId);
            if (data?.book) return normalizeShareBook({ ...(fallback || {}), ...data.book }, bookId);
        } catch (err) {
            if (!fallback) throw err;
            logger.warn(`[share] book metadata fallback ${bookId}: ${err.message || String(err)}`);
        }
        if (fallback) return fallback;
        throw new Error(`book not found: ${bookId}`);
    }

    async function localShareChapters(bookId) {
        try {
            const data = await client.getChapters(bookId, true);
            return (data.rows || []).filter((chapter) => String(chapter.chapter_id || chapter.chapterId || chapter.id || "").trim());
        } catch (err) {
            logger.warn(`[share] local chapters unavailable ${bookId}: ${err.message || String(err)}`);
            return [];
        }
    }

    async function notifyShareProgress(progressOptions, state) {
        if (typeof progressOptions.onProgress !== "function") return;
        await progressOptions.onProgress(state).catch(() => {});
    }

    async function shareBookForUser(message, inputBook, progressOptions = {}) {
        const bookId = shareBookId(inputBook);
        if (!bookId) throw new Error("missing book id");
        const uploader = userDisplayName(message.from);
        const uploaderId = String(message.from.id || "");
        const book = await resolveShareBook(bookId, inputBook);
        await notifyShareProgress(progressOptions, { phase: "metadata", book });

        const meta = await client.shareMetadata([bookToSharePayload(book, uploader, uploaderId)]);
        const metaStats = meta.stats || {};
        if (meta.success === false || Number(metaStats.failed || 0) > 0) {
            return {
                book,
                status: "metadata_failed",
                error: (metaStats.errors || ["共享书籍信息失败"])[0],
                total: 0,
                uploaded: 0,
                rewardableUploaded: 0,
                skipped: 0,
                failed: 0
            };
        }

        let chapters = await localShareChapters(book.book_id);
        if (!chapters.length && isPo18ShareBook(book)) {
            const account = progressOptions.account !== undefined
                ? progressOptions.account
                : await client.po18Account(message.from.id).catch(() => null);
            if (account?.cookies?.length && hasPo18Auth(account.cookies)) {
                await notifyShareProgress(progressOptions, { phase: "po18", book });
                try {
                    chapters = (await fetchPo18PurchasedChapters(book.book_id, account.cookies))
                        .filter((chapter) => String(chapter.chapter_id || chapter.chapterId || chapter.id || "").trim());
                } catch (err) {
                    return {
                        book,
                        status: "chapter_fetch_failed",
                        error: err.message || String(err),
                        total: 0,
                        uploaded: 0,
                        rewardableUploaded: 0,
                        skipped: 0,
                        failed: 0
                    };
                }
            }
        }

        if (!chapters.length) {
            return { book, status: "no_chapters", total: 0, uploaded: 0, rewardableUploaded: 0, skipped: 0, failed: 0 };
        }

        await notifyShareProgress(progressOptions, { phase: "cache", book, total: chapters.length });
        const cache = await client.checkSharedCache(book.book_id);
        const cachedIds = extractCacheIds(cache);
        const uploadItems = chapters
            .map((chapter, index) => ({
                chapter,
                index: index + 1,
                chapterId: String(chapter.chapter_id || chapter.chapterId || chapter.id || index + 1)
            }))
            .filter((item) => !cachedIds.has(item.chapterId));
        const skipped = chapters.length - uploadItems.length;

        if (!uploadItems.length) {
            return { book, status: "cached", total: chapters.length, uploaded: 0, rewardableUploaded: 0, skipped, failed: 0 };
        }

        let uploaded = 0;
        let rewardableUploaded = 0;
        let failed = 0;
        for (let i = 0; i < uploadItems.length; i += 1) {
            const item = uploadItems[i];
            if (i === 0 || (i + 1) % 10 === 0 || i + 1 === uploadItems.length) {
                await notifyShareProgress(progressOptions, {
                    phase: "upload",
                    book,
                    current: i + 1,
                    uploadTotal: uploadItems.length,
                    skipped,
                    uploaded,
                    rewardableUploaded,
                    failed,
                    total: chapters.length
                });
            }
            const payload = {
                ...chapterToSharePayload(book, item.chapter, item.index, uploader, uploaderId),
                source: "telegram_bot"
            };
            if (!payload.html || !payload.text) {
                failed += 1;
                continue;
            }
            try {
                await client.shareChapter(payload);
                uploaded += 1;
                if (rewardableShareChapter(book, item.chapter, item.index)) rewardableUploaded += 1;
            } catch (err) {
                failed += 1;
                logger.error(`[share] ${book.book_id}/${payload.chapterId}: ${err.message}`);
            }
        }

        return {
            book,
            status: failed ? (uploaded ? "partial" : "failed") : "uploaded",
            total: chapters.length,
            uploaded,
            rewardableUploaded,
            skipped,
            failed
        };
    }

    async function handleShare(message, bookId) {
        const id = String(bookId || "").trim();
        if (!id) return sendMessage(message.chat.id, "用法：共享 书号");
        await ensureRegistered(message.from);
        const progress = await sendMessage(message.chat.id, `正在共享：<code>${escapeHtml(id)}</code>\n准备书籍信息...`);
        const stats = await shareBookForUser(message, { book_id: id }, {
            onProgress: (state) => {
                const title = escapeHtml(shareBookTitle(state.book));
                if (state.phase === "metadata") {
                    return editMessage(message.chat.id, progress.message_id, `正在共享：<code>${escapeHtml(id)}</code>\n准备书籍信息...`);
                }
                if (state.phase === "po18") {
                    return editMessage(message.chat.id, progress.message_id, [
                        "已共享书籍信息，本地没有正文缓存。",
                        `书籍：${title}`,
                        "正在用 PO18 登录态拉取已购章节..."
                    ].join("\n"));
                }
                if (state.phase === "cache") {
                    return editMessage(message.chat.id, progress.message_id, `已共享书籍信息，正在检查正文缓存...\n书籍：${title}`);
                }
                if (state.phase === "upload") {
                    return editMessage(message.chat.id, progress.message_id, [
                        `正在上传正文：${state.current}/${state.uploadTotal}`,
                        `书籍：${title}`,
                        `已上传 ${state.uploaded} 章 / 可奖励付费新增 ${state.rewardableUploaded || 0} 章`,
                        `跳过 ${state.skipped} 章 / 失败 ${state.failed} 章`
                    ].join("\n"));
                }
                return null;
            }
        });

        if (stats.status === "metadata_failed") {
            await editMessage(message.chat.id, progress.message_id, `共享失败：${escapeHtml(stats.error || "共享书籍信息失败")}`).catch(() => {});
            return;
        }
        if (stats.status === "chapter_fetch_failed") {
            await editMessage(message.chat.id, progress.message_id, [
                "已共享书籍信息，但拉取 PO18 已购章节失败。",
                `书籍：${escapeHtml(shareBookTitle(stats.book))}`,
                `原因：${escapeHtml(stats.error || "未知错误")}`
            ].join("\n")).catch(() => {});
            return;
        }
        if (stats.status === "no_chapters") {
            await editMessage(message.chat.id, progress.message_id, [
                "已共享书籍信息，但本地没有正文缓存。",
                `书籍：${escapeHtml(shareBookTitle(stats.book))}`,
                "如果这是 PO18 已购书，请先 /po18set 账号 密码，再 /loginpo18 后重试。"
            ].join("\n")).catch(() => {});
            return;
        }
        if (stats.status === "cached") {
            await editMessage(message.chat.id, progress.message_id, `正文已是最新。\n共 ${stats.total} 章，跳过 ${stats.skipped} 章。`).catch(() => {});
            return;
        }

        await editMessage(message.chat.id, progress.message_id, [
            "正文上传完成。",
            `书籍：${escapeHtml(shareBookTitle(stats.book))}`,
            `新增 ${stats.uploaded} 章 / 可奖励付费新增 ${stats.rewardableUploaded || 0} 章`,
            `跳过 ${stats.skipped} 章 / 失败 ${stats.failed} 章`
        ].join("\n")).catch(() => {});
    }

    function bulkShareProgressText(summary, state = null) {
        const lines = [
            "<b>PO18 已购书架上传共享</b>",
            `进度：${summary.done}/${summary.total}`,
            `成功：${summary.successBooks} 本 / 奖励：${summary.rewardCopper} 铜币`,
            `新增：${summary.uploadedChapters} 章 / 可奖励付费新增：${summary.rewardableChapters} 章`,
            `跳过：${summary.skippedChapters} 章 / 失败章节：${summary.failedChapters} 章`,
            `失败书籍：${summary.failedBooks} 本`
        ];
        if (state?.book) {
            lines.push("", `当前：${escapeHtml(shareBookTitle(state.book))}（${escapeHtml(shareBookId(state.book))}）`);
            if (state.phase === "po18") lines.push("状态：正在用 PO18 登录态拉取已购章节");
            else if (state.phase === "cache") lines.push(`状态：检查共享缓存（共 ${state.total || 0} 章）`);
            else if (state.phase === "upload") lines.push(`状态：上传 ${state.current}/${state.uploadTotal}，本书已上传 ${state.uploaded} 章，可奖励 ${state.rewardableUploaded || 0} 章`);
            else lines.push("状态：准备书籍信息");
        }
        return lines.join("\n");
    }

    async function handleShareBookshelf(message) {
        await ensureRegistered(message.from);
        const account = await client.po18Account(message.from.id);
        if (!account.cookies?.length || !hasPo18Auth(account.cookies)) {
            return sendMessage(message.chat.id, "还没绑定 PO18 账号，先 /po18set 账号 密码，再 /loginpo18。");
        }
        const progress = await sendMessage(message.chat.id, `正在拉取你的 PO18 书架（账号：${escapeHtml(account.account || "?")}），准备上传共享...`);
        const books = await fetchPo18Bookshelf(account.cookies);
        if (!books.length) {
            await editMessage(message.chat.id, progress.message_id, "没拉到已购书籍。要么书架是空的，要么 Cookie 失效了。").catch(() => {});
            return { total: 0 };
        }

        for (const book of books) {
            await client.addBookshelf(message.from.id, book.book_id).catch(() => {});
        }

        const summary = {
            total: books.length,
            done: 0,
            successBooks: 0,
            failedBooks: 0,
            rewardedBooks: 0,
            rewardCopper: 0,
            uploadedChapters: 0,
            rewardableChapters: 0,
            skippedChapters: 0,
            failedChapters: 0
        };
        let lastEditAt = 0;
        const editProgress = async (state = null, force = false) => {
            const now = Date.now();
            if (!force && now - lastEditAt < 2500) return;
            lastEditAt = now;
            await editMessage(message.chat.id, progress.message_id, bulkShareProgressText(summary, state)).catch(() => {});
        };

        await editProgress(null, true);
        for (const book of books) {
            let stats;
            try {
                stats = await shareBookForUser(message, book, {
                    account,
                    onProgress: (state) => editProgress(state, false)
                });
            } catch (err) {
                stats = {
                    book: normalizeShareBook(book),
                    status: "failed",
                    error: err.message || String(err),
                    total: 0,
                    uploaded: 0,
                    rewardableUploaded: 0,
                    skipped: 0,
                    failed: 0
                };
            }

            summary.done += 1;
            summary.uploadedChapters += Number(stats.uploaded || 0);
            summary.rewardableChapters += Number(stats.rewardableUploaded || 0);
            summary.skippedChapters += Number(stats.skipped || 0);
            summary.failedChapters += Number(stats.failed || 0);
            if (Number(stats.uploaded || 0) > 0) summary.successBooks += 1;
            if (["failed", "metadata_failed", "chapter_fetch_failed", "no_chapters"].includes(stats.status)) summary.failedBooks += 1;

            if (Number(stats.rewardableUploaded || 0) > rewardMinChapters && rewardCopper > 0) {
                try {
                    await client.addCurrency(
                        message.from.id,
                        "copper",
                        rewardCopper,
                        "po18_bookshelf_share_reward",
                        `${shareBookId(stats.book)} paid_uploaded=${stats.rewardableUploaded} uploaded=${stats.uploaded} tgid=${message.from.id}`
                    );
                    summary.rewardedBooks += 1;
                    summary.rewardCopper += rewardCopper;
                } catch (err) {
                    logger.warn(`[share-bookshelf] reward failed ${shareBookId(stats.book)}: ${err.message || String(err)}`);
                }
            }
            await client.recordUserEvent(
                message.from.id,
                "po18_bookshelf_share",
                `${shareBookId(stats.book)} status=${stats.status} uploaded=${stats.uploaded || 0} paid_uploaded=${stats.rewardableUploaded || 0} skipped=${stats.skipped || 0} failed=${stats.failed || 0}`
            ).catch(() => {});
            await editProgress({ phase: "done", book: stats.book }, true);
        }

        await editMessage(message.chat.id, progress.message_id, [
            "<b>PO18 已购书架上传共享完成</b>",
            `处理：${summary.done}/${summary.total} 本`,
            `成功新增：${summary.successBooks} 本 / 失败：${summary.failedBooks} 本`,
            `新增章节：${summary.uploadedChapters} / 可奖励付费新增：${summary.rewardableChapters}`,
            `跳过：${summary.skippedChapters} / 失败章节：${summary.failedChapters}`,
            `奖励：${summary.rewardedBooks} 本，合计 ${summary.rewardCopper} 铜币`,
            `奖励规则：单本本次新增付费章节 > ${rewardMinChapters} 章奖励 ${rewardCopper} 铜币；免费章节和已有章节不计入。`
        ].join("\n")).catch(() => {});
        return summary;
    }

    return {
        handleShare,
        handleShareBookshelf,
        _internals: {
            explicitFreeChapter,
            explicitPaidChapter,
            rewardableShareChapter,
            normalizeShareBook,
            shareBookForUser
        }
    };
}

module.exports = { createShareHandlers };
