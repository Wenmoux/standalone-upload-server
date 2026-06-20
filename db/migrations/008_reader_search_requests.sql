CREATE TABLE IF NOT EXISTS reader_search_requests (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES reader_users(id) ON DELETE SET NULL,
    telegram_id TEXT DEFAULT '',
    telegram_username TEXT DEFAULT '',
    nickname TEXT DEFAULT '',
    query TEXT NOT NULL,
    clean_query TEXT DEFAULT '',
    search_type TEXT DEFAULT 'search',
    platform TEXT DEFAULT '',
    result_count INTEGER DEFAULT 0,
    source TEXT DEFAULT 'telegram_bot',
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, query, platform, search_type)
);

CREATE INDEX IF NOT EXISTS idx_reader_search_requests_query
    ON reader_search_requests(query, platform, search_type);

CREATE INDEX IF NOT EXISTS idx_reader_search_requests_status
    ON reader_search_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reader_search_requests_user
    ON reader_search_requests(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reader_search_requests_telegram
    ON reader_search_requests(telegram_id, created_at DESC);
