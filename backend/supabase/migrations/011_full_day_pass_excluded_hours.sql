-- ============================================
-- 011: FULL-DAY PASS EXCLUDED HOURS
-- ============================================
-- Allows a full-day pass to go ahead even when another guest has already
-- booked a portion of the business day. The conflicting hour(s) are recorded
-- on the booking row so the pass-holder can be shown which hours are NOT part
-- of their day ("minus the hour").
--
-- excluded_ranges is a JSONB array of {"start_time", "end_time"} objects
-- (24h 'HH:MM:SS'), defaulting to an empty array for all other bookings.
-- ============================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS excluded_ranges JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ============================================
-- BLOCKING-BOOKINGS LOOKUP (client availability)
-- ============================================
-- The booking modal's calendar and the full-day exclusion banner need to see
-- every booking that holds a slot in a room, but the standard RLS policy
-- ("Users can view own bookings") hides other guests' bookings from the
-- client. SECURITY DEFINER bypasses RLS so an authenticated caller can read
-- the room's blocking (pending/paid/completed) bookings while the caller's
-- own bookings are filtered out -- your own holds must never count as
-- "hours someone else took away" from your full-day pass.
-- ============================================

CREATE OR REPLACE FUNCTION public.get_room_blocking_bookings(
  p_room_id uuid,
  p_from_date date
)
RETURNS TABLE (
  id uuid,
  room_id uuid,
  user_id uuid,
  plan_id uuid,
  date date,
  start_time time,
  end_time time,
  status text,
  excluded_ranges jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.room_id, b.user_id, b.plan_id, b.date, b.start_time, b.end_time, b.status, b.excluded_ranges
  FROM bookings b
  WHERE b.room_id = p_room_id
    AND b.date >= p_from_date
    AND b.status IN ('pending', 'paid', 'completed')
    AND b.user_id <> auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_room_blocking_bookings(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_room_blocking_bookings(uuid, date) TO authenticated;