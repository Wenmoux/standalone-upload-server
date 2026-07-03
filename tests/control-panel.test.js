const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { handlePanelRequest, importedValuesFromText, loadConfigIntoEnv, setupToken, versionPayload } = require("../docker/control-panel");

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

test("version payload exposes runtime app version and build metadata", () => {
    const previous = {
        PO18_APP_VERSION: process.env.PO18_APP_VERSION,
        PO18_IMAGE_TAG: process.env.PO18_IMAGE_TAG,
        PO18_BUILD_DATE: process.env.PO18_BUILD_DATE,
        PO18_BUILD_REVISION: process.env.PO18_BUILD_REVISION
    };
    try {
        process.env.PO18_APP_VERSION = "1.0.0+test";
        process.env.PO18_IMAGE_TAG = "wenmoux/reader:test";
        process.env.PO18_BUILD_DATE = "2026-06-23T12:00:00.000Z";
        process.env.PO18_BUILD_REVISION = "abc123def456";

        const payload = versionPayload("unit-test");
        assert.equal(payload.service, "unit-test");
        assert.equal(payload.version, "1.0.0+test");
        assert.equal(payload.image, "wenmoux/reader:test");
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
        PO18_BUILD_DATE: process.env.PO18_BUILD_DATE,
        PO18_BUILD_REVISION: process.env.PO18_BUILD_REVISION
    };
    const hadBuildInfo = fs.existsSync(buildInfoFile);
    const oldBuildInfo = hadBuildInfo ? fs.readFileSync(buildInfoFile, "utf8") : "";
    try {
        fs.writeFileSync(buildInfoFile, JSON.stringify({
            version: "1.0.0+image",
            image: "wenmoux/reader:v1.0",
            build_date: "2026-06-28T16:12:44.322Z",
            build_revision: "image-rev"
        }));
        process.env.PO18_APP_VERSION = "1.0.0+runtime-old";
        process.env.PO18_IMAGE_TAG = "wenmoux/reader:runtime-old";
        process.env.PO18_BUILD_DATE = "2026-06-23T12:00:00.000Z";
        process.env.PO18_BUILD_REVISION = "runtime-rev";

        const payload = versionPayload("unit-test");
        assert.equal(payload.version, "1.0.0+image");
        assert.equal(payload.runtime_version, "1.0.0+runtime-old");
        assert.equal(payload.image, "wenmoux/reader:v1.0");
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
        const { values, importedCount } = importedValuesFromText([
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
        ].join("\n"), file);

        assert.equal(importedCount, 8);
        assert.equal(values.PO18_SETUP_TOKEN, "next-token-123456");
        assert.equal(values.TELEGRAM_BOT_TOKEN, "telegram-token");
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
        });
    } finally {
        if (previous === undefined) delete process.env.PO18_SETUP_TOKEN;
        else process.env.PO18_SETUP_TOKEN = previous;
    }
});
