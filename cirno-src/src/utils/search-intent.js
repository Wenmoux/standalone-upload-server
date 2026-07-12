/**
 * [INPUT]: 依赖用户搜索文本、可选平台过滤和约定的作者/标签/书名语法
 * [OUTPUT]: 对外提供搜索值归一化、意图解析与书库查询参数投影函数
 * [POS]: cirno-src/src/utils 的搜索语义适配层，被首页和全库页共享以消除解析分歧
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export function normalizeSearchValue(value) {
  return String(value || '').trim()
}

export function parseSearchIntent(value) {
  const keyword = normalizeSearchValue(value)
  const author = keyword.match(/^(?:author|a|作者|作家)[:：]\s*(.+)$/i)
  if (author && normalizeSearchValue(author[1])) {
    return { type: 'author', value: normalizeSearchValue(author[1]) }
  }

  const tag = keyword.match(/^(?:tag|t|标签|分类)[:：]\s*(.+)$/i)
  if (tag && normalizeSearchValue(tag[1])) {
    return { type: 'tag', value: normalizeSearchValue(tag[1]) }
  }

  if (/^#[^#\s]/.test(keyword)) {
    return { type: 'tag', value: normalizeSearchValue(keyword.replace(/^#+/, '')) }
  }

  return { type: 'keyword', value: keyword }
}

export function libraryQueryForSearch(intent, platform = '') {
  const query = {}
  if (!intent || !intent.value) return query
  if (intent.type === 'author') query.author = intent.value
  if (intent.type === 'tag') query.tag = intent.value
  if (intent.type === 'keyword') query.q = intent.value
  if (platform) query.platform = platform
  return query
}
