-- Ticket #42 fix: pruning must keep the download token so a pruned Quiz's
-- link stays *recognised* (and can 410) instead of falling into the
-- unrecognised-token 404 branch. `pruned_at` records when the daily pruning
-- job deleted this Quiz's Storage objects; null means "not pruned" (or
-- pruned then re-rendered via `--composition`, which clears it again).
alter table quizzes add column pruned_at timestamptz;

comment on column quizzes.pruned_at is
  'Set by the daily pruning job when this Quiz''s Deliverable objects were deleted from Storage; the download token is kept so the route can still recognise it and answer 410. Cleared by --composition re-rendering (src/scripts/recompose-quiz.ts), which re-enables the same link.';
