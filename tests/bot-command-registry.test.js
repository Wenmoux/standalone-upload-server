/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供命令目录、注册器和别名一致性的自动化回归断言
 * [POS]: tests 的命令目录、注册器和别名一致性守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { commandCatalogMap } = require("../bot/command-catalog");
const { createCommandRegistry, normalizeCommand } = require("../bot/command-registry");

test("command registry normalizes commands and aliases", async () => {
    const calls = [];
    const registry = createCommandRegistry();
    registry.register({
        command: "Search",
        aliases: ["/s", "/find@SomeBot"],
        description: "Search books",
        action: "search",
        handler: async (ctx) => calls.push(ctx.args)
    });

    assert.equal(normalizeCommand("/Search@ReaderBot"), "/search");
    assert.equal(registry.resolve("/search").action, "search");
    assert.equal(registry.resolve("/s").primaryCommand, "/search");
    assert.equal(registry.resolve("/find").primaryCommand, "/search");
    assert.deepEqual(registry.telegramCommands(), [{ command: "search", description: "Search books" }]);

    assert.equal(await registry.execute("/s", { args: "alpha" }), true);
    assert.equal(await registry.execute("/missing", { args: "beta" }), false);
    assert.deepEqual(calls, ["alpha"]);
});

test("command catalog exposes implemented word cloud aliases and numeric give syntax", () => {
    const catalog = commandCatalogMap();
    assert.equal(catalog.get("/wordcloud").command, "/wordcloud");
    assert.deepEqual(catalog.get("/wordcloud").aliases, ["/cloud"]);
    assert.equal(catalog.get("/cloud").command, "/cloud");
    assert.equal(catalog.get("/cloud").primaryCommand, "/wordcloud");
    assert.equal(catalog.get("/give").help, "/give TelegramID 铜币 100");
});
