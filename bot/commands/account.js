/**
 * [INPUT]: 依赖 command-registry 的注册接口与调用方注入的账户面板、帮助、签到、管理员广播、流水和后台任务处理器
 * [OUTPUT]: 对外提供账户面板、完整帮助与管理员通知域 Telegram 命令的集中注册函数
 * [POS]: bot/commands 的账户命令装配器，只声明命令到处理器的映射，不实现账户或广播业务
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function registerAccountCommands(registry, handlers = {}) {
    const {
        handleStart,
        handleMenu,
        handleHelp,
        handleRegister,
        handleMe,
        handleSign,
        handleRedeem,
        handleGive,
        handleBroadcast,
        handleTop,
        handleTransactions,
        handleTasks,
        handleTask,
        handleCancelJob
    } = handlers;

    registry.register({
        command: "/start",
        description: "打开功能面板",
        action: "start",
        handler: ({ message, args }) => handleStart(message, args)
    });
    registry.register({ command: "/menu", description: "打开功能面板", action: "menu", handler: ({ message }) => handleMenu(message) });
    registry.register({ command: "/help", description: "查看完整帮助", action: "help", handler: ({ message }) => handleHelp(message) });
    registry.register({
        command: "/reg",
        description: "注册账号",
        action: "register",
        handler: ({ message, args }) => handleRegister(message, args)
    });
    registry.register({ command: "/me", description: "我的账户", action: "me", handler: ({ message }) => handleMe(message) });
    registry.register({ command: "/sign", description: "每日签到", action: "sign", handler: ({ message }) => handleSign(message) });
    registry.register({
        command: "/redeem",
        aliases: ["/cdk"],
        description: "兑换下载次数 CDK",
        action: "redeem_cdk",
        handler: ({ message, args }) => handleRedeem(message, args)
    });
    registry.register({
        command: "/give",
        description: "管理员发币",
        action: "give",
        handler: ({ message, args }) => handleGive(message, args)
    });
    registry.register({
        command: "/broadcast",
        description: "管理员发布全员通知",
        action: "broadcast",
        handler: ({ message, args }) => handleBroadcast(message, args)
    });
    registry.register({
        command: "/top",
        description: "货币/经验排行",
        action: "top",
        handler: ({ message, args }) => handleTop(message, args)
    });
    registry.register({ command: "/tasks", description: "我的后台任务", action: "tasks", handler: ({ message }) => handleTasks(message) });
    registry.register({
        command: "/task",
        description: "查看任务详情",
        action: "task",
        handler: ({ message, args }) => handleTask(message, args)
    });
    registry.register({
        command: "/canceljob",
        description: "取消后台任务",
        action: "cancel_job",
        handler: ({ message, args }) => handleCancelJob(message, args)
    });
    registry.register({
        command: "/tx",
        aliases: ["/transactions"],
        description: "币流水",
        action: "transactions",
        handler: ({ message }) => handleTransactions(message)
    });
}

module.exports = { registerAccountCommands };
