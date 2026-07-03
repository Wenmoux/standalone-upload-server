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
