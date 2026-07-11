ALTER TABLE reader_search_requests
    ADD COLUMN IF NOT EXISTS resolved_book_id TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS resolution_note TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS notified_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_reader_search_requests_workflow
    ON reader_search_requests(status, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_reader_search_requests_resolution
    ON reader_search_requests(resolved_book_id, notified_at)
    WHERE resolved_book_id <> '';
