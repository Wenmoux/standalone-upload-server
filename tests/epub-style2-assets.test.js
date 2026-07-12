const assert = require("assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const test = require("node:test");
const { createEpubStyle2AssetService } = require("../services/epub-style2-assets");

const ONE_PIXEL_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
    "base64"
);

test("style2 asset service reports dimensions and persists custom images", async (t) => {
    const customDir = await fs.mkdtemp(path.join(os.tmpdir(), "po18-style2-assets-"));
    t.after(() => fs.rm(customDir, { recursive: true, force: true }));
    const service = createEpubStyle2AssetService({ customDir, configFile: path.join(customDir, "app.env") });

    const initial = await service.listAssets();
    const title = initial.find((item) => item.slot === "title-background");
    assert.equal(title.recommendedWidth, 687);
    assert.equal(title.recommendedHeight, 1415);
    assert.equal(title.custom, false);

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
