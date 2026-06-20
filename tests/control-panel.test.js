const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { handlePanelRequest, importedValuesFromText, loadConfigIntoEnv, setupToken } = require("../docker/control-panel");

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
