/**
 * Picture Item CSV template download (spec 4, ticket #95). Same shape and
 * reasoning as the Text import's own template route
 * (../../template/route.ts): a route handler, not a static file, since it
 * must call assertOperator() itself (this segment sits outside the admin
 * shell layout's guarded tree); the second `deps` parameter exists only for
 * picture-import-actions.integration.test.ts to call this GET directly with
 * a stubbed assertOperator.
 */
import { assertOperator } from "@/admin/auth/session";
import { PICTURE_ITEM_IMPORT_HEADER } from "@/admin/items/import-picture-csv";

interface TemplateRouteDeps {
  assertOperator?: typeof assertOperator;
  /** Never read -- present only so this type shares a property with the real second argument Next.js passes; see ../../template/route.ts's own docblock. */
  params?: Promise<Record<string, never>>;
}

const EXAMPLE_ROW: Record<(typeof PICTURE_ITEM_IMPORT_HEADER)[number], string> = {
  file: "example.jpg",
  subsubcategoryId: "0",
  difficulty: "medium",
  answer_nl: "Amsterdam",
  fact_nl: "",
  answer_en: "Amsterdam",
  fact_en: "",
};

/** The CSV bytes the download offers -- exported for potential reuse, same as buildTemplateCsv in ../../template/route.ts. */
export function buildPictureTemplateCsv(): string {
  const header = PICTURE_ITEM_IMPORT_HEADER.join(",");
  const exampleRow = PICTURE_ITEM_IMPORT_HEADER.map((key) => EXAMPLE_ROW[key]).join(",");
  return `${header}\n${exampleRow}\n`;
}

export async function GET(_request: Request, deps?: TemplateRouteDeps): Promise<Response> {
  await (deps?.assertOperator ?? assertOperator)();

  return new Response(buildPictureTemplateCsv(), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="picture-items-template.csv"',
    },
  });
}
