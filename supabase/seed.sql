-- Bilingual placeholder seed content.
--
-- Shape (see supabase/README.md "Pool coverage" for the full reasoning):
--   8 Categories, each with 2 Subcategories, each with 5 Subsubcategories
--   => 10 Subsubcategories per Category.
--   Each Subsubcategory gets exactly one Item per (kind, difficulty)
--   combination: 3 kinds x 3 difficulties = 9 Items per Subsubcategory.
--   8 x 10 x 9 = 720 Items total.
--
-- Why this satisfies the ticket's pool-coverage requirement:
--   - Per Category, per kind, there are exactly 10 Subsubcategories with an
--     Item of any given Difficulty -- the minimum for a Round of 10 Items to
--     never need two Items from the same Subsubcategory, with no slack.
--   - Per Locale, per Difficulty: 8 Categories x 10 Subsubcategories = 80
--     Items of each kind (text/picture/music), comfortably over the "at
--     least 60 text + 10 picture + 10 music" floor, and spread across all 8
--     Categories (not concentrated in one), so a full mixed-mode Quiz (up to
--     8 distinct Categories, one Round each) and a single-category Quiz (one
--     Category supplying 6 Text Rounds = 60 Text Items, reusing
--     Subsubcategories across Rounds since the no-duplicate rule is only
--     within a Round) are both fillable at every Difficulty, in both
--     Locales.
--
-- Text is deterministic placeholder content, not real quiz material:
-- "Vraag <n> over <Category>" / "Question <n> about <Category>".
--
-- Locale-exception handful (documented, for ticket #6 to prove Locale
-- filtering): 3 Items get an nl-only translation and 3 get an en-only
-- translation, one pair per kind, identified below by their seed sequence
-- number. Every other Item gets both.

begin;

-- 1. Categories -------------------------------------------------------------

insert into categories (id) overriding system value
select generate_series(1, 8);

insert into category_translations (category_id, locale, name)
values
  (1, 'nl', 'Sport'),           (1, 'en', 'Sports'),
  (2, 'nl', 'Geschiedenis'),    (2, 'en', 'History'),
  (3, 'nl', 'Muziek'),          (3, 'en', 'Music'),
  (4, 'nl', 'Aardrijkskunde'),  (4, 'en', 'Geography'),
  (5, 'nl', 'Wetenschap'),      (5, 'en', 'Science'),
  (6, 'nl', 'Film en TV'),      (6, 'en', 'Film and TV'),
  (7, 'nl', 'Literatuur'),      (7, 'en', 'Literature'),
  (8, 'nl', 'Algemene Kennis'), (8, 'en', 'General Knowledge');

-- 2. Subcategories: 2 per Category (ids 1..16) -------------------------------

insert into subcategories (id, category_id) overriding system value
select s.id, ((s.id - 1) / 2) + 1
from generate_series(1, 16) as s(id);

insert into subcategory_translations (subcategory_id, locale, name)
select
  sc.id,
  loc,
  case loc
    when 'nl' then cnl.name || ' - Subcategorie ' || (((sc.id - 1) % 2) + 1)
    else cen.name || ' - Subcategory ' || (((sc.id - 1) % 2) + 1)
  end
from subcategories sc
join category_translations cnl on cnl.category_id = sc.category_id and cnl.locale = 'nl'
join category_translations cen on cen.category_id = sc.category_id and cen.locale = 'en'
cross join unnest(array['nl', 'en']::locale[]) as loc;

-- 3. Subsubcategories: 5 per Subcategory (ids 1..80) => 10 per Category -----

insert into subsubcategories (id, subcategory_id) overriding system value
select s.id, ((s.id - 1) / 5) + 1
from generate_series(1, 80) as s(id);

insert into subsubcategory_translations (subsubcategory_id, locale, name)
select
  ss.id,
  loc,
  case loc
    when 'nl' then cnl.name || ' - Onderwerp ' || (((ss.id - 1) % 5) + 1)
    else cen.name || ' - Topic ' || (((ss.id - 1) % 5) + 1)
  end
from subsubcategories ss
join subcategories sc on sc.id = ss.subcategory_id
join category_translations cnl on cnl.category_id = sc.category_id and cnl.locale = 'nl'
join category_translations cen on cen.category_id = sc.category_id and cen.locale = 'en'
cross join unnest(array['nl', 'en']::locale[]) as loc;

-- 4. Items: one per (Subsubcategory, kind, difficulty) -> 80 x 3 x 3 = 720 --
--
-- seq order: all 240 text Items first (seq 1-240), then 240 picture (241-480),
-- then 240 music (481-720), each block ordered by subsubcategory then
-- difficulty (easy, medium, hard).

create temporary table item_seed on commit drop as
select
  gen_random_uuid() as item_id,
  ss.id as subsubcategory_id,
  c.id as category_id,
  cnl.name as category_name_nl,
  cen.name as category_name_en,
  k.kind,
  k.kind_ord,
  d.difficulty,
  d.difficulty_ord,
  row_number() over (order by k.kind_ord, ss.id, d.difficulty_ord) as seq
from subsubcategories ss
join subcategories sc on sc.id = ss.subcategory_id
join categories c on c.id = sc.category_id
join category_translations cnl on cnl.category_id = c.id and cnl.locale = 'nl'
join category_translations cen on cen.category_id = c.id and cen.locale = 'en'
cross join (values ('text', 1), ('picture', 2), ('music', 3)) as k(kind, kind_ord)
cross join (values ('easy', 1), ('medium', 2), ('hard', 3)) as d(difficulty, difficulty_ord);

insert into items (id, kind, subsubcategory_id, difficulty)
select item_id, kind::item_kind, subsubcategory_id, difficulty::difficulty
from item_seed;

-- 5. Item translations -------------------------------------------------------
--
-- Locale-exception handful: seq 1 and 481 are nl-only, seq 2 and 482 are
-- en-only (text and music, one pair each); seq 241 is nl-only and seq 242 is
-- en-only (picture). Six Items total, so both Locale pools still meet the
-- coverage floor above.

insert into item_translations (item_id, locale, question, answer, fact)
select
  s.item_id,
  loc,
  case s.kind
    when 'text' then
      case loc
        when 'nl' then 'Vraag ' || s.seq || ' over ' || s.category_name_nl
        else 'Question ' || s.seq || ' about ' || s.category_name_en
      end
    else null
  end,
  case s.kind
    when 'music' then null
    else
      case loc
        when 'nl' then 'Antwoord ' || s.seq
        else 'Answer ' || s.seq
      end
  end,
  case when s.kind <> 'music' and s.seq % 5 <> 0 then
    case loc
      when 'nl' then 'Feit bij vraag ' || s.seq
      else 'Fact for question ' || s.seq
    end
  else null end
from item_seed s
cross join unnest(array['nl', 'en']::locale[]) as loc
where not (loc = 'en' and s.seq in (1, 241, 481))
  and not (loc = 'nl' and s.seq in (2, 242, 482));

-- 6. Picture and Music detail rows ------------------------------------------
-- Reuse the same 4 seed asset files across many Items (storage_path is not
-- unique). File names are the object keys inside each bucket (see
-- supabase/config.toml [storage.buckets.*] and supabase/seed-assets/).

insert into picture_item_details (item_id, storage_path)
select
  item_id,
  (array['placeholder-blue.png', 'placeholder-red.png', 'placeholder-green.png', 'placeholder-yellow.png'])[((seq - 1) % 4) + 1]
from item_seed
where kind = 'picture';

insert into music_item_details (item_id, storage_path, artist, title)
select
  item_id,
  (array['tone-a.mp3', 'tone-b.mp3', 'tone-c.mp3', 'tone-d.mp3'])[((seq - 1) % 4) + 1],
  'Placeholder Artist ' || (((seq - 1) % 5) + 1),
  'Placeholder Track ' || seq
from item_seed
where kind = 'music';

commit;
