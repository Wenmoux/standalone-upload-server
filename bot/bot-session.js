function createSearchCache(options = {}) {
    const maxSize = Math.max(1, Math.trunc(Number(options.maxSize || 200)));
    const cache = new Map();
    let seq = 0;

    function remember(query) {
        const key = String(++seq);
        cache.set(key, String(query || ""));
        while (cache.size > maxSize) {
            const first = cache.keys().next().value;
            cache.delete(first);
        }
        return key;
    }

    return {
        get: (key) => cache.get(String(key || "")),
        remember,
        size: () => cache.size
    };
}

function helpLinesFromCommands(registry, escapeHtml = (value) => String(value ?? "")) {
    const grouped = new Map();
    for (const command of registry.configuredCommands()) {
        if (!command.enabled) continue;
        if (!grouped.has(command.group)) grouped.set(command.group, []);
        const line = command.help || command.command;
        if (!grouped.get(command.group).includes(line)) grouped.get(command.group).push(line);
    }
    const order = ["搜书", "账户", "导出", "群互动", "PO18 / PikPak", "其它"];
    const lines = [];
    for (const group of order) {
        const rows = grouped.get(group);
        if (!rows || !rows.length) continue;
        lines.push("", `<b>${escapeHtml(group)}</b>`, ...rows.map(escapeHtml));
        if (group === "导出") lines.push("大书会进入后台队列，群里不会卡住其它消息。");
    }
    return lines;
}

module.exports = { createSearchCache, helpLinesFromCommands };
