/**
 * [INPUT]: 依赖 command-registry、导出冷却包装器、持久任务调度器和 EPUB 样式选择交互
 * [OUTPUT]: 对外提供 TXT 与 EPUB 导出命令的集中注册函数
 * [POS]: bot/commands 的导出命令装配器，把即时命令转换为样式选择或后台导出任务
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function registerExportCommands(registry, handlers = {}) {
    const { withExportCooldown, scheduleExport, requestEpubStyle } = handlers;

    registry.register({
        command: "/exporttxt",
        description: "导出 TXT",
        action: "export_txt",
        handler: ({ message, args }) => withExportCooldown(message, "导出", () => scheduleExport(message.chat, message.from, args, "txt"))
    });
    registry.register({
        command: "/exportepub",
        description: "导出 EPUB",
        action: "export_epub",
        handler: ({ message, args }) => requestEpubStyle(message.chat, message.from, args)
    });
}

module.exports = { registerExportCommands };
