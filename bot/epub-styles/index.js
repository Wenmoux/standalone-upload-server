const crane = require("./crane");
const styleOne = require("./style-one");
const styleTwo = require("./style-two");
const styleThree = require("./style-three");
const { DEFAULT_EPUB_EXPORT_CONFIG, EPUB_STYLE_OPTIONS, normalizeEpubExportConfig } = require("../../services/epub-style-config");

const STYLES = new Map([styleOne, styleTwo, styleThree, crane].map((style) => [style.id, style]));

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
