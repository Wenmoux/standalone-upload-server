CREATE OR REPLACE FUNCTION sync_book_taxonomy()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM book_taxonomy WHERE metadata_id = NEW.id;

    INSERT INTO book_taxonomy(metadata_id, kind, value, normalized_value)
    SELECT NEW.id, deduplicated.kind, deduplicated.value, deduplicated.normalized_value
    FROM (
        SELECT
            source.kind,
            source.normalized_value,
            (array_agg(source.value ORDER BY source.source_order))[1] value
        FROM (
            SELECT
                'category'::text kind,
                btrim(parts.token) value,
                lower(btrim(parts.token)) normalized_value,
                parts.ordinality source_order
            FROM regexp_split_to_table(
                COALESCE(NEW.category, ''),
                '[,，、/|·]+'
            ) WITH ORDINALITY parts(token, ordinality)

            UNION ALL

            SELECT
                'tag'::text kind,
                btrim(parts.token) value,
                lower(btrim(parts.token)) normalized_value,
                parts.ordinality source_order
            FROM regexp_split_to_table(
                COALESCE(NEW.tags, ''),
                '[,，、|/\s:：;；#＃·•・]+'
            ) WITH ORDINALITY parts(token, ordinality)
        ) source
        WHERE source.value <> ''
        GROUP BY source.kind, source.normalized_value
    ) deduplicated;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
