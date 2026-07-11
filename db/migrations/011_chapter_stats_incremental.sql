DROP TRIGGER IF EXISTS trg_chapter_cache_book_stats ON chapter_cache;
DROP TRIGGER IF EXISTS trg_chapter_cache_stats_insert ON chapter_cache;
DROP TRIGGER IF EXISTS trg_chapter_cache_stats_update ON chapter_cache;
DROP TRIGGER IF EXISTS trg_chapter_cache_stats_delete ON chapter_cache;
DROP TRIGGER IF EXISTS trg_chapter_cache_stats_truncate ON chapter_cache;

CREATE OR REPLACE FUNCTION chapter_stats_after_insert()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO book_stats (
        book_id,
        platform,
        cache_count,
        last_chapter_at,
        updated_at
    )
    SELECT
        book_id,
        COALESCE(MAX(NULLIF(platform, '')), ''),
        COUNT(*)::int,
        MAX(COALESCE(updated_at, created_at)),
        CURRENT_TIMESTAMP
    FROM new_chapters
    WHERE book_id IS NOT NULL AND btrim(book_id) <> ''
    GROUP BY book_id
    ON CONFLICT (book_id) DO UPDATE SET
        platform = COALESCE(NULLIF(EXCLUDED.platform, ''), book_stats.platform),
        cache_count = book_stats.cache_count + EXCLUDED.cache_count,
        last_chapter_at = GREATEST(book_stats.last_chapter_at, EXCLUDED.last_chapter_at),
        updated_at = CURRENT_TIMESTAMP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION chapter_stats_after_update()
RETURNS TRIGGER AS $$
DECLARE
    moved_book BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM old_chapters old_row
        FULL JOIN new_chapters new_row USING (id)
        WHERE old_row.book_id IS DISTINCT FROM new_row.book_id
    ) INTO moved_book;

    IF moved_book THEN
        WITH affected AS (
            SELECT book_id FROM old_chapters
            UNION
            SELECT book_id FROM new_chapters
        ),
        exact AS (
            SELECT
                affected.book_id,
                COALESCE(MAX(NULLIF(chapter_cache.platform, '')), '') platform,
                COUNT(chapter_cache.id)::int cache_count,
                MAX(COALESCE(chapter_cache.updated_at, chapter_cache.created_at)) last_chapter_at
            FROM affected
            LEFT JOIN chapter_cache ON chapter_cache.book_id = affected.book_id
            WHERE affected.book_id IS NOT NULL AND btrim(affected.book_id) <> ''
            GROUP BY affected.book_id
        )
        INSERT INTO book_stats (book_id, platform, cache_count, last_chapter_at, updated_at)
        SELECT book_id, platform, cache_count, last_chapter_at, CURRENT_TIMESTAMP
        FROM exact
        ON CONFLICT (book_id) DO UPDATE SET
            platform = COALESCE(NULLIF(EXCLUDED.platform, ''), book_stats.platform),
            cache_count = EXCLUDED.cache_count,
            last_chapter_at = EXCLUDED.last_chapter_at,
            updated_at = CURRENT_TIMESTAMP;
    ELSE
        WITH changed AS (
            SELECT
                book_id,
                COALESCE(MAX(NULLIF(platform, '')), '') platform,
                MAX(COALESCE(updated_at, created_at)) last_chapter_at
            FROM new_chapters
            WHERE book_id IS NOT NULL AND btrim(book_id) <> ''
            GROUP BY book_id
        )
        UPDATE book_stats stats
        SET
            platform = COALESCE(NULLIF(changed.platform, ''), stats.platform),
            last_chapter_at = GREATEST(stats.last_chapter_at, changed.last_chapter_at),
            updated_at = CURRENT_TIMESTAMP
        FROM changed
        WHERE stats.book_id = changed.book_id;

        INSERT INTO book_stats (book_id, platform, cache_count, last_chapter_at, updated_at)
        SELECT
            changed.book_id,
            changed.platform,
            (SELECT COUNT(*)::int FROM chapter_cache WHERE chapter_cache.book_id = changed.book_id),
            changed.last_chapter_at,
            CURRENT_TIMESTAMP
        FROM (
            SELECT
                book_id,
                COALESCE(MAX(NULLIF(platform, '')), '') platform,
                MAX(COALESCE(updated_at, created_at)) last_chapter_at
            FROM new_chapters
            WHERE book_id IS NOT NULL AND btrim(book_id) <> ''
            GROUP BY book_id
        ) changed
        WHERE NOT EXISTS (SELECT 1 FROM book_stats WHERE book_stats.book_id = changed.book_id)
        ON CONFLICT (book_id) DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION chapter_stats_after_delete()
RETURNS TRIGGER AS $$
BEGIN
    WITH deleted AS (
        SELECT book_id, COUNT(*)::int deleted_count
        FROM old_chapters
        WHERE book_id IS NOT NULL AND btrim(book_id) <> ''
        GROUP BY book_id
    )
    UPDATE book_stats stats
    SET
        cache_count = GREATEST(0, stats.cache_count - deleted.deleted_count),
        last_chapter_at = (
            SELECT MAX(COALESCE(chapter_cache.updated_at, chapter_cache.created_at))
            FROM chapter_cache
            WHERE chapter_cache.book_id = stats.book_id
        ),
        updated_at = CURRENT_TIMESTAMP
    FROM deleted
    WHERE stats.book_id = deleted.book_id;

    DELETE FROM book_stats stats
    WHERE stats.book_id IN (SELECT book_id FROM old_chapters)
      AND NOT EXISTS (SELECT 1 FROM book_metadata WHERE book_metadata.book_id = stats.book_id)
      AND NOT EXISTS (SELECT 1 FROM chapter_cache WHERE chapter_cache.book_id = stats.book_id)
      AND NOT EXISTS (SELECT 1 FROM reader_book_feedback WHERE reader_book_feedback.book_id = stats.book_id)
      AND NOT EXISTS (SELECT 1 FROM reader_book_crowd_votes WHERE reader_book_crowd_votes.book_id = stats.book_id);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION chapter_stats_after_truncate()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE book_stats
    SET cache_count = 0, last_chapter_at = NULL, updated_at = CURRENT_TIMESTAMP;

    DELETE FROM book_stats stats
    WHERE NOT EXISTS (SELECT 1 FROM book_metadata WHERE book_metadata.book_id = stats.book_id)
      AND NOT EXISTS (SELECT 1 FROM reader_book_feedback WHERE reader_book_feedback.book_id = stats.book_id)
      AND NOT EXISTS (SELECT 1 FROM reader_book_crowd_votes WHERE reader_book_crowd_votes.book_id = stats.book_id);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chapter_cache_stats_insert
AFTER INSERT ON chapter_cache
REFERENCING NEW TABLE AS new_chapters
FOR EACH STATEMENT EXECUTE FUNCTION chapter_stats_after_insert();

CREATE TRIGGER trg_chapter_cache_stats_update
AFTER UPDATE ON chapter_cache
REFERENCING OLD TABLE AS old_chapters NEW TABLE AS new_chapters
FOR EACH STATEMENT EXECUTE FUNCTION chapter_stats_after_update();

CREATE TRIGGER trg_chapter_cache_stats_delete
AFTER DELETE ON chapter_cache
REFERENCING OLD TABLE AS old_chapters
FOR EACH STATEMENT EXECUTE FUNCTION chapter_stats_after_delete();

CREATE TRIGGER trg_chapter_cache_stats_truncate
AFTER TRUNCATE ON chapter_cache
FOR EACH STATEMENT EXECUTE FUNCTION chapter_stats_after_truncate();
