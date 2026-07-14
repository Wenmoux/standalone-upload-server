/**
 * [INPUT]: 依赖 node:test、assert 与 Admin useLazyWorkspace 页内加载调度器
 * [OUTPUT]: 提供工作区首次加载、并发去重、失败重试、成功缓存与强制刷新回归断言
 * [POS]: tests 的 Admin 按需加载行为守卫，防止快速切换或临时错误造成重复请求与永久空白
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const assert = require("assert/strict");
const test = require("node:test");

async function workspace(loaders) {
    const { useLazyWorkspace } = await import("../admin-ui/src/utils/lazyWorkspace.js");
    return useLazyWorkspace("runtime", loaders);
}

test("lazy workspace deduplicates concurrent loads and caches successful tabs", async () => {
    let calls = 0;
    let release;
    const pending = new Promise((resolve) => {
        release = resolve;
    });
    const state = await workspace({
        runtime: async () => {
            calls += 1;
            await pending;
        }
    });

    const first = state.loadActiveTab();
    const second = state.loadActiveTab();
    await Promise.resolve();
    assert.equal(calls, 1);
    release();
    await Promise.all([first, second]);
    await state.loadActiveTab();
    assert.equal(calls, 1);
    await state.refreshActive();
    assert.equal(calls, 2);
});

test("lazy workspace retries failed tabs and ignores unknown keys", async () => {
    let calls = 0;
    const state = await workspace({
        runtime: async () => {
            calls += 1;
            if (calls === 1) throw new Error("temporary failure");
        },
        messages: async () => {}
    });

    await assert.rejects(state.loadActiveTab(), /temporary failure/);
    await state.loadActiveTab();
    assert.equal(calls, 2);
    await state.selectTab("unknown");
    assert.equal(state.activeTab.value, "runtime");
    await state.selectTab("messages");
    assert.equal(state.activeTab.value, "messages");
});
