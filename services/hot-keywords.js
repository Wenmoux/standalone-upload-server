function normalizeHotKeyword(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function createHotKeywordService(options = {}) {
    const configGet = options.configGet || (async () => "");
    const configSet = options.configSet || (async () => {});

    async function getHotKeywords(limit = 20) {
        const raw = await configGet("bot_hot_keywords");
        let rows = [];
        try {
            rows = JSON.parse(raw || "[]");
        } catch {
            rows = [];
        }
        if (!Array.isArray(rows)) rows = [];
        return rows
            .map((row) => ({
                keyword: normalizeHotKeyword(row.keyword),
                type: String(row.type || row.search_type || "search").slice(0, 24),
                count: Number(row.count || 0),
                result_count: Number(row.result_count || row.total_results || 0),
                last_searched_at: row.last_searched_at || row.updated_at || null
            }))
            .filter((row) => row.keyword)
            .sort((a, b) => b.count - a.count || String(b.last_searched_at || "").localeCompare(String(a.last_searched_at || "")))
            .slice(0, Math.max(1, Math.min(100, Number(limit || 20))));
    }

    async function saveHotKeywords(rows) {
        const cleaned = (Array.isArray(rows) ? rows : [])
            .map((row) => ({
                keyword: normalizeHotKeyword(row.keyword),
                type: String(row.type || row.search_type || "search").slice(0, 24),
                count: Math.max(0, Number(row.count || 0)),
                result_count: Math.max(0, Number(row.result_count || row.total_results || 0)),
                last_searched_at: row.last_searched_at || new Date().toISOString()
            }))
            .filter((row) => row.keyword)
            .sort((a, b) => b.count - a.count || String(b.last_searched_at || "").localeCompare(String(a.last_searched_at || "")))
            .slice(0, 200);
        await configSet("bot_hot_keywords", JSON.stringify(cleaned));
        return cleaned;
    }

    async function addHotKeyword(keyword, type = "search", resultCount = 0, count = 1, lastAt = new Date().toISOString()) {
        const key = normalizeHotKeyword(keyword);
        if (!key) return null;
        const rows = await getHotKeywords(200);
        const rowType = String(type || "search").slice(0, 24);
        const rowKey = `${rowType}\n${key.toLowerCase()}`;
        const map = new Map(rows.map((row) => [`${row.type}\n${row.keyword.toLowerCase()}`, row]));
        const found = map.get(rowKey) || { keyword: key, type: rowType, count: 0, result_count: 0, last_searched_at: lastAt };
        found.keyword = key;
        found.type = rowType;
        found.count = Number(found.count || 0) + Math.max(1, Number(count || 1));
        found.result_count = Number(found.result_count || 0) + Math.max(0, Number(resultCount || 0));
        found.last_searched_at = lastAt || new Date().toISOString();
        map.set(rowKey, found);
        await saveHotKeywords([...map.values()]);
        return found;
    }

    return {
        addHotKeyword,
        getHotKeywords,
        normalizeHotKeyword,
        saveHotKeywords
    };
}

module.exports = {
    createHotKeywordService,
    normalizeHotKeyword
};
