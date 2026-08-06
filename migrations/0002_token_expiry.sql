-- Confirmation tokens used to be valid forever. A stale token sitting in an
-- old email should not still confirm a subscription years later, so new
-- tokens carry an expiry. Existing pending rows are left with a NULL expiry
-- (treated as "not yet expirable" by confirmSubscriber in db.ts) rather than
-- backfilled with a guessed value.
ALTER TABLE subscribers ADD COLUMN token_expires_at INTEGER;
