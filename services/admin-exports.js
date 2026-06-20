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
