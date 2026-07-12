const EPUB_EXPORT_STYLE_CHOICES = Object.freeze([
    { id: "style1", label: "样式 1 · 江湖纸卷" },
    { id: "style2", label: "老二次元" }
]);

const EPUB_EXPORT_STYLE_IDS = new Set(EPUB_EXPORT_STYLE_CHOICES.map((item) => item.id));

function normalizeEpubStyleChoice(value = "") {
    const id = String(value || "").trim();
    return EPUB_EXPORT_STYLE_IDS.has(id) ? id : "";
}

function epubStyleSelectionMarkup(bookId, callback = (parts) => parts.join("|")) {
    const id = String(bookId || "").trim();
    return {
        inline_keyboard: EPUB_EXPORT_STYLE_CHOICES.map((style) => [
            { text: style.label, callback_data: callback(["epubstyle", style.id, id]) }
        ])
    };
}

module.exports = { EPUB_EXPORT_STYLE_CHOICES, epubStyleSelectionMarkup, normalizeEpubStyleChoice };
