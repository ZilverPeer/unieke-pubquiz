-- Strictly nested 3-level Category hierarchy (Category -> Subcategory ->
-- Subsubcategory), each with exactly one parent. Names are per-Locale, in a
-- translations table per level keyed (parent_id, locale). See CONTEXT.md
-- "Content model" and docs/adr/0004-shared-item-identity-per-locale-translations.md.

create table categories (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);

create table category_translations (
  category_id bigint not null references categories (id) on delete cascade,
  locale locale not null,
  name text not null,
  primary key (category_id, locale)
);
-- primary key (category_id, locale) already provides an index with category_id
-- as the leading column, covering the foreign key.

create table subcategories (
  id bigint generated always as identity primary key,
  category_id bigint not null references categories (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index subcategories_category_id_idx on subcategories (category_id);

create table subcategory_translations (
  subcategory_id bigint not null references subcategories (id) on delete cascade,
  locale locale not null,
  name text not null,
  primary key (subcategory_id, locale)
);

create table subsubcategories (
  id bigint generated always as identity primary key,
  subcategory_id bigint not null references subcategories (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index subsubcategories_subcategory_id_idx on subsubcategories (subcategory_id);

create table subsubcategory_translations (
  subsubcategory_id bigint not null references subsubcategories (id) on delete cascade,
  locale locale not null,
  name text not null,
  primary key (subsubcategory_id, locale)
);
