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
 * Thrown by assertOperator() when the session is not an allowlisted
 * operator, so a server action can refuse the write without redirecting
 * (a server action can't `redirect()` mid-mutation the way a page render
 * can).
 */
export class NotAnOperatorError extends Error {
  constructor() {
    super("Not an allowlisted operator");
    this.name = "NotAnOperatorError";
  }
}

/**
 * Re-check for area server actions (spec 4 admin tickets, #87/#88/#92/#93,
 * additive): the shell layout already guards page renders with
 * requireOperator(), but a server action is a separate request and must
 * re-check for itself rather than trust that the page that rendered its
 * form was actually guarded. Throws NotAnOperatorError instead of
 * redirecting, since a form action has no natural "redirect to login"
 * moment mid-mutation.
 *
 * A thin wrapper around requireOperator() so every area's actions.ts can
 * take an injectable `deps.assertOperator` (defaulting to this real
 * implementation), letting integration tests bypass the Supabase Auth
 * session entirely by passing a stub (see admin-common brief "Tests").
 */
export async function assertOperator(): Promise<OperatorSession> {
  const operator = await requireOperator();
  if (!operator) {
    throw new NotAnOperatorError();
  }
  return operator;
}
