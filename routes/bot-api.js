/**
 * [INPUT]: 依赖 Express 与 Bot system/users/red-packets/social/library 子路由工厂
 * [OUTPUT]: 对外提供 createBotApiRoutes，组合 Telegram Bot 所需全部内部 HTTP API
 * [POS]: routes 的 Bot API 纯组合边界，固定子域挂载顺序且不再持有 SQL、凭据或余额结算规则
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const express = require("express");
const { createBotApiLibraryRoutes } = require("./bot-api-library");
const { createBotApiRedPacketRoutes } = require("./bot-api-red-packets");
const { createBotApiSocialRoutes } = require("./bot-api-social");
const { createBotApiSystemRoutes } = require("./bot-api-system");
const { createBotApiUserRoutes } = require("./bot-api-users");

function createBotApiRoutes(deps = {}) {
    const router = express.Router();
    router.use(createBotApiSystemRoutes(deps));
    router.use(createBotApiUserRoutes(deps));
    router.use(createBotApiRedPacketRoutes(deps));
    router.use(createBotApiSocialRoutes(deps));
    router.use(createBotApiLibraryRoutes(deps));
    return router;
}

module.exports = { createBotApiRoutes };
