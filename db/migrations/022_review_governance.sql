ALTER TABLE reader_book_review_votes
    ADD COLUMN IF NOT EXISTS change_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_changed_at TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reader_review_vote_change_count_nonnegative') THEN
        ALTER TABLE reader_book_review_votes
            ADD CONSTRAINT reader_review_vote_change_count_nonnegative CHECK (change_count >= 0) NOT VALID;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS reader_book_review_reports (
    id BIGSERIAL PRIMARY KEY,
    review_id BIGINT NOT NULL REFERENCES reader_book_reviews(id) ON DELETE CASCADE,
    reporter_user_id BIGINT NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
    telegram_id TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    resolved_by BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
    resolution_note TEXT NOT NULL DEFAULT '',
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(review_id, reporter_user_id),
    CONSTRAINT reader_review_report_reason CHECK (reason IN ('spam', 'abuse', 'spoiler', 'illegal', 'other')),
    CONSTRAINT reader_review_report_status CHECK (status IN ('pending', 'resolved', 'rejected')),
    CONSTRAINT reader_review_report_details_length CHECK (char_length(details) <= 2000)
);

CREATE TABLE IF NOT EXISTS reader_book_review_appeals (
    id BIGSERIAL PRIMARY KEY,
    review_id BIGINT NOT NULL REFERENCES reader_book_reviews(id) ON DELETE CASCADE,
    appellant_user_id BIGINT NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
    telegram_id TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    resolved_by BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
    resolution_note TEXT NOT NULL DEFAULT '',
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT reader_review_appeal_status CHECK (status IN ('pending', 'accepted', 'rejected')),
    CONSTRAINT reader_review_appeal_content_length CHECK (char_length(content) BETWEEN 6 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_reader_review_reports_queue
    ON reader_book_review_reports(status, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_reader_review_reports_review
    ON reader_book_review_reports(review_id, status);
CREATE INDEX IF NOT EXISTS idx_reader_review_appeals_queue
    ON reader_book_review_appeals(status, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_reader_review_appeals_user
    ON reader_book_review_appeals(appellant_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reader_review_appeals_one_pending
    ON reader_book_review_appeals(review_id, appellant_user_id)
    WHERE status = 'pending';
