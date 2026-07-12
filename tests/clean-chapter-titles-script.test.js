/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供标题清洗 CLI 参数与执行边界的自动化回归断言
 * [POS]: tests 的标题清洗 CLI 参数与执行边界守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供标题清洗 CLI 参数与执行边界的自动化回归断言
 * [POS]: tests 的标题清洗 CLI 参数与执行边界守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { buildSelectSql, parseArgs } = require("../scripts/clean-chapter-titles");

test("clean chapter titles script defaults to dry run with limit", () => {
    const options = parseArgs([]);
    assert.equal(options.apply, false);
    assert.equal(options.limit, 200);
});

test("clean chapter titles script builds filtered select sql", () => {
    const query = buildSelectSql({ platform: "qidian", bookId: "123", limit: 50, offset: 10 });
    assert.match(query.sql, /LOWER\(TRIM\(COALESCE\(platform/);
    assert.match(query.sql, /book_id = \$2/);
    assert.match(query.sql, /LIMIT \$3 OFFSET \$4/);
    assert.deepEqual(query.params, ["qidian", "123", 50, 10]);
});
