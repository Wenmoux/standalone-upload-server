/**
 * [INPUT]: 依赖书籍查询、Telegram 推送配置/API、书评状态写入与系统推送不可见标记
 * [OUTPUT]: 对外提供最新书籍元信息读取、书评频道文案/按钮构造和发布状态机
 * [POS]: services 的书评外发适配层，连接 book-social 事实与 Telegram 频道但不持有 HTTP 路由状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function truncateTelegramText(value = "", max = 900) {
    const text = String(value || "");
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function createLatestBookMetadataLookup(query) {
    return async function latestBookMetadata(bookId) {
        if (!bookId) return null;
        const result = await query(
            `SELECT book_id, title, author, cover, category, tags, status, description, description_html, detail_url, platform
             FROM book_metadata
             WHERE book_id = $1
             ORDER BY COALESCE(subscribed_chapters, 0) DESC, COALESCE(updated_at, created_at) DESC, id DESC
             LIMIT 1`,
            [String(bookId)]
        );
        return result.rows[0] || null;
    };
}

function createBookReviewChannelService(options = {}) {
    const latestBookMetadata = options.latestBookMetadata || createLatestBookMetadataLookup(options.query);
    const telegramPushConfig = options.telegramPushConfig;
    const telegramLoginBotToken = options.telegramLoginBotToken;
    const configGet = options.configGet;
    const updateBookReviewChannelMessage = options.updateBookReviewChannelMessage;
    const postJson = options.postJson;
    const telegramApiUrl = options.telegramApiUrl;
    const telegramHtml = options.telegramHtml;
    const markTelegramSystemPush = options.markTelegramSystemPush || ((value) => value);

    function bookReviewChannelText(review = {}, book = {}) {
        const title = book.title || review.book_title || review.book_id || "";
        const author = book.author || review.book_author || "";
        const reviewer = review.author_telegram_username
            ? `@${review.author_telegram_username}`
            : review.author_nickname || review.nickname || "reader";
        const lines = [
            "<b>新书评</b>",
            "",
            `<b>${telegramHtml(title)}</b>`,
            author ? `作者：${telegramHtml(author)}` : "",
            `书号：<code>${telegramHtml(review.book_id || book.book_id || "")}</code>`,
            `发布者：${telegramHtml(reviewer)}`,
            "",
            telegramHtml(truncateTelegramText(review.content || "", 900)),
            "",
            `赞 ${Number(review.like_count || 0)} · 踩 ${Number(review.dislike_count || 0)}`
        ];
        return lines.filter(Boolean).join("\n");
    }

    function bookReviewChannelMarkup(review = {}) {
        const id = String(review.id || "");
        const bookId = String(review.book_id || "");
        const rows = [
            [
                { text: "赞 +100铜", callback_data: `rvup|${id}`.slice(0, 64) },
                { text: "踩 -1铜", callback_data: `rvdn|${id}`.slice(0, 64) }
            ]
        ];
        if (bookId) rows.push([{ text: "书籍详情", callback_data: `info|${bookId}`.slice(0, 64) }]);
        return { inline_keyboard: rows };
    }

    async function writeChannelStatus(reviewId, patch) {
        await updateBookReviewChannelMessage(reviewId, patch).catch(() => {});
    }

    async function pushBookReviewToChannel({ review, book } = {}) {
        if (!review?.id) return { skipped: "missing_review" };
        const [pushConfig, token, chatId] = await Promise.all([
            telegramPushConfig(),
            telegramLoginBotToken(),
            configGet("telegram_chat_id")
        ]);
        if (!pushConfig.enabled || !pushConfig.pushTypes.includes("review")) {
            await writeChannelStatus(review.id, { status: "skipped", error: "review push disabled" });
            return { skipped: "review_push_disabled" };
        }
        if (!token || !chatId) {
            await writeChannelStatus(review.id, { status: "skipped", error: "missing telegram_bot_token or telegram_chat_id" });
            return { skipped: "missing_channel_config" };
        }
        try {
            const raw = await postJson(telegramApiUrl(token, "sendMessage"), {
                chat_id: chatId,
                text: markTelegramSystemPush(bookReviewChannelText(review, book)),
                parse_mode: "HTML",
                disable_web_page_preview: true,
                reply_markup: bookReviewChannelMarkup(review)
            });
            const parsed = JSON.parse(raw || "{}");
            const messageId = parsed?.result?.message_id ? String(parsed.result.message_id) : "";
            await writeChannelStatus(review.id, {
                channel_chat_id: String(chatId),
                channel_message_id: messageId,
                status: "sent",
                error: ""
            });
            return { sent: true, chat_id: String(chatId), message_id: messageId };
        } catch (err) {
            await writeChannelStatus(review.id, {
                status: "failed",
                error: String(err.message || err).slice(0, 500)
            });
            throw err;
        }
    }

    return {
        bookReviewChannelMarkup,
        bookReviewChannelText,
        latestBookMetadata,
        pushBookReviewToChannel
    };
}

module.exports = {
    createBookReviewChannelService,
    createLatestBookMetadataLookup,
    truncateTelegramText
};
