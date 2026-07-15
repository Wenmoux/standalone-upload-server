/**
 * [INPUT]: 依赖 node:test、assert、fs/path 与 Reader 组合根、设置面板、样式边界及阅读设置 mixin 源码
 * [OUTPUT]: 提供阅读设置状态机、面板事件、样式拆分和 GEB 契约的自动化回归断言
 * [POS]: tests 的 Reader 结构守卫，以生产构建之外的快速契约阻止设置逻辑或视觉规则重新膨胀组合根
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
    assert.match(reader, /mixins:\s*\[[^\]]*readerSettingsMixin[^\]]*\]/s);
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

test("Reader settings panel owns the drawer markup and emits semantic actions", () => {
    const reader = source("cirno-src/src/views/Reader.vue");
    const panel = source("cirno-src/src/components/reader-settings-panel.vue");
    const controller = source("cirno-src/src/components/reader-settings-panel.js");
    const readerStyle = source("cirno-src/src/styles/reader.less");
    const panelStyle = source("cirno-src/src/styles/reader-settings-panel.less");

    assert.match(reader, /import ReaderSettingsPanel from ['"]\.\.\/components\/reader-settings-panel\.vue['"]/);
    assert.match(reader, /<reader-settings-panel[\s\S]*@update-setting="setReaderSetting"/);
    assert.match(reader, /@tts-action="handleReaderTtsAction"/);
    assert.doesNotMatch(reader, /<a-drawer/);
    assert.match(reader, /<style src="\.\.\/styles\/reader\.less" lang="less" scoped><\/style>/);
    assert.ok(reader.split(/\r?\n/).length < 800, "Reader 组合根应保持在 800 行以内");

    assert.match(panel, /<a-drawer/);
    assert.match(panel, /<script src="\.\/reader-settings-panel\.js"><\/script>/);
    assert.match(panel, /<style src="\.\.\/styles\/reader-settings-panel\.less" lang="less" scoped><\/style>/);
    assert.ok(panel.split(/\r?\n/).length < 800, "设置面板模板应保持在 800 行以内");

    for (const event of ["update-setting", "update-custom-setting", "select-theme", "step-setting", "tts-action"]) {
        assert.match(controller, new RegExp(`['"]${event}['"]`));
    }
    assert.match(readerStyle, /\.book-page\s*\{/);
    assert.doesNotMatch(readerStyle, /\.reader-settings\s*\{/);
    assert.match(panelStyle, /\.reader-settings\s*\{/);
    assert.match(panelStyle, /reader-settings-drawer/);
});
