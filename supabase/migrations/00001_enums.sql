-- Enums shared across the content model.
-- See CONTEXT.md "Content model" and docs/adr/0004-shared-item-identity-per-locale-translations.md.

create type locale as enum ('nl', 'en');

create type item_kind as enum ('text', 'picture', 'music');

-- Fixed Difficulty of an individual Item (exactly one, never "mixed").
create type difficulty as enum ('easy', 'medium', 'hard');

create type quiz_mode as enum ('mixed', 'single_category');

-- Customer-facing requested Difficulty on a Quiz. Distinct from `difficulty`
-- because a Quiz may request "mixed" (4/3/3 across the three levels per Round),
-- which is never a valid Difficulty on an individual Item.
create type requested_difficulty as enum ('easy', 'medium', 'hard', 'mixed');
