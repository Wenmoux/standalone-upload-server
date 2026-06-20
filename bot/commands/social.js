function registerSocialCommands(registry, handlers = {}) {
    const {
        handleMyFav,
        handleRedPacket,
        handleClaimRedPacket,
        handleCrowd,
        handleReview,
        handleReviews
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
        description: "发布书评",
        action: "book_review_publish",
        handler: ({ message, args }) => handleReview(message, args)
    });
    registry.register({
        command: "/reviews",
        description: "查看书评",
        action: "book_reviews",
        handler: ({ message, args }) => handleReviews(message, args)
    });
}

module.exports = { registerSocialCommands };
