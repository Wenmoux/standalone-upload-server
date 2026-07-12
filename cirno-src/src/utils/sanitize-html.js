/**
 * [INPUT]: 依赖 DOMPurify、不可信正文 HTML/图片地址和可选解析基址
 * [OUTPUT]: 对外提供白名单 sanitizeHtml 与协议受限的 sanitizeImageUrl
 * [POS]: cirno-src/src/utils 的 DOM 注入安全边界，所有富文本和外部图片渲染前必须经过此层
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import DOMPurify from 'dompurify'

const URI_SAFE = /^(?:(?:https?|data|blob):|\/\/)/i

export function sanitizeHtml(html = '') {
  return DOMPurify.sanitize(String(html || ''), {
    ALLOWED_TAGS: ['p', 'br', 'img', 'strong', 'b', 'em', 'i', 'span', 'div', 'a', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea'],
    FORBID_ATTR: ['style'],
    ADD_ATTR: ['rel']
  })
}

export function sanitizeImageUrl(url = '', base = '') {
  const raw = String(url || '').trim()
  if (!raw || /^javascript:/i.test(raw)) return ''
  if (/^\/\//.test(raw)) return URI_SAFE.test(raw) ? raw : ''
  try {
    const fallbackBase = typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost/'
    const resolved = new URL(raw, base || fallbackBase).href
    return URI_SAFE.test(resolved) ? resolved : ''
  } catch (e) {
    return ''
  }
}
