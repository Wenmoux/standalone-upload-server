/**
 * [INPUT]: 依赖注入的 admin_config 读写能力和单条/批量搜索关键词事实
 * [OUTPUT]: 对外提供热词规范化、读取、串行批量累积和替换的配置服务工厂
 * [POS]: services 的热搜状态边界，以一次读改写合并 Reader、Bot 与词云共享关键词，避免批量请求放大写入
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function normalizeHotKeyword(value) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 80);
}

function createHotKeywordService(options = {}) {
    const configGet = options.configGet || (async () => "");
    const configSet = options.configSet || (async () => {});
    let updateTail = Promise.resolve();

    function finiteCount(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(0, number) : Math.max(0, Number(fallback) || 0);
    }

    function serializeUpdate(work) {
        const run = updateTail.then(work, work);
        updateTail = run.catch(() => {});
        return run;
    }

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
            .slice(0, Math.max(1, Math.min(200, Number(limit || 20))));
    }

    async function saveHotKeywords(rows) {
        const cleaned = (Array.isArray(rows) ? rows : [])
            .map((row) => ({
                keyword: normalizeHotKeyword(row.keyword),
                type: String(row.type || row.search_type || "search").slice(0, 24),
                count: finiteCount(row.count),
                result_count: finiteCount(row.result_count ?? row.total_results),
                last_searched_at: row.last_searched_at || new Date().toISOString()
            }))
            .filter((row) => row.keyword)
            .sort((a, b) => b.count - a.count || String(b.last_searched_at || "").localeCompare(String(a.last_searched_at || "")))
            .slice(0, 200);
        await configSet("bot_hot_keywords", JSON.stringify(cleaned));
        return cleaned;
    }

    async function addHotKeywords(inputRows = []) {
        return serializeUpdate(async () => {
            const rows = await getHotKeywords(200);
            const previous = rows.length;
            const map = new Map(rows.map((row) => [`${row.type}\n${row.keyword.toLowerCase()}`, { ...row }]));
            const added = [];
            for (const input of Array.isArray(inputRows) ? inputRows : []) {
                const keyword = normalizeHotKeyword(input?.keyword ?? input?.query);
                if (!keyword) continue;
                const type = String(input?.type || input?.search_type || "search").slice(0, 24);
                const mapKey = `${type}\n${keyword.toLowerCase()}`;
                const lastAt = input?.last_searched_at || input?.created_at || new Date().toISOString();
                const found = map.get(mapKey) || {
                    keyword,
                    type,
                    count: 0,
                    result_count: 0,
                    last_searched_at: lastAt
                };
                found.keyword = keyword;
                found.type = type;
                found.count = finiteCount(found.count) + Math.max(1, finiteCount(input?.count, 1));
                found.result_count =
                    finiteCount(found.result_count) + finiteCount(input?.result_count ?? input?.total_results ?? input?.resultCount);
                found.last_searched_at = lastAt;
                map.set(mapKey, found);
                added.push({ ...found });
            }
            if (!added.length) return { rows, added, previous, writes: 0 };
            return { rows: await saveHotKeywords([...map.values()]), added, previous, writes: 1 };
        });
    }

    async function addHotKeyword(keyword, type = "search", resultCount = 0, count = 1, lastAt = new Date().toISOString()) {
        const result = await addHotKeywords([{ keyword, type, result_count: resultCount, count, last_searched_at: lastAt }]);
        return result.added[0] || null;
    }

    return {
        addHotKeyword,
        addHotKeywords,
        getHotKeywords,
        normalizeHotKeyword,
        saveHotKeywords
    };
}

module.exports = {
    createHotKeywordService,
    normalizeHotKeyword
};
