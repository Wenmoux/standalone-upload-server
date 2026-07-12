/**
 * [INPUT]: 依赖注入的 PostgreSQL query 和上传/更新产生的事件字段
 * [OUTPUT]: 对外提供上传事件记录、查询与状态更新能力的事件服务工厂
 * [POS]: services 的上传事件事实源，为更新历史、Telegram 推送与后台观测提供统一落库边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function createEventService(options = {}) {
    const query = options.query;
    const cleanPgText = options.cleanPgText || ((value) => value);
    const cleanPgValue = options.cleanPgValue || ((value) => value);

    async function recordEvent(event = {}) {
        if (typeof query !== "function") throw new Error("event query function is not configured");
        const details = cleanPgValue(event.details || {});
        const result = await query(
            `INSERT INTO upload_events
            (event_type, action, book_id, chapter_id, title, platform, source, uploader, uploader_id, details)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            RETURNING *`,
            [
                event.eventType,
                cleanPgText(event.action || ""),
                cleanPgText(event.bookId || "") || null,
                cleanPgText(event.chapterId || "") || null,
                cleanPgText(event.title || "") || null,
                cleanPgText(event.platform || "") || null,
                cleanPgText(event.source || "") || null,
                cleanPgText(event.uploader || "") || null,
                cleanPgText(event.uploaderId || "") || null,
                cleanPgText(JSON.stringify(details))
            ]
        );
        return result.rows[0];
    }

    return { recordEvent };
}

module.exports = { createEventService };
