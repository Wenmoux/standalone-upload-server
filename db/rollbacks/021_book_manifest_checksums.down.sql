DROP INDEX IF EXISTS idx_chapter_cache_manifest_checksum;
ALTER TABLE chapter_cache DROP CONSTRAINT IF EXISTS chapter_cache_manifest_checksum_format;
ALTER TABLE book_metadata DROP CONSTRAINT IF EXISTS book_metadata_manifest_checksum_format;
ALTER TABLE chapter_cache DROP COLUMN IF EXISTS manifest_checksum;
ALTER TABLE book_metadata DROP COLUMN IF EXISTS manifest_checksum;
