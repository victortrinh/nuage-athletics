-- Failed password-gate attempts, counted per IP.
--
-- Deliberately not reusing signup_attempts: sharing a bucket would let someone
-- hammering the gate exhaust a real visitor's ability to subscribe, and a
-- subscriber's retries would loosen the brute-force limit on the password.
CREATE TABLE IF NOT EXISTS gate_attempts (
  ip           TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gate_attempts ON gate_attempts (ip, attempted_at);
