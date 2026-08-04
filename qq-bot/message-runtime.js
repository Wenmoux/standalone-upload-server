/**
 * [INPUT]: 依赖 PgBotClient、QQ API 发送器、共享搜索解析/平台语义、QQ 内容范围/实时缓存策略、EPUB 模板配置与卡片格式化器
 * [OUTPUT]: 对外提供 QQ 主面板/帮助/签到、紧凑结果键盘、详情、EPUB 模板库/自定义面板和带状态卡的 TXT/EPUB 下载交互
 * [POS]: qq-bot 的业务交互核心，以单行主动作和两列内容选择匹配 QQ 移动端密度，并在昂贵导出前拒绝零缓存书籍
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { createSearchPlatformRegistry } = require("../bot/search-platforms");
const { createSearchQueryParser, parseBookId } = require("../bot/search-query");
const { filterQqBooks } = require("../services/qq-bot-config");
const { normalizeEpubCustomConfig } = require("../bot/epub-style-picker");
const { CATEGORIES: EPUB_STUDIO_CATEGORIES, component, cycleStudioConfig } = require("../services/epub-component-library");
const {
    bookButtonLabel,
    cacheUnavailableText,
    clean,
    customStyleText,
    detailText,
    emptySearchText,
    errorText,
    exportStatusText,
    helpText,
    menuText,
    searchText,
    signText,
    styleText
} = require("./formatters");

function createQqMessageRuntime(options = {}) {
    const client = options.client;
    const api = options.api;
    const configProvider = options.configProvider;
    const exportRuntime = options.exportRuntime;
    const logger = options.logger || console;
    const searchLimit = Math.max(1, Math.min(10, Number(options.searchLimit || 5)));
    const sessionTtlMs = Math.max(60000, Number(options.sessionTtlMs || 30 * 60 * 1000));
    const sessions = new Map();
    const contexts = new Map();
    const seenMessages = new Map();
    const activeExports = new Set();
    const platformRegistry = createSearchPlatformRegistry();
    const { parseSearchQuery } = createSearchQueryParser({ searchLimit: 30, parsePlatformSuffix: platformRegistry.parsePlatformSuffix });

    function sessionKey(event) {
        return `${event.targetKey}:${event.userOpenId}`;
    }

    function getSession(event) {
        const key = sessionKey(event);
        const current = sessions.get(key);
        if (current && Date.now() - current.updatedAt < sessionTtlMs) return current;
        const next = {
            query: "",
            page: 1,
            rows: [],
            selectedBookId: "",
            pendingStyleBookId: "",
            pendingEpubConfig: null,
            updatedAt: Date.now()
        };
        sessions.set(key, next);
        return next;
    }

    function cleanup() {
        const cutoff = Date.now() - sessionTtlMs;
        for (const [key, value] of sessions) if (value.updatedAt < cutoff) sessions.delete(key);
        for (const [key, at] of seenMessages) if (at < cutoff) seenMessages.delete(key);
    }

    function contextFor(targetKey) {
        if (String(targetKey).startsWith("qq:")) return contexts.get(`user:${String(targetKey).slice(3)}`);
        return contexts.get(String(targetKey));
    }

    async function sendMarkdown(eventOrTarget, text, keyboard = []) {
        const event = typeof eventOrTarget === "object" ? eventOrTarget : contextFor(eventOrTarget);
        if (!event) throw new Error("QQ reply context expired");
        return api.sendMarkdown(event.target, text, event.reply, keyboard);
    }

    async function sendText(eventOrTarget, text) {
        const event = typeof eventOrTarget === "object" ? eventOrTarget : contextFor(eventOrTarget);
        if (!event) throw new Error("QQ reply context expired");
        const plain = clean(String(text || "").replace(/<br\s*\/?>/gi, "\n"));
        return api.sendText(event.target, plain, event.reply);
    }

    async function sendFile(targetKey, filePath) {
        const event = contextFor(targetKey);
        if (!event) throw new Error("QQ file reply context expired");
        return api.sendFile(event.target, filePath, event.reply);
    }

    async function accessBook(bookId) {
        try {
            return await client.qqBookAccess(bookId);
        } catch (err) {
            if ([403, 404].includes(err.status)) return err.data || { allowed: false, reason: "book_not_found" };
            throw err;
        }
    }

    function blockedMessage(access = {}) {
        if (access.reason === "book_not_found") return "没有找到这本书。";
        if (access.reason === "tag_blocked") return "这本书命中了 QQ Bot 的屏蔽标签，不能在这里查看或下载。";
        return "这本书不在 QQ Bot 当前允许的平台范围内。";
    }

    function hasCachedContent(book = {}) {
        return Number(book.cache_count || 0) > 0;
    }

    function chunkRows(buttons = [], size = 2) {
        const rows = [];
        for (let index = 0; index < buttons.length; index += size) rows.push(buttons.slice(index, index + size));
        return rows;
    }

    function searchAgainKeyboard() {
        return [
            [
                { label: "重新搜书", data: "搜索 ", enter: false, style: 1 },
                { label: "返回面板", data: "菜单", style: 0 }
            ]
        ];
    }

    function afterActionKeyboard() {
        return [
            [
                { label: "🔎 继续搜书", data: "搜索 ", enter: false, style: 1 },
                { label: "返回面板", data: "菜单", style: 0 }
            ]
        ];
    }

    function helpKeyboard() {
        return [
            [
                { label: "🔎 开始搜书", data: "搜索 ", enter: false, style: 1 },
                { label: "返回面板", data: "菜单", style: 0 }
            ]
        ];
    }

    function profileFor(event) {
        return {
            id: event.identity,
            username: `qq_${event.userOpenId.slice(-12)}`,
            first_name: clean(event.raw?.author?.username || event.raw?.author?.nickname || "QQ 用户")
        };
    }

    async function ensureUser(event) {
        return exportRuntime.ensureRegistered(profileFor(event));
    }

    async function showMenu(event) {
        const user = await ensureUser(event);
        return sendMarkdown(event, menuText(user), menuKeyboard());
    }

    async function showHelp(event) {
        return sendMarkdown(event, helpText(), helpKeyboard());
    }

    async function sign(event) {
        await ensureUser(event);
        try {
            const result = await client.sign(event.identity, "qq_bot");
            return sendMarkdown(event, signText(result), afterActionKeyboard());
        } catch (err) {
            if (err.status === 409) {
                return sendMarkdown(event, "# 📅 今日已签到\n\n今天的奖励已经领取，明天再来。", afterActionKeyboard());
            }
            throw err;
        }
    }

    async function search(event, rawQuery, page = 1) {
        const query = String(rawQuery || "").trim();
        if (!query) return showMenu(event);
        const config = await configProvider();
        const platformPayload = await client.searchPlatforms().catch(() => ({ platforms: [] }));
        platformRegistry.update(platformPayload);
        const parsed = parseSearchQuery(query);
        parsed.params.page = Math.max(1, page);
        parsed.params.limit = 30;
        parsed.params.cache_min = 1;
        if (!parsed.params.platform && config.allowedPlatforms?.length === 1) parsed.params.platform = config.allowedPlatforms[0];
        const data = await client.searchBooks(parsed.params);
        const rows = filterQqBooks(data.rows, config).slice(0, searchLimit);
        await client.recordSearch(parsed.keyword, `qq_${parsed.type}`, rows.length).catch(() => {});
        if (!rows.length) return sendMarkdown(event, emptySearchText(query), searchAgainKeyboard());
        const state = getSession(event);
        state.query = query;
        state.page = Number(data.page || page);
        state.rows = rows;
        state.selectedBookId = "";
        state.pendingStyleBookId = "";
        state.pendingEpubConfig = null;
        state.updatedAt = Date.now();
        const hasMore = !!data.has_more || state.page * Number(data.limit || 30) < Number(data.total || 0);
        const numberButtons = rows.map((book, index) => ({
            label: bookButtonLabel(book, index + 1),
            data: `选择 ${index + 1}`,
            style: 0
        }));
        const pagerButtons = [
            ...(state.page > 1 ? [{ label: "‹ 上一页", data: "上一页", style: 1 }] : []),
            ...(hasMore ? [{ label: "下一页 ›", data: "下一页", style: 1 }] : [])
        ];
        const keyboard = [...chunkRows(numberButtons, 2), ...(pagerButtons.length ? [pagerButtons] : [])];
        return sendMarkdown(event, searchText(query, rows, state.page, hasMore), keyboard);
    }

    function resolveBookId(event, value = "") {
        const state = getSession(event);
        const raw = String(value || "").trim();
        if (/^\d{1,2}$/.test(raw)) return String(state.rows[Number(raw) - 1]?.book_id || "");
        return parseBookId(raw) || state.selectedBookId || "";
    }

    async function showDetail(event, value = "") {
        const bookId = resolveBookId(event, value);
        if (!bookId) return sendText(event, "请先搜索并选择一本书，或发送：详情 书号");
        const access = await accessBook(bookId);
        if (!access.allowed) return sendText(event, blockedMessage(access));
        const state = getSession(event);
        state.selectedBookId = String(access.book.book_id || bookId);
        state.pendingStyleBookId = "";
        state.pendingEpubConfig = null;
        state.updatedAt = Date.now();
        const keyboard = hasCachedContent(access.book)
            ? [
                  [
                      { label: "下载 TXT", data: "TXT", style: 1 },
                      { label: "制作 EPUB", data: "EPUB", style: 1 },
                      { label: "继续搜书", data: "搜索 ", enter: false, style: 0 }
                  ]
              ]
            : searchAgainKeyboard();
        return sendMarkdown(event, detailText(access.book), keyboard);
    }

    function styleByInput(value = "") {
        const raw = String(value || "").trim().toLowerCase();
        if (!raw) return null;
        if (/^\d+$/.test(raw)) return exportRuntime.epubStyles[Number(raw) - 1] || null;
        return exportRuntime.epubStyles.find((item) => item.id.toLowerCase() === raw || String(item.label || "").toLowerCase() === raw) || null;
    }

    async function exportBook(event, format, value = "", styleInput = "", customConfig = null) {
        const state = getSession(event);
        const bookId = resolveBookId(event, value);
        if (!bookId) return sendText(event, "请先搜索并选择一本书，或在命令后填写书号。 ");
        const access = await accessBook(bookId);
        if (!access.allowed) return sendText(event, blockedMessage(access));
        if (!hasCachedContent(access.book)) {
            state.pendingStyleBookId = "";
            state.pendingEpubConfig = null;
            state.updatedAt = Date.now();
            return sendMarkdown(event, cacheUnavailableText(access.book), searchAgainKeyboard());
        }
        state.selectedBookId = String(access.book.book_id || bookId);
        if (format === "epub" && !styleInput) {
            const config = await configProvider();
            state.pendingStyleBookId = state.selectedBookId;
            state.pendingEpubConfig = normalizeEpubCustomConfig({ styleId: config.defaultEpubStyle || "style1" });
            state.updatedAt = Date.now();
            return sendMarkdown(
                event,
                styleText(exportRuntime.epubStyles, config.defaultEpubStyle, access.book),
                [
                    ...chunkRows(
                        exportRuntime.epubStyles.filter((style) => style.direct !== false).map((style, index) => ({
                            label: style.label || style.id,
                            data: `样式 ${index + 1}`,
                            style: style.id === config.defaultEpubStyle ? 1 : 0
                        })),
                        2
                    ),
                    [
                        { label: "基础自定义", data: "自定义EPUB", style: 0 },
                        { label: "模板工坊", data: "模板工坊", style: 1 }
                    ],
                    [{ label: "取消", data: "取消", style: 0 }]
                ]
            );
        }
        const style = format === "epub" ? styleByInput(styleInput) : null;
        if (format === "epub" && !style) return sendText(event, "EPUB 样式无效，请发送 EPUB 后按列表选择。 ");
        const key = sessionKey(event);
        if (activeExports.has(key)) return sendText(event, "已有一个导出任务正在处理，请等待完成。 ");
        activeExports.add(key);
        try {
            await exportRuntime.exportBook(event, state.selectedBookId, format, style?.id || "", customConfig);
        } catch (err) {
            logger.error?.(`[qq-bot] export failed: ${err.code || err.message || err}`);
            if (!err.userNotified) {
                await sendMarkdown(event, errorText(`导出失败：${err.message || "请稍后重试"}`), afterActionKeyboard()).catch(() => {});
            }
        } finally {
            activeExports.delete(key);
            state.pendingStyleBookId = "";
            state.pendingEpubConfig = null;
            state.updatedAt = Date.now();
        }
    }

    async function showCustomEpub(event, value = null) {
        const state = getSession(event);
        if (!state.pendingStyleBookId) return sendText(event, "请先选择一本书并进入 EPUB 模板库。 ");
        const config = normalizeEpubCustomConfig(value || state.pendingEpubConfig || { styleId: "style1" });
        state.pendingEpubConfig = config;
        state.updatedAt = Date.now();
        const style = exportRuntime.epubStyles.find((item) => item.id === config.styleId) || exportRuntime.epubStyles[0] || {};
        const toggles = [
            {
                label: `${config.includeColophon ? "✓" : "○"} 制作说明`,
                data: "切换制作说明",
                style: config.includeColophon ? 1 : 0
            }
        ];
        if (style.capabilities?.chapterArt === "optional") {
            toggles.push({
                label: `${config.showTopImage ? "✓" : "○"} 章头装饰`,
                data: "切换章头装饰",
                style: config.showTopImage ? 1 : 0
            });
        }
        const studioRows =
            config.styleId === "studio"
                ? EPUB_STUDIO_CATEGORIES.map((category) => [
                      {
                          label: `${{ chapter: "章题", volume: "分卷", intro: "简介", ornament: "装饰" }[category]}：${component(category, config.studio[category]).name}`,
                          data: `切换组件 ${category}`,
                          style: 0
                      }
                  ])
                : [];
        return sendMarkdown(event, customStyleText(exportRuntime.epubStyles, config, { book_id: state.pendingStyleBookId }), [
            ...chunkRows(
                exportRuntime.epubStyles.filter((item) => item.direct !== false).map((item, index) => ({
                    label: `${item.id === config.styleId ? "✓ " : ""}${item.label || item.id}`,
                    data: `底板 ${index + 1}`,
                    style: item.id === config.styleId ? 1 : 0
                })),
                2
            ),
            ...studioRows,
            toggles,
            [
                { label: "生成 EPUB", data: "确认生成EPUB", style: 1 },
                { label: "返回模板库", data: "EPUB", style: 0 }
            ]
        ]);
    }

    async function handle(event) {
        cleanup();
        if (seenMessages.has(event.messageId)) return;
        seenMessages.set(event.messageId, Date.now());
        contexts.set(event.targetKey, event);
        contexts.set(`user:${event.userOpenId}`, event);
        const state = getSession(event);
        let input = String(event.content || "").trim();
        if (!input) return showMenu(event);
        input = input.replace(/^\//, "").trim();
        if (/^(?:start|menu|菜单|功能)$/i.test(input)) return showMenu(event);
        if (/^(?:help|帮助|使用帮助)$/i.test(input)) return showHelp(event);
        if (/^(?:sign|签到|每日签到)$/i.test(input)) return sign(event);
        if (/^(?:取消|cancel)$/i.test(input)) {
            state.pendingStyleBookId = "";
            state.pendingEpubConfig = null;
            state.updatedAt = Date.now();
            return sendMarkdown(event, "# 已取消\n\n当前 EPUB 样式选择已关闭。", afterActionKeyboard());
        }
        if (/^(?:自定义epub|自定义生成)$/i.test(input) && state.pendingStyleBookId) return showCustomEpub(event);
        if (/^模板工坊$/i.test(input) && state.pendingStyleBookId) {
            return showCustomEpub(event, { ...state.pendingEpubConfig, styleId: "studio" });
        }
        const baseMatch = input.match(/^底板\s*(\d+)$/i);
        if (baseMatch && state.pendingStyleBookId && state.pendingEpubConfig) {
            const style = exportRuntime.epubStyles[Number(baseMatch[1]) - 1];
            if (!style) return sendText(event, "EPUB 底板无效，请重新选择。 ");
            return showCustomEpub(event, { ...state.pendingEpubConfig, styleId: style.id });
        }
        if (/^切换制作说明$/i.test(input) && state.pendingStyleBookId && state.pendingEpubConfig) {
            return showCustomEpub(event, {
                ...state.pendingEpubConfig,
                includeColophon: !state.pendingEpubConfig.includeColophon
            });
        }
        if (/^切换章头装饰$/i.test(input) && state.pendingStyleBookId && state.pendingEpubConfig) {
            return showCustomEpub(event, { ...state.pendingEpubConfig, showTopImage: !state.pendingEpubConfig.showTopImage });
        }
        const studioMatch = input.match(/^切换组件\s+(chapter|volume|intro|ornament)$/i);
        if (studioMatch && state.pendingStyleBookId && state.pendingEpubConfig?.styleId === "studio") {
            return showCustomEpub(event, {
                ...state.pendingEpubConfig,
                studio: cycleStudioConfig(state.pendingEpubConfig.studio, studioMatch[1].toLowerCase())
            });
        }
        if (/^确认生成epub$/i.test(input) && state.pendingStyleBookId && state.pendingEpubConfig) {
            return exportBook(
                event,
                "epub",
                state.pendingStyleBookId,
                state.pendingEpubConfig.styleId,
                state.pendingEpubConfig
            );
        }
        const styleMatch = input.match(/^(?:样式|style)\s*(\S+)$/i);
        if (styleMatch && state.pendingStyleBookId) return exportBook(event, "epub", state.pendingStyleBookId, styleMatch[1]);
        if (/^(?:下一页|next)$/i.test(input)) return state.query ? search(event, state.query, state.page + 1) : sendText(event, "请先搜索。 ");
        if (/^(?:上一页|prev|previous)$/i.test(input)) return state.query ? search(event, state.query, Math.max(1, state.page - 1)) : sendText(event, "请先搜索。 ");
        const searchMatch = input.match(/^(?:搜索|搜|search)\s+([\s\S]+)$/i);
        if (searchMatch) return search(event, searchMatch[1], 1);
        const detailMatch = input.match(/^(?:详情|选择|info)\s*(\S*)$/i);
        if (detailMatch) return showDetail(event, detailMatch[1]);
        const exportMatch = input.match(/^(txt|epub|下载txt|下载epub)\s*(\S*)?(?:\s+(\S+))?$/i);
        if (exportMatch) {
            const format = /epub/i.test(exportMatch[1]) ? "epub" : "txt";
            return exportBook(event, format, exportMatch[2] || "", exportMatch[3] || "");
        }
        if (/^\d{1,2}$/.test(input) && state.rows.length) return showDetail(event, input);
        return search(event, input, 1);
    }

    function menuKeyboard() {
        return [
            [
                { label: "搜书", data: "搜索 ", enter: false, style: 1 },
                { label: "签到", data: "签到", style: 1 },
                { label: "帮助", data: "帮助", style: 0 }
            ]
        ];
    }

    async function sendStatus(eventOrTarget, text) {
        const terminal = /导出完成|已私聊发送|失败|不足|已用完|无法|错误码/.test(String(text || ""));
        return sendMarkdown(eventOrTarget, exportStatusText(text), terminal ? afterActionKeyboard() : []);
    }

    return { handle, sendFile, sendMarkdown, sendStatus, sendText };
}

module.exports = { createQqMessageRuntime };
