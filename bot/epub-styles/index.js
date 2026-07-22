/**
 * [INPUT]: 依赖五个 EPUB 样式插件与 services/epub-style-config 的合法配置和样式元数据
 * [OUTPUT]: 对外提供样式解析、默认回退和可用 EPUB 样式列表
 * [POS]: epub-styles 的唯一插件注册表，连接服务端配置语义与 epub-builder 的具体渲染实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const crane = require("./crane");
const styleOne = require("./style-one");
const styleTwo = require("./style-two");
const styleThree = require("./style-three");
const styleFour = require("./style-four");
const { DEFAULT_EPUB_EXPORT_CONFIG, EPUB_STYLE_OPTIONS, normalizeEpubExportConfig } = require("../../services/epub-style-config");

const STYLES = new Map([styleOne, styleTwo, styleThree, styleFour, crane].map((style) => [style.id, style]));

function resolveEpubStyle(value) {
    const config = normalizeEpubExportConfig(value);
    return {
        config,
        style: STYLES.get(config.styleId) || STYLES.get(DEFAULT_EPUB_EXPORT_CONFIG.styleId)
    };
}

function listEpubStyles() {
    return EPUB_STYLE_OPTIONS.map((item) => ({ ...item }));
}

module.exports = { listEpubStyles, resolveEpubStyle };
