/**
 * [INPUT]: 依赖产品允许在 Telegram 直接选择的 EPUB 样式白名单和 64 字节 callback_data 约束
 * [OUTPUT]: 对外提供样式选项、白名单规范化和 EPUB 样式 inline keyboard 构造能力
 * [POS]: bot 交互层的 EPUB 样式选择边界，刻意隐藏仅用于历史兼容的生成器样式
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const EPUB_EXPORT_STYLE_CHOICES = Object.freeze([
    { id: "style1", label: "江湖纸卷" },
    { id: "style2", label: "老二次元" },
    { id: "style3", label: "疏影横斜" }
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
