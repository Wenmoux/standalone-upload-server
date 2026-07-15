/**
 * [INPUT]: 依赖 Telegram Bot 已实现命令的产品语义与别名约定
 * [OUTPUT]: 对外提供 BOT_COMMAND_CATALOG、精简 Telegram 系统菜单投影、命令索引、规范化与分组查询能力
 * [POS]: bot 命令面的单一元数据源，被帮助信息和命令注册一致性检查共同消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const BOT_COMMAND_CATALOG = [
    { command: "/start", group: "账户", description: "打开功能面板", help: "/start" },
    { command: "/menu", group: "账户", description: "打开功能面板", help: "/menu", telegramMenu: true },
    { command: "/help", group: "账户", description: "查看完整帮助", help: "/help" },
    { command: "/reg", group: "账户", description: "注册账号", help: "/reg" },
    { command: "/me", group: "账户", description: "我的账户", help: "/me", telegramMenu: true },
    { command: "/sign", group: "账户", description: "每日签到", help: "/sign", telegramMenu: true },
    { command: "/tx", group: "账户", description: "币流水", help: "/tx", aliases: ["/transactions"] },
    { command: "/redeem", group: "账户", description: "兑换下载次数 CDK", help: "/redeem CDK-XXXX-XXXX", aliases: ["/cdk"] },
    { command: "/top", group: "账户", description: "货币/经验排行", help: "/top exp" },
    { command: "/tasks", group: "任务", description: "查看后台任务", help: "/tasks", telegramMenu: true },
    { command: "/task", group: "任务", description: "查看任务详情", help: "/task 任务号" },
    { command: "/canceljob", group: "任务", description: "取消排队或运行任务", help: "/canceljob 任务号" },
    { command: "/give", group: "账户", description: "管理员发币", help: "/give TelegramID 铜币 100", adminOnly: true },
    { command: "/broadcast", group: "账户", description: "管理员发布全员通知", help: "/broadcast [通知内容]", adminOnly: true },
    { command: "/search", group: "搜书", description: "搜索书籍", help: "/search 关键词 [-qd|-fq]", telegramMenu: true },
    { command: "/hot", group: "搜书", description: "热门书籍", help: "/hot [-qd|-fq]", telegramMenu: true },
    { command: "/wordcloud", group: "搜书", description: "热搜词云", help: "/wordcloud [-qd|-fq]", aliases: ["/cloud"] },
    { command: "/random", group: "搜书", description: "随机推荐", help: "/random [-qd|-fq]", telegramMenu: true },
    { command: "/info", group: "搜书", description: "书籍详情", help: "/info 书号" },
    { command: "/exporttxt", group: "导出", description: "导出 TXT", help: "/exporttxt 书号" },
    { command: "/exportepub", group: "导出", description: "导出 EPUB", help: "/exportepub 书号" },
    { command: "/myfav", group: "群互动", description: "我的收藏", help: "/myfav" },
    { command: "/hb", group: "群互动", description: "发红包", help: "/hb 100 5", aliases: ["/hongbao"] },
    { command: "/qhb", group: "群互动", description: "抢红包", help: "/qhb", aliases: ["/qiang", "/qianghongbao"] },
    { command: "/crowd", group: "群互动", description: "众筹投票榜", help: "/crowd 书号", aliases: ["/cf", "/zhongchou", "/众筹"] },
    { command: "/review", group: "群互动", description: "引导发布书评", help: "/review 书号 [内容]" },
    { command: "/reviews", group: "群互动", description: "查看书评", help: "/reviews 书号" },
    { command: "/reportreview", group: "群互动", description: "举报书评", help: "/reportreview 书评号 原因 说明" },
    { command: "/appealreview", group: "群互动", description: "申诉书评", help: "/appealreview 书评号 申诉说明" },
    { command: "/pikpak", group: "PO18 / PikPak", description: "PikPak 文件", help: "/pikpak search 关键词", aliases: ["/pp"] },
    { command: "/po18set", group: "PO18 / PikPak", description: "绑定 PO18", help: "/po18set 账号 密码" },
    { command: "/loginpo18", group: "PO18 / PikPak", description: "登录 PO18", help: "/loginpo18" },
    { command: "/po18code", group: "PO18 / PikPak", description: "提交验证码", help: "/po18code 验证码" },
    { command: "/po18status", group: "PO18 / PikPak", description: "PO18 登录状态", help: "/po18status", telegramMenu: true },
    { command: "/po18logout", group: "PO18 / PikPak", description: "清除 PO18 登录", help: "/po18logout" },
    { command: "/mybookshelf", group: "PO18 / PikPak", description: "拉取已购书架", help: "/mybookshelf" }
];

function normalizeBotCommand(value = "") {
    const raw =
        String(value || "")
            .trim()
            .split(/\s+/)[0] || "";
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
