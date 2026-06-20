function registerExportCommands(registry, handlers = {}) {
    const { withExportCooldown, scheduleExport } = handlers;

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
        handler: ({ message, args }) => withExportCooldown(message, "导出", () => scheduleExport(message.chat, message.from, args, "epub"))
    });
}

module.exports = { registerExportCommands };
