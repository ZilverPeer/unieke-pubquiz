-- Items: one shared identity across Locales (uuid, per ticket #3 spec and
-- ADR-0004), language-dependent text in item_translations, and type-specific
-- payload in 1:1 detail tables. Text Items have no detail table -- all their
-- payload lives in item_translations.

create table items (
  id uuid primary key default gen_random_uuid(),
  kind item_kind not null,
  subsubcategory_id bigint not null references subsubcategories (id),
  difficulty difficulty not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index items_subsubcategory_id_idx on items (subsubcategory_id);
create index items_kind_difficulty_idx on items (kind, difficulty);

-- An Item is only sampleable for a Locale if a row exists here for that
-- Locale (docs/adr/0004). question/answer/fact are nullable because their
-- applicability differs per kind:
--   text    -> question + answer required, fact optional
--   picture -> question null (the image is the prompt), answer required, fact optional
--   music   -> question and answer null (artist/title in music_item_details serve
--              that role), fact optional
-- Nothing in this schema enforces that shape per kind; it is a seeding/
-- application convention, not a DB constraint, to keep the table uniform
-- across kinds per CONTEXT.md "DRY across Item kinds".
create table item_translations (
  item_id uuid not null references items (id) on delete cascade,
  locale locale not null,
  question text,
  answer text,
  fact text,
  primary key (item_id, locale)
);

create table picture_item_details (
  item_id uuid primary key references items (id) on delete cascade,
  storage_path text not null
);

create table music_item_details (
  item_id uuid primary key references items (id) on delete cascade,
  storage_path text not null,
  artist text not null,
  title text not null
);
