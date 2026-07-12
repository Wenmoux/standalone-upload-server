/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供虚拟章节列表窗口计算的自动化回归断言
 * [POS]: tests 的虚拟章节列表窗口计算守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

function loadVirtualRange() {
    const source = fs.readFileSync(path.resolve(__dirname, "../cirno-src/src/utils/virtual-list.js"), "utf8");
    const body = source.replace("export function calculateVirtualRange", "function calculateVirtualRange");
    return Function(`${body}; return calculateVirtualRange;`)();
}

test("reader virtual list renders only the viewport window", () => {
    const calculateVirtualRange = loadVirtualRange();
    const first = calculateVirtualRange({ itemCount: 5000, itemHeight: 56, scrollTop: 0, viewportHeight: 560, overscan: 10 });
    assert.deepEqual(first, { start: 0, end: 20, offset: 0, totalHeight: 280000 });

    const middle = calculateVirtualRange({ itemCount: 5000, itemHeight: 56, scrollTop: 56000, viewportHeight: 560, overscan: 10 });
    assert.equal(middle.start, 990);
    assert.equal(middle.end, 1020);
    assert.equal(middle.end - middle.start, 30);
});
