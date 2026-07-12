/**
 * [INPUT]: 依赖跨模块现行字段语义，不依赖运行时实现
 * [OUTPUT]: 通过 JSDoc 提供 BookIdentity、ChapterRecord、SystemJob、AuthScope 与 CrawlerResult 类型契约
 * [POS]: types 的文档型领域边界，让 JavaScript 模块共享术语而不改变既有运行时和 API 字段
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/** @typedef {{bookId: string, platform: string}} BookIdentity */

/**
 * @typedef {Object} ChapterRecord
 * @property {string} bookId
 * @property {string} chapterId
 * @property {number} chapterOrder
 * @property {string} title
 * @property {boolean} isVolume
 */

/**
 * @typedef {Object} SystemJob
 * @property {number} id
 * @property {string} type
 * @property {'queued'|'running'|'succeeded'|'failed'|'canceled'} status
 * @property {number} progress
 * @property {number} attempts
 * @property {number} maxAttempts
 * @property {Object<string, unknown>} input
 * @property {Object<string, unknown>} result
 */

/** @typedef {'bot:read'|'bot:user'|'bot:export'|'bot:po18'|'bot:admin'|'crawler:write'} AuthScope */

/**
 * @typedef {Object} CrawlerResult
 * @property {number} booksProcessed
 * @property {number} metadataUploaded
 * @property {number} chaptersUploaded
 * @property {number} chaptersSkippedCached
 * @property {number} chaptersFailed
 */

module.exports = {};
