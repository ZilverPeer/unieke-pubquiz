-- Orders and Quizzes: the persistence for the order-to-delivery pipeline
-- (spec #36, ticket #38). See CONTEXT.md "Order" / "Quiz" and
-- src/domain/orders.ts (pinned shapes; this migration mirrors them).

create type quiz_status as enum ('pending', 'generating', 'delivered', 'failed');

-- One WooCommerce order as recorded by the webhook. billing_email is stored
-- trimmed and lower-cased by the repository (mirrors compositions'
-- normalizeBillingEmail, see CONTEXT.md "No-repeat rule") rather than
-- enforced here, matching the compositions table's existing convention.
-- status is WooCommerce's free-form order status string (e.g. "processing",
-- "completed"), not an enum -- WooCommerce and its extensions can add
-- statuses we don't control.
create table orders (
  id uuid primary key default gen_random_uuid(),
  woo_order_id bigint not null,
  billing_email text not null,
  status text not null,
  raw_payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (woo_order_id)
);

-- Support lookups by billing email (CONTEXT.md "Scope": "Composition /
-- delivery history per billing email is read-only, for support lookups").
create index orders_billing_email_idx on orders (billing_email);
create index orders_status_idx on orders (status);

-- One Quiz to generate: a line item unit (quantity n yields n Quiz rows,
-- sequence 0..n-1). composition_id is set once generation succeeds;
-- download_token and delivered_at are set together on delivery.
-- No `on delete cascade`/`on delete set null` clauses: deleting an order
-- while Quizzes reference it, or a Composition while a Quiz references it,
-- is blocked (Postgres default `on delete no action` behaves as restrict).
create table quizzes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id),
  woo_line_item_id bigint not null,
  sequence smallint not null,
  locale locale not null,
  quiz_mode quiz_mode not null,
  requested_difficulty requested_difficulty not null,
  -- Category id per slot (index 0-7), string or null where unassigned --
  -- see CategoryPick in src/domain/types.ts. Always exactly 8 entries.
  category_picks jsonb not null,
  status quiz_status not null default 'pending',
  failure_reason text,
  composition_id uuid references compositions (id),
  download_token text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, woo_line_item_id, sequence),
  unique (download_token)
);

create index quizzes_order_id_idx on quizzes (order_id);
create index quizzes_status_idx on quizzes (status);
create index quizzes_delivered_at_idx on quizzes (delivered_at);

create trigger orders_set_updated_at
  before update on orders
  for each row
  execute function extensions.moddatetime(updated_at);

create trigger quizzes_set_updated_at
  before update on quizzes
  for each row
  execute function extensions.moddatetime(updated_at);

alter table orders enable row level security;
alter table quizzes enable row level security;

-- Deliverables: the four files per Quiz (see DELIVERABLE_FILES in
-- src/domain/orders.ts), uploaded to `<quiz id>/<file name>`. Private, like
-- the pictures/music-clips buckets -- the download route streams through the
-- app after checking the token (spec #36), never a public Storage URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('deliverables', 'deliverables', false, 20971520, array['application/pdf', 'audio/mpeg'])
on conflict (id) do nothing;
