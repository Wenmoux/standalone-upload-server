/**
 * [INPUT]: 依赖 Bot/Reader 用户对象中的书卷等级与经验投影
 * [OUTPUT]: 对外提供 Telegram/QQ 共用的书卷等级文本
 * [POS]: bot 跨平台账户展示内核，统一等级文案而不携带 HTML、Markdown 或按钮协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function scholarText(user = {}) {
    const scholar = user.scholar || {};
    const level = scholar.level || user.scholar_level || 1;
    const name = scholar.name || user.scholar_level_name || "卷首书童";
    const exp = scholar.exp ?? user.scholar_exp ?? 0;
    const toNext = scholar.exp_to_next ?? 0;
    return `${name} Lv.${level} · 经验 ${exp}${toNext ? ` · 距下一级 ${toNext}` : ""}`;
}

module.exports = { scholarText };
