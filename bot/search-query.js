const { parsePlatformSuffix } = require("./search-platforms");

function createSearchQueryParser(options = {}) {
    const searchLimit = Number(options.searchLimit || 5);

    function parseSearchQuery(query) {
        const parsed = parsePlatformSuffix(query);
        const value = parsed.query;
        const params = { page: 1, limit: searchLimit, sort: "cache_desc", cache_min: 1, fast: 1 };
        if (parsed.platform) params.platform = parsed.platform;
        let type = "search";
        if (value.startsWith("#")) {
            params.tag = value.slice(1).trim();
            type = "tag";
        } else if (/^tag[:：]/i.test(value)) {
            params.tag = value.replace(/^tag[:：]/i, "").trim();
            type = "tag";
        } else {
            params.keyword = value;
        }
        return { params, type, keyword: params.tag || params.keyword || "", platform: parsed.platform, suffix: parsed.suffix, cleanQuery: value };
    }

    return { parseSearchQuery, parseBookId };
}

function parseBookId(value = "") {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const urlMatch = raw.match(/\/books\/([0-9A-Za-z_-]+)/i);
    if (urlMatch) return urlMatch[1];
    const articleMatch = raw.match(/\/articles(?:content)?\/([0-9A-Za-z_-]+)/i);
    if (articleMatch && raw.match(/book(?:id)?[=/:-]?([0-9A-Za-z_-]+)/i)) return raw.match(/book(?:id)?[=/:-]?([0-9A-Za-z_-]+)/i)[1];
    const paramMatch = raw.match(/[?&](?:book_id|bookId|book|id)=([0-9A-Za-z_-]+)/i);
    if (paramMatch) return paramMatch[1];
    const commandMatch = raw.match(/^\/info_([0-9A-Za-z_-]+)/i);
    if (commandMatch) return commandMatch[1];
    const codeMatch = raw.match(/(?:书号|book(?:_?id)?|id)[:：=\s]+([0-9A-Za-z_-]+)/i);
    if (codeMatch) return codeMatch[1];
    const bare = raw.split(/\s+/)[0].replace(/^#/, "").trim();
    return /^[0-9A-Za-z_-]{2,64}$/.test(bare) ? bare : "";
}

module.exports = { createSearchQueryParser, parseBookId };
