-- Compositions: the exact list of Item ids per Round slot for a generated
-- Quiz, stored permanently. See CONTEXT.md "Composition" and "No-repeat rule".

create table compositions (
  id uuid primary key default gen_random_uuid(),
  billing_email text not null,
  locale locale not null,
  quiz_mode quiz_mode not null,
  requested_difficulty requested_difficulty not null,
  seed bigint not null,
  created_at timestamptz not null default now()
);

-- No-repeat rule looks up every past Composition for a billing email.
create index compositions_billing_email_idx on compositions (billing_email);

-- slot_index: which of the 8 Round slots (0-7) this Item belongs to.
-- position: the Item's position within that Round (0-9, 10 Items per Round).
create table composition_items (
  id bigint generated always as identity primary key,
  composition_id uuid not null references compositions (id) on delete cascade,
  slot_index smallint not null,
  position smallint not null,
  item_id uuid not null references items (id),
  unique (composition_id, slot_index, position)
);

-- The unique constraint above indexes composition_id as its leading column;
-- item_id needs its own index (no-repeat exclusion set is looked up by item_id
-- and is also this table's other foreign key).
create index composition_items_item_id_idx on composition_items (item_id);
