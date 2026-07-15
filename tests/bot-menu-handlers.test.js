/**
 * [INPUT]: 依赖 node:test、assert、Bot 账户面板格式器、命令目录/注册器和菜单分派器
 * [OUTPUT]: 提供精简系统命令、无重复书籍动作的宫格面板及 callback 委托回归
 * [POS]: tests 的 Telegram 导航入口守卫，确保命令发现层保持简洁而领域命令继续兼容可用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { mainMenuMarkup, mainMenuText, po18MenuMarkup } = require("../bot/account-formatters");
const { createAccountHandlers } = require("../bot/account-handlers");
const { BOT_COMMAND_CATALOG } = require("../bot/command-catalog");
const { createCommandRegistry } = require("../bot/command-registry");
const { createMenuHandlers } = require("../bot/menu-handlers");

test("Telegram system command list contains only high-frequency entry points", () => {
    const registry = createCommandRegistry();
    for (const item of BOT_COMMAND_CATALOG) {
        registry.register({ ...item, handler: async () => {} });
    }
    const commands = registry.telegramCommands().map((item) => item.command);
    assert.deepEqual(commands, ["menu", "me", "sign", "tasks", "search", "hot", "random", "po18status"]);
    assert.equal(commands.includes("myfav"), false);
    assert.equal(commands.includes("exporttxt"), false);
    assert.equal(commands.includes("exportepub"), false);
});

test("main panel is a compact button grid without duplicate book actions", () => {
    const mainButtons = mainMenuMarkup().inline_keyboard.flat();
    const po18Buttons = po18MenuMarkup().inline_keyboard.flat();
    const labels = mainButtons.map((button) => button.text).join(" ");
    assert.doesNotMatch(labels, /收藏|导出|书评|众筹/);
    assert.match(labels, /搜书/);
    assert.ok(mainButtons.every((button) => String(button.callback_data).startsWith("menu|")));
    assert.ok(po18Buttons.some((button) => button.callback_data === "menu|home"));
});

test("menu callbacks delegate to existing handlers instead of duplicating business logic", async () => {
    const calls = [];
    const handler =
        (name) =>
        async (...args) =>
            calls.push([name, ...args]);
    const { handleMenuAction } = createMenuHandlers({
        sendMessage: handler("send"),
        mainMenuMarkup,
        po18MenuText: () => "po18",
        po18MenuMarkup,
        handleMenu: handler("menu"),
        handleHelp: handler("help"),
        handleHot: handler("hot"),
        handleRandom: handler("random"),
        handleWordCloud: handler("wordcloud"),
        handleMe: handler("me"),
        handleSign: handler("sign"),
        handleTasks: handler("tasks"),
        handleTop: handler("top"),
        handlePo18Status: handler("po18status"),
        handleLoginPo18: handler("po18login"),
        scheduleMyBookshelf: handler("bookshelf"),
        withSearchCooldown: (message, label, action) => action(),
        withBookshelfCooldown: (message, label, action) => action()
    });
    const message = { chat: { id: 1 }, from: { id: 2 } };
    await handleMenuAction(message, "hot");
    await handleMenuAction(message, "me");
    await handleMenuAction(message, "bookshelf");
    await handleMenuAction(message, "home");
    assert.deepEqual(
        calls.map((item) => item[0]),
        ["hot", "me", "bookshelf", "menu"]
    );
});

test("start opens the button panel while help keeps the full command reference", async () => {
    const sent = [];
    const help = [];
    const handlers = createAccountHandlers({
        client: { getUser: async () => ({ nickname: "Alice", copper_coins: 1, silver_coins: 2 }) },
        sendMessage: async (...args) => sent.push(args),
        deliverLongGroupResult: async (...args) => help.push(args),
        escapeHtml: (value) => String(value),
        scholarText: () => "Lv1",
        freeExportText: () => "",
        startHelpText: () => "full help",
        mainMenuText,
        mainMenuMarkup,
        takePrivateExportStart: () => null,
        helpLinesFromCommands: () => ["/search"]
    });
    const message = { chat: { id: 1 }, from: { id: 2 } };
    await handlers.handleStart(message, "");
    await handlers.handleHelp(message);
    assert.match(sent[0][1], /功能面板/);
    assert.equal(sent[0][2].reply_markup.inline_keyboard.length, 5);
    assert.equal(help[0][1], "full help");
});
