-- Ticket #71: Quiz mode is removed from the domain. The customer's Category
-- picks are now cycled evenly over the 8 Round slots (slot i gets pick
-- `i % k` for k picks; 0 picks fills every slot with a random Category) --
-- see CONTEXT.md "Quiz". `mixed`/`single_category` no longer distinguish
-- anything, so the column and its enum type go away; there is no production
-- data to migrate.

alter table quizzes drop column quiz_mode;
alter table compositions drop column quiz_mode;

drop type quiz_mode;

comment on column quizzes.category_picks is
  'the customer''s Category ids in pick order, 0 to 8 entries, distinct';
