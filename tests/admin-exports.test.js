/**
 * [INPUT]: 依赖 node:test、assert 与 admin-exports 的 CSV 单元格、文本、文件名和响应适配函数
 * [OUTPUT]: 提供公式注入、引号换行、BOM/CRLF、文件名响应头和发送协议自动化回归
 * [POS]: tests 的 Admin 表格导出安全守卫，防止用户数据在电子表格中被解释为公式或污染响应头
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { csvCell, csvText, safeCsvFilename, sendCsv } = require("../services/admin-exports");

test("admin CSV cells escape structure and neutralize string formulas", () => {
    assert.equal(csvCell(null), "");
    assert.equal(csvCell('a,b"c'), '"a,b""c"');
    assert.equal(csvCell("line1\nline2"), "line1 line2");
    assert.equal(csvCell("\r=cmd"), "' =cmd");
    assert.equal(csvCell('=HYPERLINK("https://evil")'), '"\'=HYPERLINK(""https://evil"")"');
    assert.equal(csvCell("  +cmd"), "'  +cmd");
    assert.equal(csvCell(-12), "-12");
});

test("admin CSV text and response keep stable encoding and safe filenames", () => {
    const text = csvText(
        [{ name: "Alice", note: "@SUM(1,2)" }],
        [
            { key: "name", label: "name" },
            { key: "note", label: "note" }
        ]
    );
    assert.equal(text, '\uFEFFname,note\r\nAlice,"\'@SUM(1,2)"\r\n');
    assert.equal(safeCsvFilename('bad\r\n"/name.csv'), "bad____name.csv");

    const headers = {};
    let body = "";
    sendCsv(
        {
            setHeader: (name, value) => {
                headers[name] = value;
            },
            send: (value) => {
                body = value;
            }
        },
        'users\r\n".csv',
        [{ name: "Alice" }],
        [{ key: "name", label: "name" }]
    );
    assert.equal(headers["Content-Type"], "text/csv; charset=utf-8");
    assert.equal(headers["Content-Disposition"], 'attachment; filename="users___.csv"');
    assert.match(body, /^\uFEFFname\r\nAlice\r\n$/);
});
