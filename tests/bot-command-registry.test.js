const assert = require("assert/strict");
const test = require("node:test");
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
