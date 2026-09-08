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

/** Thrown by assertOperator() when the caller has no allowlisted operator session. */
export class NotAnOperatorError extends Error {
  constructor() {
    super("Not signed in as an allowlisted operator");
    this.name = "NotAnOperatorError";
  }
}

/**
 * Additive, spec 4 wave pin (ticket #87): the seam server actions re-check
 * through, since the layout's requireOperator() only guards the page render,
 * not a direct POST to the action (see node_modules/next/dist/docs's
 * mutating-data guide: "Always verify authentication and authorization
 * inside every Server Function"). Reuses requireOperator() rather than
 * duplicating the session/allowlist check; throws instead of redirecting so
 * an action can turn the failure into an ActionResult, and so tests can
 * inject a stub that never touches cookies/Supabase Auth (see each admin
 * area's actions.ts `deps.assertOperator` default parameter).
 */
export async function assertOperator(): Promise<OperatorSession> {
  const operator = await requireOperator();
  if (!operator) throw new NotAnOperatorError();
  return operator;
}
