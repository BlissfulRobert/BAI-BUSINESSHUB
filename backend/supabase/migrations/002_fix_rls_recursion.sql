-- FIX: Infinite recursion in RLS role checks
-- The admin-check subqueries (SELECT 1 FROM profiles WHERE role='admin') cause
-- infinite recursion because evaluating the policy re-triggers the profiles
-- SELECT policy. Fix by using a SECURITY DEFINER function that bypasses RLS.

-- Helper: is the current user an admin? SECURITY DEFINER runs as the owner
-- with RLS bypassed, so it won't recurse.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Re-grant so authenticated/anon roles can call it
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- PROFILES policies (fix recursion)
-- ---------------------------------------------------------------------

-- Drop the recursive admin policy
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;

CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  USING (public.is_admin());

-- Everyone can read their own via existing policy (keep). Fine.

-- ---------------------------------------------------------------------
-- ROOMS policies (fix recursion)
-- ---------------------------------------------------------------------
ALTER TABLE rooms DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all rooms" ON rooms;
DROP POLICY IF EXISTS "Admins can insert rooms" ON rooms;
DROP POLICY IF EXISTS "Admins can update rooms" ON rooms;
DROP POLICY IF EXISTS "Admins can delete rooms" ON rooms;

CREATE POLICY "Admins can view all rooms"
  ON rooms FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can insert rooms"
  ON rooms FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update rooms"
  ON rooms FOR UPDATE
  USING (public.is_admin());

CREATE POLICY "Admins can delete rooms"
  ON rooms FOR DELETE
  USING (public.is_admin());

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- BOOKINGS policies (fix recursion)
-- ---------------------------------------------------------------------
ALTER TABLE bookings DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all bookings" ON bookings;
DROP POLICY IF EXISTS "Admins can update all bookings" ON bookings;

CREATE POLICY "Admins can view all bookings"
  ON bookings FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can update all bookings"
  ON bookings FOR UPDATE
  USING (public.is_admin());

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- PLANS policies (fix recursion)
-- ---------------------------------------------------------------------
ALTER TABLE plans DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage plans" ON plans;

CREATE POLICY "Admins can manage plans"
  ON plans FOR ALL
  USING (public.is_admin());

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- REPORTS policies (fix recursion)
-- ---------------------------------------------------------------------
ALTER TABLE reports DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all reports" ON reports;
DROP POLICY IF EXISTS "Admins can update all reports" ON reports;

CREATE POLICY "Admins can view all reports"
  ON reports FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can update all reports"
  ON reports FOR UPDATE
  USING (public.is_admin());

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- GALLERY policies (fix recursion)
-- ---------------------------------------------------------------------
ALTER TABLE gallery DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage gallery" ON gallery;

CREATE POLICY "Admins can manage gallery"
  ON gallery FOR ALL
  USING (public.is_admin());

ALTER TABLE gallery ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- OFFERS policies (fix recursion)
-- ---------------------------------------------------------------------
ALTER TABLE offers DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage offers" ON offers;

CREATE POLICY "Admins can manage offers"
  ON offers FOR ALL
  USING (public.is_admin());

ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
