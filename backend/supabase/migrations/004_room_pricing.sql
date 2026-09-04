-- Set per-room base hourly rates (USD) per the Room Rental Rate Structure:
--   Conference Room     -> $50/hour
--   Consultation Room   -> $30/hour
-- These are idempotent UPDATEs so they apply to existing live data and fresh
-- setups (where the seed still inserts the values first).

UPDATE rooms
SET price_per_hour = 50.00
WHERE slug = 'conference-room';

UPDATE rooms
SET price_per_hour = 30.00
WHERE slug = 'meeting-room';
