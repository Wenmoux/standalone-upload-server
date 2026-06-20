CREATE TABLE IF NOT EXISTS bot_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    telegram_id TEXT NOT NULL DEFAULT '',
    telegram_username TEXT NOT NULL DEFAULT '',
    chat_id TEXT NOT NULL DEFAULT '',
    chat_type TEXT NOT NULL DEFAULT '',
    command TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'succeeded',
    error_code TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bot_audit_logs_created
    ON bot_audit_logs(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_bot_audit_logs_command_status
    ON bot_audit_logs(command, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_audit_logs_telegram
    ON bot_audit_logs(telegram_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_audit_logs_failed_reason
    ON bot_audit_logs(error_code, created_at DESC)
    WHERE status = 'failed';
