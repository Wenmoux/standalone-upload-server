DROP INDEX IF EXISTS idx_book_metadata_expected_chapters;
DROP INDEX IF EXISTS idx_book_metadata_catalog_updated;
DROP INDEX IF EXISTS idx_book_metadata_source_updated;

DROP TRIGGER IF EXISTS trg_book_metadata_taxonomy ON book_metadata;
DROP FUNCTION IF EXISTS sync_book_taxonomy();
DROP INDEX IF EXISTS idx_book_taxonomy_value_trgm;
DROP INDEX IF EXISTS idx_book_taxonomy_lookup;
DROP TABLE IF EXISTS book_taxonomy;
DROP TABLE IF EXISTS book_status_dictionary;
DROP TABLE IF EXISTS platform_dictionary;

ALTER TABLE book_metadata DROP CONSTRAINT IF EXISTS book_metadata_status_nonempty;
ALTER TABLE book_metadata DROP CONSTRAINT IF EXISTS book_metadata_platform_nonempty;
ALTER TABLE book_metadata DROP COLUMN IF EXISTS expected_chapters_source;
ALTER TABLE book_metadata DROP COLUMN IF EXISTS expected_chapters;
ALTER TABLE book_metadata DROP COLUMN IF EXISTS metadata_cached_at;
ALTER TABLE book_metadata DROP COLUMN IF EXISTS catalog_updated_at;
ALTER TABLE book_metadata DROP COLUMN IF EXISTS source_updated_at;

DROP TRIGGER IF EXISTS trg_chapter_order_nonnegative_deferred ON chapter_cache;
DROP FUNCTION IF EXISTS chapter_order_nonnegative_at_commit();
ALTER TABLE chapter_cache
    ADD CONSTRAINT chapter_cache_order_nonnegative CHECK (COALESCE(chapter_order, 0) >= 0) NOT VALID;
