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
