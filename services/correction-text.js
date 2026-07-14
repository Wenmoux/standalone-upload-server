/**
 * [INPUT]: 依赖 Reader 纠错提交的 Unicode 文本、字符偏移与替换内容
 * [OUTPUT]: 对外提供换行规范化、Unicode 字符计数和精确/首处替换纯函数
 * [POS]: services 的纠错文本规则层，让 Reader 与 Admin 审核共享同一字符偏移语义
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function normalizeCorrectionText(value = "") {
    return String(value || "").replace(/\r\n?/g, "\n");
}

function correctionCharLength(value = "") {
    return Array.from(String(value || "")).length;
}

function replaceFirstText(source = "", search = "", replacement = "") {
    const text = String(source || "");
    const target = String(search || "");
    if (!target) return { changed: false, value: text };
    const index = text.indexOf(target);
    if (index < 0) return { changed: false, value: text };
    return {
        changed: true,
        value: text.slice(0, index) + String(replacement || "") + text.slice(index + target.length)
    };
}

function replaceTextAtCharOffset(source = "", search = "", replacement = "", offset = null) {
    const index = Number(offset);
    const text = String(source || "");
    const target = String(search || "");
    if (!Number.isInteger(index) || index < 0 || !target) return { changed: false, value: text };
    const chars = Array.from(text);
    const targetLength = correctionCharLength(target);
    if (chars.slice(index, index + targetLength).join("") !== target) return { changed: false, value: text };
    chars.splice(index, targetLength, ...Array.from(String(replacement || "")));
    return { changed: true, value: chars.join("") };
}

module.exports = {
    correctionCharLength,
    normalizeCorrectionText,
    replaceFirstText,
    replaceTextAtCharOffset
};
