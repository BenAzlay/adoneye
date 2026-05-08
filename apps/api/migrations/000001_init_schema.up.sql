-- gen_random_uuid() is available in PostgreSQL 13+ without extensions.
-- Neon runs PG 16+, so no pgcrypto needed.

CREATE TABLE users (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email               TEXT        NOT NULL UNIQUE,
    -- Nullable: populated when user completes checkout and a Stripe customer is created.
    stripe_customer_id  TEXT        UNIQUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE subscriptions (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_subscription_id   TEXT        NOT NULL UNIQUE,
    stripe_customer_id       TEXT        NOT NULL,
    stripe_price_id          TEXT        NOT NULL,
    -- Mirrors Stripe subscription status: active, past_due, canceled, etc.
    status                   TEXT        NOT NULL,
    current_period_start     TIMESTAMPTZ,
    current_period_end       TIMESTAMPTZ,
    cancel_at_period_end     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency log: prevents processing the same Stripe webhook event twice.
CREATE TABLE stripe_events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    stripe_event_id TEXT        NOT NULL UNIQUE,
    event_type      TEXT        NOT NULL,
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wallets (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Raw address is stored because portfolio analysis requires on-chain API lookups
    -- that accept the full address. It must never appear in logs or analytics.
    address         TEXT NOT NULL,
    -- SHA-256 of lowercased address. Used for unique enforcement and indexed lookups
    -- so the raw address is not exposed in index storage or query logs.
    address_hash    TEXT NOT NULL UNIQUE,
    -- First 6 + last 4 chars (e.g. 0x1234...abcd). Safe to display in UI and logs.
    address_redacted TEXT NOT NULL,
    chain_scope                 TEXT        NOT NULL DEFAULT 'evm',
    weekly_analysis_enabled     BOOLEAN     NOT NULL DEFAULT FALSE,
    next_run_at                 TIMESTAMPTZ,
    last_run_at                 TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE analysis_jobs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id       UUID        NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    -- e.g. 'weekly_analysis'
    job_type        TEXT        NOT NULL,
    -- e.g. 'pending', 'running', 'completed', 'failed'
    status          TEXT        NOT NULL,
    scheduled_for   TIMESTAMPTZ NOT NULL,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE portfolio_analyses (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id        UUID        NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    -- Nullable: may be generated outside a scheduled job (e.g. on-demand).
    analysis_job_id  UUID        REFERENCES analysis_jobs(id) ON DELETE SET NULL,
    -- Lookback window used for this analysis, e.g. 7, 30, 90.
    period_days      INTEGER     NOT NULL,
    -- e.g. 'pending', 'completed', 'failed'
    status           TEXT        NOT NULL,
    -- Precomputed results passed to the LLM for explanation. Never raw provider data.
    result_json      JSONB,
    error_message    TEXT,
    generated_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_subscriptions_user_id        ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status         ON subscriptions(status);
CREATE INDEX idx_wallets_user_id              ON wallets(user_id);
-- address_hash already has a UNIQUE constraint which creates an implicit index;
-- named explicitly here for clarity in query plans.
CREATE INDEX idx_wallets_address_hash         ON wallets(address_hash);
CREATE INDEX idx_analysis_jobs_wallet_id      ON analysis_jobs(wallet_id);
CREATE INDEX idx_analysis_jobs_status         ON analysis_jobs(status);
CREATE INDEX idx_analysis_jobs_scheduled_for  ON analysis_jobs(scheduled_for);
CREATE INDEX idx_portfolio_analyses_wallet_id      ON portfolio_analyses(wallet_id);
CREATE INDEX idx_portfolio_analyses_generated_at   ON portfolio_analyses(generated_at DESC);
