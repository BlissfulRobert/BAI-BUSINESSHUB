-- ============================================
-- ADMIN NOTIFICATIONS
-- is_seen tracks whether an admin has viewed/acted on a new booking or report.
-- New rows default to false so a red notification dot shows on the admin
-- dashboard until the admin dismisses it (action on the item or "mark all seen").
-- Existing rows are back-filled as seen so pre-existing data doesn't nag.
-- Cancelled/finished items no longer count towards the badge (handled in the UI).
-- ============================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_seen BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE reports  ADD COLUMN IF NOT EXISTS is_seen BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bookings_is_seen ON bookings(is_seen);
CREATE INDEX IF NOT EXISTS idx_reports_is_seen  ON reports(is_seen);

-- Back-fill: treat existing rows as already seen by the admin.
UPDATE bookings SET is_seen = true;
UPDATE reports  SET is_seen = true;
