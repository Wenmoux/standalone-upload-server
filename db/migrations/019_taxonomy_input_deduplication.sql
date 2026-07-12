WITH taxonomy_tokens AS (
    SELECT
        m.id metadata_id,
        'category'::text kind,
        btrim(parts.token) value,
        lower(btrim(parts.token)) normalized_value,
        parts.ordinality source_order
    FROM book_metadata m
    CROSS JOIN LATERAL regexp_split_to_table(
        COALESCE(m.category, ''),
        '[,，、/|·]+'
    ) WITH ORDINALITY parts(token, ordinality)
    WHERE btrim(parts.token) <> ''

    UNION ALL

    SELECT
        m.id metadata_id,
        'tag'::text kind,
        btrim(parts.token) value,
        lower(btrim(parts.token)) normalized_value,
        parts.ordinality source_order
    FROM book_metadata m
    CROSS JOIN LATERAL regexp_split_to_table(
        COALESCE(m.tags, ''),
        '[,，、|/\s:：;；#＃·•・]+'
    ) WITH ORDINALITY parts(token, ordinality)
    WHERE btrim(parts.token) <> ''
), unique_tokens AS (
    SELECT
        metadata_id,
        kind,
        normalized_value,
        (array_agg(value ORDER BY source_order))[1] value,
        min(source_order) source_order,
        count(*) occurrences
    FROM taxonomy_tokens
    GROUP BY metadata_id, kind, normalized_value
), rebuilt AS (
    SELECT
        metadata_id,
        kind,
        string_agg(value, ', ' ORDER BY source_order) cleaned_value,
        bool_or(occurrences > 1) has_duplicates
    FROM unique_tokens
    GROUP BY metadata_id, kind
)
UPDATE book_metadata metadata
SET
    category = COALESCE((
        SELECT cleaned_value
        FROM rebuilt
        WHERE metadata_id = metadata.id
          AND kind = 'category'
          AND has_duplicates
    ), metadata.category),
    tags = COALESCE((
        SELECT cleaned_value
        FROM rebuilt
        WHERE metadata_id = metadata.id
          AND kind = 'tag'
          AND has_duplicates
    ), metadata.tags)
WHERE EXISTS (
    SELECT 1
    FROM rebuilt
    WHERE metadata_id = metadata.id
      AND has_duplicates
);
