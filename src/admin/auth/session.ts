/**
 * Operator gate for the admin shell (spec 4, ticket #85). requireOperator()
 * is the one seam every page under src/app/admin renders behind (called
 * from the admin layout, src/app/admin/layout.tsx): no session redirects to
 * the login page; a session that isn't on the ADMIN_EMAILS allowlist
 * (src/admin/auth/allowlist.ts) is left for the layout to render the Dutch
 * refusal rather than redirected, since redirecting a signed-in-but-refused
 * user back to /admin would just bounce them into this same check again.
 */
import { redirect } from "next/navigation";
import { isAllowedOperator } from "./allowlist";
import { createAdminSupabaseClient } from "./server-client";

export interface OperatorSession {
  email: string;
}

export async function requireOperator(): Promise<OperatorSession | null> {
  const supabase = await createAdminSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect("/admin/login");
  }

  if (!isAllowedOperator(user.email, process.env.ADMIN_EMAILS)) {
    return null;
  }

  return { email: user.email };
}

/**
 * Server-action-side re-check (spec 4 admin wave brief, "Layout rules"): the
 * guarded layout already keeps a non-operator off the page, but a server
 * action is reachable on its own, so every write action calls this too.
 * Unlike requireOperator() it never redirects -- a rejected call throws, for
 * the action to turn into a rejected ActionResult, not a navigation. Tests
 * bypass the real check by injecting a stub of the same shape (see
 * src/app/admin/(shell)/orders/actions.integration.test.ts).
 */
export async function assertOperator(): Promise<OperatorSession> {
  const supabase = await createAdminSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !isAllowedOperator(user.email, process.env.ADMIN_EMAILS)) {
    throw new Error("assertOperator: no allowlisted operator session");
  }

  return { email: user.email };
}
