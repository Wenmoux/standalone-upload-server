ALTER TABLE book_metadata
    ADD COLUMN IF NOT EXISTS manifest_checksum TEXT NOT NULL DEFAULT '';

ALTER TABLE chapter_cache
    ADD COLUMN IF NOT EXISTS manifest_checksum TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'book_metadata_manifest_checksum_format') THEN
        ALTER TABLE book_metadata
            ADD CONSTRAINT book_metadata_manifest_checksum_format
            CHECK (manifest_checksum = '' OR manifest_checksum ~ '^[0-9a-f]{64}$') NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chapter_cache_manifest_checksum_format') THEN
        ALTER TABLE chapter_cache
            ADD CONSTRAINT chapter_cache_manifest_checksum_format
            CHECK (manifest_checksum = '' OR manifest_checksum ~ '^[0-9a-f]{64}$') NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chapter_cache_manifest_checksum
    ON chapter_cache(book_id, manifest_checksum)
    WHERE manifest_checksum <> '';
