/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供导出错误分类与面向用户消息的自动化回归断言
 * [POS]: tests 的导出错误分类与面向用户消息守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const {
    EXPORT_ERROR_CODES,
    asExportError,
    classifyExportError,
    formatExportFailure
} = require("../bot/export-errors");

test("export errors classify common failures", () => {
    assert.equal(classifyExportError(new Error("本地没有正文缓存，无法导出")).code, EXPORT_ERROR_CODES.NO_CONTENT);
    assert.equal(classifyExportError(Object.assign(new Error("余额不足"), { status: 409 })).code, EXPORT_ERROR_CODES.INSUFFICIENT_BALANCE);
    assert.equal(classifyExportError(new Error("Telegram sendDocument failed")).code, EXPORT_ERROR_CODES.TELEGRAM_SEND_FAILED);
    assert.equal(classifyExportError(asExportError(EXPORT_ERROR_CODES.PRIVATE_CHAT_REQUIRED, "blocked")).code, EXPORT_ERROR_CODES.PRIVATE_CHAT_REQUIRED);

    const formatted = formatExportFailure(asExportError(EXPORT_ERROR_CODES.FREE_QUOTA_USED, "quota"));
    assert.match(formatted.text, /EXPORT_FREE_QUOTA_USED/);
    assert.match(formatted.message, /免费导出额度/);
});
