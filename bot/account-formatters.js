function defaultEscape(value) {
    return String(value ?? "");
}

function permissionText(user = {}, stats = {}) {
    if (user.is_admin) return "管理员";
    if (stats.export_unlocked || user.export_unlocked_at) return "已开通导出";
    if (stats.free_export?.available) return "未开通导出（今日可免费）";
    return "未开通导出";
}

function startHelpText({ user, payload, helpLines = [], escapeHtml = defaultEscape, scholarText = () => "" } = {}) {
    const accountLine = user
        ? `账号：${escapeHtml(user.nickname || user.username)} · ${escapeHtml(scholarText(user))} · 铜币 ${user.copper_coins} · 银币 ${user.silver_coins}`
        : "还未注册，发送 /reg 注册。";
    const inviteLine = payload ? `邀请码：<code>${escapeHtml(payload)}</code>` : "";
    return [
        "<b>PO18 找书 Bot</b>",
        accountLine,
        inviteLine,
        ...helpLines
    ].filter(Boolean).join("\n");
}

function registerText(result = {}, { escapeHtml = defaultEscape, scholarText = () => "" } = {}) {
    const user = result.user || {};
    return [
        result.existed ? "你已经注册过了。" : "注册成功，已赠送初始铜币。",
        `账号：${escapeHtml(user.nickname || user.username)}`,
        `等级：${escapeHtml(scholarText(user))}`,
        `每日免费导出：${user.daily_free_exports || user.scholar?.daily_free_exports || 1} 本/天`,
        `铜币：${user.copper_coins}`,
        `银币：${user.silver_coins}`
    ].join("\n");
}

function walletText(user = {}, { escapeHtml = defaultEscape, scholarText = () => "" } = {}) {
    return [
        `<b>${escapeHtml(user.nickname || user.username)}</b> 的钱包`,
        `铜币：${user.copper_coins}`,
        `银币：${user.silver_coins}`,
        `等级：${escapeHtml(scholarText(user))}`,
        `每日免费导出：${user.daily_free_exports || user.scholar?.daily_free_exports || 1} 本/天`,
        `连签：${user.sign_cycle_day || 0} 天`,
        `上次签到：${user.last_sign_date ? String(user.last_sign_date).slice(0, 10) : "-"}`
    ].join("\n");
}

function meText({ user = {}, stats = {}, telegramId = "", escapeHtml = defaultEscape, scholarText = () => "", freeExportText = () => "" } = {}) {
    const signedDate = user.last_sign_date ? String(user.last_sign_date).slice(0, 10) : "-";
    return [
        `<b>我的账户</b>`,
        "",
        `ID：<code>${escapeHtml(user.telegram_id || telegramId)}</code>`,
        `昵称：${escapeHtml(user.nickname || user.telegram_username || user.username || "-")}`,
        "",
        `<b>资产</b>`,
        `铜币：${user.copper_coins || 0}`,
        `银币：${user.silver_coins || 0}`,
        "",
        `<b>书卷等级</b>`,
        `${escapeHtml(scholarText(user))}`,
        `${escapeHtml(freeExportText(stats.free_export || {}))}`,
        "",
        `<b>权限与记录</b>`,
        `权限：${permissionText(user, stats)}`,
        `下载：${stats.download_count || 0} 次`,
        `收藏：${stats.bookshelf_count || 0} 本`,
        `共享：${stats.share_count || 0} 次`,
        "",
        `<b>签到</b>`,
        `连续：${user.sign_cycle_day || 0} 天`,
        `上次：${escapeHtml(signedDate)}`
    ].join("\n");
}

function signSuccessText(result = {}, { escapeHtml = defaultEscape, scholarText = () => "" } = {}) {
    const reward = result.reward || {};
    const user = result.user || {};
    return [
        "签到成功。",
        `本次获得：铜币 ${reward.copper}${reward.silver ? `，银币 ${reward.silver}` : ""}，经验 ${reward.exp || 0}`,
        `连签：${reward.day} 天`,
        `等级：${escapeHtml(scholarText(user))}${reward.level_up ? "（已升级）" : ""}`,
        `当前铜币：${user.copper_coins}`
    ].join("\n");
}

module.exports = {
    meText,
    permissionText,
    registerText,
    signSuccessText,
    startHelpText,
    walletText
};
