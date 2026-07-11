const assert = require("assert/strict");
const test = require("node:test");
const { createTaskStatusHandlers } = require("../bot/task-status-handlers");

function runtime(overrides = {}) {
    const sent = [];
    const client = {
        listSystemJobs: async () => ({ rows: [] }),
        getSystemJob: async () => null,
        cancelSystemJob: async () => null,
        ...(overrides.client || {})
    };
    const handlers = createTaskStatusHandlers({
        client,
        ensureRegistered: async () => {},
        sendMessage: async (chatId, text) => sent.push({ chatId, text }),
        escapeHtml: (value) => String(value)
    });
    return { ...handlers, sent, client };
}

const message = { from: { id: 42 }, chat: { id: 42 } };

test("bot task status handler lists compact cards and protects ownership", async () => {
    const handlers = runtime({
        client: {
            listSystemJobs: async () => ({ rows: [{ id: 7, type: "bot_export_txt", status: "running", progress: 35 }] }),
            getSystemJob: async () => ({ id: 7, type: "bot_export_txt", status: "running", progress: 35, created_by: "telegram:99" })
        }
    });
    await handlers.handleTasks(message);
    assert.match(handlers.sent[0].text, /#7 · TXT 导出 · 运行中 · 35%/);
    await handlers.handleTask(message, "7");
    assert.match(handlers.sent[1].text, /不属于当前账号/);
});

test("bot task status handler cancels an owned task through the scoped endpoint", async () => {
    const calls = [];
    const handlers = runtime({
        client: {
            cancelSystemJob: async (id, telegramId) => {
                calls.push({ id, telegramId });
                return { id, status: "running" };
            }
        }
    });
    await handlers.handleCancelJob(message, "8");
    assert.deepEqual(calls, [{ id: "8", telegramId: 42 }]);
    assert.match(handlers.sent[0].text, /已提交取消/);
});
