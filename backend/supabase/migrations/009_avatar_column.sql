-- Add avatar (profile picture) column to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Create public "avatars" storage bucket so users can store profile pictures.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Allow any authenticated user to upload a file to the avatars bucket.
CREATE POLICY "Anyone can upload avatars"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
  );

-- Allow users to update their own avatars.
CREATE POLICY "Users can update their own avatars"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND auth.uid() = owner
  );

-- Allow anyone to read (download) avatars since the bucket is public.
CREATE POLICY "Anyone can read avatars"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');
