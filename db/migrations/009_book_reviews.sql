CREATE TABLE IF NOT EXISTS reader_book_reviews (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES reader_users(id) ON DELETE SET NULL,
    telegram_id TEXT DEFAULT '',
    telegram_username TEXT DEFAULT '',
    nickname TEXT DEFAULT '',
    book_id TEXT NOT NULL,
    content TEXT NOT NULL,
    publish_cost INTEGER NOT NULL DEFAULT 100,
    status TEXT NOT NULL DEFAULT 'published',
    source TEXT DEFAULT 'telegram_bot',
    channel_chat_id TEXT DEFAULT '',
    channel_message_id TEXT DEFAULT '',
    channel_status TEXT DEFAULT 'pending',
    channel_error TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reader_book_review_votes (
    id BIGSERIAL PRIMARY KEY,
    review_id BIGINT NOT NULL REFERENCES reader_book_reviews(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES reader_users(id) ON DELETE SET NULL,
    telegram_id TEXT DEFAULT '',
    vote TEXT NOT NULL,
    reward_delta INTEGER NOT NULL DEFAULT 0,
    source TEXT DEFAULT 'telegram_bot',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(review_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reader_book_reviews_book
    ON reader_book_reviews(book_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_reader_book_reviews_user
    ON reader_book_reviews(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reader_book_reviews_telegram
    ON reader_book_reviews(telegram_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reader_book_review_votes_review
    ON reader_book_review_votes(review_id, vote);

CREATE INDEX IF NOT EXISTS idx_reader_book_review_votes_user
    ON reader_book_review_votes(user_id, created_at DESC);
