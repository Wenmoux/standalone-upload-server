function registerIntegrationCommands(registry, handlers = {}) {
    const {
        withPikpakCooldown,
        withBookshelfCooldown,
        handlePikpak,
        handlePo18Set,
        handleLoginPo18,
        handlePo18Code,
        handlePo18Status,
        handlePo18Logout,
        scheduleMyBookshelf
    } = handlers;

    registry.register({
        command: "/pikpak",
        aliases: ["/pp"],
        description: "PikPak 文件",
        action: "pikpak",
        handler: ({ message, args }) => withPikpakCooldown(message, "PikPak", () => handlePikpak(message, args))
    });
    registry.register({ command: "/po18set", description: "绑定 PO18", action: "po18_set", handler: ({ message, args }) => handlePo18Set(message, args) });
    registry.register({ command: "/loginpo18", description: "登录 PO18", action: "po18_login", handler: ({ message }) => handleLoginPo18(message) });
    registry.register({ command: "/po18code", description: "提交验证码", action: "po18_code", handler: ({ message, args }) => handlePo18Code(message, args) });
    registry.register({ command: "/po18status", description: "PO18 状态", action: "po18_status", handler: ({ message }) => handlePo18Status(message) });
    registry.register({ command: "/po18logout", description: "清除 PO18 登录", action: "po18_logout", handler: ({ message }) => handlePo18Logout(message) });
    registry.register({
        command: "/mybookshelf",
        description: "拉取已购书架",
        action: "po18_bookshelf",
        handler: ({ message }) => withBookshelfCooldown(message, "PO18 书架同步", () => scheduleMyBookshelf(message))
    });
}

module.exports = { registerIntegrationCommands };
