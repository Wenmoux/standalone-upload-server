DROP TRIGGER IF EXISTS trg_reader_book_crowd_votes_book_stats ON reader_book_crowd_votes;
DROP TRIGGER IF EXISTS trg_reader_book_feedback_book_stats ON reader_book_feedback;
DROP TRIGGER IF EXISTS trg_chapter_cache_book_stats ON chapter_cache;
DROP TRIGGER IF EXISTS trg_book_metadata_book_stats ON book_metadata;

DROP FUNCTION IF EXISTS book_stats_refresh_trigger();
DROP FUNCTION IF EXISTS refresh_book_stats(TEXT);

DROP INDEX IF EXISTS idx_book_stats_updated;
DROP INDEX IF EXISTS idx_book_stats_crowd_votes;
DROP INDEX IF EXISTS idx_book_stats_cache_count;

DROP TABLE IF EXISTS book_stats;
