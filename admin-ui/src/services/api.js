/**
 * [INPUT]: 依赖浏览器 fetch、同源 Cookie 会话和服务端 JSON/文本响应约定
 * [OUTPUT]: 对外提供 ApiError、认证失效事件、统一 api 请求函数与受控下载地址生成器
 * [POS]: admin-ui/src/services 的唯一 HTTP 边界，为全部视图统一凭证、响应解析、认证恢复与错误语义
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

export const ADMIN_AUTH_EXPIRED_EVENT = "po18:admin-auth-expired";

function notifyAuthExpired(path, payload) {
  if (typeof window === "undefined") return;
  if (/^\/admin-api\/auth\/(?:login|me|access)$/.test(path)) return;
  window.dispatchEvent(new CustomEvent(ADMIN_AUTH_EXPIRED_EVENT, { detail: { path, payload } }));
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
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : { message: await response.text().catch(() => "") };
  if (!response.ok) {
    if (response.status === 401) notifyAuthExpired(path, payload);
    throw new ApiError(payload.error || payload.message || `请求失败：${response.status}`, response.status, payload);
  }
  return payload;
}

export function adminDownloadPath(path) {
  return path;
}
