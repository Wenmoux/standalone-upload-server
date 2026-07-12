/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供PWA manifest、Service Worker 与安装资源的自动化回归断言
 * [POS]: tests 的PWA manifest、Service Worker 与安装资源守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const test = require("node:test");

function storageMock(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
        has: (key) => values.has(key)
    };
}

function loadReaderSession() {
    const file = path.resolve(__dirname, "../cirno-src/src/utils/reader-session.js");
    let source = fs.readFileSync(file, "utf8");
    source = source
        .replace(/^import .*reader-offline.*$/m, "const flushOfflineProgress = async () => ({ flushed: 0 });")
        .replace(/export\s+/g, "");
    return Function(`${source}\nreturn {
        cachedReaderUser,
        clearReaderSession,
        getReaderSession,
        markReaderSession,
        readerSessionState
    }`)();
}

test("reader session removes legacy tokens, coalesces checks, and preserves verified identity offline", async () => {
    const previousStorage = global.localStorage;
    const storage = storageMock({ login_token: "local-session" });
    global.localStorage = storage;
    try {
        const session = loadReaderSession();
        assert.equal(storage.has("login_token"), false);
        let requests = 0;
        const fetchImpl = async () => {
            requests += 1;
            return { ok: true, status: 200, json: async () => ({ user: { id: 7, username: "reader" } }) };
        };
        const [first, second] = await Promise.all([
            session.getReaderSession({ force: true, fetchImpl }),
            session.getReaderSession({ force: true, fetchImpl })
        ]);
        assert.equal(requests, 1);
        assert.equal(first.id, 7);
        assert.equal(second.id, 7);

        const offline = await session.getReaderSession({
            force: true,
            fetchImpl: async () => {
                throw new Error("offline");
            }
        });
        assert.equal(offline.id, 7);
        assert.equal(session.readerSessionState().status, "offline");
    } finally {
        if (previousStorage === undefined) delete global.localStorage;
        else global.localStorage = previousStorage;
    }
});

test("reader service worker precaches only shell assets and bypasses authenticated APIs", async () => {
    const moduleUrl = pathToFileURL(path.resolve(__dirname, "../cirno-src/scripts/reader-pwa-plugin.mjs")).href;
    const { readerPwaPlugin } = await import(moduleUrl);
    const plugin = readerPwaPlugin();
    plugin.configResolved({ base: "/" });
    let emitted = null;
    plugin.generateBundle.call(
        { emitFile: (asset) => { emitted = asset; } },
        {},
        {
            "index.html": { fileName: "index.html" },
            "app.js": { fileName: "static/app.123.js" },
            "app.css": { fileName: "static/app.123.css" }
        }
    );
    assert.equal(emitted.fileName, "sw.js");
    assert.match(emitted.source, /reader-\(\?:auth\|api\)/);
    assert.match(emitted.source, /request\.method !== 'GET'/);
    assert.match(emitted.source, /manifest\.webmanifest/);
    assert.doesNotMatch(emitted.source, /cache\.put\(request/);
});

test("reader PWA manifest is installable and declares a maskable icon", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../cirno-src/public/manifest.webmanifest"), "utf8"));
    assert.equal(manifest.display, "standalone");
    assert.ok(manifest.start_url);
    assert.ok(manifest.icons.some((icon) => /maskable/.test(icon.purpose || "")));
    assert.ok(manifest.icons.some((icon) => icon.type === "image/png" && icon.sizes === "192x192"));
    assert.ok(manifest.icons.some((icon) => icon.type === "image/png" && icon.sizes === "512x512"));
});
