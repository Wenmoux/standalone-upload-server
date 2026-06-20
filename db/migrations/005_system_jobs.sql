CREATE TABLE IF NOT EXISTS system_jobs (
    id BIGSERIAL PRIMARY KEY,
    type TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    error TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    locked_by TEXT NOT NULL DEFAULT '',
    locked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT system_jobs_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
    CONSTRAINT system_jobs_progress_check CHECK (progress >= 0 AND progress <= 100)
);

CREATE INDEX IF NOT EXISTS idx_system_jobs_status_created
    ON system_jobs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_jobs_type_created
    ON system_jobs(type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_jobs_created
    ON system_jobs(created_at DESC);
