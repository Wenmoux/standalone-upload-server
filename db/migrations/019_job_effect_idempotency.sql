CREATE TABLE IF NOT EXISTS reader_operation_ledger (
    id BIGSERIAL PRIMARY KEY,
    idempotency_key TEXT NOT NULL,
    operation_scope TEXT NOT NULL DEFAULT '',
    operation_type TEXT NOT NULL DEFAULT '',
    user_id BIGINT REFERENCES reader_users(id) ON DELETE SET NULL,
    telegram_id TEXT NOT NULL DEFAULT '',
    result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT reader_operation_ledger_key_nonempty CHECK (idempotency_key <> ''),
    CONSTRAINT reader_operation_ledger_key_length CHECK (char_length(idempotency_key) <= 240),
    CONSTRAINT reader_operation_ledger_scope_length CHECK (char_length(operation_scope) BETWEEN 1 AND 120),
    CONSTRAINT reader_operation_ledger_type_length CHECK (char_length(operation_type) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reader_operation_ledger_idempotency
    ON reader_operation_ledger(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_reader_operation_ledger_user_created
    ON reader_operation_ledger(user_id, created_at DESC);

ALTER TABLE reader_transactions
    ADD COLUMN IF NOT EXISTS operation_key TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_reader_transactions_operation_key
    ON reader_transactions(operation_key)
    WHERE operation_key <> '';

ALTER TABLE reader_export_usage
    ADD COLUMN IF NOT EXISTS operation_key TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_reader_export_usage_operation_key
    ON reader_export_usage(operation_key)
    WHERE operation_key <> '';
