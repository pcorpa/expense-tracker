-- Update profiles table to use first_name and last_name instead of full_name
ALTER TABLE profiles DROP COLUMN IF EXISTS full_name;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_name text;
