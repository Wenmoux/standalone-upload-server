DROP INDEX IF EXISTS idx_pg_chapter_cache_book_order_unique;

CREATE UNIQUE INDEX idx_pg_chapter_cache_book_order_unique
    ON chapter_cache(book_id, chapter_order)
    WHERE chapter_order > 0
      AND LOWER(TRIM(COALESCE(platform, ''))) NOT IN ('qidian', 'qd', 'fanqie', 'fq', 'tomato');
