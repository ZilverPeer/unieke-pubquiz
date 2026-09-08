-- Spec 4 (#80): an Item that appears in any Composition is archived, never
-- deleted (the no-repeat rule needs its history). Archived Items are never
-- sampled: loadPool (src/repository/pool.ts) excludes rows with a non-null
-- archived_at. Null means live.
alter table items add column archived_at timestamptz;

-- The pool query reads only live Items; a partial index keeps that filter
-- cheap once archived rows pile up.
create index items_live_idx on items (id) where archived_at is null;
