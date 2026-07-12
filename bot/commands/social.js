/**
 * [INPUT]: 依赖 command-registry 与收藏、红包、众筹、引导式书评、审核和申诉领域处理器
 * [OUTPUT]: 对外提供群互动、兼容书评命令与书评治理命令的集中注册函数
 * [POS]: bot/commands 的社交命令装配器，只定义 Telegram 命令边界并把执行委托给领域处理层
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function registerSocialCommands(registry, handlers = {}) {
    const {
        handleMyFav,
        handleRedPacket,
        handleClaimRedPacket,
        handleCrowd,
        handleReview,
        handleReviews,
        handleReportReview,
        handleAppealReview
    } = handlers;

    registry.register({ command: "/myfav", description: "我的收藏", action: "myfav", handler: ({ message }) => handleMyFav(message) });
    registry.register({
        command: "/hb",
        aliases: ["/hongbao"],
        description: "发红包",
        action: "red_packet_create",
        handler: ({ message, args }) => handleRedPacket(message, args)
    });
    registry.register({
        command: "/qhb",
        aliases: ["/qiang", "/qianghongbao"],
        description: "抢红包",
        action: "red_packet_claim",
        handler: ({ message }) => handleClaimRedPacket(message)
    });
    registry.register({
        command: "/crowd",
        aliases: ["/cf", "/zhongchou", "/众筹"],
        description: "众筹投票榜",
        action: "crowd",
        handler: ({ message, args }) => handleCrowd(message, args)
    });
    registry.register({
        command: "/review",
        description: "引导发布书评",
        action: "book_review_publish",
        handler: ({ message, args }) => handleReview(message, args)
    });
    registry.register({
        command: "/reviews",
        description: "查看书评",
        action: "book_reviews",
        handler: ({ message, args }) => handleReviews(message, args)
    });
    registry.register({
        command: "/reportreview",
        description: "举报书评",
        action: "book_review_report",
        handler: ({ message, args }) => handleReportReview(message, args)
    });
    registry.register({
        command: "/appealreview",
        description: "申诉书评审核",
        action: "book_review_appeal",
        handler: ({ message, args }) => handleAppealReview(message, args)
    });
}

module.exports = { registerSocialCommands };
