/**
 * [INPUT]: 依赖 command-registry 与搜索、热门、词云、随机推荐、详情处理器及其冷却包装器
 * [OUTPUT]: 对外提供检索发现域 Telegram 命令的集中注册函数
 * [POS]: bot/commands 的搜索命令装配器，统一声明用户命令、别名与领域处理入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function registerSearchCommands(registry, handlers = {}) {
    const {
        withSearchCooldown,
        withInfoCooldown,
        handleSearch,
        handleHot,
        handleWordCloud,
        handleRandom,
        handleInfo
    } = handlers;

    registry.register({
        command: "/search",
        description: "搜索书籍",
        action: "search",
        handler: ({ message, args }) => withSearchCooldown(message, "搜索", () => handleSearch(message, args))
    });
    registry.register({
        command: "/hot",
        description: "热门书籍",
        action: "hot",
        handler: ({ message, args }) => withSearchCooldown(message, "热门", () => handleHot(message, args))
    });
    registry.register({
        command: "/wordcloud",
        aliases: ["/cloud"],
        description: "热搜词云",
        action: "wordcloud",
        handler: ({ message, args }) => withSearchCooldown(message, "词云", () => handleWordCloud(message, args))
    });
    registry.register({
        command: "/random",
        description: "随机推荐",
        action: "random",
        handler: ({ message, args }) => withSearchCooldown(message, "随机推荐", () => handleRandom(message, args))
    });
    registry.register({
        command: "/info",
        description: "书籍详情",
        action: "info",
        handler: ({ message, args }) => withInfoCooldown(message, "详情", () => handleInfo(message, args))
    });
}

module.exports = { registerSearchCommands };
