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
