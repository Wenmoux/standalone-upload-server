/**
 * [INPUT]: 依赖命令注册表的已配置命令快照、进程内时间源及 Telegram 会话身份
 * [OUTPUT]: 对外提供有界搜索查询缓存、短期书评草稿状态与按命令分组生成的帮助文本
 * [POS]: bot 会话辅助层，在 Telegram 回调长度约束下保存短期交互上下文并投影命令元数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function createSearchCache(options = {}) {
    const maxSize = Math.max(1, Math.trunc(Number(options.maxSize || 200)));
    const cache = new Map();
    let seq = 0;

    function remember(query) {
        const key = String(++seq);
        cache.set(key, String(query || ""));
        while (cache.size > maxSize) {
            const first = cache.keys().next().value;
            cache.delete(first);
        }
        return key;
    }

    return {
        get: (key) => cache.get(String(key || "")),
        remember,
        size: () => cache.size
    };
}

function createReviewDraftStore(options = {}) {
    const maxSize = Math.max(1, Math.trunc(Number(options.maxSize || 1000)));
    const ttlMs = Math.max(1000, Math.trunc(Number(options.ttlMs || 10 * 60 * 1000)));
    const defaultMinLength = Math.max(1, Math.trunc(Number(options.minLength || 6)));
    const defaultMaxLength = Math.max(defaultMinLength, Math.trunc(Number(options.maxLength || 1200)));
    const now = typeof options.now === "function" ? options.now : Date.now;
    const drafts = new Map();

    function keyOf(chatId, userId) {
        return `${String(chatId || "")}:${String(userId || "")}`;
    }

    function prune() {
        const cutoff = now() - ttlMs;
        for (const [key, draft] of drafts) {
            if (draft.createdAt <= cutoff) drafts.delete(key);
        }
        while (drafts.size > maxSize) {
            drafts.delete(drafts.keys().next().value);
        }
    }

    function get({ chatId, userId } = {}) {
        prune();
        return drafts.get(keyOf(chatId, userId)) || null;
    }

    function begin({ chatId, userId, bookId, promptMessageId = "", rules = {} } = {}) {
        prune();
        const key = keyOf(chatId, userId);
        const minLength = Math.max(1, Math.trunc(Number(rules.min_length || defaultMinLength)));
        const maxLength = Math.max(minLength, Math.trunc(Number(rules.max_length || defaultMaxLength)));
        const draft = {
            chatId: String(chatId || ""),
            userId: String(userId || ""),
            bookId: String(bookId || ""),
            promptMessageId: String(promptMessageId || ""),
            minLength,
            maxLength,
            createdAt: now()
        };
        drafts.delete(key);
        drafts.set(key, draft);
        prune();
        return draft;
    }

    function validate({ chatId, userId, content } = {}) {
        const draft = get({ chatId, userId });
        if (!draft) return { handled: false, status: "missing" };
        const text = String(content || "").trim();
        const length = Array.from(text).length;
        if (length < draft.minLength) {
            return { handled: true, status: "too_short", draft, content: text, length };
        }
        if (length > draft.maxLength) {
            return { handled: true, status: "too_long", draft, content: text, length };
        }
        return { handled: true, status: "ready", draft, content: text, length };
    }

    function remove({ chatId, userId, bookId = "" } = {}) {
        const key = keyOf(chatId, userId);
        const draft = get({ chatId, userId });
        if (!draft || (bookId && draft.bookId !== String(bookId))) return false;
        drafts.delete(key);
        return true;
    }

    return {
        begin,
        cancel: remove,
        complete: remove,
        get,
        size: () => {
            prune();
            return drafts.size;
        },
        validate
    };
}

function helpLinesFromCommands(registry, escapeHtml = (value) => String(value ?? "")) {
    const grouped = new Map();
    for (const command of registry.configuredCommands()) {
        if (!command.enabled) continue;
        if (!grouped.has(command.group)) grouped.set(command.group, []);
        const line = command.help || command.command;
        if (!grouped.get(command.group).includes(line)) grouped.get(command.group).push(line);
    }
    const order = ["搜书", "账户", "导出", "群互动", "PO18 / PikPak", "其它"];
    const lines = [];
    for (const group of order) {
        const rows = grouped.get(group);
        if (!rows || !rows.length) continue;
        lines.push("", `<b>${escapeHtml(group)}</b>`, ...rows.map(escapeHtml));
        if (group === "导出") lines.push("大书会进入后台队列，群里不会卡住其它消息。");
    }
    return lines;
}

module.exports = { createReviewDraftStore, createSearchCache, helpLinesFromCommands };
