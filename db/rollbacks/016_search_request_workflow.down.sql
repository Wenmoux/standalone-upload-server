DROP INDEX IF EXISTS idx_reader_search_requests_resolution;
DROP INDEX IF EXISTS idx_reader_search_requests_workflow;

ALTER TABLE reader_search_requests
    DROP COLUMN IF EXISTS notified_at,
    DROP COLUMN IF EXISTS resolved_at,
    DROP COLUMN IF EXISTS resolution_note,
    DROP COLUMN IF EXISTS resolved_book_id;
