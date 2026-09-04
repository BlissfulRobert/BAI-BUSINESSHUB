-- ============================================
-- 010: CONSULTATION ROOM + BOOKING STATUS CHANGES
-- ============================================
-- 1) Rename the "Meeting Room" to "Consultation Room" (name, slug, description,
--    gallery text, and plan features).
-- 2) Rename the memberships column included_meeting_hours ->
--    included_consultation_hours.
-- 3) Update membership_usage.room_slug CHECK to allow 'consultation-room'.
-- 4) Remove the 'approved' booking lifecycle: migrate 'approved' rows -> 'paid'
--    and drop 'approved' from the bookings.status CHECK.
--    Also add 'expired' to the CHECK so the auto-expire path (which writes
--    status='expired') actually persists.
--
-- All statements are idempotent / defensive so they apply to both fresh and
-- existing live databases.
-- ============================================

-- ============================================
-- 1a) ROOMS: rename Meeting Room -> Consultation Room
-- ============================================
UPDATE rooms
SET name = 'Consultation Room',
    slug = 'consultation-room',
    description = 'A professional consultation room designed for focused discussions, client meetings, interviews, and small team collaborations. Features modern decor and essential meeting amenities.'
WHERE slug = 'meeting-room';

-- ============================================
-- 1b) GALLERY: update the room's gallery text
-- ============================================
UPDATE gallery
SET title = 'Consultation Room Interior',
    description = 'Modern consultation room with comfortable seating for 8'
WHERE title = 'Meeting Room Interior';

-- ============================================
-- 1c) PLANS: swap the shared feature label
-- ============================================
UPDATE plans
SET features = array_replace(features, 'Conference or Meeting Room', 'Conference or Consultation Room')
WHERE 'Conference or Meeting Room' = ANY (features);

-- ============================================
-- 2) MEMBERSHIPS: rename included_meeting_hours -> included_consultation_hours
--    Guarded so fresh databases (where this column is seeded differently) don't
--    fail. Uses information_schema to check the column exists.
-- ============================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'memberships'
      AND column_name = 'included_meeting_hours'
  ) THEN
    ALTER TABLE memberships RENAME COLUMN included_meeting_hours TO included_consultation_hours;
  END IF;
END $$;

-- ============================================
-- 3) MEMBERSHIP USAGE: allow 'consultation-room' slug
--    Migrate existing rows then swap the CHECK constraint.
-- ============================================
-- The CHECK constraint is unnamed in 007 (inline), so find it by name pattern
-- and drop it via dynamic SQL.
DO $$
DECLARE
  cn text;
BEGIN
  SELECT conname INTO cn
    FROM pg_constraint
    WHERE conname LIKE 'membership_usage%'
      AND contype = 'c'
    LIMIT 1;
  IF cn IS NOT NULL THEN
    EXECUTE format('ALTER TABLE membership_usage DROP CONSTRAINT %I', cn);
  END IF;
END $$;

-- Migrate existing usage rows to the new slug before re-applying a constraint.
UPDATE membership_usage
SET room_slug = 'consultation-room'
WHERE room_slug = 'meeting-room';

-- Re-add the constraint with both valid slugs.
ALTER TABLE membership_usage
  ADD CONSTRAINT membership_usage_room_slug_check
  CHECK (room_slug IN ('conference-room', 'consultation-room'));

-- ============================================
-- 4) BOOKINGS STATUS: remove 'approved', add 'expired'
--    Migrate approved rows -> paid, then replace the CHECK constraint.
-- ============================================
-- Approving is now done by marking the booking as paid, so any rows still in
-- the old 'approved' state become 'paid'.
UPDATE bookings
SET status = 'paid'
WHERE status = 'approved';

-- Drop the existing inline status CHECK constraint (created in 001).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_status_check'
      AND contype = 'c'
  ) THEN
    ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
  END IF;
END $$;

-- Re-add without 'approved' and including 'expired' (auto-expiry writes this).
ALTER TABLE bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'paid', 'completed', 'cancelled', 'expired'));

-- ============================================
-- 5) RACE-FREE BOOKING SLOTS (b-tree GIST exclusion)
--    Airtight protection against the check-then-insert race in
--    api/bookings/+server.ts: two overlapping bookings for the same room and
--    date cannot BOTH be in a blocking state (pending/paid/completed). This
--    makes the DB itself reject the second overlapping insert instead of
--    relying on the (best-effort) server-side overlap query.
-- ============================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_no_overlap_blocking'
  ) THEN
    -- The EXCLUDE is made partial (WHERE ...) so only blocking statuses are
    -- mutually exclusive; cancelled/expired rows never hold a slot and may
    -- overlap freely (e.g. a replacement booking on a released slot).
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_no_overlap_blocking
      EXCLUDE USING gist (
        room_id WITH =,
        date WITH =,
        tsrange(date::timestamp + start_time, date::timestamp + end_time) WITH &&
      )
      WHERE (status IN ('pending', 'paid', 'completed'));
  END IF;
END $$;
