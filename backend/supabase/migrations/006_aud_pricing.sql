-- Align pricing to AUD per the Room Rental Rate Structure (figures mirrored
-- as AUD values). Update live data idempotently; fresh setups apply the seed
-- values first, so these are safe either way.
--
--   Conference Room: hourly 50, half-day 200, full-day 350, weekly 1600, monthly 6400
--   Meeting Room:    hourly 30, half-day 120, full-day 200, weekly 960, monthly 3840
--
-- Note: Weekly/Monthly authoritative per-room prices live in the frontend
-- pricing engine (lib/utils/pricing.ts RATE_CARDS). The plans.price values
-- below are representative/display values.

UPDATE rooms
SET price_per_hour = 50.00
WHERE slug = 'conference-room';

UPDATE rooms
SET price_per_hour = 30.00
WHERE slug = 'meeting-room';

UPDATE plans SET price = 50.00    WHERE slug = 'hourly';
UPDATE plans SET price = 200.00   WHERE slug = 'half-day';
UPDATE plans SET price = 350.00   WHERE slug = 'full-day';
UPDATE plans SET price = 1600.00  WHERE slug = 'weekly';
UPDATE plans SET price = 6400.00  WHERE slug = 'monthly';
