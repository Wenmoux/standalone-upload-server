const { expect, test } = require("@playwright/test");

const BASE_URL = String(process.env.PO18_SMOKE_BASE_URL || "http://127.0.0.1:3100").replace(/\/+$/, "");
const READER_URL = String(process.env.PO18_SMOKE_READER_URL || "http://127.0.0.1:3200").replace(/\/+$/, "");

test("backend exposes health and a nonblank admin/setup page", async ({ page, request }) => {
    const live = await request.get(`${BASE_URL}/health/live`);
    expect(live.status(), "/health/live should be reachable").toBe(200);

    const version = await request.get(`${BASE_URL}/health/version`);
    expect(version.status(), "/health/version should be reachable").toBe(200);

    const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    expect(response.status(), "admin/setup root should not be a server error").toBeLessThan(500);
    await page.waitForFunction(() => document.body.innerText.trim().length > 0);
    const text = await page.locator("body").innerText();
    expect(text.trim().length, "admin/setup page should not be blank").toBeGreaterThan(0);
});

test("reader port renders a nonblank page", async ({ page, request }) => {
    const ready = await request.get(`${READER_URL}/health/ready`).catch(() => null);
    if (ready) expect(ready.status(), "/health/ready should not be a server error").toBeLessThan(500);

    const response = await page.goto(READER_URL, { waitUntil: "domcontentloaded" });
    expect(response.status(), "reader root should not be a server error").toBeLessThan(500);
    await page.waitForFunction(() => document.body.innerText.trim().length > 0);
    const text = await page.locator("body").innerText();
    expect(text.trim().length, "reader page should not be blank").toBeGreaterThan(0);
});
