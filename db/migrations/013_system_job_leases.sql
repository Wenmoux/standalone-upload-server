ALTER TABLE system_jobs
    ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'system_jobs_attempt_check') THEN
        ALTER TABLE system_jobs ADD CONSTRAINT system_jobs_attempt_check CHECK (attempt >= 0 AND max_attempts >= 1);
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_system_jobs_claim
    ON system_jobs(status, next_run_at, priority DESC, created_at, id)
    WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_system_jobs_lease
    ON system_jobs(lease_expires_at)
    WHERE status = 'running';

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_jobs_idempotency
    ON system_jobs(idempotency_key)
    WHERE idempotency_key <> '' AND status IN ('queued', 'running');
