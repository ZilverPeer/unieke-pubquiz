-- Pool-coverage check: sampleable Item counts per kind, Locale and Difficulty.
--
-- A full mixed-mode Quiz needs, per Locale and per requested Difficulty
-- (mixed draws across all three, so the "mixed" row sums easy+medium+hard):
--   >= 60 sampleable text Items (6 Text Rounds x 10)
--   >= 10 sampleable picture Items (1 Picture Round x 10)
--   >= 10 sampleable music Items (1 Music Round x 10)
-- spread across enough Categories/Subsubcategories that no Round of 10 needs
-- two Items from the same Subsubcategory (>= 10 Subsubcategories supplying
-- that kind+difficulty within at least one Category). See supabase/seed.sql
-- and supabase/README.md "Pool coverage" for the full reasoning.
--
-- Run with: supabase db query < supabase/checks/pool-coverage.sql
-- or:       docker exec -i <db-container> psql -U postgres -f - < supabase/checks/pool-coverage.sql

select
  it.kind,
  tr.locale,
  it.difficulty,
  count(*) as sampleable_items,
  count(distinct it.subsubcategory_id) as distinct_subsubcategories,
  count(distinct ss.subcategory_id) as distinct_subcategories,
  count(distinct sc.category_id) as distinct_categories,
  case it.kind when 'text' then 60 else 10 end as required_for_full_quiz,
  (count(*) >= case it.kind when 'text' then 60 else 10 end) as meets_threshold
from items it
join item_translations tr on tr.item_id = it.id
join subsubcategories ss on ss.id = it.subsubcategory_id
join subcategories sc on sc.id = ss.subcategory_id
group by it.kind, tr.locale, it.difficulty
order by tr.locale, it.difficulty, it.kind;

-- Per-Category, per-kind Subsubcategory coverage (backs the "no Round needs
-- two Items from the same Subsubcategory" claim): every (category, kind)
-- pair should show >= 10 distinct Subsubcategories for every Difficulty.
select
  c.id as category_id,
  it.kind,
  it.difficulty,
  count(distinct it.subsubcategory_id) as distinct_subsubcategories
from items it
join subsubcategories ss on ss.id = it.subsubcategory_id
join subcategories sc on sc.id = ss.subcategory_id
join categories c on c.id = sc.category_id
group by c.id, it.kind, it.difficulty
order by c.id, it.kind, it.difficulty;
