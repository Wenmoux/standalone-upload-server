/**
 * Shared domain contracts used by JavaScript services. These are documentation-only
 * typedefs so existing runtime and API fields remain unchanged.
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
