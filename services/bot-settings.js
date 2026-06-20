const { BOT_COMMAND_CATALOG, normalizeBotCommand } = require("../bot/command-catalog");

const BOT_COMMAND_SETTINGS_KEY = "bot_command_settings";

function parseBotCommandSettings(value = "") {
    try {
        const parsed = JSON.parse(String(value || "{}"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        return parsed;
    } catch {
        return {};
    }
}

function cleanCommandPatch(row = {}) {
    const command = normalizeBotCommand(row.command);
    if (!command) return null;
    return {
        command,
        enabled: row.enabled !== false,
        description: String(row.description || "").trim().slice(0, 120),
        disabledMessage: String(row.disabledMessage || row.disabled_message || "").trim().slice(0, 240)
    };
}

function mergeCommandSettings(stored = {}) {
    const storedRows = Array.isArray(stored.commands) ? stored.commands : [];
    const overrides = new Map();
    for (const row of storedRows) {
        const cleaned = cleanCommandPatch(row);
        if (cleaned) overrides.set(cleaned.command, cleaned);
    }
    const commands = BOT_COMMAND_CATALOG.map((item) => {
        const command = normalizeBotCommand(item.command);
        const saved = overrides.get(command) || {};
        return {
            command,
            aliases: (item.aliases || []).map(normalizeBotCommand),
            group: item.group || "其它",
            action: item.action || command.replace(/^\//, ""),
            enabled: saved.enabled !== false,
            description: saved.description || item.description || "",
            defaultDescription: item.description || "",
            help: item.help || command,
            adminOnly: !!item.adminOnly,
            disabledMessage: saved.disabledMessage || ""
        };
    });
    return {
        updatedAt: stored.updatedAt || stored.updated_at || "",
        commands,
        groups: [...new Set(commands.map((item) => item.group))]
    };
}

function serializeCommandSettings(payload = {}) {
    const commands = (Array.isArray(payload.commands) ? payload.commands : [])
        .map(cleanCommandPatch)
        .filter(Boolean)
        .map((row) => ({
            command: row.command,
            enabled: row.enabled,
            description: row.description,
            disabledMessage: row.disabledMessage
        }));
    return JSON.stringify({
        updatedAt: new Date().toISOString(),
        commands
    });
}

function createBotSettingsService(options = {}) {
    const configGet = options.configGet || (async () => "");
    const configSet = options.configSet || (async () => {});

    async function botCommandSettings() {
        return mergeCommandSettings(parseBotCommandSettings(await configGet(BOT_COMMAND_SETTINGS_KEY)));
    }

    async function saveBotCommandSettings(payload = {}) {
        await configSet(BOT_COMMAND_SETTINGS_KEY, serializeCommandSettings(payload));
        return botCommandSettings();
    }

    return {
        botCommandSettings,
        saveBotCommandSettings
    };
}

module.exports = {
    BOT_COMMAND_SETTINGS_KEY,
    createBotSettingsService,
    mergeCommandSettings,
    parseBotCommandSettings,
    serializeCommandSettings
};
