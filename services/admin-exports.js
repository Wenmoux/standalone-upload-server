/**
 * [INPUT]: 依赖任意表格值与 Express response 的 header/send 能力
 * [OUTPUT]: 对外提供 CSV 单元格转义、UTF-8 BOM 文本组装和下载响应发送函数
 * [POS]: services 的 Admin 导出适配层，统一跨路由的 CSV 编码与响应协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function csvCell(value) {
    if (value === null || value === undefined) return "";
    const text = String(value).replace(/\r?\n/g, " ");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvText(rows = [], columns = []) {
    const header = columns.map((column) => csvCell(column.label || column.key)).join(",");
    const body = rows.map((row) => columns.map((column) => csvCell(row[column.key])).join(","));
    return `\uFEFF${[header, ...body].join("\r\n")}\r\n`;
}

function sendCsv(res, filename, rows, columns) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csvText(rows, columns));
}

module.exports = {
    csvCell,
    csvText,
    sendCsv
};
