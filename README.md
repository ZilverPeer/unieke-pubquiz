This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Environment variables

| Variable | Used by | Default |
|---|---|---|
| `WOOCOMMERCE_WEBHOOK_SECRET` | webhook signature verification (`src/app/api/webhooks/woocommerce`) and `npm run shop:up` | `test-secret` (local only) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | repository connection to the local Supabase stack (`src/repository/local-stack-config.ts`) | resolved via `supabase status -o env` |
| `DATABASE_URL` | pg-boss's own store (`src/worker/boss.ts`) | `postgresql://postgres:postgres@127.0.0.1:45322/postgres` |
| `PUBQUIZ_WORKER` | set to `1` to run the pg-boss worker inside `next dev`/the container (`src/instrumentation.ts`) | unset (worker off) |

See `.env.example`, `src/app/api/webhooks/woocommerce/README.md`, `src/worker/README.md` and `shop/README.md` for the full detail behind each one.

## Public routes

`/api/webhooks/woocommerce` has no session or API key to check -- it verifies its own HMAC signature instead (see `src/app/api/webhooks/woocommerce/README.md`). No auth middleware exists yet (no `src/middleware.ts` or `src/proxy.ts`); when one is added, this route must stay excluded from it.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
