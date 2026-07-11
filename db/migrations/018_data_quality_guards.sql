DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'book_metadata_book_id_nonempty') THEN
        ALTER TABLE book_metadata
            ADD CONSTRAINT book_metadata_book_id_nonempty CHECK (btrim(book_id) <> '') NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'book_metadata_counts_nonnegative') THEN
        ALTER TABLE book_metadata
            ADD CONSTRAINT book_metadata_counts_nonnegative CHECK (
                COALESCE(word_count, 0) >= 0 AND
                COALESCE(chapter_count, 0) >= 0 AND
                COALESCE(total_chapters, 0) >= 0 AND
                COALESCE(subscribed_chapters, 0) >= 0 AND
                COALESCE(free_chapters, 0) >= 0 AND
                COALESCE(paid_chapters, 0) >= 0
            ) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chapter_cache_identity_nonempty') THEN
        ALTER TABLE chapter_cache
            ADD CONSTRAINT chapter_cache_identity_nonempty CHECK (btrim(book_id) <> '' AND btrim(chapter_id) <> '') NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chapter_cache_order_nonnegative') THEN
        ALTER TABLE chapter_cache
            ADD CONSTRAINT chapter_cache_order_nonnegative CHECK (COALESCE(chapter_order, 0) >= 0) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reader_review_vote_value') THEN
        ALTER TABLE reader_book_review_votes
            ADD CONSTRAINT reader_review_vote_value CHECK (vote IN ('like', 'dislike')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reader_correction_status_value') THEN
        ALTER TABLE reader_corrections
            ADD CONSTRAINT reader_correction_status_value CHECK (status IN ('pending', 'approved', 'rejected', 'applied')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'system_jobs_status_value') THEN
        ALTER TABLE system_jobs
            ADD CONSTRAINT system_jobs_status_value CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_tokens_kind_value') THEN
        ALTER TABLE api_tokens
            ADD CONSTRAINT api_tokens_kind_value CHECK (kind IN ('bot', 'upload')) NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chapter_cache_invalid_identity
    ON chapter_cache (id)
    WHERE btrim(book_id) = '' OR btrim(chapter_id) = '';

CREATE INDEX IF NOT EXISTS idx_book_metadata_invalid_counts
    ON book_metadata (id)
    WHERE COALESCE(word_count, 0) < 0
       OR COALESCE(chapter_count, 0) < 0
       OR COALESCE(total_chapters, 0) < 0
       OR COALESCE(subscribed_chapters, 0) < 0
       OR COALESCE(free_chapters, 0) < 0
       OR COALESCE(paid_chapters, 0) < 0;
