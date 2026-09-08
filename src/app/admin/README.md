# Admin shell (spec 4, ticket #85)

Login, the operator allowlist, the locale switch, and the operator CLI for the protected `/admin` area. Later spec 4 tickets (Categories, Items, coverage, Orders) build inside this shell; this ticket is only the shell itself -- the four nav destinations are empty placeholders.

## Login and the guard

- `src/proxy.ts` is the Next.js proxy (Next 16's renamed middleware): it refreshes the Supabase session cookie on every request and, for any request under `/admin` other than `/admin/login` itself, redirects to `/admin/login` when there is no valid session. This is the *optimistic* check -- it only asks "is there a session", never the allowlist -- per the Next.js authentication guide.
- The matcher excludes `/api/`, `/download/`, `/_next/` and any path with a file extension, so the webhook route and the download route are never touched by the guard.
- `src/admin/auth/session.ts`'s `requireOperator()` is the secure check, called from `src/app/admin/(shell)/layout.tsx`: it reads the session via `src/admin/auth/server-client.ts` (a `@supabase/ssr` client built from the anon key, never the service role key) and checks the email against `src/admin/auth/allowlist.ts`'s `isAllowedOperator()`. No session redirects to `/admin/login`; a session that isn't allowlisted renders the Dutch refusal instead of the shell (redirecting a refused, signed-in user back to `/admin` would just bounce them into this same check again).
- The guarded pages (the shell itself, Categories, Items, Coverage, Orders) live under the `(shell)` route group (`src/app/admin/(shell)/`); route groups don't affect the URL, so they're still served at `/admin`, `/admin/categories`, etc. `/admin/login` deliberately sits *outside* that group, with its own minimal layout (`src/app/admin/login/layout.tsx`, next-intl only, no guard): `requireOperator()` redirects to `/admin/login` on no session, so if the guarded layout also wrapped the login page, that redirect would target itself and loop forever (fix round 1).
- `src/app/admin/login/actions.ts` has the `login` and `signOut` server actions. No self sign-up: `login` only ever signs in the one operator account created by the CLI below. A failed sign-in redirects back to `/admin/login?error=1`, which the login page reads to show the Dutch error.

## Allowlist

`ADMIN_EMAILS` (`.env.example`, `.env.local`) is a comma-separated, whitespace- and case-insensitive list of emails. Empty or unset refuses everyone -- it fails closed, not open.

## Locale

`next-intl` reads the locale from the `pubquiz_admin_locale` cookie (`src/i18n/request.ts`), defaulting to `nl`. `src/app/admin/(shell)/locale/actions.ts`'s `setLocale` action sets the cookie and revalidates the admin layout, so the switch is visible immediately, not just after the next full reload. Message files are `messages/nl.json` and `messages/en.json` at the repo root, namespaced `admin.nav`, `admin.login`, `admin.locale`, `admin.refused`.

## Operator CLI

```sh
npm run admin:operator -- <email> <password>
```

Creates the Supabase Auth user (service role client, email pre-confirmed) if it doesn't exist yet, or updates its password if it does -- idempotent, so it also doubles as a password reset. Prints only the email and `created` or `updated`. Local-stack only: it resolves the stack's URL and service role key the same way `src/repository/local-stack-config.ts` does.

Remember to also add the account's email to `ADMIN_EMAILS`, or a correctly-authenticated operator still sees the refusal.
