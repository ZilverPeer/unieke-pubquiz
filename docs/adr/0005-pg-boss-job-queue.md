# Generation runs in a pg-boss worker, not inline in the webhook

A WooCommerce order can contain several quizzes, each needing sampling, four rendered files, and an `ffmpeg` audio build. Doing that inside the webhook request would tie correctness to a single long HTTP call, with no retry or resume after a crash, and WooCommerce retries webhooks that don't answer quickly. We use `pg-boss`, an off-the-shelf job queue on the Postgres we already have: the webhook records the order, enqueues one job per quiz, and returns 200; a worker in the Next.js container processes jobs with retries and per-quiz isolation. This adds no service and no cost.

## Considered options
- **Inline in the webhook** — simplest, but no retries/resume and a long-running request that WooCommerce may time out and re-send.
- **Vercel Workflow** — fits only if hosted on Vercel, which ADR-0003 rules out.
- **Hosted queues (Inngest, Trigger.dev)** — mature, but a third vendor and a potential recurring cost for a hobby-scale project.
- **Own queue table + cron polling** — works, but hand-rolls what `pg-boss` already does well.
