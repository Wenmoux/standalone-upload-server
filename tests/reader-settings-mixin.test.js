/**
 * [INPUT]: 依赖 node:test、assert、fs/path 与 Reader 组合根及阅读设置 mixin 源码
 * [OUTPUT]: 提供阅读设置状态机接线、职责下沉和 GEB 契约的自动化回归断言
 * [POS]: tests 的 Reader 结构守卫，以生产构建之外的快速契约阻止设置逻辑重新膨胀组合根
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function source(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Reader delegates settings, themes and display conversion to one mixin", () => {
    const reader = source("cirno-src/src/views/Reader.vue");
    const settings = source("cirno-src/src/mixins/reader-settings.js");

    assert.match(reader, /import readerSettingsMixin from ['"]\.\.\/mixins\/reader-settings['"]/);
    assert.match(reader, /mixins:\s*\[readerCorrectionMixin, readerNavigationMixin, readerSettingsMixin, readerTtsMixin\]/);
    assert.doesNotMatch(reader, /from ['"]\.\.\/utils\/reader-settings['"]/);
    assert.doesNotMatch(reader, /from ['"]\.\.\/utils\/reader-content['"]/);
    assert.doesNotMatch(
        reader,
        /\b(?:normalizeReaderSettings|handleCustomHeaderImageUpload|rebuildChapterDisplayContent)\s*\([^)]*\)\s*\{/
    );

    for (const marker of ["[INPUT]", "[OUTPUT]", "[POS]", "[PROTOCOL]"]) {
        assert.match(settings, new RegExp(`\\${marker}`));
    }
    assert.match(settings, /mounted\(\)\s*\{\s*this\.loadReaderSettings\(\)/);
    assert.match(settings, /['"]readerSettings\.convertMode['"]\s*\([^)]*\)\s*\{/);
    assert.match(settings, /readerThemeStyle\(\)\s*\{/);
    assert.match(settings, /handleCustomHeaderImageUpload\(event\)\s*\{/);
    assert.match(settings, /async rebuildChapterDisplayContent\(\)\s*\{/);
    assert.match(settings, /toggleConvertModeQuick\(\)\s*\{/);
});
