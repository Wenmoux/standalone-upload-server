/**
 * [INPUT]: 依赖 QQ 官方 App Access Token、OpenAPI、Gateway 与富媒体分片上传/合并协议，以及 Node Fetch/文件/摘要能力
 * [OUTPUT]: 对外提供 QQ API 客户端、Token 获取/凭据测试、文本/Markdown 内嵌键盘、含代码块的语义化纯文本降级、带阶段重试的文件发送和错误类型
 * [POS]: qq-bot 的唯一腾讯网络边界，集中处理鉴权刷新、超时、回复序号与官方可重试错误，避免调用方解释内部代理故障
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const DEFAULT_API_BASE = "https://api.sgroup.qq.com";
const DEFAULT_TOKEN_URLS = ["https://api.bot.qq.com/app/getAppAccessToken", "https://bots.qq.com/app/getAppAccessToken"];
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const QQ_UPLOAD_RETRYABLE_CODES = new Set(["850027", "40093001", "QQ_API_TIMEOUT"]);

class QqApiError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = "QqApiError";
        this.status = Number(options.status || 0);
        this.code = options.code ?? "QQ_API_ERROR";
        this.data = options.data || null;
    }
}

async function fetchJson(fetchImpl, url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, { ...options, signal: controller.signal });
        const text = await response.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            data = { message: text.slice(0, 500) };
        }
        if (!response.ok || data.code) {
            throw new QqApiError(data.message || data.error || `QQ API HTTP ${response.status}`, {
                status: response.status,
                code: data.code || "QQ_API_ERROR",
                data
            });
        }
        return data;
    } catch (err) {
        if (err.name === "AbortError") throw new QqApiError(`QQ API timeout after ${timeoutMs}ms`, { code: "QQ_API_TIMEOUT" });
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

async function requestAppAccessToken(options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const appId = String(options.appId || "").trim();
    const appSecret = String(options.appSecret || "").trim();
    if (!appId || !appSecret) throw new QqApiError("QQ AppID/AppSecret 未配置", { code: "QQ_CREDENTIALS_MISSING" });
    const urls = options.tokenUrl ? [String(options.tokenUrl)] : DEFAULT_TOKEN_URLS;
    let lastError = null;
    for (const url of urls) {
        try {
            const data = await fetchJson(
                fetchImpl,
                url,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ appId, clientSecret: appSecret })
                },
                Number(options.timeoutMs || 20000)
            );
            const accessToken = String(data.access_token || data.accessToken || "").trim();
            if (!accessToken) throw new QqApiError("QQ Token 响应缺少 access_token", { data });
            return { accessToken, expiresIn: Math.max(60, Number(data.expires_in || data.expiresIn || 7200)) };
        } catch (err) {
            lastError = err;
            if (err.status && err.status < 500 && err.status !== 404) break;
        }
    }
    throw lastError || new QqApiError("QQ Token 获取失败");
}

async function testQqBotCredentials(configProvider, options = {}) {
    const config = await configProvider();
    const token = await requestAppAccessToken({ ...options, appId: config.appId, appSecret: config.appSecret });
    return { ok: true, expiresIn: token.expiresIn };
}

function targetPath(target = {}, resource) {
    const kind = target.kind === "group" ? "groups" : "users";
    const id = encodeURIComponent(String(target.id || "").replace(/^qq:/, ""));
    if (!id) throw new QqApiError("QQ 消息目标为空", { code: "QQ_TARGET_MISSING" });
    return `/v2/${kind}/${id}/${resource}`;
}

function nextReplyPayload(reply = {}) {
    if (!reply || !reply.msgId) return {};
    reply.seq = Math.max(0, Number(reply.seq || 0)) + 1;
    return { msg_id: String(reply.msgId), msg_seq: reply.seq };
}

function digest(buffer, algorithm) {
    return crypto.createHash(algorithm).update(buffer).digest("hex");
}

function isRetryableQqUploadError(error) {
    const code = String(error?.code ?? "");
    const status = Number(error?.status || 0);
    return (
        QQ_UPLOAD_RETRYABLE_CODES.has(code) ||
        status >= 500 ||
        /call inner proxy error|internal|temporar|timeout|timed out|fetch failed|network|econn|socket/i.test(String(error?.message || ""))
    );
}

function labelQqUploadError(error, operation) {
    if (!(error instanceof Error)) return new QqApiError(`QQ ${operation}失败`, { data: error });
    if (error.qqOperation) return error;
    error.qqOperation = operation;
    const code = error.code && error.code !== "QQ_API_ERROR" ? `（${error.code}）` : "";
    error.message = `QQ ${operation}失败${code}：${error.message}`;
    return error;
}

function commandKeyboard(rows = []) {
    const label = (value) => Array.from(String(value || "操作")).slice(0, 12).join("");
    const contentRows = (Array.isArray(rows) ? rows : [])
        .slice(0, 5)
        .map((row, rowIndex) => ({
            buttons: (Array.isArray(row) ? row : [])
                .slice(0, 5)
                .map((button, buttonIndex) => ({
                    id: `po18_${rowIndex}_${buttonIndex}`,
                    render_data: {
                        label: label(button.label || button.text),
                        visited_label: label(button.visitedLabel || button.label || button.text),
                        style: Number(button.style ?? 1)
                    },
                    action: {
                        type: 2,
                        permission: { type: 2 },
                        data: String(button.data || "").slice(0, 64),
                        enter: button.enter !== false
                    }
                }))
                .filter((button) => button.action.data)
        }))
        .filter((row) => row.buttons.length);
    return contentRows.length ? { content: { rows: contentRows } } : null;
}

function markdownToPlainText(content = "") {
    return String(content || "")
        .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
        .replace(/\\([\\`*_[\]{}()#+\-.!|>])/g, "$1")
        .replace(/^\s*```[^\r\n]*\r?\n?/gm, "")
        .replace(/^\s{0,3}#{1,6}\s+/gm, "")
        .replace(/^\s*>\s?/gm, "")
        .replace(/^\s*[-*_]{3,}\s*$/gm, "")
        .replace(/\*\*|__|`/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function createQqApiClient(options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const apiBase = String(options.apiBase || DEFAULT_API_BASE).replace(/\/+$/, "");
    const timeoutMs = Number(options.timeoutMs || 30000);
    const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? 500));
    const credentials = options.credentials || (() => ({}));
    let tokenCache = { value: "", expiresAt: 0, fingerprint: "" };

    async function accessToken() {
        const current = await credentials();
        const appId = String(current.appId || "").trim();
        const appSecret = String(current.appSecret || "").trim();
        const fingerprint = crypto.createHash("sha256").update(`${appId}\0${appSecret}`).digest("hex");
        if (tokenCache.value && tokenCache.fingerprint === fingerprint && tokenCache.expiresAt - Date.now() > 60000) return tokenCache.value;
        const token = await requestAppAccessToken({ appId, appSecret, fetchImpl, timeoutMs, tokenUrl: options.tokenUrl });
        tokenCache = {
            value: token.accessToken,
            expiresAt: Date.now() + Math.max(60, token.expiresIn - 60) * 1000,
            fingerprint
        };
        return tokenCache.value;
    }

    async function request(resource, requestOptions = {}) {
        const token = await accessToken();
        const headers = { Authorization: `QQBot ${token}`, ...(requestOptions.headers || {}) };
        if (requestOptions.body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
        return fetchJson(fetchImpl, `${apiBase}${resource}`, { ...requestOptions, headers }, requestOptions.timeoutMs || timeoutMs);
    }

    async function retryUploadOperation(operation, task, attempts = 3) {
        let lastError = null;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                return await task();
            } catch (error) {
                lastError = error;
                if (attempt >= attempts - 1 || !isRetryableQqUploadError(error)) break;
                const delayMs = retryDelayMs * 2 ** attempt;
                if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
        throw labelQqUploadError(lastError, operation);
    }

    async function gateway() {
        const data = await request("/gateway");
        return String(data.url || "wss://api.sgroup.qq.com/websocket/");
    }

    async function sendText(target, content, reply = {}) {
        return request(targetPath(target, "messages"), {
            method: "POST",
            body: JSON.stringify({ content: String(content || "").slice(0, 1900), msg_type: 0, ...nextReplyPayload(reply) })
        });
    }

    async function sendMarkdown(target, content, reply = {}, keyboardRows = []) {
        const sequence = nextReplyPayload(reply);
        const keyboard = commandKeyboard(keyboardRows);
        try {
            return await request(targetPath(target, "messages"), {
                method: "POST",
                body: JSON.stringify({
                    markdown: { content: String(content || "").slice(0, 3900) },
                    msg_type: 2,
                    ...(keyboard ? { keyboard } : {}),
                    ...sequence
                })
            });
        } catch (err) {
            const fallback = markdownToPlainText(content);
            return request(targetPath(target, "messages"), {
                method: "POST",
                body: JSON.stringify({ content: fallback.slice(0, 1900), msg_type: 0, ...sequence })
            });
        }
    }

    async function uploadFile(target, filePath) {
        const buffer = await fs.readFile(filePath);
        if (buffer.length > MAX_FILE_BYTES) throw new QqApiError("QQ 文件上限为 200 MB", { code: "QQ_FILE_TOO_LARGE" });
        const fileName = path.basename(filePath);
        const prepare = await retryUploadOperation("文件预上传", () =>
            request(targetPath(target, "upload_prepare"), {
                method: "POST",
                body: JSON.stringify({
                    file_type: 4,
                    file_size: String(buffer.length),
                    file_name: fileName,
                    md5: digest(buffer, "md5"),
                    sha1: digest(buffer, "sha1"),
                    md5_10m: digest(buffer.subarray(0, Math.min(buffer.length, 10002432)), "md5")
                }),
                timeoutMs: Math.max(timeoutMs, 60000)
            })
        );
        const parts = (Array.isArray(prepare.parts) ? [...prepare.parts] : []).sort(
            (left, right) => Number(left.index ?? left.part_index ?? 0) - Number(right.index ?? right.part_index ?? 0)
        );
        if (buffer.length && !parts.length) {
            throw new QqApiError("QQ 文件预上传响应缺少分片", { code: "QQ_UPLOAD_PARTS_MISSING", data: prepare });
        }
        let offset = 0;
        for (let index = 0; index < parts.length; index += 1) {
            const part = parts[index];
            if (offset >= buffer.length) {
                throw new QqApiError("QQ 文件预上传返回了多余分片", { code: "QQ_UPLOAD_PARTS_INVALID", data: prepare });
            }
            const size = Math.min(buffer.length - offset, Math.max(1, Number(part.block_size || prepare.block_size || 5 * 1024 * 1024)));
            const chunk = buffer.subarray(offset, offset + size);
            await retryUploadOperation(`文件分片 ${index + 1}/${parts.length} 上传`, async () => {
                const uploadResponse = await fetchImpl(String(part.presigned_url), {
                    method: "PUT",
                    headers: { "Content-Length": String(chunk.length) },
                    body: chunk
                });
                if (!uploadResponse.ok) {
                    throw new QqApiError(`HTTP ${uploadResponse.status}`, {
                        status: uploadResponse.status,
                        code: "QQ_FILE_PART_HTTP"
                    });
                }
            });
            await retryUploadOperation(`文件分片 ${index + 1}/${parts.length} 确认`, () =>
                request(targetPath(target, "upload_part_finish"), {
                    method: "POST",
                    body: JSON.stringify({
                        upload_id: prepare.upload_id,
                        part_index: Number(part.index ?? part.part_index ?? index),
                        block_size: String(chunk.length),
                        md5: digest(chunk, "md5")
                    })
                })
            );
            offset += size;
        }
        if (offset !== buffer.length) throw new QqApiError("QQ 文件分片大小与本地文件不一致", { code: "QQ_UPLOAD_SIZE_MISMATCH" });
        const merged = await retryUploadOperation("文件合并", () =>
            request(targetPath(target, "files"), {
                method: "POST",
                body: JSON.stringify({ file_type: 4, srv_send_msg: false, file_name: fileName, upload_id: prepare.upload_id }),
                timeoutMs: Math.max(timeoutMs, 60000)
            })
        );
        if (!merged.file_info) throw new QqApiError("QQ 文件合并响应缺少 file_info", { data: merged });
        return merged.file_info;
    }

    async function sendFile(target, filePath, reply = {}) {
        const fileInfo = await uploadFile(target, filePath);
        const sequence = nextReplyPayload(reply);
        return retryUploadOperation("文件消息发送", () =>
            request(targetPath(target, "messages"), {
                method: "POST",
                body: JSON.stringify({ msg_type: 7, media: { file_info: fileInfo }, ...sequence }),
                timeoutMs: Math.max(timeoutMs, 60000)
            })
        );
    }

    return { accessToken, gateway, request, sendFile, sendMarkdown, sendText, uploadFile };
}

module.exports = {
    MAX_FILE_BYTES,
    QqApiError,
    commandKeyboard,
    createQqApiClient,
    isRetryableQqUploadError,
    markdownToPlainText,
    requestAppAccessToken,
    targetPath,
    testQqBotCredentials
};
