CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_pg_book_metadata_book_id_trgm
    ON book_metadata USING GIN (book_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_pg_book_metadata_title_trgm
    ON book_metadata USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_pg_book_metadata_author_trgm
    ON book_metadata USING GIN (author gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_pg_book_metadata_tags_trgm
    ON book_metadata USING GIN (tags gin_trgm_ops);
