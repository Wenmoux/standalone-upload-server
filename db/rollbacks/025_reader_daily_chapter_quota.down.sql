DROP TABLE IF EXISTS reader_chapter_usage;

ALTER TABLE reader_users
    DROP CONSTRAINT IF EXISTS reader_users_daily_chapter_limit_nonnegative;

ALTER TABLE reader_users
    DROP COLUMN IF EXISTS daily_chapter_limit;
