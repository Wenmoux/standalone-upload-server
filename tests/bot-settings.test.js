/**
 * [INPUT]: 依赖 node:test、assert 与 bot-settings 的命令目录合并、输入清洗、序列化和配置服务工厂
 * [OUTPUT]: 提供未知命令拒绝、布尔兼容、控制字符清洗、去重排序及持久化读取回归
 * [POS]: tests 的 Bot 命令策略守卫，确保后台配置只能覆盖真实命令目录且不会积累平行清单
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const {
    BOT_COMMAND_SETTINGS_KEY,
    cleanCommandPatch,
    createBotSettingsService,
    mergeCommandSettings,
    parseBotCommandSettings,
    serializeCommandSettings
} = require("../services/bot-settings");

test("bot command settings parse and clean only catalog commands", () => {
    assert.deepEqual(parseBotCommandSettings("bad"), {});
    assert.deepEqual(parseBotCommandSettings("[]"), {});
    assert.equal(cleanCommandPatch({ command: "/unknown" }), null);
    assert.deepEqual(
        cleanCommandPatch({
            command: "SEARCH@po18book_bot",
            enabled: "false",
            description: " 搜\u0000索 ",
            disabled_message: " 暂\n停 "
        }),
        {
            command: "/search",
            enabled: false,
            description: "搜 索",
            disabledMessage: "暂 停"
        }
    );
});

test("bot command settings serialize deduplicated catalog order and merge aliases", () => {
    const serialized = JSON.parse(
        serializeCommandSettings({
            commands: [
                { command: "/search", enabled: true, description: "old" },
                { command: "/unknown", enabled: false },
                { command: "/search", enabled: false, description: "new" },
                { command: "/start", enabled: true }
            ]
        })
    );
    assert.deepEqual(
        serialized.commands.map((item) => item.command),
        ["/start", "/search"]
    );
    assert.equal(serialized.commands[1].enabled, false);
    assert.equal(serialized.commands[1].description, "new");
    assert.match(serialized.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

    const merged = mergeCommandSettings(serialized);
    const search = merged.commands.find((item) => item.command === "/search");
    assert.equal(search.enabled, false);
    assert.equal(search.description, "new");
    assert.ok(merged.commands.find((item) => item.command === "/tx").aliases.includes("/transactions"));
    assert.ok(merged.groups.includes("搜书"));
});

test("bot command settings service persists through the shared config key", async () => {
    let stored = "";
    const calls = [];
    const service = createBotSettingsService({
        configGet: async (key) => {
            calls.push(["get", key]);
            return stored;
        },
        configSet: async (key, value) => {
            calls.push(["set", key]);
            stored = value;
        }
    });
    const result = await service.saveBotCommandSettings({ commands: [{ command: "/hot", enabled: false }] });
    assert.equal(result.commands.find((item) => item.command === "/hot").enabled, false);
    assert.deepEqual(
        calls.map((item) => item[1]),
        [BOT_COMMAND_SETTINGS_KEY, BOT_COMMAND_SETTINGS_KEY]
    );
});
