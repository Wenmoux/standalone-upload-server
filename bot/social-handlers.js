function createSocialHandlers(options = {}) {
    const {
        client,
        crowdVoteCost,
        ensureRegistered,
        handleInfo,
        parseBookId,
        sendBookCards,
        sendMessage,
        editMessage,
        deliverLongGroupResult,
        escapeHtml,
        bookActions,
        crowdCardText,
        crowdActions,
        bookReviewsText,
        bookReviewsActions,
        reviewChannelText,
        reviewVoteActions
    } = options;

    async function handleFeedback(message, bookId, feedback, source = "info", editTarget = null) {
        const id = String(bookId || "").trim();
        if (!id) return sendMessage(message.chat.id, "缺少书号");
        await ensureRegistered(message.from);
        const result = await client.feedback(message.from.id, id, feedback, source);
        const isLike = result.feedback === "like";
        const text = result.already_exists
            ? `这本你已经点过${isLike ? "喜欢" : "不喜欢"}了。`
            : isLike
              ? "记住了，以后往这个方向多推。"
              : "记下了，以后少推这类。";
        if (editTarget) {
            await handleInfo(message, id, editTarget).catch(() => {});
            return text;
        }
        return sendMessage(
            message.chat.id,
            [text, `喜欢 ${result.counts?.like_count || 0} · 不喜欢 ${result.counts?.dislike_count || 0}`].join("\n"),
            { reply_markup: bookActions(id) }
        );
    }

    async function handleCrowd(message, rawBook = "", editTarget = null) {
        await ensureRegistered(message.from);
        const bookId = parseBookId(rawBook);
        if (!bookId) {
            const data = await client.crowdLeaderboard(message.from.id, 10);
            const stats = data.stats || {};
            const text = [
                "<b>众筹榜</b>",
                "",
                "用法：/crowd 书籍链接 或 /crowd 书号",
                `每次支持消耗 ${crowdVoteCost} 银币。`,
                "",
                "<b>当前排行榜</b>",
                ...(data.leaderboard || []).map(
                    (row) => `${row.rank || "-"} · ${escapeHtml(row.title || row.book_id)} · ${Number(row.supporter_count || 0)} 人`
                ),
                ...(data.leaderboard?.length ? [] : ["暂无投票记录"]),
                "",
                `总计：${Number(stats.total_books || 0)} 本书 · ${Number(stats.total_votes || 0)} 次支持 · ${Number(stats.total_silver || 0)} 银币`
            ].join("\n");
            return deliverLongGroupResult(message, text, {}, { title: "众筹榜", ...(editTarget ? { editTarget } : {}) });
        }
        const result = await client.crowdBook(bookId, message.from.id, 10);
        const text = crowdCardText(result, result.book?.supported_by_me);
        const markup = crowdActions(result.book?.book_id || bookId, result.book?.detail_url || "");
        return deliverLongGroupResult(
            message,
            text,
            { reply_markup: markup },
            { title: "众筹详情", ...(editTarget ? { editTarget } : {}) }
        );
    }

    async function handleCrowdVote(message, bookId, editTarget = null) {
        const id = parseBookId(bookId);
        if (!id) return sendMessage(message.chat.id, "缺少书号");
        await ensureRegistered(message.from);
        const result = await client.crowdVote(id, message.from.id, crowdVoteCost);
        const text = crowdCardText(result, true);
        const markup = crowdActions(result.book?.book_id || id, result.book?.detail_url || "");
        if (editTarget) {
            await editMessage(editTarget.chatId, editTarget.messageId, text, { reply_markup: markup }).catch(() => {});
            return result.already_exists ? "你已支持过这本书" : `支持成功，消耗 ${result.vote_cost || crowdVoteCost} 银币`;
        }
        return deliverLongGroupResult(message, text, { reply_markup: markup }, { title: "众筹详情" });
    }

    function parseReviewArgs(args = "") {
        const text = String(args || "").trim();
        if (!text) return { bookId: "", content: "" };
        const first = text.split(/\s+/)[0] || "";
        const bookId = parseBookId(first);
        if (!bookId) return { bookId: "", content: "" };
        return { bookId, content: text.slice(first.length).trim() };
    }

    async function handleReviews(message, rawBook = "", editTarget = null) {
        await ensureRegistered(message.from);
        const bookId = parseBookId(rawBook);
        if (!bookId) return sendMessage(message.chat.id, "用法：/reviews 书号");
        const payload = await client.listBookReviews(bookId, message.from.id, 5);
        const text = bookReviewsText(bookId, payload);
        const markup = bookReviewsActions(bookId);
        return deliverLongGroupResult(message, text, { reply_markup: markup }, { title: "书评", ...(editTarget ? { editTarget } : {}) });
    }

    async function handleReview(message, args = "") {
        const { bookId, content } = parseReviewArgs(args);
        if (!bookId || !content) return sendMessage(message.chat.id, "用法：/review 书号 内容");
        await ensureRegistered(message.from);
        const result = await client.publishBookReview(bookId, message.from.id, content);
        const channelText = result.channel?.sent
            ? "频道：已推送"
            : result.channel?.skipped
              ? `频道：未推送（${escapeHtml(result.channel.skipped)}）`
              : result.channel?.error
                ? `频道：推送失败（${escapeHtml(result.channel.error)}）`
                : "频道：未推送";
        return sendMessage(
            message.chat.id,
            [
                "书评已发布。",
                `书号：<code>${escapeHtml(bookId)}</code>`,
                `消耗：${Number(result.cost || 0)} 铜`,
                `当前铜币：${Number(result.user?.copper_coins || 0)}`,
                channelText,
                "",
                "赞会给你 +100 铜，踩会扣 1 铜；同一用户重复点击不会重复结算。"
            ].join("\n"),
            { reply_markup: bookReviewsActions(bookId) }
        );
    }

    async function handleReviewVote(message, reviewId, vote, editTarget = null) {
        await ensureRegistered(message.from);
        const result = await client.voteBookReview(reviewId, message.from.id, vote);
        if (editTarget && result.review) {
            await editMessage(editTarget.chatId, editTarget.messageId, reviewChannelText(result.review), {
                reply_markup: reviewVoteActions(result.review)
            }).catch(() => {});
        }
        if (result.already_exists) return vote === "like" ? "你已经赞过了" : "你已经踩过了";
        if (Number(result.reward_delta || 0) > 0) return `已赞，作者 +${result.reward_delta} 铜`;
        if (Number(result.reward_delta || 0) < 0) return `已踩，作者 ${result.reward_delta} 铜`;
        return "已更新";
    }

    async function handleMyFav(message) {
        await ensureRegistered(message.from);
        const data = await client.listBookshelf(message.from.id);
        if (!data.rows.length) return sendMessage(message.chat.id, "你的书架还没有书。");
        await sendBookCards(message, data.rows.slice(0, 20), `我的收藏：${data.rows.length} 本`);
    }

    return {
        handleCrowd,
        handleCrowdVote,
        handleFeedback,
        handleMyFav,
        handleReview,
        handleReviews,
        handleReviewVote,
        parseReviewArgs
    };
}

module.exports = { createSocialHandlers };
