/**
 * Request-level tests for the admin guard (spec 4, ticket #85), in the
 * style of src/app/api/webhooks/woocommerce/route.integration.test.ts:
 * drives the exported proxy() function directly with real NextRequests
 * against the real local Supabase stack (no session cookie needed for
 * these cases -- the guard only has to tell "no session" from "some
 * session", which an absent cookie already proves).
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3001"));
}

// Mirrors config.matcher's pattern (src/proxy.ts) so this test proves the
// matcher itself excludes these paths in a real Next.js deployment, not
// just that proxy() happens to pass them through when called directly.
function matcherIncludes(pathname: string): boolean {
  return new RegExp(`^${config.matcher[0]}$`).test(pathname);
}

describe("proxy", () => {
  it("redirects an unauthenticated GET /admin to /admin/login", async () => {
    const response = await proxy(request("/admin"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3001/admin/login");
  });

  it("lets an unauthenticated GET /admin/login through without a redirect", async () => {
    const response = await proxy(request("/admin/login"));

    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets the webhook route through untouched", async () => {
    const response = await proxy(request("/api/webhooks/woocommerce"));

    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets the download route through untouched", async () => {
    const response = await proxy(request("/download/abc/quiz.zip"));

    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
  });

  it("config.matcher excludes the webhook, download and _next paths", () => {
    expect(matcherIncludes("/api/webhooks/woocommerce")).toBe(false);
    expect(matcherIncludes("/download/abc/quiz.zip")).toBe(false);
    expect(matcherIncludes("/_next/static/chunk.js")).toBe(false);
    expect(matcherIncludes("/favicon.ico")).toBe(false);
  });

  it("config.matcher includes /admin and /admin/login", () => {
    expect(matcherIncludes("/admin")).toBe(true);
    expect(matcherIncludes("/admin/login")).toBe(true);
  });
});
