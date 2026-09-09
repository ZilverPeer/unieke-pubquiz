/**
 * Text Item CSV template download (spec 4, ticket #94, story 31). A route
 * handler, not a static file under public/, since it must call
 * assertOperator() itself: this segment sits outside src/app/admin/(shell)/
 * layout.tsx's tree (a route.ts is never rendered through a layout), so the
 * layout's requireOperator() guard never runs for it -- the request-level
 * proxy guard (src/proxy.ts) still redirects an unauthenticated request to
 * /admin/login (its matcher excludes only /api/, /download/, /_next/ and
 * dotted-extension paths, none of which match this path), but that guard
 * only checks for a Supabase Auth session, never the ADMIN_EMAILS
 * allowlist -- assertOperator() is the one seam that checks both.
 *
 * The second `deps` parameter exists only for
 * import-actions.integration.test.ts to call this GET directly with a
 * stubbed assertOperator, the same seam-testing shape actions.ts's own
 * `deps` parameter uses. It is read defensively (`deps?.assertOperator`)
 * rather than as a plain default parameter: Next.js always invokes a route
 * handler with a real second argument (`{ params }`), even for a route with
 * no dynamic segments, so a plain `= defaultDeps` default would never apply
 * in production and the stub type would never match what Next actually
 * passes.
 */
import { assertOperator } from "@/admin/auth/session";
import { TEXT_ITEM_IMPORT_HEADER } from "@/admin/items/import-csv";

interface TemplateRouteDeps {
  assertOperator?: typeof assertOperator;
  /**
   * Never read -- present only so this type shares a property with the real
   * second argument Next.js passes (`{ params: Promise<{}> }`), the shape
   * every route handler gets even without a dynamic segment. Without an
   * overlapping key, TypeScript's route type validator (.next/types)
   * rejects GET's signature as having "no properties in common" with what
   * Next.js actually calls it with.
   */
  params?: Promise<Record<string, never>>;
}

const EXAMPLE_ROW: Record<(typeof TEXT_ITEM_IMPORT_HEADER)[number], string> = {
  subsubcategoryId: "0",
  difficulty: "medium",
  question_nl: "Wat is de hoofdstad van Nederland?",
  answer_nl: "Amsterdam",
  fact_nl: "",
  question_en: "What is the capital of the Netherlands?",
  answer_en: "Amsterdam",
  fact_en: "",
};

/**
 * The CSV bytes the download offers -- exported for potential reuse, but
 * the round-trip check belongs to the integration test (it needs a real
 * Subsubcategory id from the stack to replace the "0" example with).
 */
export function buildTemplateCsv(): string {
  const header = TEXT_ITEM_IMPORT_HEADER.join(",");
  const exampleRow = TEXT_ITEM_IMPORT_HEADER.map((key) => EXAMPLE_ROW[key]).join(",");
  return `${header}\n${exampleRow}\n`;
}

export async function GET(_request: Request, deps?: TemplateRouteDeps): Promise<Response> {
  await (deps?.assertOperator ?? assertOperator)();

  return new Response(buildTemplateCsv(), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="text-items-template.csv"',
    },
  });
}
