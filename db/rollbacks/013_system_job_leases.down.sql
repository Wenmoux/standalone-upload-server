DROP INDEX IF EXISTS idx_system_jobs_idempotency;
DROP INDEX IF EXISTS idx_system_jobs_lease;
DROP INDEX IF EXISTS idx_system_jobs_claim;

ALTER TABLE system_jobs DROP CONSTRAINT IF EXISTS system_jobs_attempt_check;
ALTER TABLE system_jobs
    DROP COLUMN IF EXISTS cancel_requested_at,
    DROP COLUMN IF EXISTS heartbeat_at,
    DROP COLUMN IF EXISTS lease_expires_at,
    DROP COLUMN IF EXISTS next_run_at,
    DROP COLUMN IF EXISTS idempotency_key,
    DROP COLUMN IF EXISTS attempt,
    DROP COLUMN IF EXISTS max_attempts,
    DROP COLUMN IF EXISTS priority;
