/**
 * [INPUT]: 依赖 PostgreSQL 事务、Reader 用户投影、Telegram 身份规范化与红包随机拆分规则
 * [OUTPUT]: 对外提供幂等红包创建、重复领取恢复、定向即时结算及过期余额退款服务
 * [POS]: services 的红包聚合根，以用户/红包行锁和操作账本维持余额、红包、领取与流水一致性
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function redPacketError(status, message, code = "") {
    return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

function positiveInteger(value, name, max = 1000000000) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number > max) throw redPacketError(400, `invalid ${name}`);
    return number;
}

function positiveBigintText(value, name) {
    const text = String(value ?? "").trim();
    if (!/^[1-9]\d{0,18}$/.test(text) || BigInt(text) > 9223372036854775807n) {
        throw redPacketError(400, `invalid ${name}`);
    }
    return text;
}

function ledgerResult(row = {}) {
    if (row.result_json && typeof row.result_json === "object") return row.result_json;
    try {
        return JSON.parse(row.result_json || "{}");
    } catch {
        return {};
    }
}

function createRedPacketService(options = {}) {
    const pool = options.pool;
    const botUserSelect = options.botUserSelect || (() => "*");
    const normalizeTelegramId = options.normalizeTelegramId || ((value) => String(value || "").trim());
    const normalizeChatId = options.normalizeChatId || ((value) => String(value || "").trim());
    const randomRedPacketAmount = options.randomRedPacketAmount || ((remaining) => Number(remaining || 0));
    const configuredExpiresInMs = Number(options.expiresInMs ?? 24 * 60 * 60 * 1000);
    const expiresInMs = Number.isFinite(configuredExpiresInMs) ? Math.max(60000, configuredExpiresInMs) : 24 * 60 * 60 * 1000;
    if (!pool || typeof pool.connect !== "function") throw new Error("red packet pool is required");

    function normalizeCreateInput(input = {}) {
        const senderTelegramId = normalizeTelegramId(input.senderTelegramId || input.sender_telegram_id);
        const targetTelegramId = normalizeTelegramId(input.targetTelegramId || input.target_telegram_id || "");
        const chatId = normalizeChatId(input.chatId || input.chat_id);
        const currency = String(input.currency || "copper")
            .trim()
            .toLowerCase();
        if (!senderTelegramId || !chatId) throw redPacketError(400, "missing sender/chat");
        if (targetTelegramId && targetTelegramId === senderTelegramId) throw redPacketError(409, "不能给自己发定向红包");
        if (!["copper", "silver"].includes(currency)) throw redPacketError(400, "invalid currency");
        const totalAmount = positiveInteger(input.totalAmount ?? input.total_amount, "total_amount");
        const totalCount = targetTelegramId ? 1 : positiveInteger(input.totalCount ?? input.total_count ?? 1, "total_count", 100);
        if (totalAmount < totalCount) throw redPacketError(400, "红包金额不能小于份数");
        const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || "").trim();
        if (idempotencyKey.length > 240) throw redPacketError(400, "invalid idempotency_key");
        return {
            senderTelegramId,
            targetTelegramId,
            chatId: String(chatId).slice(0, 100),
            currency,
            totalAmount,
            totalCount,
            note: String(input.note || "")
                .trim()
                .slice(0, 120),
            idempotencyKey
        };
    }

    function sameCreateOperation(result, input) {
        const signature = result.signature || {};
        return (
            String(signature.sender_telegram_id || "") === input.senderTelegramId &&
            String(signature.target_telegram_id || "") === input.targetTelegramId &&
            String(signature.chat_id || "") === input.chatId &&
            String(signature.currency || "") === input.currency &&
            Number(signature.total_amount) === input.totalAmount &&
            Number(signature.total_count) === input.totalCount
        );
    }

    async function replayCreate(db, input) {
        if (!input.idempotencyKey) return null;
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.idempotencyKey]);
        const found = await db.query(
            `SELECT operation_scope, operation_type, result_json
             FROM reader_operation_ledger
             WHERE idempotency_key = $1
             LIMIT 1`,
            [input.idempotencyKey]
        );
        const row = found.rows[0];
        if (!row) return null;
        const result = ledgerResult(row);
        if (
            row.operation_scope !== "red-packet-create" ||
            row.operation_type !== "red_packet_create" ||
            !sameCreateOperation(result, input)
        ) {
            throw redPacketError(409, "idempotency key already used for another operation", "IDEMPOTENCY_CONFLICT");
        }
        return { ...(result.response || {}), repeated: true };
    }

    async function recordCreateOperation(db, input, sender, response) {
        if (!input.idempotencyKey) return;
        await db.query(
            `INSERT INTO reader_operation_ledger
                (idempotency_key, operation_scope, operation_type, user_id, telegram_id, result_json)
             VALUES ($1,'red-packet-create','red_packet_create',$2,$3,$4::jsonb)`,
            [
                input.idempotencyKey,
                sender.id,
                sender.telegram_id || input.senderTelegramId,
                JSON.stringify({
                    signature: {
                        sender_telegram_id: input.senderTelegramId,
                        target_telegram_id: input.targetTelegramId,
                        chat_id: input.chatId,
                        currency: input.currency,
                        total_amount: input.totalAmount,
                        total_count: input.totalCount
                    },
                    response
                })
            ]
        );
    }

    async function createRedPacket(rawInput = {}) {
        const input = normalizeCreateInput(rawInput);
        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            const replayed = await replayCreate(db, input);
            if (replayed) {
                await db.query("COMMIT");
                return replayed;
            }

            const identities = [...new Set([input.senderTelegramId, input.targetTelegramId].filter(Boolean))].sort();
            const locked = await db.query(
                `SELECT ${botUserSelect()}
                 FROM reader_users
                 WHERE telegram_id = ANY($1::text[])
                 ORDER BY telegram_id ASC
                 FOR UPDATE`,
                [identities]
            );
            const users = new Map(locked.rows.map((user) => [String(user.telegram_id || ""), user]));
            const sender = users.get(input.senderTelegramId);
            const target = input.targetTelegramId ? users.get(input.targetTelegramId) : null;
            if (!sender) throw redPacketError(404, "sender not found");
            if (sender.is_banned) throw redPacketError(403, "user banned");
            if (input.targetTelegramId && !target) throw redPacketError(404, "target not found");
            if (target?.is_banned) throw redPacketError(403, "target user banned");
            const column = input.currency === "silver" ? "silver_coins" : "copper_coins";
            const updatedSender = await db.query(
                `UPDATE reader_users
                 SET ${column} = COALESCE(${column},0) - $1
                 WHERE id = $2 AND COALESCE(${column},0) >= $1
                 RETURNING ${botUserSelect()}`,
                [input.totalAmount, sender.id]
            );
            if (!updatedSender.rows.length) {
                throw redPacketError(409, `${input.currency === "silver" ? "银币" : "铜币"}不足`);
            }

            const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
            const insertedPacket = await db.query(
                `INSERT INTO reader_red_packets(sender_user_id, sender_telegram_id, target_telegram_id, chat_id, currency,
                                                total_amount, total_count, remaining_count, remaining_amount, note, expired_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$6,$8,$9)
                 RETURNING *`,
                [
                    sender.id,
                    input.senderTelegramId,
                    input.targetTelegramId,
                    input.chatId,
                    input.currency,
                    input.totalAmount,
                    input.totalCount,
                    input.note,
                    expiresAt
                ]
            );
            let packet = insertedPacket.rows[0];
            await db.query(
                `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
                 VALUES ($1,$2,'hb_send',$3,$4,$5,$6,'telegram_bot')`,
                [
                    sender.id,
                    input.senderTelegramId,
                    input.currency,
                    -input.totalAmount,
                    updatedSender.rows[0][column],
                    `hb ${input.totalAmount}x${input.totalCount}`
                ]
            );

            let updatedTarget = null;
            let claim = null;
            if (target) {
                updatedTarget = await db.query(
                    `UPDATE reader_users SET ${column}=COALESCE(${column},0)+$1 WHERE id=$2 RETURNING ${botUserSelect()}`,
                    [input.totalAmount, target.id]
                );
                const settled = await db.query(
                    `UPDATE reader_red_packets
                     SET claimed_count=1, claimed_amount=$1, remaining_count=0, remaining_amount=0, status='claimed'
                     WHERE id=$2
                     RETURNING *`,
                    [input.totalAmount, packet.id]
                );
                packet = settled.rows[0];
                const insertedClaim = await db.query(
                    `INSERT INTO reader_red_packet_claims(packet_id, user_id, telegram_id, amount)
                     VALUES ($1,$2,$3,$4)
                     RETURNING *`,
                    [packet.id, target.id, input.targetTelegramId, input.totalAmount]
                );
                claim = insertedClaim.rows[0];
                await db.query(
                    `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
                     VALUES ($1,$2,'hb_receive',$3,$4,$5,$6,'telegram_bot')`,
                    [
                        target.id,
                        input.targetTelegramId,
                        input.currency,
                        input.totalAmount,
                        updatedTarget.rows[0][column],
                        `hb from ${input.senderTelegramId}`
                    ]
                );
            }

            const response = {
                packet,
                sender: updatedSender.rows[0],
                target: updatedTarget?.rows?.[0] || null,
                claim,
                repeated: false
            };
            await recordCreateOperation(db, input, sender, response);
            await db.query("COMMIT");
            return response;
        } catch (error) {
            await db.query("ROLLBACK").catch(() => {});
            throw error;
        } finally {
            db.release();
        }
    }

    async function refundExpiredPacket(db, packet, claimant, sender) {
        const remaining = Math.max(0, Number(packet.remaining_amount || 0));
        const currency = packet.currency === "silver" ? "silver" : "copper";
        const column = currency === "silver" ? "silver_coins" : "copper_coins";
        if (!sender && remaining > 0) throw redPacketError(409, "红包发送者不存在，无法退款");
        let updatedSender = sender;
        if (sender && remaining > 0) {
            const updated = await db.query(
                `UPDATE reader_users SET ${column}=COALESCE(${column},0)+$1 WHERE id=$2 RETURNING ${botUserSelect()}`,
                [remaining, sender.id]
            );
            updatedSender = updated.rows[0] || sender;
            await db.query(
                `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
                 VALUES ($1,$2,'hb_refund',$3,$4,$5,$6,'telegram_bot')`,
                [
                    sender.id,
                    sender.telegram_id || packet.sender_telegram_id || "",
                    currency,
                    remaining,
                    updatedSender[column],
                    `hb ${packet.id} expired`
                ]
            );
        }
        const expired = await db.query(
            `UPDATE reader_red_packets
             SET status='expired', remaining_count=0, remaining_amount=0
             WHERE id=$1 AND status='open'
             RETURNING *`,
            [packet.id]
        );
        return {
            expired: true,
            refunded: remaining,
            currency,
            packet: expired.rows[0] || packet,
            user: sender?.id === claimant?.id ? updatedSender : claimant
        };
    }

    async function claimRedPacket(rawInput = {}) {
        const telegramId = normalizeTelegramId(rawInput.telegramId || rawInput.telegram_id);
        const chatId = String(normalizeChatId(rawInput.chatId || rawInput.chat_id || "")).slice(0, 100);
        const packetIdRaw = rawInput.packetId ?? rawInput.packet_id ?? "";
        const packetId =
            packetIdRaw === "" || packetIdRaw === null || packetIdRaw === undefined ? null : positiveBigintText(packetIdRaw, "packet_id");
        if (!telegramId || !chatId) throw redPacketError(400, "missing user/chat");

        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            const identityResult = await db.query("SELECT id FROM reader_users WHERE telegram_id=$1", [telegramId]);
            const identity = identityResult.rows[0];
            if (!identity) throw redPacketError(404, "user not found");

            const packetResult = packetId
                ? await db.query("SELECT * FROM reader_red_packets WHERE id=$1 AND chat_id=$2 FOR UPDATE", [packetId, chatId])
                : await db.query(
                      `SELECT p.*
                       FROM reader_red_packets p
                       WHERE p.status='open' AND p.remaining_count>0 AND p.chat_id=$1
                         AND (p.expired_at IS NULL OR p.expired_at > CURRENT_TIMESTAMP)
                         AND NOT EXISTS (
                             SELECT 1 FROM reader_red_packet_claims c WHERE c.packet_id=p.id AND c.user_id=$2
                         )
                       ORDER BY p.id ASC
                       LIMIT 1
                       FOR UPDATE`,
                      [chatId, identity.id]
                  );
            const packet = packetResult.rows[0];
            if (!packet) throw redPacketError(404, "当前没有可抢的红包");

            const userIds = [...new Set([String(identity.id), String(packet.sender_user_id)].filter(Boolean))];
            const lockedUsers = await db.query(
                `SELECT ${botUserSelect()}
                 FROM reader_users
                 WHERE id = ANY($1::bigint[])
                 ORDER BY id ASC
                 FOR UPDATE`,
                [userIds]
            );
            const users = new Map(lockedUsers.rows.map((row) => [String(row.id), row]));
            const user = users.get(String(identity.id));
            const sender = users.get(String(packet.sender_user_id));
            if (!user) throw redPacketError(404, "user not found");
            if (user.is_banned) throw redPacketError(403, "user banned");

            const existed = await db.query("SELECT * FROM reader_red_packet_claims WHERE packet_id=$1 AND user_id=$2 LIMIT 1", [
                packet.id,
                user.id
            ]);
            if (existed.rows.length) {
                await db.query("COMMIT");
                return {
                    repeated: true,
                    amount: Number(existed.rows[0].amount || 0),
                    currency: packet.currency === "silver" ? "silver" : "copper",
                    packet,
                    claim: existed.rows[0],
                    user
                };
            }
            if (packet.status === "open" && packet.expired_at && new Date(packet.expired_at).getTime() <= Date.now()) {
                const expired = await refundExpiredPacket(db, packet, user, sender);
                await db.query("COMMIT");
                return expired;
            }
            if (packet.status !== "open" || Number(packet.remaining_count || 0) <= 0) {
                throw redPacketError(404, "当前没有可抢的红包");
            }
            if (String(packet.sender_telegram_id || "") === telegramId) throw redPacketError(409, "不能抢自己的红包");
            if (packet.target_telegram_id && String(packet.target_telegram_id) !== telegramId) {
                throw redPacketError(403, "这个红包不是发给你的");
            }

            const remainingAmount = positiveInteger(packet.remaining_amount, "remaining_amount");
            const remainingCount = positiveInteger(packet.remaining_count, "remaining_count", 100);
            const maximum = remainingAmount - (remainingCount - 1);
            if (maximum < 1) throw redPacketError(409, "红包余额状态异常");
            const calculated = Math.trunc(Number(randomRedPacketAmount(remainingAmount, remainingCount)));
            const claimAmount = Math.max(1, Math.min(Number.isFinite(calculated) ? calculated : 1, maximum));
            const currency = packet.currency === "silver" ? "silver" : "copper";
            const column = currency === "silver" ? "silver_coins" : "copper_coins";
            const updatedUser = await db.query(
                `UPDATE reader_users SET ${column}=COALESCE(${column},0)+$1 WHERE id=$2 RETURNING ${botUserSelect()}`,
                [claimAmount, user.id]
            );
            const updatedPacket = await db.query(
                `UPDATE reader_red_packets
                 SET remaining_count=remaining_count-1,
                     remaining_amount=remaining_amount-$1,
                     claimed_count=claimed_count+1,
                     claimed_amount=claimed_amount+$1,
                     status=CASE WHEN remaining_count-1 <= 0 THEN 'claimed' ELSE 'open' END
                 WHERE id=$2 AND status='open' AND remaining_count>0 AND remaining_amount >= $1
                 RETURNING *`,
                [claimAmount, packet.id]
            );
            if (!updatedPacket.rows.length) throw redPacketError(409, "红包状态已变化，请重试");
            const claim = await db.query(
                `INSERT INTO reader_red_packet_claims(packet_id, user_id, telegram_id, amount)
                 VALUES ($1,$2,$3,$4)
                 RETURNING *`,
                [packet.id, user.id, telegramId, claimAmount]
            );
            await db.query(
                `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
                 VALUES ($1,$2,'hb_receive',$3,$4,$5,$6,'telegram_bot')`,
                [
                    user.id,
                    telegramId,
                    currency,
                    claimAmount,
                    updatedUser.rows[0][column],
                    `hb ${packet.id} from ${packet.sender_telegram_id}`
                ]
            );
            await db.query("COMMIT");
            return {
                repeated: false,
                amount: claimAmount,
                currency,
                packet: updatedPacket.rows[0],
                claim: claim.rows[0],
                user: updatedUser.rows[0]
            };
        } catch (error) {
            await db.query("ROLLBACK").catch(() => {});
            throw error;
        } finally {
            db.release();
        }
    }

    return { claimRedPacket, createRedPacket };
}

module.exports = {
    createRedPacketService,
    positiveBigintText,
    positiveInteger
};
