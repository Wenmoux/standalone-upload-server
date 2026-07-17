DROP INDEX IF EXISTS idx_pg_chapter_cache_book_order_unique;

WITH duplicate_books AS (
    SELECT DISTINCT book_id
    FROM (
        SELECT book_id, chapter_order
        FROM chapter_cache
        WHERE chapter_order > 0
        GROUP BY book_id, chapter_order
        HAVING COUNT(*) > 1
    ) duplicates
),
ranked_chapters AS (
    SELECT
        chapter.id,
        ROW_NUMBER() OVER (
            PARTITION BY chapter.book_id
            ORDER BY chapter.chapter_order ASC, chapter.chapter_id ASC, chapter.id ASC
        )::integer AS next_order
    FROM chapter_cache chapter
    JOIN duplicate_books duplicate ON duplicate.book_id = chapter.book_id
    WHERE chapter.chapter_order > 0
)
UPDATE chapter_cache chapter
SET chapter_order = ranked.next_order,
    updated_at = CURRENT_TIMESTAMP
FROM ranked_chapters ranked
WHERE chapter.id = ranked.id
  AND chapter.chapter_order IS DISTINCT FROM ranked.next_order;

CREATE UNIQUE INDEX idx_pg_chapter_cache_book_order_unique
    ON chapter_cache(book_id, chapter_order)
    WHERE chapter_order > 0;
