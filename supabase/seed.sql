-- Bilingual placeholder seed content.
--
-- Shape (see supabase/README.md "Pool coverage" for the full reasoning):
--   8 Categories, each with 2 Subcategories, each with 5 Subsubcategories
--   => 10 Subsubcategories per Category.
--   Each Subsubcategory gets 7 text Items and 1 picture + 1 music Item per
--   Difficulty (3 kinds x 3 difficulties, text at 7x density): 27 Items per
--   Subsubcategory. 8 x 10 x 27 = 2160 Items total (1680 text, 240 picture,
--   240 music).
--
-- Invariants this shape must hold (see src/sample and its README for the
-- rules being served):
--   - An Item never appears twice within the same Quiz, in either Quiz
--     mode. Within a single Round of 10 Items, that's also guaranteed by
--     the no-two-Items-share-a-Subsubcategory rule; across Rounds of the
--     same Quiz it's enforced by sampleComposition itself excluding every
--     Item already placed earlier in that Quiz (see issue #34).
--   - Per Category, per kind, there are exactly 10 Subsubcategories with an
--     Item of any given Difficulty -- the minimum for a Round of 10 Items to
--     never need two Items from the same Subsubcategory. Picture and music
--     keep zero slack here (exactly 10 Items per Category/Difficulty, one
--     Round's worth). Text needs more: a single-category Quiz draws 6
--     distinct Text Rounds (60 Items, no repeats across Rounds) from ONE
--     Category, unlike mixed mode where every Round's Category differs. 7x
--     density gives 70 text Items per (Category, Difficulty) -- 10 Items of
--     slack over the 60 needed, at every requested Difficulty.
--   - Per Locale, per Difficulty: 8 Categories x 10 Subsubcategories x 7 =
--     560 text Items, and 80 picture / 80 music Items, comfortably over the
--     "at least 60 text + 10 picture + 10 music" floor for one mixed-mode
--     Quiz, spread across all 8 Categories (not concentrated in one).
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

-- 4. Items: text at 7 per (Subsubcategory, difficulty), picture/music at 1 --
--    -> 80 x 3 x (7 + 1 + 1) = 2160 --------------------------------------
--
-- seq order: all 1680 text Items first (seq 1-1680, 7 per (subsubcategory,
-- difficulty) cell, repeat 1-7 innermost), then 240 picture (1681-1920),
-- then 240 music (1921-2160), each block ordered by subsubcategory then
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
  row_number() over (order by k.kind_ord, ss.id, d.difficulty_ord, rep.n) as seq
from subsubcategories ss
join subcategories sc on sc.id = ss.subcategory_id
join categories c on c.id = sc.category_id
join category_translations cnl on cnl.category_id = c.id and cnl.locale = 'nl'
join category_translations cen on cen.category_id = c.id and cen.locale = 'en'
-- text repeats 7x per (Subsubcategory, difficulty) cell; picture/music stay
-- at 1x (see the file header for why text alone needs the extra density).
cross join (values ('text', 1, 7), ('picture', 2, 1), ('music', 3, 1)) as k(kind, kind_ord, per_cell)
cross join (values ('easy', 1), ('medium', 2), ('hard', 3)) as d(difficulty, difficulty_ord)
cross join lateral generate_series(1, k.per_cell) as rep(n);

insert into items (id, kind, subsubcategory_id, difficulty)
select item_id, kind::item_kind, subsubcategory_id, difficulty::difficulty
from item_seed;

-- 5. Item translations -------------------------------------------------------
--
-- Locale-exception handful: seq 1 and 1921 are nl-only, seq 2 and 1922 are
-- en-only (text and music, one pair each); seq 1681 is nl-only and seq 1682
-- is en-only (picture). Six Items total, so both Locale pools still meet the
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
where not (loc = 'en' and s.seq in (1, 1681, 1921))
  and not (loc = 'nl' and s.seq in (2, 1682, 1922));

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
