/**
 * [INPUT]: 依赖 bot/command-catalog 的命令真源及注入的 admin_config 读写能力
 * [OUTPUT]: 对外提供 Bot 命令开关服务、配置键以及设置合并、解析和序列化函数
 * [POS]: services 的 Bot 功能策略层，使后台配置只覆盖命令目录而不会产生漂移的平行清单
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { BOT_COMMAND_CATALOG, normalizeBotCommand } = require("../bot/command-catalog");

const BOT_COMMAND_SETTINGS_KEY = "bot_command_settings";
const BOT_COMMANDS = new Set(BOT_COMMAND_CATALOG.map((item) => normalizeBotCommand(item.command)));

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
    if (!command || !BOT_COMMANDS.has(command)) return null;
    const disabledValues = new Set(["0", "false", "off", "disabled"]);
    const enabled =
        typeof row.enabled === "boolean"
            ? row.enabled
            : !disabledValues.has(
                  String(row.enabled === undefined ? "true" : row.enabled)
                      .trim()
                      .toLowerCase()
              );
    const cleanText = (value, maxLength) =>
        String(value || "")
            .replace(/[\u0000-\u001f\u007f]+/g, " ")
            .trim()
            .slice(0, maxLength);
    return {
        command,
        enabled,
        description: cleanText(row.description, 120),
        disabledMessage: cleanText(row.disabledMessage || row.disabled_message, 240)
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
    const overrides = new Map();
    for (const item of Array.isArray(payload.commands) ? payload.commands : []) {
        const row = cleanCommandPatch(item);
        if (row) overrides.set(row.command, row);
    }
    const commands = BOT_COMMAND_CATALOG.map((item) => overrides.get(normalizeBotCommand(item.command)))
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
    cleanCommandPatch,
    createBotSettingsService,
    mergeCommandSettings,
    parseBotCommandSettings,
    serializeCommandSettings
};
