const { commandCatalogMap, normalizeBotCommand } = require("./command-catalog");

function normalizeCommand(value = "") {
    return normalizeBotCommand(value);
}

function normalizeCommandSettings(settings = {}) {
    const rows = Array.isArray(settings.commands) ? settings.commands : [];
    const map = new Map();
    for (const row of rows) {
        const command = normalizeCommand(row.command);
        if (!command) continue;
        map.set(command, {
            enabled: row.enabled !== false,
            description: String(row.description || "").trim(),
            disabledMessage: String(row.disabledMessage || row.disabled_message || "").trim()
        });
    }
    return {
        updatedAt: settings.updatedAt || settings.updated_at || "",
        commands: map
    };
}

function createCommandRegistry() {
    const commands = new Map();
    const primaryCommands = [];

    function register(definition = {}) {
        const command = normalizeCommand(definition.command);
        if (!command) throw new Error("command is required");
        if (typeof definition.handler !== "function") throw new Error(`handler is required for ${command}`);
        const record = {
            ...definition,
            command,
            aliases: (definition.aliases || []).map(normalizeCommand).filter(Boolean),
            description: String(definition.description || "").trim(),
            action: String(definition.action || command.replace(/^\//, "")).trim()
        };
        commands.set(command, record);
        primaryCommands.push(record);
        for (const alias of record.aliases) {
            commands.set(alias, { ...record, command: alias, primaryCommand: command, description: "" });
        }
        return record;
    }

    function resolve(command) {
        return commands.get(normalizeCommand(command)) || null;
    }

    async function execute(command, context = {}) {
        const resolved = resolve(command);
        if (!resolved) return false;
        await resolved.handler({ ...context, command: resolved });
        return true;
    }

    function telegramCommands() {
        const seen = new Set();
        return primaryCommands
            .filter((item) => item.description)
            .filter((item) => isEnabled(item.command))
            .filter((item) => {
                const key = item.command.replace(/^\//, "");
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .map((item) => ({ command: item.command.replace(/^\//, ""), description: effectiveDescription(item) }));
    }

    const catalog = commandCatalogMap();
    let commandSettings = normalizeCommandSettings();

    function setSettings(settings = {}) {
        commandSettings = normalizeCommandSettings(settings);
    }

    function effectiveSetting(command) {
        const normalized = normalizeCommand(command);
        const record = resolve(normalized);
        const primary = record?.primaryCommand || normalized;
        return commandSettings.commands.get(primary) || commandSettings.commands.get(normalized) || {};
    }

    function isEnabled(command) {
        return effectiveSetting(command).enabled !== false;
    }

    function disabledMessage(command) {
        return effectiveSetting(command).disabledMessage || "这个 Bot 命令已由管理员临时关闭。";
    }

    function effectiveDescription(item = {}) {
        return effectiveSetting(item.command).description || item.description || catalog.get(item.command)?.description || "";
    }

    function configuredCommands() {
        return primaryCommands.map((item) => {
            const catalogItem = catalog.get(item.command) || {};
            const setting = effectiveSetting(item.command);
            return {
                command: item.command,
                aliases: item.aliases || catalogItem.aliases || [],
                group: catalogItem.group || "其它",
                action: item.action,
                enabled: setting.enabled !== false,
                description: effectiveDescription(item),
                defaultDescription: item.description || catalogItem.description || "",
                help: catalogItem.help || item.command,
                adminOnly: !!catalogItem.adminOnly,
                disabledMessage: setting.disabledMessage || ""
            };
        });
    }

    return {
        register,
        resolve,
        execute,
        setSettings,
        isEnabled,
        disabledMessage,
        configuredCommands,
        telegramCommands,
        list: () => primaryCommands.slice()
    };
}

module.exports = {
    createCommandRegistry,
    normalizeCommand,
    normalizeCommandSettings
};
