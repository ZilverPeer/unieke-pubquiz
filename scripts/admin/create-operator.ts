/**
 * Creates or resets the one operator account on the local stack's Supabase
 * Auth (spec 4, ticket #85). Idempotent: a second run for an existing email
 * updates its password rather than failing.
 *
 * Usage: npm run admin:operator -- <email> <password>
 */
import "../load-env";
import { createClient } from "@supabase/supabase-js";
import { resolveLocalStackConfig } from "../../src/repository/local-stack-config";

async function main(): Promise<void> {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage: npm run admin:operator -- <email> <password>");
    process.exitCode = 1;
    return;
  }

  const config = resolveLocalStackConfig();
  const supabase = createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // auth.admin.listUsers() paginates (default page size 50); local dev only
  // ever creates the one operator account, so a single page is enough to
  // find it by email.
  const { data: existing, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) throw listError;
  const found = existing.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());

  if (found) {
    const { error } = await supabase.auth.admin.updateUserById(found.id, { password });
    if (error) throw error;
    console.log(`${email} updated`);
    return;
  }

  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  console.log(`${email} created`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
