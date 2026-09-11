-- The Stripe checkout path (and the orders table it populated) is retired —
-- Shopify's headless checkout replaces it, Shopify admin is now the order
-- record, and this table was empty in production (commerce was never
-- enabled). 0003_orders.sql is left in place rather than removed: production
-- D1 already has it recorded as applied, and rewriting migration history
-- would desync that ledger from the deployed database.
DROP INDEX IF EXISTS idx_orders_status;
DROP INDEX IF EXISTS idx_orders_email;
DROP TABLE IF EXISTS orders;
