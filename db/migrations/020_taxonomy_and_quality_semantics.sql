ALTER TABLE chapter_cache DROP CONSTRAINT IF EXISTS chapter_cache_order_nonnegative;

CREATE OR REPLACE FUNCTION chapter_order_nonnegative_at_commit()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM chapter_cache
        WHERE id = NEW.id
          AND COALESCE(chapter_order, 0) < 0
    ) THEN
        RAISE EXCEPTION 'chapter_order must be non-negative after the transaction completes'
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chapter_order_nonnegative_deferred ON chapter_cache;
CREATE CONSTRAINT TRIGGER trg_chapter_order_nonnegative_deferred
AFTER INSERT OR UPDATE OF chapter_order ON chapter_cache
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION chapter_order_nonnegative_at_commit();

ALTER TABLE book_metadata
    ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS catalog_updated_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS metadata_cached_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE book_metadata
    ADD COLUMN IF NOT EXISTS expected_chapters INTEGER
        GENERATED ALWAYS AS (
            GREATEST(
                COALESCE(total_chapters, 0),
                COALESCE(subscribed_chapters, 0),
                COALESCE(chapter_count, 0),
                COALESCE(free_chapters, 0) + COALESCE(paid_chapters, 0)
            )
        ) STORED;

ALTER TABLE book_metadata
    ADD COLUMN IF NOT EXISTS expected_chapters_source TEXT
        GENERATED ALWAYS AS (
            CASE
                WHEN GREATEST(
                    COALESCE(total_chapters, 0),
                    COALESCE(subscribed_chapters, 0),
                    COALESCE(chapter_count, 0),
                    COALESCE(free_chapters, 0) + COALESCE(paid_chapters, 0)
                ) <= 0 THEN 'unknown'
                WHEN COALESCE(total_chapters, 0) >= GREATEST(
                    COALESCE(subscribed_chapters, 0),
                    COALESCE(chapter_count, 0),
                    COALESCE(free_chapters, 0) + COALESCE(paid_chapters, 0)
                ) THEN 'site_total'
                WHEN COALESCE(subscribed_chapters, 0) >= GREATEST(
                    COALESCE(chapter_count, 0),
                    COALESCE(free_chapters, 0) + COALESCE(paid_chapters, 0)
                ) THEN 'purchasable'
                WHEN COALESCE(chapter_count, 0) >= COALESCE(free_chapters, 0) + COALESCE(paid_chapters, 0)
                    THEN 'catalog'
                ELSE 'free_plus_paid'
            END
        ) STORED;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'book_metadata_platform_nonempty') THEN
        ALTER TABLE book_metadata
            ADD CONSTRAINT book_metadata_platform_nonempty CHECK (btrim(COALESCE(platform, '')) <> '') NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'book_metadata_status_nonempty') THEN
        ALTER TABLE book_metadata
            ADD CONSTRAINT book_metadata_status_nonempty CHECK (btrim(COALESCE(status, '')) <> '') NOT VALID;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS platform_dictionary (
    platform TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO platform_dictionary(platform, label) VALUES
    ('po18', 'PO18'),
    ('qidian', '起点'),
    ('qd', '起点'),
    ('fanqie', '番茄'),
    ('fq', '番茄'),
    ('tomato', '番茄'),
    ('ihuaben', '话本'),
    ('popo', 'POPO'),
    ('local', '本地导入'),
    ('unknown', '未知')
ON CONFLICT (platform) DO UPDATE SET label = EXCLUDED.label, active = TRUE, updated_at = CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS book_status_dictionary (
    status TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    terminal BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO book_status_dictionary(status, label, terminal) VALUES
    ('unknown', '未知', FALSE),
    ('ongoing', '连载中', FALSE),
    ('serializing', '连载中', FALSE),
    ('completed', '已完结', TRUE),
    ('finished', '已完结', TRUE),
    ('paused', '暂停', FALSE)
ON CONFLICT (status) DO UPDATE SET label = EXCLUDED.label, terminal = EXCLUDED.terminal, updated_at = CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS book_taxonomy (
    metadata_id BIGINT NOT NULL REFERENCES book_metadata(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('category', 'tag')),
    value TEXT NOT NULL,
    normalized_value TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (metadata_id, kind, normalized_value)
);

CREATE INDEX IF NOT EXISTS idx_book_taxonomy_lookup
    ON book_taxonomy(kind, normalized_value, metadata_id);
CREATE INDEX IF NOT EXISTS idx_book_taxonomy_value_trgm
    ON book_taxonomy USING GIN (normalized_value gin_trgm_ops);

CREATE OR REPLACE FUNCTION sync_book_taxonomy()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM book_taxonomy WHERE metadata_id = NEW.id;

    INSERT INTO book_taxonomy(metadata_id, kind, value, normalized_value)
    SELECT NEW.id, source.kind, source.value, lower(source.value)
    FROM (
        SELECT 'category'::text kind, btrim(token) value
        FROM regexp_split_to_table(COALESCE(NEW.category, ''), '[,，、/|·]+') token
        UNION ALL
        SELECT 'tag'::text kind, btrim(token) value
        FROM regexp_split_to_table(COALESCE(NEW.tags, ''), '[,，、|/\s:：;；#＃·•・]+') token
    ) source
    WHERE source.value <> ''
    ON CONFLICT (metadata_id, kind, normalized_value) DO UPDATE SET value = EXCLUDED.value;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_book_metadata_taxonomy ON book_metadata;
CREATE TRIGGER trg_book_metadata_taxonomy
AFTER INSERT OR UPDATE OF category, tags ON book_metadata
FOR EACH ROW EXECUTE FUNCTION sync_book_taxonomy();

INSERT INTO book_taxonomy(metadata_id, kind, value, normalized_value)
SELECT m.id, source.kind, source.value, lower(source.value)
FROM book_metadata m
CROSS JOIN LATERAL (
    SELECT 'category'::text kind, btrim(token) value
    FROM regexp_split_to_table(COALESCE(m.category, ''), '[,，、/|·]+') token
    UNION ALL
    SELECT 'tag'::text kind, btrim(token) value
    FROM regexp_split_to_table(COALESCE(m.tags, ''), '[,，、|/\s:：;；#＃·•・]+') token
) source
WHERE source.value <> ''
ON CONFLICT (metadata_id, kind, normalized_value) DO UPDATE SET value = EXCLUDED.value;

CREATE INDEX IF NOT EXISTS idx_book_metadata_source_updated
    ON book_metadata(source_updated_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_book_metadata_catalog_updated
    ON book_metadata(catalog_updated_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_book_metadata_expected_chapters
    ON book_metadata(expected_chapters DESC, id DESC);
