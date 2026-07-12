/**
 * [INPUT]: 依赖浏览器 fetch、同源 Cookie 会话和服务端 JSON/文本响应约定
 * [OUTPUT]: 对外提供 ApiError、统一 api 请求函数与受控下载地址生成器
 * [POS]: admin-ui/src/services 的唯一 HTTP 边界，为全部视图统一凭证与错误语义
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const hasBody = options.body !== undefined && options.body !== null;
  if (hasBody && !headers["Content-Type"] && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(payload.error || payload.message || `请求失败：${response.status}`, response.status, payload);
  }
  return payload;
}

export function adminDownloadPath(path) {
  return path;
}
