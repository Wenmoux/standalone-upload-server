/**
 * [INPUT]: 不依赖进程内状态，只接收 Telegram 推送正文或标题文本
 * [OUTPUT]: 对外提供跨 server/Bot 进程稳定的系统推送标记及附加、识别函数
 * [POS]: 根级 Telegram 推送协议契约，让发送端与轮询端无需共享内存即可识别本系统消息
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const TELEGRAM_SYSTEM_PUSH_MARKER = "\u2063\u2060\u2063\u2060";

function markTelegramSystemPush(value = "") {
    const text = String(value ?? "");
    return text.includes(TELEGRAM_SYSTEM_PUSH_MARKER) ? text : `${text}${TELEGRAM_SYSTEM_PUSH_MARKER}`;
}

function hasTelegramSystemPushMarker(value = "") {
    return String(value ?? "").includes(TELEGRAM_SYSTEM_PUSH_MARKER);
}

module.exports = {
    TELEGRAM_SYSTEM_PUSH_MARKER,
    hasTelegramSystemPushMarker,
    markTelegramSystemPush
};
