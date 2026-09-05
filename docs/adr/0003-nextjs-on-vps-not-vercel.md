---
status: accepted
---
# Run the Next.js app on the WordPress VPS, not on Vercel

The project has a hard constraint of no recurring cost beyond one VPS, which self-hosted WordPress (ADR-0001) already requires. The Next.js app was initially scaffolded against Vercel, but the linked team is on the Hobby plan, whose fair-use terms restrict it to non-commercial use, and Pro is a monthly fee. Generation also needs an `ffmpeg` binary and may run well over five minutes for multi-quiz orders. We therefore run the Next.js app as a Docker container on the same VPS as WordPress: zero marginal cost, no terms issue, no execution-time cap, and the same Docker-based shape as the local dev environment. Supabase stays hosted (Free tier). We give up Vercel preview deployments and take on keeping one more container updated.

## Considered options
- **Vercel Hobby** — free, but commercial use is against the plan terms; a 300 s function limit; would need Vercel Workflow for durability.
- **Vercel Pro** — solves the terms issue, but is exactly the recurring cost we ruled out.
- **Supabase Edge Functions** — Deno with a tight CPU budget and no way to ship `ffmpeg`; unusable for rendering.
