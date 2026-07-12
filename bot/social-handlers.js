/**
 * [INPUT]: 依赖 PgBotClient、注册守卫、短期书评草稿、书籍/众筹/书评 UI 构造器和 Telegram 消息编辑/删除接口
 * [OUTPUT]: 对外提供收藏、反馈、红包、众筹、可退出回复态的引导式书评发布、投票、举报与申诉交互处理器
 * [POS]: bot 社交治理域的交互编排层，把群聊定向回复和私聊普通输入映射为服务端受审计的领域 API 调用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
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
        deleteMessage = async () => {},
        deliverLongGroupResult,
        escapeHtml,
        bookActions,
        crowdCardText,
        crowdActions,
        bookReviewsText,
        bookReviewsActions,
        reviewChannelText,
        reviewDrafts,
        reviewPromptActions,
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

    async function publishReview(message, bookId, content) {
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

    async function handleReviewStart(message, rawBook = "") {
        const bookId = parseBookId(rawBook);
        if (!bookId) return sendMessage(message.chat.id, "缺少书号，请从书籍详情点“写书评”。");
        await ensureRegistered(message.from);
        const payload = await client.listBookReviews(bookId, message.from.id, 1);
        const rules = payload.rules || {};
        const book = payload.book || {};
        const title = book.title || book.book_title || bookId;
        const identity = { chatId: message.chat.id, userId: message.from.id };
        const previous = reviewDrafts.get(identity);
        if (previous) {
            reviewDrafts.cancel(identity);
            if (previous.promptMessageId) await deleteMessage(previous.chatId, previous.promptMessageId).catch(() => {});
        }
        const grouped = message.chat.type === "group" || message.chat.type === "supergroup";
        try {
            const prompt = await sendMessage(
                message.chat.id,
                [
                    `<b>写书评 · ${escapeHtml(title)}</b>`,
                    `书号：<code>${escapeHtml(bookId)}</code>`,
                    `${grouped ? "请回复这条消息" : "请直接发送"}书评内容（${Number(rules.min_length || 6)}-${Number(rules.max_length || 1200)} 字）。`,
                    `发布将消耗 ${Number(rules.cost_copper ?? 100)} 铜币。`,
                    "回复“取消”也可退出。"
                ].join("\n"),
                grouped ? {
                    reply_markup: {
                        force_reply: true,
                        selective: true,
                        input_field_placeholder: "输入书评内容"
                    }
                } : {}
            );
            reviewDrafts.begin({
                chatId: message.chat.id,
                userId: message.from.id,
                bookId,
                promptMessageId: prompt?.message_id,
                rules
            });
            await sendMessage(message.chat.id, "不想发布时，可点下方取消。", {
                reply_markup: reviewPromptActions(bookId),
                reply_to_message_id: prompt?.message_id
            }).catch(() => {});
            return prompt;
        } catch (err) {
            reviewDrafts.cancel({ chatId: message.chat.id, userId: message.from.id, bookId });
            throw err;
        }
    }

    function reviewDraftContext(message, content = "") {
        const draft = reviewDrafts.get({ chatId: message.chat.id, userId: message.from.id });
        if (!draft) return null;
        const text = String(content || "").trim();
        if (/^\/cancel(?:@\w+)?$/i.test(text)) return draft;
        if (text.startsWith("/")) return null;
        const grouped = message.chat.type === "group" || message.chat.type === "supergroup";
        if (grouped && String(message.reply_to_message?.message_id || "") !== draft.promptMessageId) return null;
        return draft;
    }

    async function handleReviewDraft(message, content = "") {
        const identity = { chatId: message.chat.id, userId: message.from.id };
        const text = String(content || "").trim();
        if (/^(?:取消|\/cancel(?:@\w+)?)$/i.test(text)) {
            const draft = reviewDrafts.get(identity);
            if (!reviewDrafts.cancel(identity)) return false;
            if (draft?.promptMessageId) await deleteMessage(draft.chatId, draft.promptMessageId).catch(() => {});
            await sendMessage(message.chat.id, "已取消发布书评。");
            return true;
        }
        const checked = reviewDrafts.validate({ ...identity, content: text });
        if (!checked.handled) return false;
        if (checked.status !== "ready") {
            const problem =
                checked.status === "too_short"
                    ? `内容太短，至少需要 ${checked.draft.minLength} 字（当前 ${checked.length} 字）。`
                    : `内容太长，最多允许 ${checked.draft.maxLength} 字（当前 ${checked.length} 字）。`;
            const grouped = message.chat.type === "group" || message.chat.type === "supergroup";
            const prompt = await sendMessage(
                message.chat.id,
                `${problem}\n${grouped ? "请回复这条消息" : "请直接"}重新发送，或发送“取消”退出。`,
                grouped ? {
                    reply_markup: {
                        force_reply: true,
                        selective: true,
                        input_field_placeholder: "重新输入书评内容"
                    }
                } : {}
            );
            reviewDrafts.begin({
                ...identity,
                bookId: checked.draft.bookId,
                promptMessageId: prompt?.message_id,
                rules: { min_length: checked.draft.minLength, max_length: checked.draft.maxLength }
            });
            return true;
        }
        try {
            await publishReview(message, checked.draft.bookId, checked.content);
        } catch (err) {
            err.message = `书评发布失败，草稿已保留；请回复原提示重试，或点“取消发布”。原因：${err.message || String(err)}`;
            throw err;
        }
        reviewDrafts.complete({ ...identity, bookId: checked.draft.bookId });
        return true;
    }

    async function handleReviewCancel(message, rawBook = "", editTarget = null) {
        const bookId = parseBookId(rawBook);
        const identity = { chatId: message.chat.id, userId: message.from.id, bookId };
        const draft = reviewDrafts.get(identity);
        const canceled = reviewDrafts.cancel(identity);
        if (canceled && draft?.promptMessageId) await deleteMessage(draft.chatId, draft.promptMessageId).catch(() => {});
        if (editTarget) {
            await editMessage(editTarget.chatId, editTarget.messageId, canceled ? "已取消发布书评。" : "这次书评输入已结束或过期。").catch(
                () => {}
            );
        }
        return canceled ? "已取消" : "没有待发布的书评";
    }

    async function handleReview(message, args = "") {
        const { bookId, content } = parseReviewArgs(args);
        if (!bookId) return sendMessage(message.chat.id, "用法：/review 书号 [内容]");
        if (!content) return handleReviewStart(message, bookId);
        const identity = { chatId: message.chat.id, userId: message.from.id };
        const draft = reviewDrafts.get(identity);
        reviewDrafts.cancel(identity);
        if (draft?.promptMessageId) await deleteMessage(draft.chatId, draft.promptMessageId).catch(() => {});
        return publishReview(message, bookId, content);
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

    async function handleReportReview(message, args = "") {
        const [reviewId = "", reason = "", ...details] = String(args || "")
            .trim()
            .split(/\s+/);
        if (!/^\d+$/.test(reviewId) || !["spam", "abuse", "spoiler", "illegal", "other"].includes(reason)) {
            return sendMessage(message.chat.id, "用法：/reportreview 书评号 原因 说明\n原因：spam / abuse / spoiler / illegal / other");
        }
        await ensureRegistered(message.from);
        const result = await client.reportBookReview(reviewId, message.from.id, reason, details.join(" "));
        return sendMessage(
            message.chat.id,
            `举报已提交。当前有效举报 ${Number(result.report_count || 0)} 条，书评状态：${escapeHtml(result.review_status || "published")}。`
        );
    }

    async function handleAppealReview(message, args = "") {
        const [reviewId = "", ...content] = String(args || "")
            .trim()
            .split(/\s+/);
        const text = content.join(" ").trim();
        if (!/^\d+$/.test(reviewId) || Array.from(text).length < 6) {
            return sendMessage(message.chat.id, "用法：/appealreview 书评号 申诉说明（至少 6 字）");
        }
        await ensureRegistered(message.from);
        const result = await client.appealBookReview(reviewId, message.from.id, text);
        return sendMessage(message.chat.id, `申诉已提交，记录号 #${result.appeal?.id || "-"}，请等待管理员审核。`);
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
        handleReviewCancel,
        handleReviewDraft,
        handleReviewStart,
        handleReviews,
        handleReviewVote,
        handleReportReview,
        handleAppealReview,
        parseReviewArgs,
        reviewDraftContext
    };
}

module.exports = { createSocialHandlers };
