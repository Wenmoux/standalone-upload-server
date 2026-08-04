/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供配置解析、默认值和安全校验的自动化回归断言
 * [POS]: tests 的配置解析、默认值和安全校验守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供配置解析、默认值和安全校验的自动化回归断言
 * [POS]: tests 的配置解析、默认值和安全校验守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createConfigService, exportPricingPayload, normalizePlatformKey, parsePlatformLabels } = require("../services/config");

test("config helpers normalize labels and pricing", () => {
    assert.equal(normalizePlatformKey(" PO-18 "), "po18");
    assert.deepEqual(parsePlatformLabels('{" PO18 ":" Main ","empty":"","bad":null}'), { PO18: "Main" });
    const pricing = exportPricingPayload({ unlockCost: -1, freeCopperCost: "12.8", paidChapterSilverCost: "bad" });
    assert.deepEqual(
        {
            unlockCost: pricing.unlockCost,
            freeCopperCost: pricing.freeCopperCost,
            paidChapterSilverCost: pricing.paidChapterSilverCost,
            dailyQuotaByLevel: pricing.dailyQuotaByLevel
        },
        {
            unlockCost: 0,
            freeCopperCost: 12,
            paidChapterSilverCost: 10,
            dailyQuotaByLevel: {}
        }
    );
    assert.equal(pricing.epub.styleId, "style1");
    assert.equal(pricing.epubStyles.find((style) => style.id === "style1")?.name, "江湖纸卷");
    assert.equal(pricing.epubStyles.find((style) => style.id === "style2")?.name, "老二次元");
    assert.equal(pricing.epubStyles.find((style) => style.id === "style3")?.name, "空门夜雨");
    assert.equal(pricing.epubStyles.find((style) => style.id === "style4")?.name, "丹青云卷");
    assert.equal(pricing.epubStyles.find((style) => style.id === "studio")?.name, "模板工坊");
    assert.equal(pricing.epubStyles.find((style) => style.id === "studio")?.direct, false);
    assert.ok(pricing.epubStyles.some((style) => style.id === "crane"));
    const style2 = exportPricingPayload({
        epub: {
            styleId: "style2",
            style2: { customCss: "@import url(x); body{color:red}", fontFamily: "Songti SC; color:red", volumeTitle: "正文" }
        }
    }).epub;
    assert.equal(style2.styleId, "style2");
    assert.equal(style2.style2.customCss, "body{color:red}");
    assert.doesNotMatch(style2.style2.fontFamily, /;/);
    assert.equal(Object.hasOwn(style2.style2, "volumeTitle"), false);
    assert.equal(exportPricingPayload({ epub: { styleId: "style3" } }).epub.styleId, "style3");
    assert.deepEqual(exportPricingPayload({ dailyQuotaByLevel: { 3: "2", 2: "1", bad: 9 } }).dailyQuotaByLevel, { 2: 1, 3: 2 });
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
        bot_export_paid_chapter_silver_cost: "bad",
        bot_export_daily_quota_by_level: '{"2":1,"3":2}',
        bot_epub_style_config: JSON.stringify({ styleId: "crane", includeColophon: false, introTitle: "简介" })
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
    assert.deepEqual(
        platforms.platforms.map((row) => row.value),
        ["po18", "qidian", "custom"]
    );
    assert.equal(platforms.platforms[0].label, "PO18 Custom");
    assert.equal(platforms.platforms[1].label, "\u8d77\u70b9");

    const exportConfig = await service.exportPricingConfig();
    assert.equal(exportConfig.unlockCost, 75);
    assert.equal(exportConfig.freeCopperCost, 250);
    assert.equal(exportConfig.paidChapterSilverCost, 12);
    assert.deepEqual(exportConfig.dailyQuotaByLevel, { 2: 1, 3: 2 });
    assert.equal(exportConfig.epub.styleId, "crane");
    assert.equal(exportConfig.epub.includeColophon, false);
    assert.equal(exportConfig.epub.introTitle, "简介");
});
