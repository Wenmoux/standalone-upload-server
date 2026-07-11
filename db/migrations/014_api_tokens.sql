CREATE TABLE IF NOT EXISTS api_tokens (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'bot',
    token_hash TEXT NOT NULL UNIQUE,
    token_prefix TEXT NOT NULL DEFAULT '',
    scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    allowed_ips_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    revoked_at TIMESTAMP,
    last_used_at TIMESTAMP,
    last_used_ip TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_kind_active
    ON api_tokens(kind, revoked_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_tokens_last_used
    ON api_tokens(last_used_at DESC NULLS LAST);
