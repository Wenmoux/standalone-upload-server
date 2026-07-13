/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供老二次元样式资源解析与回退的自动化回归断言
 * [POS]: tests 的老二次元样式资源解析与回退守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const test = require("node:test");
const { createEpubStyle2AssetService } = require("../services/epub-style2-assets");

const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64");

test("style2 asset service reports dimensions and persists custom images", async (t) => {
    const customDir = await fs.mkdtemp(path.join(os.tmpdir(), "po18-style2-assets-"));
    t.after(() => fs.rm(customDir, { recursive: true, force: true }));
    const service = createEpubStyle2AssetService({ customDir, configFile: path.join(customDir, "app.env") });

    const initial = await service.listAssets();
    assert.deepEqual(
        initial.map((item) => item.slot),
        ["title-background", "colophon-background", "intro-background", "volume", "chapter"]
    );
    const title = initial.find((item) => item.slot === "title-background");
    assert.equal(title.recommendedWidth, 687);
    assert.equal(title.recommendedHeight, 1415);
    assert.equal(title.custom, false);
    assert.equal(
        initial.some((item) => ["note", "publisher", "volume-2", "chapter-2", "chapter-3"].includes(item.slot)),
        false
    );

    await fs.writeFile(path.join(customDir, "chapter-1.asset"), ONE_PIXEL_PNG);
    const legacy = await service.resolveAsset("chapter");
    assert.equal(legacy.custom, true);
    assert.equal(legacy.width, 1);
    await service.restoreAsset("chapter");
    assert.equal((await service.resolveAsset("chapter")).custom, false);

    const uploaded = await service.uploadAsset("title-background", Readable.from([ONE_PIXEL_PNG]));
    assert.equal(uploaded.custom, true);
    assert.equal(uploaded.mediaType, "image/png");
    assert.equal(uploaded.width, 1);
    assert.equal(uploaded.height, 1);

    const custom = await service.resolveAsset("title-background");
    assert.equal(custom.custom, true);
    assert.equal(custom.width, 1);
    assert.equal(custom.height, 1);

    await service.restoreAsset("title-background");
    assert.equal((await service.resolveAsset("title-background")).custom, false);
});
