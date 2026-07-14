/**
 * [INPUT]: 依赖任意表格值与 Express response 的 header/send 能力
 * [OUTPUT]: 对外提供公式安全的 CSV 单元格转义、UTF-8 BOM 文本组装、文件名清洗和下载响应函数
 * [POS]: services 的 Admin 导出安全边界，统一跨路由的公式注入防护、CSV 编码与响应协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function csvCell(value) {
    if (value === null || value === undefined) return "";
    const raw = String(value).replace(/\r\n?|\n/g, " ");
    const text = typeof value === "string" && /^[\t ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvText(rows = [], columns = []) {
    const header = columns.map((column) => csvCell(column.label || column.key)).join(",");
    const body = rows.map((row) => columns.map((column) => csvCell(row[column.key])).join(","));
    return `\uFEFF${[header, ...body].join("\r\n")}\r\n`;
}

function safeCsvFilename(value = "export.csv") {
    return (
        String(value || "export.csv")
            .replace(/[\r\n"\\/]/g, "_")
            .slice(0, 180) || "export.csv"
    );
}

function sendCsv(res, filename, rows, columns) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeCsvFilename(filename)}"`);
    res.send(csvText(rows, columns));
}

module.exports = {
    csvCell,
    csvText,
    safeCsvFilename,
    sendCsv
};
