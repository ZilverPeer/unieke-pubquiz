/**
 * Admin guard (spec 4, ticket #85): redirects an unauthenticated request
 * under /admin to /admin/login. This is the *optimistic* check the Next.js
 * authentication guide recommends (node_modules/next/dist/docs/01-app/
 * 02-guides/authentication.md, "Optimistic checks with Proxy") -- it only
 * asks "is there a valid Supabase session?", never the allowlist, which is
 * a database-free question a JWT already answers. The allowlist itself
 * (src/admin/auth/allowlist.ts) is checked in the admin layout via
 * requireOperator() (src/admin/auth/session.ts), the secure check close to
 * the data it protects.
 *
 * Every request that reaches this file also gets its Supabase session
 * cookie refreshed, per the @supabase/ssr Next.js guide (see server-client
 * docs pulled via ctx7): the cookies() API isn't available at the top
 * level of a proxy, so this builds its own @supabase/ssr client directly
 * from the NextRequest/NextResponse cookie jars rather than reusing
 * src/admin/auth/server-client.ts (which assumes next/headers's cookies()).
 *
 * matcher excludes /api/, /download/ (both must keep working without
 * login -- spec 4 story 26), /_next/ and any path with a file extension
 * (static assets), so this never runs on the webhook or download routes.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set (see .env.example)`);
  }
  return value;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  const isLoginRoute = pathname === "/admin/login";

  if (isAdminRoute && !isLoginRoute && !user) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!api/|download/|_next/|.*\\..*).*)"],
};
