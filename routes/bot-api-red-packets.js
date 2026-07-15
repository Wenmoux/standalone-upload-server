/**
 * [INPUT]: 依赖 Express、Bot Token 鉴权、红包领域服务与 Bot 用户公开投影
 * [OUTPUT]: 对外提供红包创建和领取 HTTP 路由工厂
 * [POS]: routes 的 Bot 红包协议适配层，只映射兼容字段、状态码与公开响应，不持有余额结算 SQL
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const express = require("express");

function createBotApiRedPacketRoutes(deps = {}) {
    const router = express.Router();
    const { requireBotApi, createRedPacket, claimRedPacket, botPublicUser } = deps;

    router.post("/bot-api/red-packets", requireBotApi, async (req, res, next) => {
        try {
            const result = await createRedPacket({
                senderTelegramId: req.body?.sender_telegram_id || req.body?.senderTelegramId,
                targetTelegramId: req.body?.target_telegram_id || req.body?.targetTelegramId || "",
                chatId: req.body?.chat_id || req.body?.chatId || "",
                currency: req.body?.currency,
                totalAmount: req.body?.total_amount ?? req.body?.totalAmount,
                totalCount: req.body?.total_count ?? req.body?.totalCount,
                note: req.body?.note,
                idempotencyKey: req.body?.idempotency_key || req.body?.idempotencyKey || ""
            });
            res.json({
                success: true,
                repeated: !!result.repeated,
                packet: result.packet,
                sender: botPublicUser(result.sender),
                target: botPublicUser(result.target),
                claim: result.claim || null
            });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message, code: error.code || undefined });
            next(error);
        }
    });

    router.post("/bot-api/red-packets/claim", requireBotApi, async (req, res, next) => {
        try {
            const result = await claimRedPacket({
                telegramId: req.body?.telegram_id || req.body?.telegramId,
                chatId: req.body?.chat_id || req.body?.chatId || "",
                packetId: req.body?.packet_id ?? req.body?.packetId ?? ""
            });
            if (result.expired) {
                return res.status(410).json({
                    error: "红包已过期，剩余金额已退回发送者",
                    code: "RED_PACKET_EXPIRED",
                    refunded: result.refunded,
                    currency: result.currency,
                    packet: result.packet
                });
            }
            res.json({
                success: true,
                repeated: !!result.repeated,
                amount: result.amount,
                currency: result.currency,
                packet: result.packet,
                claim: result.claim,
                user: botPublicUser(result.user)
            });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message, code: error.code || undefined });
            next(error);
        }
    });

    return router;
}

module.exports = { createBotApiRedPacketRoutes };
