function registerAccountCommands(registry, handlers = {}) {
    const {
        handleStart,
        handleRegister,
        handleMe,
        handleSign,
        handleRedeem,
        handleGive,
        handleTop,
        handleTransactions,
        handleTasks,
        handleTask,
        handleCancelJob
    } = handlers;

    registry.register({ command: "/start", description: "查看可用命令", action: "start", handler: ({ message, args }) => handleStart(message, args) });
    registry.register({ command: "/reg", description: "注册账号", action: "register", handler: ({ message, args }) => handleRegister(message, args) });
    registry.register({ command: "/me", description: "我的账户", action: "me", handler: ({ message }) => handleMe(message) });
    registry.register({ command: "/sign", description: "每日签到", action: "sign", handler: ({ message }) => handleSign(message) });
    registry.register({ command: "/redeem", aliases: ["/cdk"], description: "兑换下载次数 CDK", action: "redeem_cdk", handler: ({ message, args }) => handleRedeem(message, args) });
    registry.register({ command: "/give", description: "管理员发币", action: "give", handler: ({ message, args }) => handleGive(message, args) });
    registry.register({ command: "/top", description: "货币/经验排行", action: "top", handler: ({ message, args }) => handleTop(message, args) });
    registry.register({ command: "/tasks", description: "我的后台任务", action: "tasks", handler: ({ message }) => handleTasks(message) });
    registry.register({ command: "/task", description: "查看任务详情", action: "task", handler: ({ message, args }) => handleTask(message, args) });
    registry.register({ command: "/canceljob", description: "取消后台任务", action: "cancel_job", handler: ({ message, args }) => handleCancelJob(message, args) });
    registry.register({
        command: "/tx",
        aliases: ["/transactions"],
        description: "币流水",
        action: "transactions",
        handler: ({ message }) => handleTransactions(message)
    });
}

module.exports = { registerAccountCommands };
