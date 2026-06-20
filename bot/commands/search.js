function registerSearchCommands(registry, handlers = {}) {
    const {
        withSearchCooldown,
        withInfoCooldown,
        handleSearch,
        handleHot,
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
