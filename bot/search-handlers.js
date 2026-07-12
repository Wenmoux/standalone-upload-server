/**
 * [INPUT]: 依赖 Node 临时文件能力、word-cloud 渲染器、PgBotClient、查询解析器和 Telegram UI/发送适配器
 * [OUTPUT]: 对外提供搜索、热门、词云、随机推荐、详情卡片及缺书需求提交处理器
 * [POS]: bot 检索发现域的交互编排层，连接 server API 查询结果、分页会话与 Telegram 展示
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { renderWordCloudPngBuffer, renderWordCloudSvgBuffer } = require("./word-cloud");

function createSearchHandlers(options = {}) {
    const {
        client,
        searchLimit,
        defaultRecommendPlatform,
        parseSearchQuery,
        parsePlatformSuffix,
        platformLabel,
        rememberSearch,
        ensureRegistered,
        userDisplayName,
        escapeHtml,
        sendMessage,
        editMessage,
        sendDocument,
        sendPhoto,
        deliverLongGroupResult,
        bookListItem,
        listActions,
        searchPager,
        searchRequestActions,
        mergeKeyboards,
        detailCardText,
        bookActions
    } = options;

    async function sendBookCards(target, rows, title) {
        const message = typeof target === "object" ? target : null;
        const chatId = message ? message.chat.id : target;
        const text = [`<b>${escapeHtml(title)}</b>`, "", ...rows.map((book, index) => bookListItem(book, index + 1))].join("\n\n");
        if (message) return deliverLongGroupResult(message, text, { reply_markup: listActions(rows) }, { title });
        return sendMessage(chatId, text, { reply_markup: listActions(rows) });
    }

    async function handleSearch(message, rawQuery, page = 1, editTarget = null) {
        const query = rawQuery.trim();
        if (!query) return sendMessage(message.chat.id, "用法：/search 关键词 [-qd|-fq] 或 /search #标签 [-qd|-fq]");
        const { params, type, keyword, platform, cleanQuery } = parseSearchQuery(query);
        if (!keyword) return sendMessage(message.chat.id, "用法：/search 关键词 [-qd|-fq] 或 /search #标签 [-qd|-fq]");
        params.page = page;
        const data = await client.searchBooks(params);
        await client.recordSearch(keyword, type, data.total).catch(() => {});
        const label = platformLabel(platform);
        if (!data.rows.length) {
            const searchKey = rememberSearch(query);
            const text = [
                `没找到「${escapeHtml(cleanQuery || query)}」在 ${escapeHtml(label)} 的相关书。`,
                "可以提交到缺书需求列表，后台会统计后续补库优先级。"
            ].join("\n");
            const markup = searchRequestActions(searchKey);
            if (editTarget)
                return deliverLongGroupResult(message, text, { reply_markup: markup }, { title: `${label} 搜索无结果`, editTarget });
            return sendMessage(message.chat.id, text, { reply_markup: markup });
        }
        const visibleCount = (Number(data.page || page) - 1) * Number(data.limit || searchLimit) + data.rows.length;
        const totalText = data.total_is_estimated && data.has_more ? `${visibleCount}+` : data.total;
        const header = `${escapeHtml(label)} · 找到 ${totalText} 本，当前第 ${data.page} 页`;
        const searchKey = rememberSearch(query);
        const text = [
            `<b>${escapeHtml(query)}</b>`,
            header,
            "",
            ...data.rows.map((book, index) => bookListItem(book, (data.page - 1) * data.limit + index + 1))
        ].join("\n\n");
        const pager = searchPager(searchKey, data.page, data.total, data.limit);
        const actions = listActions(data.rows);
        return deliverLongGroupResult(
            message,
            text,
            { reply_markup: mergeKeyboards(actions, pager) },
            {
                title: `${label} 搜索结果`,
                ...(editTarget ? { editTarget } : {})
            }
        );
    }

    async function handleHot(message, args = "") {
        const { platform } = parsePlatformSuffix(args, { defaultPlatform: defaultRecommendPlatform });
        const data = await client.searchBooks({ page: 1, limit: searchLimit, sort: "popularity_desc", platform, cache_min: 1, fast: 1 });
        const keywords = await client.hotKeywords(8).catch(() => ({ rows: [] }));
        const title = keywords.rows?.length
            ? `${platformLabel(platform)} 热门排行\n热搜：${keywords.rows.map((row) => `${row.keyword}(${row.count})`).join(" / ")}`
            : `${platformLabel(platform)} 热门排行`;
        await sendBookCards(message, data.rows, title);
    }

    function parseWordCloudArgs(args = "") {
        const parsed = parsePlatformSuffix(args, { defaultPlatform: "" });
        const limitMatch = parsed.query.match(/\b(\d{1,3})\b/);
        const limit = limitMatch ? Math.max(20, Math.min(100, Number(limitMatch[1]))) : 60;
        const sourceLimitMatch = parsed.query.match(/(?:source|books|书)[=:：]?(\d{2,4})/i);
        const sourceLimit = sourceLimitMatch ? Math.max(50, Math.min(2000, Number(sourceLimitMatch[1]))) : 300;
        return { platform: parsed.platform, limit, sourceLimit };
    }

    async function sendWordCloudResult(chatId, rows, renderOptions, caption) {
        const svg = renderWordCloudSvgBuffer(rows, renderOptions);
        try {
            const png = renderWordCloudPngBuffer(rows, renderOptions);
            return await sendPhoto(chatId, png, "po18-word-cloud.png", caption);
        } catch {
            const dir = await fs.mkdtemp(path.join(os.tmpdir(), "po18-wordcloud-"));
            const filePath = path.join(dir, "po18-word-cloud.svg");
            try {
                await fs.writeFile(filePath, svg);
                return await sendDocument(chatId, filePath, caption);
            } finally {
                await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
            }
        }
    }

    async function handleWordCloud(message, args = "") {
        const { platform, limit, sourceLimit } = parseWordCloudArgs(args);
        const label = platformLabel(platform);
        const progress = await sendMessage(message.chat.id, `正在生成 ${escapeHtml(label)} 热搜词云...`);
        const payload = await client.wordCloud({ limit, sourceLimit, platform });
        const rows = payload.rows || [];
        if (!rows.length) {
            return editMessage(message.chat.id, progress.message_id, "暂无热搜词或热门标签，先搜索几次或等榜单数据积累后再试。").catch(
                () => {}
            );
        }
        const topWords = rows
            .slice(0, 8)
            .map((row) => row.text)
            .join(" / ");
        const renderOptions = {
            title: `${label} 热搜词云`,
            subtitle: `热搜词 + 热门书籍标签 · ${rows.length} 个关键词`,
            generatedAt: new Date(payload.generated_at || Date.now()).toLocaleString("zh-CN", { hour12: false })
        };
        await sendWordCloudResult(
            message.chat.id,
            rows,
            renderOptions,
            [
                `${label} 热搜词云`,
                `Top：${topWords}`,
                `来源：热搜词 ${payload.sources?.hot_keywords || 0}，标签 ${payload.sources?.tags || 0}`
            ].join("\n")
        );
        await editMessage(message.chat.id, progress.message_id, "词云已生成。").catch(() => {});
    }

    async function handleRandom(message, args = "") {
        const { platform } = parsePlatformSuffix(args, { defaultPlatform: defaultRecommendPlatform });
        const page = Math.max(1, Math.floor(Math.random() * 30) + 1);
        const data = await client.searchBooks({ page, limit: searchLimit, sort: "updated_desc", platform, cache_min: 1, fast: 1 });
        if (!data.rows.length) return sendMessage(message.chat.id, "暂时没有可推荐的书。");
        await sendBookCards(message, data.rows, `${platformLabel(platform)} 随机推荐`);
    }

    async function handleInfo(message, bookId, editTarget = null) {
        const id = bookId.trim();
        if (!id) return sendMessage(message.chat.id, "用法：/info 书号");
        const [{ book }, chapters, reviews] = await Promise.all([
            client.getBook(id),
            client.getChapters(id),
            client.listBookReviews(id, message.from?.id || "", 3).catch(() => null)
        ]);
        const text = detailCardText(book, chapters.rows || [], reviews);
        const markup = bookActions(book.book_id, book.detail_url);
        return deliverLongGroupResult(
            message,
            text,
            { reply_markup: markup },
            { title: "书籍详情", ...(editTarget ? { editTarget } : {}) }
        );
    }

    async function handleSearchRequestSubmit(message, rawQuery) {
        const query = String(rawQuery || "").trim();
        if (!query) return "提交已过期，请重新搜索后再点提交。";
        const { type, keyword, platform, cleanQuery } = parseSearchQuery(query);
        if (!keyword) return "搜索词无效，请重新搜索后再提交。";
        await ensureRegistered(message.from);
        const result = await client.submitSearchRequest(message.from.id, {
            query,
            clean_query: cleanQuery || keyword || query,
            type,
            platform: platform || "",
            result_count: 0,
            source: "bot_search_no_result",
            telegram_username: message.from.username || "",
            nickname: userDisplayName(message.from)
        });
        return result.already_exists ? "这个搜索需求你已经提交过了。" : "已提交到缺书需求列表。";
    }

    return {
        handleHot,
        handleInfo,
        handleRandom,
        handleSearch,
        handleSearchRequestSubmit,
        handleWordCloud,
        parseWordCloudArgs,
        sendBookCards,
        sendWordCloudResult
    };
}

module.exports = { createSearchHandlers };
