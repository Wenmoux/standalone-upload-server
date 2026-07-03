CREATE INDEX IF NOT EXISTS idx_book_stats_platform_cache
    ON book_stats((LOWER(TRIM(COALESCE(platform, '')))), cache_count DESC, book_id);
