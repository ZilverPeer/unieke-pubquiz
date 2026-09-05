-- items.updated_at was set on insert (default now()) but never maintained on
-- update. Use the moddatetime extension (ships with Postgres contrib and is
-- available in the Supabase local/hosted image) to keep it current.

create extension if not exists moddatetime with schema extensions;

create trigger items_set_updated_at
  before update on items
  for each row
  execute function extensions.moddatetime(updated_at);
