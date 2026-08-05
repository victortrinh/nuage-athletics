-- Subscribers + CASL consent record.
--
-- CASL (Canada's Anti-Spam Legislation) requires express consent and puts the
-- burden of proof on the sender. The columns below exist so that, if challenged,
-- we can show exactly what wording was displayed, when, and from where.
-- Do not drop consent_text / consent_version to "clean up" the schema.

CREATE TABLE IF NOT EXISTS subscribers (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE,
  locale           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',   -- pending | confirmed | unsubscribed
  token            TEXT NOT NULL,                     -- confirm + unsubscribe token
  consent_text     TEXT NOT NULL,                     -- verbatim wording shown at signup
  consent_version  TEXT NOT NULL,
  consented_at     INTEGER NOT NULL,
  confirmed_at     INTEGER,
  unsubscribed_at  INTEGER,
  ip               TEXT,
  user_agent       TEXT,
  source           TEXT,
  created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers (status);
CREATE INDEX IF NOT EXISTS idx_subscribers_token  ON subscribers (token);

-- Coarse IP rate limiting for the signup endpoint.
CREATE TABLE IF NOT EXISTS signup_attempts (
  ip          TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signup_attempts ON signup_attempts (ip, attempted_at);
