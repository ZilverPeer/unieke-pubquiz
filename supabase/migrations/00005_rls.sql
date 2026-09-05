-- Row Level Security on every table, no policies. anon and authenticated get
-- zero access (RLS enabled + no policy = deny-all for any role subject to
-- RLS). service_role has BYPASSRLS in Supabase's local and hosted stacks, so
-- the generation engine (which always connects as service_role) is unaffected.
-- Verify with: select relname, relrowsecurity from pg_class
--   where relnamespace = 'public'::regnamespace and relkind = 'r';

alter table categories enable row level security;
alter table category_translations enable row level security;
alter table subcategories enable row level security;
alter table subcategory_translations enable row level security;
alter table subsubcategories enable row level security;
alter table subsubcategory_translations enable row level security;
alter table items enable row level security;
alter table item_translations enable row level security;
alter table picture_item_details enable row level security;
alter table music_item_details enable row level security;
alter table compositions enable row level security;
alter table composition_items enable row level security;
