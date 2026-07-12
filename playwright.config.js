/**
 * [INPUT]: 依赖 tests/smoke 浏览器用例与 Playwright 运行时
 * [OUTPUT]: 对外提供无头浏览器、超时、失败 trace 和列表报告配置
 * [POS]: 根级容器/页面烟雾测试配置，补充 Node 契约测试无法覆盖的真实浏览器边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
module.exports = {
    testDir: "./tests/smoke",
    timeout: 30000,
    expect: {
        timeout: 5000
    },
    use: {
        headless: true,
        trace: "retain-on-failure"
    },
    reporter: [["list"]]
};
