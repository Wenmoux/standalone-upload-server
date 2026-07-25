/**
 * [INPUT]: 依赖 ws、QQ Gateway Opcode/Intents 契约、Access Token 提供器和事件处理器
 * [OUTPUT]: 对外提供单连接 Gateway 运行器及 C2C/群聊消息归一化函数
 * [POS]: qq-bot 的实时事件入口，负责连接、鉴权、心跳、恢复和协议对象到平台中立消息的转换
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const WebSocket = require("ws");

const GROUP_AND_C2C_EVENT = 1 << 25;

function normalizeQqEvent(payload = {}) {
    if (!['C2C_MESSAGE_CREATE', 'GROUP_AT_MESSAGE_CREATE', 'GROUP_MESSAGE_CREATE'].includes(payload.t)) return null;
    const data = payload.d || {};
    const group = payload.t !== "C2C_MESSAGE_CREATE";
    const userOpenId = String(
        data.author?.member_openid || data.author?.user_openid || data.member_openid || data.author?.id || ""
    ).trim();
    const targetId = String(group ? data.group_openid || data.group_id || "" : userOpenId).trim();
    const content = String(data.content || "")
        .replace(/<@!?[^>]+>/g, " ")
        .replace(/^\s*@[^\s]+\s*/, "")
        .trim();
    if (!userOpenId || !targetId || !data.id) return null;
    return {
        eventType: payload.t,
        kind: group ? "group" : "user",
        target: { kind: group ? "group" : "user", id: targetId },
        targetKey: `${group ? "group" : "user"}:${targetId}`,
        userOpenId,
        identity: `qq:${userOpenId}`,
        messageId: String(data.id),
        content,
        timestamp: data.timestamp || "",
        reply: { msgId: String(data.id), seq: 0 },
        raw: data
    };
}

function createQqGateway(options = {}) {
    const WebSocketImpl = options.WebSocketImpl || WebSocket;
    const logger = options.logger || console;
    const onEvent = options.onEvent || (async () => {});
    let socket = null;
    let heartbeat = null;
    let sessionId = "";
    let sequence = null;
    let stopped = false;

    function send(payload) {
        if (socket?.readyState === WebSocketImpl.OPEN) socket.send(JSON.stringify(payload));
    }

    function clearHeartbeat() {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
    }

    async function run({ url, accessToken }) {
        stopped = false;
        const gatewayUrl = String(url || "wss://api.sgroup.qq.com/websocket/");
        return new Promise((resolve, reject) => {
            let settled = false;
            socket = new WebSocketImpl(gatewayUrl);
            socket.on("open", () => logger.info?.("[qq-bot] gateway connected"));
            socket.on("message", (raw) => {
                let payload;
                try {
                    payload = JSON.parse(raw.toString());
                } catch {
                    return;
                }
                if (Number.isFinite(Number(payload.s))) sequence = Number(payload.s);
                if (payload.op === 10) {
                    clearHeartbeat();
                    const interval = Math.max(1000, Number(payload.d?.heartbeat_interval || 45000));
                    heartbeat = setInterval(() => send({ op: 1, d: sequence }), interval);
                    const token = `QQBot ${accessToken}`;
                    if (sessionId && sequence !== null) send({ op: 6, d: { token, session_id: sessionId, seq: sequence } });
                    else {
                        send({
                            op: 2,
                            d: {
                                token,
                                intents: GROUP_AND_C2C_EVENT,
                                shard: [0, 1],
                                properties: { $os: process.platform, $browser: "po18-reader", $device: "po18-reader" }
                            }
                        });
                    }
                    return;
                }
                if (payload.op === 0) {
                    if (payload.t === "READY") sessionId = String(payload.d?.session_id || "");
                    const event = normalizeQqEvent(payload);
                    if (event) Promise.resolve(onEvent(event)).catch((err) => logger.error?.(`[qq-bot] event failed: ${err.message || err}`));
                    return;
                }
                if (payload.op === 7) socket.close(4000, "gateway reconnect requested");
                if (payload.op === 9) {
                    sessionId = "";
                    sequence = null;
                    socket.close(4001, "invalid session");
                }
            });
            socket.on("error", (err) => {
                if (!settled) {
                    settled = true;
                    reject(err);
                } else logger.error?.(`[qq-bot] gateway error: ${err.message || err}`);
            });
            socket.on("close", (code) => {
                clearHeartbeat();
                socket = null;
                if (!settled) {
                    settled = true;
                    resolve({ stopped, code });
                }
            });
        });
    }

    function stop() {
        stopped = true;
        clearHeartbeat();
        socket?.close(1000, "shutdown");
    }

    return { run, stop };
}

module.exports = { GROUP_AND_C2C_EVENT, createQqGateway, normalizeQqEvent };
