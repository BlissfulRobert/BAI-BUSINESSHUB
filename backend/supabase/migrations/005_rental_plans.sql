-- Restructure rental plans to the Room Rental Rate Structure periods:
--   Hourly, Half-day, Full-day, Weekly, Monthly
-- Replaces the old fixed Daily/Weekly/Monthly passes. Upsert by slug so the
-- change applies to existing live data as well as fresh setups.

-- Deactivate the old daily plan (replaced by hourly/half-day/full-day).
UPDATE plans SET is_active = false WHERE slug = 'daily';

INSERT INTO plans (name, slug, description, duration_hours, duration_label, price, features, is_active, sort_order)
VALUES
  ('Hourly Pass', 'hourly', 'Rent the room by the hour. Choose a 30-minute or 1-hour block.', 1, '1 hour', 50.00, ARRAY['30-minute or 1-hour booking', 'Conference or Consultation Room', 'WiFi & AV Equipment', 'Coffee & Tea'], true, 1),
  ('Half-day Pass', 'half-day', 'A half-day rental of the room for longer meetings and sessions.', 4, 'Half-day', 200.00, ARRAY['Room access for up to 4 hours', 'Conference or Consultation Room', 'WiFi & AV Equipment', 'Coffee & Tea'], true, 2),
  ('Full-day Pass', 'full-day', 'Rent the room for the entire business day.', 8, 'Full-day', 350.00, ARRAY['Room access for the full business day', 'Conference or Consultation Room', 'WiFi & AV Equipment', 'Coffee & Tea', 'Kitchen Access'], true, 3),
  ('Weekly Pass', 'weekly', 'Repeated room access across the working week.', 40, 'Weekly', 180.00, ARRAY['5 weekdays (Mon-Fri)', 'Priority room booking', 'Conference or Consultation Room', 'WiFi & AV Equipment'], true, 4),
  ('Monthly Pass', 'monthly', 'Recurring room access for the month.', 176, 'Monthly', 550.00, ARRAY['Daily access for the month', 'Priority room booking', 'Conference or Consultation Room', 'WiFi & AV Equipment'], true, 5)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  duration_hours = EXCLUDED.duration_hours,
  duration_label = EXCLUDED.duration_label,
  price = EXCLUDED.price,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order;
