DROP INDEX IF EXISTS idx_book_metadata_invalid_counts;
DROP INDEX IF EXISTS idx_chapter_cache_invalid_identity;

ALTER TABLE IF EXISTS api_tokens DROP CONSTRAINT IF EXISTS api_tokens_kind_value;
ALTER TABLE IF EXISTS system_jobs DROP CONSTRAINT IF EXISTS system_jobs_status_value;
ALTER TABLE IF EXISTS reader_corrections DROP CONSTRAINT IF EXISTS reader_correction_status_value;
ALTER TABLE IF EXISTS reader_book_review_votes DROP CONSTRAINT IF EXISTS reader_review_vote_value;
ALTER TABLE IF EXISTS chapter_cache DROP CONSTRAINT IF EXISTS chapter_cache_order_nonnegative;
ALTER TABLE IF EXISTS chapter_cache DROP CONSTRAINT IF EXISTS chapter_cache_identity_nonempty;
ALTER TABLE IF EXISTS book_metadata DROP CONSTRAINT IF EXISTS book_metadata_counts_nonnegative;
ALTER TABLE IF EXISTS book_metadata DROP CONSTRAINT IF EXISTS book_metadata_book_id_nonempty;
