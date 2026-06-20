const assert = require("assert/strict");
const test = require("node:test");
const {
    createConfigService,
    exportPricingPayload,
    normalizePlatformKey,
    parsePlatformLabels
} = require("../services/config");

test("config helpers normalize labels and pricing", () => {
    assert.equal(normalizePlatformKey(" PO-18 "), "po18");
    assert.deepEqual(parsePlatformLabels('{" PO18 ":" Main ","empty":"","bad":null}'), { PO18: "Main" });
    assert.deepEqual(exportPricingPayload({ unlockCost: -1, freeCopperCost: "12.8", paidChapterSilverCost: "bad" }), {
        unlockCost: 0,
        freeCopperCost: 12,
        paidChapterSilverCost: 10
    });
});

test("config service reads, writes, builds platform payload and export pricing", async (t) => {
    const previousUnlock = process.env.PO18_BOT_EXPORT_UNLOCK_COST;
    const previousPaid = process.env.PO18_BOT_EXPORT_PAID_CHAPTER_SILVER_COST;
    process.env.PO18_BOT_EXPORT_UNLOCK_COST = "75";
    process.env.PO18_BOT_EXPORT_PAID_CHAPTER_SILVER_COST = "12";
    t.after(() => {
        if (previousUnlock === undefined) delete process.env.PO18_BOT_EXPORT_UNLOCK_COST;
        else process.env.PO18_BOT_EXPORT_UNLOCK_COST = previousUnlock;
        if (previousPaid === undefined) delete process.env.PO18_BOT_EXPORT_PAID_CHAPTER_SILVER_COST;
        else process.env.PO18_BOT_EXPORT_PAID_CHAPTER_SILVER_COST = previousPaid;
    });

    const stored = {
        platform_labels: JSON.stringify({ " PO18 ": "PO18 Custom", custom: "Custom Site" }),
        bot_export_unlock_cost: "",
        bot_export_free_copper_cost: "250",
        bot_export_paid_chapter_silver_cost: "bad"
    };
    const service = createConfigService({
        cleanPgText: (value) => String(value || "").replace(/\u0000/g, ""),
        query: async (sql, params = []) => {
            if (/SELECT value FROM admin_config/.test(sql)) {
                const value = stored[params[0]];
                return { rows: value === undefined ? [] : [{ value }] };
            }
            if (/INSERT INTO admin_config/.test(sql)) {
                stored[params[0]] = params[1];
                return { rows: [] };
            }
            if (/FROM book_metadata/.test(sql)) {
                return {
                    rows: [
                        { platform: "po18", count: 3 },
                        { platform: "qidian", count: 2 },
                        { platform: "custom", count: 1 }
                    ]
                };
            }
            throw new Error(`unexpected query: ${sql}`);
        }
    });

    await service.configSet("upload\u0000mode", "safe\u0000");
    assert.equal(stored.uploadmode, "safe");

    const labels = await service.platformLabelConfig();
    assert.equal(labels.po18, "PO18");
    assert.equal(labels.PO18, "PO18 Custom");
    assert.equal(labels.qidian, "\u8d77\u70b9");

    const platforms = await service.platformConfigPayload();
    assert.deepEqual(platforms.platforms.map((row) => row.value), ["po18", "qidian", "custom"]);
    assert.equal(platforms.platforms[0].label, "PO18 Custom");
    assert.equal(platforms.platforms[1].label, "\u8d77\u70b9");

    assert.deepEqual(await service.exportPricingConfig(), {
        unlockCost: 75,
        freeCopperCost: 250,
        paidChapterSilverCost: 12
    });
});
