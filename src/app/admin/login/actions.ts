"use server";
/**
 * Login and sign-out server actions for the admin shell (spec 4, ticket
 * #85). No self sign-up: this only ever signs in the one operator account
 * created out of band by scripts/admin/create-operator.ts.
 */
import { redirect } from "next/navigation";
import { createAdminSupabaseClient } from "@/admin/auth/server-client";

export async function login(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createAdminSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/admin/login?error=1");
  }

  redirect("/admin");
}

export async function signOut(): Promise<void> {
  const supabase = await createAdminSupabaseClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
