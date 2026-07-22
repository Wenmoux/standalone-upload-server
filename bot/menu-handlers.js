/**
 * [INPUT]: 依赖 Telegram 文本投递、主/PO18 面板格式器及既有搜索、账户、任务和 PO18 领域处理器
 * [OUTPUT]: 对外提供面板 callback action 到既有领域处理器的集中分派函数
 * [POS]: bot 的功能面板交互层，只编排入口按钮，不复制收藏、导出、书评等书籍卡片动作
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function createMenuHandlers(options = {}) {
    const sendMessage = options.sendMessage;
    const mainMenuMarkup = options.mainMenuMarkup;
    const po18MenuText = options.po18MenuText;
    const po18MenuMarkup = options.po18MenuMarkup;
    const handleMenu = options.handleMenu;
    const handleHelp = options.handleHelp;
    const handleHot = options.handleHot;
    const handleRandom = options.handleRandom;
    const handleWordCloud = options.handleWordCloud;
    const handleMe = options.handleMe;
    const handleSign = options.handleSign;
    const handleTasks = options.handleTasks;
    const handleTop = options.handleTop;
    const handlePo18Status = options.handlePo18Status;
    const handleLoginPo18 = options.handleLoginPo18;
    const scheduleMyBookshelf = options.scheduleMyBookshelf;
    const withSearchCooldown = options.withSearchCooldown || ((message, label, handler) => handler());
    const withBookshelfCooldown = options.withBookshelfCooldown || ((message, label, handler) => handler());

    async function handleMenuAction(message, action) {
        if (action === "home") return handleMenu(message);
        if (action === "help") return handleHelp(message);
        if (action === "search") {
            return sendMessage(
                message.chat.id,
                [
                    "<b>搜索书籍</b>",
                    "直接发送书名、作者或书号即可搜索。",
                    "标签可写成 <code>#古言</code> 或 <code>标签：古言</code>；末尾加 <code>-qd</code>、<code>-fq</code>、<code>-hetu</code> 等平台后缀可限定站点。"
                ].join("\n"),
                { reply_markup: mainMenuMarkup() }
            );
        }
        if (action === "hot") return withSearchCooldown(message, "热门", () => handleHot(message, ""));
        if (action === "random") return withSearchCooldown(message, "随机推荐", () => handleRandom(message, ""));
        if (action === "wordcloud") return withSearchCooldown(message, "词云", () => handleWordCloud(message, ""));
        if (action === "me") return handleMe(message);
        if (action === "sign") return handleSign(message);
        if (action === "tasks") return handleTasks(message);
        if (action === "top") return handleTop(message, "exp");
        if (action === "po18") {
            return sendMessage(message.chat.id, po18MenuText(), { reply_markup: po18MenuMarkup() });
        }
        if (action === "po18status") return handlePo18Status(message);
        if (action === "po18login") return handleLoginPo18(message);
        if (action === "bookshelf") {
            return withBookshelfCooldown(message, "PO18 书架同步", () => scheduleMyBookshelf(message));
        }
        return handleMenu(message);
    }

    return { handleMenuAction };
}

module.exports = { createMenuHandlers };
