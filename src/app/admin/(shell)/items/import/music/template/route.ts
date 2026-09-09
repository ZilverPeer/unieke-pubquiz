/**
 * Music Item CSV template download (spec 4, ticket #96). Same shape and
 * reasoning as the Picture import's own template route
 * (../../pictures/template/route.ts): a route handler, not a static file,
 * since it must call assertOperator() itself (this segment sits outside
 * the admin shell layout's guarded tree); the second `deps` parameter
 * exists only for music-import-actions.integration.test.ts to call this
 * GET directly with a stubbed assertOperator.
 */
import { assertOperator } from "@/admin/auth/session";
import { MUSIC_ITEM_IMPORT_HEADER } from "@/admin/items/import-music-csv";

interface TemplateRouteDeps {
  assertOperator?: typeof assertOperator;
  /** Never read -- present only so this type shares a property with the real second argument Next.js passes; see ../../pictures/template/route.ts's own docblock. */
  params?: Promise<Record<string, never>>;
}

const EXAMPLE_ROW: Record<(typeof MUSIC_ITEM_IMPORT_HEADER)[number], string> = {
  file: "example.mp3",
  subsubcategoryId: "0",
  difficulty: "medium",
  artist: "Example Artist",
  title: "Example Title",
  startSeconds: "30",
  endSeconds: "55",
  locales: "nl;en",
};

/** The CSV bytes the download offers -- exported for potential reuse, same as buildPictureTemplateCsv in ../../pictures/template/route.ts. */
export function buildMusicTemplateCsv(): string {
  const header = MUSIC_ITEM_IMPORT_HEADER.join(",");
  const exampleRow = MUSIC_ITEM_IMPORT_HEADER.map((key) => EXAMPLE_ROW[key]).join(",");
  return `${header}\n${exampleRow}\n`;
}

export async function GET(_request: Request, deps?: TemplateRouteDeps): Promise<Response> {
  await (deps?.assertOperator ?? assertOperator)();

  return new Response(buildMusicTemplateCsv(), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="music-items-template.csv"',
    },
  });
}
