/**
 * [INPUT]: 依赖 node:test、assert 与 red-packets 领域服务及可回滚 PostgreSQL 状态替身
 * [OUTPUT]: 提供红包参数、创建幂等、定向结算、重复领取、过期退款、脏状态和事务回滚回归断言
 * [POS]: tests 的红包聚合根守卫，锁定余额、红包、领取、流水与操作账本的一致性
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createRedPacketService, positiveBigintText, positiveInteger } = require("../services/red-packets");

function redPacketDatabase({ failTransaction = false } = {}) {
    const state = {
        users: new Map(),
        packets: new Map(),
        claims: new Map(),
        ledger: new Map(),
        transactions: [],
        nextPacketId: 1,
        nextClaimId: 1
    };
    let snapshot = null;

    function userByTelegramId(telegramId) {
        return [...state.users.values()].find((user) => String(user.telegram_id) === String(telegramId));
    }

    function currencyColumn(sql) {
        return /silver_coins/.test(sql) ? "silver_coins" : "copper_coins";
    }

    function restoreSnapshot() {
        if (!snapshot) return;
        for (const key of Object.keys(snapshot)) state[key] = structuredClone(snapshot[key]);
        snapshot = null;
    }

    const client = {
        async query(sql, params = []) {
            if (sql === "BEGIN") {
                snapshot = structuredClone(state);
                return { rows: [] };
            }
            if (sql === "COMMIT") {
                snapshot = null;
                return { rows: [] };
            }
            if (sql === "ROLLBACK") {
                restoreSnapshot();
                return { rows: [] };
            }
            if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
            if (/FROM reader_operation_ledger/.test(sql)) {
                const row = state.ledger.get(String(params[0]));
                return { rows: row ? [structuredClone(row)] : [] };
            }
            if (/INSERT INTO reader_operation_ledger/.test(sql)) {
                state.ledger.set(String(params[0]), {
                    operation_scope: "red-packet-create",
                    operation_type: "red_packet_create",
                    result_json: JSON.parse(params[3])
                });
                return { rows: [] };
            }
            if (/FROM reader_users\s+WHERE telegram_id = ANY/.test(sql)) {
                const ids = params[0].map(String);
                return {
                    rows: [...state.users.values()]
                        .filter((user) => ids.includes(String(user.telegram_id)))
                        .sort((left, right) => String(left.telegram_id).localeCompare(String(right.telegram_id)))
                        .map((user) => ({ ...user }))
                };
            }
            if (/SELECT id FROM reader_users WHERE telegram_id/.test(sql)) {
                const user = userByTelegramId(params[0]);
                return { rows: user ? [{ id: user.id }] : [] };
            }
            if (/FROM reader_users\s+WHERE id = ANY/.test(sql)) {
                const ids = params[0].map(String);
                return {
                    rows: [...state.users.values()]
                        .filter((user) => ids.includes(String(user.id)))
                        .sort((left, right) => Number(left.id) - Number(right.id))
                        .map((user) => ({ ...user }))
                };
            }
            if (/UPDATE reader_users\s+SET .* - \$1/.test(sql)) {
                const column = currencyColumn(sql);
                const amount = Number(params[0]);
                const user = state.users.get(String(params[1]));
                if (!user || Number(user[column] || 0) < amount) return { rows: [] };
                user[column] = Number(user[column] || 0) - amount;
                return { rows: [{ ...user }] };
            }
            if (/UPDATE reader_users SET .*\+\$1/.test(sql)) {
                const column = currencyColumn(sql);
                const amount = Number(params[0]);
                const user = state.users.get(String(params[1]));
                if (!user) return { rows: [] };
                user[column] = Number(user[column] || 0) + amount;
                return { rows: [{ ...user }] };
            }
            if (/INSERT INTO reader_red_packets/.test(sql)) {
                const packet = {
                    id: state.nextPacketId++,
                    sender_user_id: params[0],
                    sender_telegram_id: params[1],
                    target_telegram_id: params[2],
                    chat_id: params[3],
                    currency: params[4],
                    total_amount: Number(params[5]),
                    total_count: Number(params[6]),
                    remaining_count: Number(params[6]),
                    remaining_amount: Number(params[5]),
                    claimed_count: 0,
                    claimed_amount: 0,
                    note: params[7],
                    expired_at: params[8],
                    status: "open"
                };
                state.packets.set(String(packet.id), packet);
                return { rows: [{ ...packet }] };
            }
            if (/UPDATE reader_red_packets\s+SET claimed_count=1/.test(sql)) {
                const packet = state.packets.get(String(params[1]));
                Object.assign(packet, {
                    claimed_count: 1,
                    claimed_amount: Number(params[0]),
                    remaining_count: 0,
                    remaining_amount: 0,
                    status: "claimed"
                });
                return { rows: [{ ...packet }] };
            }
            if (/SELECT \* FROM reader_red_packets WHERE id=\$1/.test(sql)) {
                const packet = state.packets.get(String(params[0]));
                return { rows: packet && String(packet.chat_id) === String(params[1]) ? [{ ...packet }] : [] };
            }
            if (/FROM reader_red_packets p/.test(sql)) {
                const packet = [...state.packets.values()].find(
                    (row) =>
                        row.status === "open" &&
                        row.remaining_count > 0 &&
                        String(row.chat_id) === String(params[0]) &&
                        !state.claims.has(`${row.id}:${params[1]}`)
                );
                return { rows: packet ? [{ ...packet }] : [] };
            }
            if (/SELECT \* FROM reader_red_packet_claims/.test(sql)) {
                const claim = state.claims.get(`${params[0]}:${params[1]}`);
                return { rows: claim ? [{ ...claim }] : [] };
            }
            if (/INSERT INTO reader_red_packet_claims/.test(sql)) {
                const claim = {
                    id: state.nextClaimId++,
                    packet_id: params[0],
                    user_id: params[1],
                    telegram_id: params[2],
                    amount: Number(params[3])
                };
                state.claims.set(`${params[0]}:${params[1]}`, claim);
                return { rows: [{ ...claim }] };
            }
            if (/UPDATE reader_red_packets\s+SET status='expired'/.test(sql)) {
                const packet = state.packets.get(String(params[0]));
                if (!packet || packet.status !== "open") return { rows: [] };
                Object.assign(packet, { status: "expired", remaining_count: 0, remaining_amount: 0 });
                return { rows: [{ ...packet }] };
            }
            if (/UPDATE reader_red_packets\s+SET remaining_count=remaining_count-1/.test(sql)) {
                const amount = Number(params[0]);
                const packet = state.packets.get(String(params[1]));
                if (!packet || packet.status !== "open" || packet.remaining_count <= 0 || packet.remaining_amount < amount) {
                    return { rows: [] };
                }
                packet.remaining_count -= 1;
                packet.remaining_amount -= amount;
                packet.claimed_count += 1;
                packet.claimed_amount += amount;
                if (packet.remaining_count <= 0) packet.status = "claimed";
                return { rows: [{ ...packet }] };
            }
            if (/INSERT INTO reader_transactions/.test(sql)) {
                if (failTransaction) throw new Error("transaction insert failed");
                const type = sql.match(/'([^']+)'\s*,\s*\$3/)?.[1] || "";
                state.transactions.push({ type, params: structuredClone(params) });
                return { rows: [] };
            }
            throw new Error(`unexpected query: ${sql}`);
        },
        release() {}
    };

    return {
        state,
        addUser(user) {
            state.users.set(String(user.id), {
                copper_coins: 0,
                silver_coins: 0,
                is_banned: false,
                ...user
            });
        },
        pool: { connect: async () => client }
    };
}

function redPacketService(database, options = {}) {
    return createRedPacketService({
        pool: database.pool,
        botUserSelect: () => "*",
        normalizeTelegramId: (value) => String(value || "").trim(),
        normalizeChatId: (value) => String(value || "").trim(),
        randomRedPacketAmount: options.randomRedPacketAmount || ((remaining, count) => (count <= 1 ? remaining : 1))
    });
}

test("red packet integer validation rejects non-finite and fractional values", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5, "bad"]) {
        assert.throws(
            () => positiveInteger(value, "amount"),
            (error) => error.status === 400
        );
    }
    assert.equal(positiveInteger("7", "amount"), 7);
    assert.equal(positiveBigintText("9007199254740993", "packet_id"), "9007199254740993");
    assert.throws(
        () => positiveBigintText("9223372036854775808", "packet_id"),
        (error) => error.status === 400
    );
});

test("red packet creation is idempotent and conflicting reuse is rejected", async () => {
    const database = redPacketDatabase();
    database.addUser({ id: 1, telegram_id: "100", copper_coins: 500 });
    const service = redPacketService(database);
    const input = {
        senderTelegramId: "100",
        chatId: "chat-a",
        totalAmount: 100,
        totalCount: 5,
        currency: "copper",
        idempotencyKey: "telegram:red-packet:chat-a:7"
    };
    const first = await service.createRedPacket(input);
    const repeated = await service.createRedPacket(input);
    assert.equal(first.repeated, false);
    assert.equal(repeated.repeated, true);
    assert.equal(repeated.packet.id, first.packet.id);
    assert.equal(database.state.users.get("1").copper_coins, 400);
    assert.equal(database.state.packets.size, 1);
    assert.equal(database.state.transactions.length, 1);
    await assert.rejects(
        service.createRedPacket({ ...input, totalAmount: 101 }),
        (error) => error.status === 409 && error.code === "IDEMPOTENCY_CONFLICT"
    );
    await assert.rejects(
        service.createRedPacket({ ...input, idempotencyKey: "x".repeat(241) }),
        (error) => error.status === 400 && /idempotency_key/.test(error.message)
    );
    assert.equal(database.state.users.get("1").copper_coins, 400);
});

test("directed red packets settle immediately and reject self or banned targets", async () => {
    const database = redPacketDatabase();
    database.addUser({ id: 1, telegram_id: "100", copper_coins: 500 });
    database.addUser({ id: 2, telegram_id: "200", copper_coins: 10 });
    database.addUser({ id: 3, telegram_id: "300", copper_coins: 10, is_banned: true });
    const service = redPacketService(database);
    const directed = await service.createRedPacket({
        senderTelegramId: "100",
        targetTelegramId: "200",
        chatId: "chat-a",
        totalAmount: 80,
        totalCount: 9,
        currency: "copper"
    });
    assert.equal(directed.packet.status, "claimed");
    assert.equal(directed.packet.total_count, 1);
    assert.equal(directed.target.copper_coins, 90);
    assert.equal(database.state.users.get("1").copper_coins, 420);
    await assert.rejects(
        service.createRedPacket({ senderTelegramId: "100", targetTelegramId: "100", chatId: "chat-a", totalAmount: 1 }),
        (error) => error.status === 409
    );
    await assert.rejects(
        service.createRedPacket({ senderTelegramId: "100", targetTelegramId: "300", chatId: "chat-a", totalAmount: 1 }),
        (error) => error.status === 403
    );
    assert.equal(database.state.users.get("1").copper_coins, 420);
});

test("explicit duplicate claims return the settled snapshot without paying twice", async () => {
    const database = redPacketDatabase();
    database.addUser({ id: 1, telegram_id: "100", copper_coins: 10 });
    database.addUser({ id: 2, telegram_id: "200", copper_coins: 0 });
    const service = redPacketService(database);
    const created = await service.createRedPacket({
        senderTelegramId: "100",
        chatId: "chat-a",
        totalAmount: 2,
        totalCount: 2,
        currency: "copper"
    });
    const claimed = await service.claimRedPacket({ telegramId: "200", chatId: "chat-a", packetId: created.packet.id });
    const repeated = await service.claimRedPacket({ telegramId: "200", chatId: "chat-a", packetId: created.packet.id });
    assert.equal(claimed.amount, 1);
    assert.equal(repeated.repeated, true);
    assert.equal(repeated.amount, 1);
    assert.equal(database.state.users.get("2").copper_coins, 1);
    assert.equal(database.state.claims.size, 1);
});

test("expired packets refund the full remainder once", async () => {
    const database = redPacketDatabase();
    database.addUser({ id: 1, telegram_id: "100", copper_coins: 500 });
    database.addUser({ id: 2, telegram_id: "200", copper_coins: 0 });
    const service = redPacketService(database);
    const created = await service.createRedPacket({
        senderTelegramId: "100",
        chatId: "chat-a",
        totalAmount: 100,
        totalCount: 2,
        currency: "copper"
    });
    database.state.packets.get(String(created.packet.id)).expired_at = "2020-01-01T00:00:00.000Z";
    const expired = await service.claimRedPacket({ telegramId: "200", chatId: "chat-a", packetId: created.packet.id });
    assert.equal(expired.expired, true);
    assert.equal(expired.refunded, 100);
    assert.equal(database.state.users.get("1").copper_coins, 500);
    assert.equal(database.state.packets.get(String(created.packet.id)).status, "expired");
    assert.deepEqual(
        database.state.transactions.map((row) => row.type),
        ["hb_send", "hb_refund"]
    );
});

test("red packet writes roll back when transaction recording fails", async () => {
    const database = redPacketDatabase({ failTransaction: true });
    database.addUser({ id: 1, telegram_id: "100", copper_coins: 500 });
    const service = redPacketService(database);
    await assert.rejects(
        service.createRedPacket({ senderTelegramId: "100", chatId: "chat-a", totalAmount: 100, totalCount: 2 }),
        /transaction insert failed/
    );
    assert.equal(database.state.users.get("1").copper_coins, 500);
    assert.equal(database.state.packets.size, 0);
    assert.equal(database.state.ledger.size, 0);
});

test("claim clamps random output and rejects impossible historical balances", async () => {
    const database = redPacketDatabase();
    database.addUser({ id: 1, telegram_id: "100", copper_coins: 10 });
    database.addUser({ id: 2, telegram_id: "200", copper_coins: 0 });
    const service = redPacketService(database, { randomRedPacketAmount: () => 9999 });
    const created = await service.createRedPacket({ senderTelegramId: "100", chatId: "chat-a", totalAmount: 5, totalCount: 2 });
    const claimed = await service.claimRedPacket({ telegramId: "200", chatId: "chat-a", packetId: created.packet.id });
    assert.equal(claimed.amount, 4);
    const packet = database.state.packets.get(String(created.packet.id));
    packet.remaining_amount = 1;
    packet.remaining_count = 2;
    database.state.claims.clear();
    await assert.rejects(
        service.claimRedPacket({ telegramId: "200", chatId: "chat-a", packetId: created.packet.id }),
        (error) => error.status === 409 && /状态异常/.test(error.message)
    );
    assert.equal(database.state.users.get("2").copper_coins, 4);
});
