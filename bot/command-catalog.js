const BOT_COMMAND_CATALOG = [
    { command: "/start", group: "账户", description: "查看可用命令", help: "/start" },
    { command: "/reg", group: "账户", description: "注册账号", help: "/reg" },
    { command: "/me", group: "账户", description: "我的账户", help: "/me" },
    { command: "/sign", group: "账户", description: "每日签到", help: "/sign" },
    { command: "/tx", group: "账户", description: "币流水", help: "/tx", aliases: ["/transactions"] },
    { command: "/top", group: "账户", description: "货币/经验排行", help: "/top exp" },
    { command: "/give", group: "账户", description: "管理员发币", help: "/give @user 100", adminOnly: true },
    { command: "/search", group: "搜书", description: "搜索书籍", help: "/search 关键词 [-qd|-fq]" },
    { command: "/hot", group: "搜书", description: "热门书籍", help: "/hot [-qd|-fq]" },
    { command: "/random", group: "搜书", description: "随机推荐", help: "/random [-qd|-fq]" },
    { command: "/info", group: "搜书", description: "书籍详情", help: "/info 书号" },
    { command: "/exporttxt", group: "导出", description: "导出 TXT", help: "/exporttxt 书号" },
    { command: "/exportepub", group: "导出", description: "导出 EPUB", help: "/exportepub 书号" },
    { command: "/myfav", group: "群互动", description: "我的收藏", help: "/myfav" },
    { command: "/hb", group: "群互动", description: "发红包", help: "/hb 100 5", aliases: ["/hongbao"] },
    { command: "/qhb", group: "群互动", description: "抢红包", help: "/qhb", aliases: ["/qiang", "/qianghongbao"] },
    { command: "/crowd", group: "群互动", description: "众筹投票榜", help: "/crowd 书号", aliases: ["/cf", "/zhongchou", "/众筹"] },
    { command: "/review", group: "群互动", description: "发布书评", help: "/review 书号 内容" },
    { command: "/reviews", group: "群互动", description: "查看书评", help: "/reviews 书号" },
    { command: "/pikpak", group: "PO18 / PikPak", description: "PikPak 文件", help: "/pikpak search 关键词", aliases: ["/pp"] },
    { command: "/po18set", group: "PO18 / PikPak", description: "绑定 PO18", help: "/po18set 账号 密码" },
    { command: "/loginpo18", group: "PO18 / PikPak", description: "登录 PO18", help: "/loginpo18" },
    { command: "/po18code", group: "PO18 / PikPak", description: "提交验证码", help: "/po18code 验证码" },
    { command: "/po18status", group: "PO18 / PikPak", description: "PO18 状态", help: "/po18status" },
    { command: "/po18logout", group: "PO18 / PikPak", description: "清除 PO18 登录", help: "/po18logout" },
    { command: "/mybookshelf", group: "PO18 / PikPak", description: "拉取已购书架", help: "/mybookshelf" }
];

function normalizeBotCommand(value = "") {
    const raw = String(value || "").trim().split(/\s+/)[0] || "";
    if (!raw) return "";
    return (raw.startsWith("/") ? raw : `/${raw}`).replace(/@\w+$/i, "").toLowerCase();
}

function commandCatalogMap() {
    const map = new Map();
    for (const item of BOT_COMMAND_CATALOG) {
        const record = { ...item, command: normalizeBotCommand(item.command), aliases: (item.aliases || []).map(normalizeBotCommand) };
        map.set(record.command, record);
        for (const alias of record.aliases) map.set(alias, { ...record, command: alias, primaryCommand: record.command });
    }
    return map;
}

module.exports = {
    BOT_COMMAND_CATALOG,
    commandCatalogMap,
    normalizeBotCommand
};
