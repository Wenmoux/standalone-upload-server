DROP INDEX IF EXISTS idx_reader_export_usage_operation_key;
ALTER TABLE IF EXISTS reader_export_usage DROP COLUMN IF EXISTS operation_key;

DROP INDEX IF EXISTS idx_reader_transactions_operation_key;
ALTER TABLE IF EXISTS reader_transactions DROP COLUMN IF EXISTS operation_key;

DROP INDEX IF EXISTS idx_reader_operation_ledger_user_created;
DROP INDEX IF EXISTS idx_reader_operation_ledger_idempotency;
DROP TABLE IF EXISTS reader_operation_ledger;
