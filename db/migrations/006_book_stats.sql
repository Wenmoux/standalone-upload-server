CREATE TABLE IF NOT EXISTS book_stats (
    book_id TEXT PRIMARY KEY,
    platform TEXT NOT NULL DEFAULT '',
    cache_count INTEGER NOT NULL DEFAULT 0,
    like_count INTEGER NOT NULL DEFAULT 0,
    dislike_count INTEGER NOT NULL DEFAULT 0,
    crowd_votes INTEGER NOT NULL DEFAULT 0,
    crowd_silver INTEGER NOT NULL DEFAULT 0,
    last_chapter_at TIMESTAMP,
    last_metadata_at TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_book_stats_cache_count
    ON book_stats(cache_count DESC, book_id);

CREATE INDEX IF NOT EXISTS idx_book_stats_crowd_votes
    ON book_stats(crowd_votes DESC, book_id);

CREATE INDEX IF NOT EXISTS idx_book_stats_updated
    ON book_stats(updated_at DESC);

CREATE OR REPLACE FUNCTION refresh_book_stats(target_book_id TEXT)
RETURNS VOID AS $$
BEGIN
    IF target_book_id IS NULL OR btrim(target_book_id) = '' THEN
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM book_metadata WHERE book_id = target_book_id)
       AND NOT EXISTS (SELECT 1 FROM chapter_cache WHERE book_id = target_book_id)
       AND NOT EXISTS (SELECT 1 FROM reader_book_feedback WHERE book_id = target_book_id)
       AND NOT EXISTS (SELECT 1 FROM reader_book_crowd_votes WHERE book_id = target_book_id) THEN
        DELETE FROM book_stats WHERE book_id = target_book_id;
        RETURN;
    END IF;

    INSERT INTO book_stats (
        book_id,
        platform,
        cache_count,
        like_count,
        dislike_count,
        crowd_votes,
        crowd_silver,
        last_chapter_at,
        last_metadata_at,
        updated_at
    )
    SELECT
        target_book_id,
        COALESCE(meta.platform, ''),
        COALESCE(ch.cache_count, 0)::int,
        COALESCE(fb.like_count, 0)::int,
        COALESCE(fb.dislike_count, 0)::int,
        COALESCE(cv.crowd_votes, 0)::int,
        COALESCE(cv.crowd_silver, 0)::int,
        ch.last_chapter_at,
        meta.last_metadata_at,
        CURRENT_TIMESTAMP
    FROM (SELECT target_book_id AS book_id) ids
    LEFT JOIN LATERAL (
        SELECT platform, MAX(COALESCE(updated_at, created_at)) OVER () last_metadata_at
        FROM book_metadata
        WHERE book_id = target_book_id
        ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
        LIMIT 1
    ) meta ON true
    LEFT JOIN LATERAL (
        SELECT COUNT(*)::int cache_count, MAX(COALESCE(updated_at, created_at)) last_chapter_at
        FROM chapter_cache
        WHERE book_id = target_book_id
    ) ch ON true
    LEFT JOIN LATERAL (
        SELECT
            COUNT(*) FILTER (WHERE feedback = 'like')::int like_count,
            COUNT(*) FILTER (WHERE feedback = 'dislike')::int dislike_count
        FROM reader_book_feedback
        WHERE book_id = target_book_id
    ) fb ON true
    LEFT JOIN LATERAL (
        SELECT COUNT(DISTINCT user_id)::int crowd_votes, COALESCE(SUM(vote_cost), 0)::int crowd_silver
        FROM reader_book_crowd_votes
        WHERE book_id = target_book_id
    ) cv ON true
    ON CONFLICT (book_id) DO UPDATE SET
        platform = EXCLUDED.platform,
        cache_count = EXCLUDED.cache_count,
        like_count = EXCLUDED.like_count,
        dislike_count = EXCLUDED.dislike_count,
        crowd_votes = EXCLUDED.crowd_votes,
        crowd_silver = EXCLUDED.crowd_silver,
        last_chapter_at = EXCLUDED.last_chapter_at,
        last_metadata_at = EXCLUDED.last_metadata_at,
        updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION book_stats_refresh_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM refresh_book_stats(OLD.book_id);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM refresh_book_stats(NEW.book_id);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_book_metadata_book_stats ON book_metadata;
CREATE TRIGGER trg_book_metadata_book_stats
AFTER INSERT OR UPDATE OR DELETE ON book_metadata
FOR EACH ROW EXECUTE FUNCTION book_stats_refresh_trigger();

DROP TRIGGER IF EXISTS trg_chapter_cache_book_stats ON chapter_cache;
CREATE TRIGGER trg_chapter_cache_book_stats
AFTER INSERT OR UPDATE OR DELETE ON chapter_cache
FOR EACH ROW EXECUTE FUNCTION book_stats_refresh_trigger();

DROP TRIGGER IF EXISTS trg_reader_book_feedback_book_stats ON reader_book_feedback;
CREATE TRIGGER trg_reader_book_feedback_book_stats
AFTER INSERT OR UPDATE OR DELETE ON reader_book_feedback
FOR EACH ROW EXECUTE FUNCTION book_stats_refresh_trigger();

DROP TRIGGER IF EXISTS trg_reader_book_crowd_votes_book_stats ON reader_book_crowd_votes;
CREATE TRIGGER trg_reader_book_crowd_votes_book_stats
AFTER INSERT OR UPDATE OR DELETE ON reader_book_crowd_votes
FOR EACH ROW EXECUTE FUNCTION book_stats_refresh_trigger();

WITH ids AS (
    SELECT book_id FROM book_metadata
    UNION
    SELECT book_id FROM chapter_cache
    UNION
    SELECT book_id FROM reader_book_feedback
    UNION
    SELECT book_id FROM reader_book_crowd_votes
),
meta AS (
    SELECT DISTINCT ON (book_id)
        book_id,
        platform,
        COALESCE(updated_at, created_at) last_metadata_at
    FROM book_metadata
    ORDER BY book_id, COALESCE(updated_at, created_at) DESC, id DESC
),
chapters AS (
    SELECT book_id, COUNT(*)::int cache_count, MAX(COALESCE(updated_at, created_at)) last_chapter_at
    FROM chapter_cache
    GROUP BY book_id
),
feedback AS (
    SELECT
        book_id,
        COUNT(*) FILTER (WHERE feedback = 'like')::int like_count,
        COUNT(*) FILTER (WHERE feedback = 'dislike')::int dislike_count
    FROM reader_book_feedback
    GROUP BY book_id
),
crowd AS (
    SELECT book_id, COUNT(DISTINCT user_id)::int crowd_votes, COALESCE(SUM(vote_cost), 0)::int crowd_silver
    FROM reader_book_crowd_votes
    GROUP BY book_id
)
INSERT INTO book_stats (
    book_id,
    platform,
    cache_count,
    like_count,
    dislike_count,
    crowd_votes,
    crowd_silver,
    last_chapter_at,
    last_metadata_at,
    updated_at
)
SELECT
    ids.book_id,
    COALESCE(meta.platform, ''),
    COALESCE(chapters.cache_count, 0),
    COALESCE(feedback.like_count, 0),
    COALESCE(feedback.dislike_count, 0),
    COALESCE(crowd.crowd_votes, 0),
    COALESCE(crowd.crowd_silver, 0),
    chapters.last_chapter_at,
    meta.last_metadata_at,
    CURRENT_TIMESTAMP
FROM ids
LEFT JOIN meta ON meta.book_id = ids.book_id
LEFT JOIN chapters ON chapters.book_id = ids.book_id
LEFT JOIN feedback ON feedback.book_id = ids.book_id
LEFT JOIN crowd ON crowd.book_id = ids.book_id
WHERE ids.book_id IS NOT NULL AND btrim(ids.book_id) <> ''
ON CONFLICT (book_id) DO UPDATE SET
    platform = EXCLUDED.platform,
    cache_count = EXCLUDED.cache_count,
    like_count = EXCLUDED.like_count,
    dislike_count = EXCLUDED.dislike_count,
    crowd_votes = EXCLUDED.crowd_votes,
    crowd_silver = EXCLUDED.crowd_silver,
    last_chapter_at = EXCLUDED.last_chapter_at,
    last_metadata_at = EXCLUDED.last_metadata_at,
    updated_at = CURRENT_TIMESTAMP;
