-- Orders, populated from Stripe checkout.session.completed webhook events.
--
-- Keyed by the Stripe Checkout Session id so a retried webhook delivery
-- (Stripe resends on any non-2xx response) upserts the same row instead of
-- creating a duplicate. raw_event keeps the full event JSON for auditing —
-- amounts/status here are for querying, raw_event is the source of truth if
-- they're ever in question.
CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,   -- Stripe Checkout Session id
  status         TEXT NOT NULL,      -- pending | paid | fulfilled | cancelled | refunded
  email          TEXT,
  locale         TEXT NOT NULL,
  amount_total   INTEGER NOT NULL,   -- minor units
  currency       TEXT NOT NULL,
  raw_event      TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_email ON orders (email);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
