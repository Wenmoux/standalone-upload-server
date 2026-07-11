CREATE TABLE IF NOT EXISTS reader_performance_events (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES reader_users(id) ON DELETE SET NULL,
    session_id TEXT DEFAULT '',
    route TEXT DEFAULT '',
    metric TEXT NOT NULL,
    value NUMERIC NOT NULL DEFAULT 0,
    rating TEXT DEFAULT '',
    navigation_type TEXT DEFAULT '',
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reader_performance_metric_time
    ON reader_performance_events(metric, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reader_performance_route_time
    ON reader_performance_events(route, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reader_performance_session
    ON reader_performance_events(session_id, created_at DESC);
