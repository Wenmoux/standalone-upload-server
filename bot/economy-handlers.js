/**
 * [INPUT]: 依赖 PgBotClient、注册用户保障、Telegram 投递与币种/流水/红包格式器
 * [OUTPUT]: 对外提供 CDK、管理员发币、排行榜、流水、幂等发红包和抢红包处理器
 * [POS]: bot 的用户经济交互层，以 Telegram 消息身份生成稳定请求键且不复制服务端余额事务规则
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function createEconomyHandlers(options = {}) {
    const client = options.client;
    const ensureRegistered = options.ensureRegistered;
    const sendMessage = options.sendMessage;
    const deliverLongGroupResult = options.deliverLongGroupResult;
    const escapeHtml = options.escapeHtml;
    const currencyLabel = options.currencyLabel;
    const transactionLine = options.transactionLine;
    const parseRedPacketArgs = options.parseRedPacketArgs;
    const redPacketMarkup = options.redPacketMarkup;
    const mentionUser = options.mentionUser;

    async function handleRedeem(message, args) {
        await ensureRegistered(message.from);
        const code =
            String(args || "")
                .trim()
                .split(/\s+/)[0] || "";
        if (!code) return sendMessage(message.chat.id, "用法：/redeem CDK-XXXX-XXXX");
        try {
            const result = await client.redeemCdk(message.from.id, code);
            await sendMessage(
                message.chat.id,
                [
                    "兑换成功。",
                    `增加下载次数：${result.cdk?.export_quota || 0}`,
                    `当前额外下载次数：${result.user?.export_extra_quota || 0}`
                ].join("\n")
            );
        } catch (err) {
            if (err.status) return sendMessage(message.chat.id, `兑换失败：${escapeHtml(err.message || "CDK 无效")}`);
            throw err;
        }
    }

    async function handleGive(message, args) {
        const sender = await ensureRegistered(message.from);
        if (!sender.is_admin) return sendMessage(message.chat.id, "只有管理员可以发币。");
        const parts = args.split(/\s+/).filter(Boolean);
        const target = parts.find((part) => /^-?\d+$/.test(part));
        const amount = Number(parts.find((part) => /^-?\d+$/.test(part) && part !== target) || parts[parts.length - 1]);
        const currency = parts.some((part) => /银|silver/i.test(part)) ? "silver" : "copper";
        if (!target || !amount) return sendMessage(message.chat.id, "用法：/give 123456789 铜币 100");
        const result = await client.addCurrency(target, currency, amount);
        await sendMessage(
            message.chat.id,
            `已发放 ${currency === "silver" ? "银币" : "铜币"} ${amount}，目标余额：${currency === "silver" ? result.user.silver_coins : result.user.copper_coins}`
        );
    }

    async function handleTop(message, args) {
        const currency = /经验|等級|等级|书卷|level|exp/i.test(args || "") ? "exp" : /银|silver/i.test(args || "") ? "silver" : "copper";
        const data = await client.top(currency, 10);
        const rows = data.rows || [];
        if (!rows.length) return sendMessage(message.chat.id, "还没有排行榜数据。");
        await deliverLongGroupResult(
            message,
            [
                `<b>${currencyLabel(currency)}排行榜 TOP 10</b>`,
                "",
                ...rows.map((user, index) => {
                    const name = user.nickname || user.telegram_username || user.username || user.telegram_id || "-";
                    const value = currency === "silver" ? user.silver_coins : currency === "exp" ? user.scholar_exp : user.copper_coins;
                    return `${index + 1}. ${escapeHtml(name)} · ${currencyLabel(currency)} ${value}`;
                })
            ].join("\n"),
            {},
            { title: "排行榜" }
        );
    }

    async function handleTransactions(message) {
        await ensureRegistered(message.from);
        const data = await client.transactions(message.from.id, 10);
        const rows = data.rows || [];
        if (!rows.length) return sendMessage(message.chat.id, "你还没有流水记录。");
        await deliverLongGroupResult(
            message,
            ["<b>最近币流水</b>", "", ...rows.map(transactionLine)].join("\n"),
            {},
            { title: "最近币流水" }
        );
    }

    async function handleRedPacket(message, args) {
        const user = await ensureRegistered(message.from);
        const parsed = parseRedPacketArgs(args);
        if (!parsed.totalAmount || parsed.totalAmount < 1 || parsed.totalCount < 1) {
            return sendMessage(message.chat.id, "用法：\n/hb 100 5 发铜币红包\n/hb silver 100 3 发银币红包\n/hb @username 100 指定发");
        }
        if (parsed.totalCount > 100) return sendMessage(message.chat.id, "最多分 100 份。");
        if (parsed.totalAmount < parsed.totalCount) return sendMessage(message.chat.id, "红包金额不能小于份数。");
        const balance = parsed.currency === "silver" ? user.silver_coins : user.copper_coins;
        if (balance < parsed.totalAmount)
            return sendMessage(message.chat.id, `${currencyLabel(parsed.currency)}不足，需要 ${parsed.totalAmount}。`);
        let targetUser = null;
        if (parsed.target) {
            targetUser = await client.getUserByTelegramUsername(parsed.target).catch(() => null);
            if (!targetUser) return sendMessage(message.chat.id, `没找到 ${escapeHtml(parsed.target)}，目标需要先 /reg 注册。`);
        }
        const messageId = String(message.message_id ?? "").trim();
        const result = await client.createRedPacket({
            sender_telegram_id: message.from.id,
            target_telegram_id: targetUser?.telegram_id || "",
            chat_id: message.chat.id,
            currency: parsed.currency,
            total_amount: parsed.totalAmount,
            total_count: parsed.totalCount,
            note: parsed.note,
            idempotency_key: messageId ? `telegram:red-packet:${message.chat.id}:${messageId}` : ""
        });
        const senderName = user.nickname || user.telegram_username || user.username || message.from.username || message.from.id;
        if (targetUser) {
            return sendMessage(
                message.chat.id,
                `🎁 ${escapeHtml(senderName)} 给 @${escapeHtml(targetUser.telegram_username || targetUser.username || targetUser.telegram_id)} 发了 ${parsed.totalAmount} ${currencyLabel(parsed.currency)}`
            );
        }
        return sendMessage(
            message.chat.id,
            [
                `🎁 ${escapeHtml(senderName)} 发了一个${currencyLabel(parsed.currency)}红包`,
                `💰 ${parsed.totalAmount} ${currencyLabel(parsed.currency)} / ${parsed.totalCount} 份`,
                `💬 ${escapeHtml(parsed.note || "恭喜发财")}`
            ].join("\n"),
            { reply_markup: redPacketMarkup(result.packet.id) }
        );
    }

    async function handleClaimRedPacket(message, packetId = "") {
        await ensureRegistered(message.from);
        try {
            const result = await client.claimRedPacket({
                telegram_id: message.from.id,
                chat_id: message.chat.id,
                packet_id: packetId || ""
            });
            const claimedBy = mentionUser(result.user || {}, message.from || {});
            await sendMessage(message.chat.id, `恭喜 ${claimedBy} 抢到了 ${result.amount} ${currencyLabel(result.currency)}！`);
        } catch (err) {
            await sendMessage(message.chat.id, escapeHtml(err.message || "抢红包失败"));
        }
    }

    return {
        handleClaimRedPacket,
        handleGive,
        handleRedeem,
        handleRedPacket,
        handleTop,
        handleTransactions
    };
}

module.exports = {
    createEconomyHandlers
};
