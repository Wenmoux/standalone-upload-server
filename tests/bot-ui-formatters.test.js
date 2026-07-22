/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供Telegram 文案、按钮和转义格式的自动化回归断言
 * [POS]: tests 的Telegram 文案、按钮和转义格式守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createBotUi } = require("../bot/ui-formatters");

test("bot ui formatters build callbacks, buttons and export quotes", () => {
    const ui = createBotUi({ crowdVoteCost: 88, platformLabel: (platform) => ({ fanqie: "番茄" })[platform] || platform });

    assert.equal(ui.callback(["a", "b"]).length, 3);
    assert.equal(ui.callback(["x".repeat(80)]).length, 64);

    const actions = ui.bookActions("book-1", "https://example.test/book");
    assert.equal(actions.inline_keyboard[0][0].callback_data, "info|book-1");
    assert.equal(actions.inline_keyboard[1][3].callback_data, "reviewnew|book-1");
    assert.equal(actions.inline_keyboard.at(-1)[0].url, "https://example.test/book");
    assert.match(ui.bookListItem({ book_id: "1", title: "测试", platform: "fanqie" }), /站别：番茄/);

    const crowd = ui.crowdActions("book-1");
    assert.match(crowd.inline_keyboard[0][0].text, /88/);
    const request = ui.searchRequestActions("abc");
    assert.equal(request.inline_keyboard[0][0].callback_data, "sreq|abc");

    assert.deepEqual(ui.exportQuote({ paidChapters: 2 }, { paidChapterSilverCost: 12 }), {
        currency: "silver",
        amount: 24,
        paidChapters: 2,
        unitCost: 12,
        label: "收费章节导出"
    });
    assert.equal(ui.parseRedPacketArgs("silver @user 30 hi").target, "@user");

    const reviews = ui.bookReviewsText("667518", {
        book: { title: "远南", author: "狄醉山", platform: "po18" },
        total: 1,
        rows: [
            {
                author_telegram_username: "wenmoux",
                like_count: 0,
                dislike_count: 0,
                content: "太棒了！我的姐弟骨启蒙！远南99！"
            }
        ],
        rules: { min_level: 2, cost_copper: 100, min_length: 6, max_length: 1200 }
    });
    assert.match(reviews, /<b>书评 · 远南<\/b>/);
    assert.match(reviews, /作者：狄醉山/);
    assert.match(reviews, /书号：<code>667518<\/code> · po18/);
    assert.match(reviews, /<b>01｜@wenmoux<\/b>/);
    assert.match(reviews, /<b>发布<\/b>：点下方“写书评”/);
    assert.equal(ui.bookReviewsActions("667518").inline_keyboard[0][0].callback_data, "reviewnew|667518");
    assert.equal(ui.reviewPromptActions("667518").inline_keyboard[0][0].callback_data, "reviewcancel|667518");
});
