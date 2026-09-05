-- Storage buckets for Picture and Music Item files. Private (no public URLs);
-- the engine reads them with the service role. Created here (not only in
-- config.toml) so `supabase db push` against a hosted project also gets them --
-- config.toml's [storage.buckets] section only seeds the local dev stack.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('pictures', 'pictures', false, 5242880, array['image/png', 'image/jpeg']),
  ('music-clips', 'music-clips', false, 10485760, array['audio/mpeg'])
on conflict (id) do nothing;
