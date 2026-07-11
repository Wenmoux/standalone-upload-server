DROP TRIGGER IF EXISTS trg_chapter_cache_stats_insert ON chapter_cache;
DROP TRIGGER IF EXISTS trg_chapter_cache_stats_update ON chapter_cache;
DROP TRIGGER IF EXISTS trg_chapter_cache_stats_delete ON chapter_cache;
DROP TRIGGER IF EXISTS trg_chapter_cache_stats_truncate ON chapter_cache;

DROP FUNCTION IF EXISTS chapter_stats_after_insert();
DROP FUNCTION IF EXISTS chapter_stats_after_update();
DROP FUNCTION IF EXISTS chapter_stats_after_delete();
DROP FUNCTION IF EXISTS chapter_stats_after_truncate();

DROP TRIGGER IF EXISTS trg_chapter_cache_book_stats ON chapter_cache;
CREATE TRIGGER trg_chapter_cache_book_stats
AFTER INSERT OR UPDATE OR DELETE ON chapter_cache
FOR EACH ROW EXECUTE FUNCTION book_stats_refresh_trigger();
