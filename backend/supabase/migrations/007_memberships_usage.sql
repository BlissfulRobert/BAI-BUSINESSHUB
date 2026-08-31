-- ============================================
-- CAPACITY: bump to 16 Conference / 8 Meeting on live DBs
-- (003 already sets these for fresh setups; this keeps existing databases
-- that ran the earlier 10/4 version aligned with the current structure).
-- ============================================
UPDATE rooms
SET capacity = 16,
    description = replace(description, 'up to 10 people', 'up to 16 people')
WHERE slug = 'conference-room';

UPDATE rooms
SET capacity = 8
WHERE slug = 'meeting-room';

-- ============================================
-- MEMBERSHIPS (Section 7)
-- One optional membership per user: included hours per room class per month.
-- ============================================
CREATE TABLE IF NOT EXISTS memberships (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  included_conference_hours NUMERIC(5,2) NOT NULL DEFAULT 4.00,
  included_meeting_hours NUMERIC(5,2) NOT NULL DEFAULT 4.00,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- MEMBERSHIP USAGE (Sections 6 & 8 ledger)
-- One balance per membership + room class + calendar month. Usage is consumed
-- by on-demand (hourly/period) bookings; overages bill at standard rates.
-- ============================================
CREATE TABLE IF NOT EXISTS membership_usage (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  room_slug TEXT NOT NULL CHECK (room_slug IN ('conference-room', 'meeting-room')),
  used_minutes INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (membership_id, room_slug, period_start)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_membership_usage_membership ON membership_usage(membership_id, period_start);

-- ============================================
-- BOOKINGS: record coverage (Section 8)
-- charge_type = 'membership' (covered by included hours), 'additional'
-- (billed at standard rates), or NULL (not covered, e.g. weekly/monthly pass).
-- ============================================
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS charge_type TEXT CHECK (charge_type IN ('membership', 'additional', NULL));
CREATE INDEX IF NOT EXISTS idx_bookings_charge_type ON bookings(charge_type);

-- ============================================
-- RLS: MEMBERSHIPS
-- ============================================
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_usage ENABLE ROW LEVEL SECURITY;

-- Users can read their own membership.
CREATE POLICY "Users can view own membership"
  ON memberships FOR SELECT
  USING (auth.uid() = user_id);

-- Admins can read all memberships.
CREATE POLICY "Admins can view all memberships"
  ON memberships FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admins can manage memberships (grant/revoke/edit).
CREATE POLICY "Admins can manage memberships"
  ON memberships FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Users can read their own membership usage.
CREATE POLICY "Users can view own membership usage"
  ON membership_usage FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.id = membership_usage.membership_id
        AND memberships.user_id = auth.uid()
    )
  );

-- Admins can read all usage.
CREATE POLICY "Admins can view all membership usage"
  ON membership_usage FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admins can manage usage.
CREATE POLICY "Admins can manage membership usage"
  ON membership_usage FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- TRIGGERS
-- ============================================
CREATE TRIGGER update_memberships_updated_at
  BEFORE UPDATE ON memberships
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_membership_usage_updated_at
  BEFORE UPDATE ON membership_usage
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ATOMIC LEDGER INCREMENT (Section 8)
-- Called by the booking route (service-role) to add used minutes without
-- overwriting concurrent increments. SECURITY DEFINER so RLS is bypassed.
-- ============================================
CREATE OR REPLACE FUNCTION add_membership_usage(
  p_membership_id uuid,
  p_period_start date,
  p_period_end date,
  p_room_slug text,
  p_minutes integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO membership_usage (membership_id, period_start, period_end, room_slug, used_minutes)
  VALUES (p_membership_id, p_period_start, p_period_end, p_room_slug, p_minutes)
  ON CONFLICT (membership_id, room_slug, period_start)
  DO UPDATE SET used_minutes = membership_usage.used_minutes + EXCLUDED.used_minutes,
                updated_at = NOW();
END;
$$;
