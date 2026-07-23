ALTER TABLE reader_users
    ADD COLUMN IF NOT EXISTS daily_chapter_limit INTEGER NOT NULL DEFAULT 500;

ALTER TABLE reader_users
    DROP CONSTRAINT IF EXISTS reader_users_daily_chapter_limit_nonnegative;

ALTER TABLE reader_users
    ADD CONSTRAINT reader_users_daily_chapter_limit_nonnegative
    CHECK (daily_chapter_limit >= 0);

CREATE TABLE IF NOT EXISTS reader_chapter_usage (
    user_id BIGINT NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
    read_date DATE NOT NULL,
    book_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    first_read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, read_date, book_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS idx_reader_chapter_usage_date
    ON reader_chapter_usage(read_date, user_id);
