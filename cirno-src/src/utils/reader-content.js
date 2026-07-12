/**
 * [INPUT]: 依赖 sanitize-html 的 HTML/图片安全边界与可注入的繁简转换器
 * [OUTPUT]: 对外提供图片段落识别、话本 HTML 解析、文本规范化和段落转换函数
 * [POS]: cirno-src/src/utils 的正文摄取层，把异构缓存内容归一化为安全渲染模型
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { sanitizeHtml, sanitizeImageUrl } from './sanitize-html'

export function isPictureParagraph(text) {
  return /^\s*<img\b[\s\S]*>\s*$/.test(String(text || ''))
}

export function isIhuabenPlatform(value = '') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
  return normalized === 'ihuaben' || normalized === 'huaben' || normalized === '话本'
}

export function isIhuabenChapterInfo(info = {}) {
  return !!(info.is_ihuaben || isIhuabenPlatform(info.platform) || /hbu-chapter-style/i.test(String(info.html_content || '')))
}

export function decodeHtmlText(value = '') {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = String(value || '')
  return textarea.value
}

export function nodeTextContent(node) {
  return decodeHtmlText((node && (node.textContent || node.innerText)) || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .trim()
}

export function absolutizeIhuabenImage(src = '') {
  const raw = String(src || '').trim()
  if (!raw) return ''
  if (/^\/\//.test(raw)) return sanitizeImageUrl(`${window.location.protocol}${raw}`)
  return sanitizeImageUrl(raw, 'https://www.ihuaben.com/')
}

export function htmlAttr(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function parseIhuabenParagraph(node) {
  const img = node.querySelector && node.querySelector('img')
  if (img) {
    const src = absolutizeIhuabenImage(img.getAttribute('src') || img.getAttribute('data-src') || '')
    const alt = decodeHtmlText(img.getAttribute('alt') || '图片').trim() || '图片'
    return src
      ? {
          type: 'ihuaben-image',
          text: `<img src="${htmlAttr(src)}" alt='${htmlAttr(alt)}'>`,
          displayText: alt,
          imageSrc: src,
          imageAlt: alt,
          tsukkomi_num: 0
        }
      : null
  }

  const speakerNode = node.querySelector && (node.querySelector('span a') || node.querySelector('i'))
  const speaker = nodeTextContent(speakerNode)
  if (speakerNode && speaker) {
    const fullText = nodeTextContent(node)
    const content = fullText.startsWith(speaker) ? fullText.slice(speaker.length).trim() : fullText
    return {
      type: 'ihuaben-dialogue',
      side: String(speakerNode.tagName || '').toLowerCase() === 'i' ? 'right' : 'left',
      speaker,
      text: content,
      displayText: content,
      tsukkomi_num: 0
    }
  }

  const text = nodeTextContent(node)
  return text ? { type: 'ihuaben-narration', text, displayText: text, tsukkomi_num: 0 } : null
}

export function parseIhuabenHtml(html = '') {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = sanitizeHtml(html || '')
  return Array.from(wrapper.querySelectorAll('p')).map(parseIhuabenParagraph).filter(Boolean)
}

export function normalizeParagraphLine(text) {
  const value = String(text || '')
  if (!value || isPictureParagraph(value)) return value
  return value.replace(/^[\s\u3000]+/, '')
}

export function convertRawText(text, converter, mode, validMode) {
  const input = String(text || '')
  return converter && validMode(mode) ? converter(input, mode) : input
}

export function convertParagraphText(text, converter, mode, validMode) {
  const input = normalizeParagraphLine(text)
  if (!input || isPictureParagraph(input)) return input
  return convertRawText(input, converter, mode, validMode)
}
