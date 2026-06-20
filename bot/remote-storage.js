function createRemoteStorage(deps = {}) {
    const fetchImpl = deps.fetchImpl === undefined ? globalThis.fetch : deps.fetchImpl;

function pikpakConfig() {
    return {
        url: (process.env.PIKPAK_WEBDAV_URL || process.env.PIKPAK_WEBDAV_URI || "").trim().replace(/\/+$/, ""),
        username: (process.env.PIKPAK_WEBDAV_USERNAME || process.env.PIKPAK_USERNAME || "").trim(),
        password: (process.env.PIKPAK_WEBDAV_PASSWORD || process.env.PIKPAK_PASSWORD || "").trim(),
        root: (process.env.PIKPAK_WEBDAV_ROOT || process.env.PIKPAK_ROOT || "/").trim() || "/"
    };
}

function webdavUrl(config, remotePath = "/") {
    const clean = String(remotePath || "/").startsWith("/") ? String(remotePath || "/") : `/${remotePath}`;
    return `${config.url}${clean.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

async function webdavRequest(config, method, remotePath = "/", headers = {}, body = undefined) {
    const auth = Buffer.from(`${config.username}:${config.password}`).toString("base64");
    if (!fetchImpl) throw new Error("fetch is not available");
    const response = await fetchImpl(webdavUrl(config, remotePath), {
        method,
        headers: {
            Authorization: `Basic ${auth}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            ...headers
        },
        body
    });
    return response;
}

async function pikpakList(config, remotePath = "/") {
    const propfind = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/><d:resourcetype/></d:prop></d:propfind>`;
    const response = await webdavRequest(config, "PROPFIND", remotePath, { Depth: "1", "Content-Type": "application/xml; charset=utf-8" }, propfind);
    if (![200, 207].includes(response.status)) throw new Error(response.status === 401 ? "PikPak 认证失败" : `PikPak HTTP ${response.status}`);
    const xml = await response.text();
    const items = [];
    for (const block of xml.matchAll(/<[^:>]*:?response[\s\S]*?<\/[^:>]*:?response>/gi)) {
        const text = block[0];
        const href = decodeURIComponent((text.match(/<[^:>]*:?href[^>]*>([\s\S]*?)<\/[^:>]*:?href>/i)?.[1] || "").trim());
        if (!href || href.replace(/\/+$/, "") === String(remotePath || "/").replace(/\/+$/, "")) continue;
        const displayName = decodeURIComponent((text.match(/<[^:>]*:?displayname[^>]*>([\s\S]*?)<\/[^:>]*:?displayname>/i)?.[1] || "").trim()) || href.split("/").filter(Boolean).pop() || href;
        const isDir = /<[^:>]*:?collection\b/i.test(text);
        const size = Number(text.match(/<[^:>]*:?getcontentlength[^>]*>([\s\S]*?)<\/[^:>]*:?getcontentlength>/i)?.[1] || 0);
        const lastmod = (text.match(/<[^:>]*:?getlastmodified[^>]*>([\s\S]*?)<\/[^:>]*:?getlastmodified>/i)?.[1] || "").trim();
        items.push({ name: displayName, path: href, is_dir: isDir, size, lastmod });
    }
    return items;
}

async function pikpakSearch(config, keyword) {
    const rootItems = await pikpakList(config, config.root);
    const results = rootItems.filter((item) => !item.is_dir && item.name.toLowerCase().includes(keyword.toLowerCase()));
    for (const dir of rootItems.filter((item) => item.is_dir).slice(0, 60)) {
        try {
            const rows = await pikpakList(config, dir.path);
            results.push(...rows.filter((item) => !item.is_dir && item.name.toLowerCase().includes(keyword.toLowerCase())));
        } catch {
            // ignore unreadable folders
        }
    }
    return results;
}

    return {
        pikpakConfig,
        webdavUrl,
        webdavRequest,
        pikpakList,
        pikpakSearch
    };
}

module.exports = { createRemoteStorage };
