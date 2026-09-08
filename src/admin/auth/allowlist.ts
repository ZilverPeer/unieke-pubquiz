/**
 * Server-side operator allowlist (spec 4, ticket #85): a signed-in Supabase
 * Auth user is only an operator if their email appears in ADMIN_EMAILS, a
 * comma-separated env var. Deliberately fails closed -- an empty or unset
 * allowlist refuses everyone rather than admitting anyone signed in.
 */
export function isAllowedOperator(
  email: string | null | undefined,
  allowlistEnv: string | null | undefined,
): boolean {
  if (!email) return false;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  const allowed = (allowlistEnv ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  return allowed.includes(normalizedEmail);
}
