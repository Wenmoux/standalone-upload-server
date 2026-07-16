/**
 * [INPUT]: 依赖 node:test、临时文件系统、拆分后的控制面运行/页面工厂、组合根公开契约与统一限流器
 * [OUTPUT]: 提供 Setup 模块边界、配置安全、导入导出、鉴权、状态与版本载荷的回归测试
 * [POS]: tests 的控制面配置/诊断/渲染/路由边界守卫，防止模块拆分或部署协议静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { createControlPanelPages } = require("../docker/control-panel-pages");
const { createControlPanelRuntime } = require("../docker/control-panel-runtime");
const {
    designTokensCss,
    handlePanelRequest,
    importedValuesFromText,
    loadConfigIntoEnv,
    sanitizeConfigExport,
    setupToken,
    versionPayload
} = require("../docker/control-panel");
const { createRateWindow } = require("../services/rate-limit");

test("control panel exposes independent runtime and page factories", () => {
    assert.equal(typeof createControlPanelRuntime, "function");
    assert.equal(typeof createControlPanelPages, "function");
});

function withTempEnv(contents, fn) {
    const file = path.join(os.tmpdir(), `po18-control-panel-${Date.now()}-${Math.random().toString(16).slice(2)}.env`);
    fs.writeFileSync(file, contents);
    return Promise.resolve(fn(file)).finally(() => fs.rmSync(file, { force: true }));
}

test("setup token from app.env ignores outer quotes", async () => {
    const previous = process.env.PO18_SETUP_TOKEN;
    try {
        delete process.env.PO18_SETUP_TOKEN;
        await withTempEnv('PO18_SETUP_TOKEN="quoted-token-123456"\n', async (file) => {
            assert.equal(setupToken(file), "quoted-token-123456");
        });
    } finally {
        if (previous === undefined) delete process.env.PO18_SETUP_TOKEN;
        else process.env.PO18_SETUP_TOKEN = previous;
    }
});

test("ordinary setup export removes directly usable credentials", () => {
    const exported = sanitizeConfigExport(
        [
            'PO18_PG_URL="postgres://user:password@db:5432/po18"',
            'PO18_UPLOAD_ADMIN_USER="admin"',
            'PO18_UPLOAD_ADMIN_PASSWORD="admin-password"',
            'PO18_UPLOAD_API_TOKEN="upload-token"',
            'PO18_CREDENTIAL_ENCRYPTION_KEY="encryption-key"',
            'PO18_SERVER_URL="https://reader.example.com"'
        ].join("\n")
    );
    assert.match(exported.content, /PO18_UPLOAD_ADMIN_USER/);
    assert.match(exported.content, /PO18_SERVER_URL/);
    assert.doesNotMatch(exported.content, /postgres:\/\/|admin-password|upload-token|encryption-key/);
    assert.deepEqual(exported.omitted, [
        "PO18_CREDENTIAL_ENCRYPTION_KEY",
        "PO18_PG_URL",
        "PO18_UPLOAD_ADMIN_PASSWORD",
        "PO18_UPLOAD_API_TOKEN"
    ]);
});

test("setup and admin consume the same static design token source", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "ui", "design-tokens.css"), "utf8");
    const adminStyles = fs.readFileSync(path.join(__dirname, "..", "admin-ui", "src", "styles.css"), "utf8");
    assert.equal(designTokensCss(), source);
    assert.match(source, /--po18-primary:/);
    assert.match(source, /--po18-font-sans:/);
    assert.match(adminStyles, /@import "\.\.\/\.\.\/ui\/design-tokens\.css"/);
});

test("version payload exposes runtime app version and build metadata", () => {
    const previous = {
        PO18_APP_VERSION: process.env.PO18_APP_VERSION,
        PO18_IMAGE_TAG: process.env.PO18_IMAGE_TAG,
        PO18_IMMUTABLE_IMAGE_TAG: process.env.PO18_IMMUTABLE_IMAGE_TAG,
        PO18_IMAGE_DIGEST: process.env.PO18_IMAGE_DIGEST,
        PO18_BUILD_DATE: process.env.PO18_BUILD_DATE,
        PO18_BUILD_REVISION: process.env.PO18_BUILD_REVISION,
        PO18_SOURCE_HASH: process.env.PO18_SOURCE_HASH
    };
    try {
        process.env.PO18_APP_VERSION = "1.0.0+test";
        process.env.PO18_IMAGE_TAG = "wenmoux/reader:test";
        process.env.PO18_IMMUTABLE_IMAGE_TAG = "wenmoux/reader:sha-abc123-source";
        process.env.PO18_IMAGE_DIGEST = "sha256:runtime-digest";
        process.env.PO18_BUILD_DATE = "2026-06-23T12:00:00.000Z";
        process.env.PO18_BUILD_REVISION = "abc123def456";
        process.env.PO18_SOURCE_HASH = "source-hash";

        const payload = versionPayload("unit-test");
        assert.equal(payload.service, "unit-test");
        assert.equal(payload.version, "1.0.0+test");
        assert.equal(payload.image, "wenmoux/reader:test");
        assert.equal(payload.immutable_image, "wenmoux/reader:sha-abc123-source");
        assert.equal(payload.image_digest, "sha256:runtime-digest");
        assert.equal(payload.source_hash, "source-hash");
        assert.equal(payload.build_date, "2026-06-23T12:00:00.000Z");
        assert.equal(payload.build_revision, "abc123def456");
        assert.equal(payload.revision, "abc123def456");
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});

test("version payload prefers immutable image build info over runtime env", () => {
    const buildInfoFile = path.join(__dirname, "..", ".po18-build.json");
    const previous = {
        PO18_APP_VERSION: process.env.PO18_APP_VERSION,
        PO18_IMAGE_TAG: process.env.PO18_IMAGE_TAG,
        PO18_IMMUTABLE_IMAGE_TAG: process.env.PO18_IMMUTABLE_IMAGE_TAG,
        PO18_IMAGE_DIGEST: process.env.PO18_IMAGE_DIGEST,
        PO18_BUILD_DATE: process.env.PO18_BUILD_DATE,
        PO18_BUILD_REVISION: process.env.PO18_BUILD_REVISION,
        PO18_SOURCE_HASH: process.env.PO18_SOURCE_HASH
    };
    const hadBuildInfo = fs.existsSync(buildInfoFile);
    const oldBuildInfo = hadBuildInfo ? fs.readFileSync(buildInfoFile, "utf8") : "";
    try {
        fs.writeFileSync(
            buildInfoFile,
            JSON.stringify({
                version: "1.0.0+image",
                image: "wenmoux/reader:v1.0",
                immutable_image: "wenmoux/reader:sha-image-rev-source",
                image_tags: ["wenmoux/reader:v1.0.0", "wenmoux/reader:sha-image-rev-source"],
                build_date: "2026-06-28T16:12:44.322Z",
                build_revision: "image-rev",
                source_hash: "image-source-hash",
                dirty: false
            })
        );
        process.env.PO18_APP_VERSION = "1.0.0+runtime-old";
        process.env.PO18_IMAGE_TAG = "wenmoux/reader:runtime-old";
        process.env.PO18_BUILD_DATE = "2026-06-23T12:00:00.000Z";
        process.env.PO18_BUILD_REVISION = "runtime-rev";

        const payload = versionPayload("unit-test");
        assert.equal(payload.version, "1.0.0+image");
        assert.equal(payload.runtime_version, "1.0.0+runtime-old");
        assert.equal(payload.image, "wenmoux/reader:v1.0");
        assert.equal(payload.immutable_image, "wenmoux/reader:sha-image-rev-source");
        assert.deepEqual(payload.image_tags, ["wenmoux/reader:v1.0.0", "wenmoux/reader:sha-image-rev-source"]);
        assert.equal(payload.source_hash, "image-source-hash");
        assert.equal(payload.build_date, "2026-06-28T16:12:44.322Z");
        assert.equal(payload.build_revision, "image-rev");
    } finally {
        if (hadBuildInfo) fs.writeFileSync(buildInfoFile, oldBuildInfo);
        else fs.rmSync(buildInfoFile, { force: true });
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});

test("loadConfigIntoEnv strips quoted secret values", async () => {
    const previous = process.env.PO18_UPLOAD_API_TOKEN;
    try {
        delete process.env.PO18_UPLOAD_API_TOKEN;
        await withTempEnv('PO18_UPLOAD_API_TOKEN="upload-token-abcdef"\n', async (file) => {
            loadConfigIntoEnv(file);
            assert.equal(process.env.PO18_UPLOAD_API_TOKEN, "upload-token-abcdef");
        });
    } finally {
        if (previous === undefined) delete process.env.PO18_UPLOAD_API_TOKEN;
        else process.env.PO18_UPLOAD_API_TOKEN = previous;
    }
});

test("setup import parses exported env and maps BOT_TOKEN", async () => {
    await withTempEnv('PO18_SETUP_TOKEN="current-token-123456"\n', async (file) => {
        const { values, importedCount } = importedValuesFromText(
            [
                "# exported",
                'PO18_SETUP_TOKEN="next-token-123456"',
                'PO18_PG_URL="postgres://user:pass@db:5432/po18"',
                'PO18_UPLOAD_ADMIN_USER="admin"',
                'PO18_UPLOAD_ADMIN_PASSWORD="admin-pass"',
                'PO18_UPLOAD_SESSION_SECRET="session-secret-123456"',
                'PO18_UPLOAD_API_TOKEN="upload-token-123456"',
                'PO18_BOT_API_TOKEN="bot-api-token-123456"',
                'BOT_TOKEN="telegram-token"',
                'UNKNOWN_KEY="ignored"'
            ].join("\n"),
            file
        );

        assert.equal(importedCount, 8);
        assert.equal(values.PO18_SETUP_TOKEN, "next-token-123456");
        assert.equal(values.TELEGRAM_BOT_TOKEN, "telegram-token");
        assert.ok(values.PO18_METRICS_TOKEN.length >= 16);
        assert.equal(values.PO18_API_BASE, "http://127.0.0.1:3100");
    });
});

test("setup import endpoint writes config and sets next setup token cookie", async () => {
    const previous = process.env.PO18_SETUP_TOKEN;
    try {
        delete process.env.PO18_SETUP_TOKEN;
        await withTempEnv('PO18_SETUP_TOKEN="old-token-123456"\n', async (file) => {
            const body = new URLSearchParams({
                config: [
                    'PO18_SETUP_TOKEN="new-token-123456"',
                    'PO18_PG_URL="postgres://user:pass@db:5432/po18"',
                    'PO18_UPLOAD_ADMIN_USER="admin"',
                    'PO18_UPLOAD_ADMIN_PASSWORD="admin-pass"',
                    'PO18_UPLOAD_SESSION_SECRET="session-secret-123456"',
                    'PO18_UPLOAD_API_TOKEN="upload-token-123456"',
                    'PO18_BOT_API_TOKEN="bot-api-token-123456"',
                    'TELEGRAM_API_BASE="https://api.telegram.org"'
                ].join("\n")
            }).toString();
            const req = {
                method: "POST",
                url: "/setup/import?token=old-token-123456",
                headers: {},
                on(event, cb) {
                    if (event === "data") cb(Buffer.from(body));
                    if (event === "end") cb();
                }
            };
            let status = 0;
            let headers = {};
            let payload = "";
            const res = {
                writeHead(code, nextHeaders) {
                    status = code;
                    headers = nextHeaders;
                },
                end(chunk) {
                    payload = String(chunk || "");
                }
            };

            await handlePanelRequest(req, res, {
                configFile: file,
                restartOnSave: false
            });

            assert.equal(status, 200);
            assert.equal(JSON.parse(payload).ok, true);
            assert.match(headers["Set-Cookie"], /new-token-123456/);
            const saved = fs.readFileSync(file, "utf8");
            assert.match(saved, /PO18_SETUP_TOKEN="new-token-123456"/);
            assert.match(saved, /PO18_PG_URL="postgres:\/\/user:pass@db:5432\/po18"/);
            assert.match(saved, /PO18_METRICS_TOKEN="[^"]{16,}"/);
        });
    } finally {
        if (previous === undefined) delete process.env.PO18_SETUP_TOKEN;
        else process.env.PO18_SETUP_TOKEN = previous;
    }
});

test("setup query token is exchanged for a cookie and removed from the URL", async () => {
    const previous = process.env.PO18_SETUP_TOKEN;
    try {
        delete process.env.PO18_SETUP_TOKEN;
        await withTempEnv('PO18_SETUP_TOKEN="clean-url-token-123456"\n', async (file) => {
            const req = {
                method: "GET",
                url: "/setup?token=clean-url-token-123456&tab=status",
                headers: {}
            };
            let status = 0;
            let headers = {};
            const res = {
                writeHead(code, nextHeaders) {
                    status = code;
                    headers = nextHeaders;
                },
                end() {}
            };

            await handlePanelRequest(req, res, { configFile: file, restartOnSave: false });
            assert.equal(status, 302);
            assert.equal(headers.Location, "/setup?tab=status");
            assert.match(headers["Set-Cookie"], /po18_setup_token=clean-url-token-123456/);
            assert.doesNotMatch(headers.Location, /token=/);
        });
    } finally {
        if (previous === undefined) delete process.env.PO18_SETUP_TOKEN;
        else process.env.PO18_SETUP_TOKEN = previous;
    }
});

test("setup panel rate limits repeated invalid tokens", async () => {
    const previous = process.env.PO18_SETUP_TOKEN;
    try {
        delete process.env.PO18_SETUP_TOKEN;
        await withTempEnv('PO18_SETUP_TOKEN="rate-token-123456"\n', async (file) => {
            const limiter = createRateWindow({ max: 1, windowMs: 60_000 });
            async function attempt() {
                const req = {
                    method: "GET",
                    url: "/setup?token=wrong-token",
                    headers: {},
                    socket: { remoteAddress: "127.0.0.5" }
                };
                let status = 0;
                let headers = {};
                const res = {
                    writeHead(code, nextHeaders) {
                        status = code;
                        headers = nextHeaders;
                    },
                    end() {}
                };
                await handlePanelRequest(req, res, {
                    configFile: file,
                    restartOnSave: false,
                    setupAuthRateWindow: limiter
                });
                return { status, headers };
            }

            assert.equal((await attempt()).status, 401);
            const blocked = await attempt();
            assert.equal(blocked.status, 429);
            assert.equal(blocked.headers["RateLimit-Limit"], "1");
            assert.equal(blocked.headers["Retry-After"], "60");
        });
    } finally {
        if (previous === undefined) delete process.env.PO18_SETUP_TOKEN;
        else process.env.PO18_SETUP_TOKEN = previous;
    }
});
