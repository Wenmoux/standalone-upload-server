const DEFAULT_PLATFORM_LABELS = {
    po18: "PO18",
    popo: "POPO",
    qidian: "\u8d77\u70b9",
    qd: "\u8d77\u70b9",
    fanqie: "\u756a\u8304",
    fq: "\u756a\u8304",
    tomato: "\u756a\u8304",
    miguodu: "\u7c73\u56fd\u5ea6",
    migudu: "\u7c73\u56fd\u5ea6",
    miguo: "\u7c73\u56fd\u5ea6",
    hetu: "\u6cb3\u56fe",
    haitang: "\u6d77\u68e0",
    ht: "\u6d77\u68e0",
    longma: "\u9f99\u9a6c",
    lianhongxintiao: "\u8138\u7ea2\u5fc3\u8df3",
    lianhong: "\u8138\u7ea2\u5fc3\u8df3",
    lhxt: "\u8138\u7ea2\u5fc3\u8df3"
};

function cleanPlatformKey(value = "") {
    return String(value || "").trim();
}

function normalizePlatformKey(value = "") {
    return cleanPlatformKey(value).toLowerCase().replace(/[\s_-]+/g, "");
}

function parsePlatformLabels(value = "") {
    try {
        const parsed = JSON.parse(value || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const labels = {};
        for (const [key, label] of Object.entries(parsed)) {
            const cleanKey = cleanPlatformKey(key);
            const cleanLabel = String(label || "").trim();
            if (cleanKey && cleanLabel) labels[cleanKey] = cleanLabel;
        }
        return labels;
    } catch {
        return {};
    }
}

function nonNegativeInt(value, fallback = 0) {
    const parsedFallback = Number(fallback);
    const safeFallback = Number.isFinite(parsedFallback) ? Math.max(0, Math.trunc(parsedFallback)) : 0;
    if (value === "" || value === null || value === undefined) return safeFallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return safeFallback;
    return Math.max(0, Math.trunc(parsed));
}

function exportPricingPayload(config = {}) {
    return {
        unlockCost: nonNegativeInt(config.unlockCost, 100),
        freeCopperCost: nonNegativeInt(config.freeCopperCost, 100),
        paidChapterSilverCost: nonNegativeInt(config.paidChapterSilverCost, 10)
    };
}

function createConfigService(options = {}) {
    const query = options.query;
    const cleanPgText = options.cleanPgText || ((value) => value);

    async function configGet(key) {
        if (typeof query !== "function") throw new Error("config query function is not configured");
        const result = await query("SELECT value FROM admin_config WHERE key = $1", [key]);
        return result.rows[0]?.value || "";
    }

    async function configSet(key, value) {
        if (typeof query !== "function") throw new Error("config query function is not configured");
        await query(
            `INSERT INTO admin_config(key, value, updated_at)
             VALUES ($1, $2, CURRENT_TIMESTAMP)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [cleanPgText(key), cleanPgText(value)]
        );
    }

    async function platformLabelConfig() {
        const stored = parsePlatformLabels(await configGet("platform_labels"));
        return { ...DEFAULT_PLATFORM_LABELS, ...stored };
    }

    async function platformUsageRows() {
        const result = await query(
            `SELECT NULLIF(TRIM(platform), '') platform, COUNT(*)::int count
             FROM book_metadata
             WHERE NULLIF(TRIM(platform), '') IS NOT NULL
             GROUP BY NULLIF(TRIM(platform), '')
             ORDER BY count DESC, platform ASC`
        );
        return result.rows || [];
    }

    async function platformConfigPayload() {
        const [storedRaw, usageRows] = await Promise.all([configGet("platform_labels"), platformUsageRows()]);
        const storedLabels = parsePlatformLabels(storedRaw);
        const labels = { ...DEFAULT_PLATFORM_LABELS, ...storedLabels };
        const knownKeys = new Set([
            ...Object.keys(storedLabels).map(normalizePlatformKey),
            ...usageRows.map((row) => normalizePlatformKey(row.platform))
        ]);
        const platforms = [...knownKeys]
            .filter(Boolean)
            .map((key) => {
                const usage = usageRows.find((row) => normalizePlatformKey(row.platform) === key);
                const storedEntry = Object.entries(storedLabels).find(([raw]) => normalizePlatformKey(raw) === key);
                const defaultEntry = Object.entries(DEFAULT_PLATFORM_LABELS).find(([raw]) => normalizePlatformKey(raw) === key);
                const value = usage?.platform || storedEntry?.[0] || defaultEntry?.[0] || key;
                const label = storedEntry?.[1] || defaultEntry?.[1] || value;
                return {
                    value,
                    label,
                    count: Number(usage?.count || 0),
                    configured: !!storedEntry,
                    defaultLabel: defaultEntry?.[1] || ""
                };
            })
            .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
        return { labels, platforms };
    }

    async function exportPricingConfig() {
        const [unlockCost, freeCopperCost, paidChapterSilverCost] = await Promise.all([
            configGet("bot_export_unlock_cost"),
            configGet("bot_export_free_copper_cost"),
            configGet("bot_export_paid_chapter_silver_cost")
        ]);
        return exportPricingPayload({
            unlockCost: nonNegativeInt(unlockCost, process.env.PO18_BOT_EXPORT_UNLOCK_COST ?? 100),
            freeCopperCost: nonNegativeInt(freeCopperCost, process.env.PO18_BOT_EXPORT_FREE_COPPER_COST ?? 100),
            paidChapterSilverCost: nonNegativeInt(paidChapterSilverCost, process.env.PO18_BOT_EXPORT_PAID_CHAPTER_SILVER_COST ?? 10)
        });
    }

    return {
        cleanPlatformKey,
        configGet,
        configSet,
        exportPricingConfig,
        exportPricingPayload,
        nonNegativeInt,
        normalizePlatformKey,
        parsePlatformLabels,
        platformConfigPayload,
        platformLabelConfig,
        platformUsageRows
    };
}

module.exports = {
    DEFAULT_PLATFORM_LABELS,
    cleanPlatformKey,
    createConfigService,
    exportPricingPayload,
    nonNegativeInt,
    normalizePlatformKey,
    parsePlatformLabels
};
