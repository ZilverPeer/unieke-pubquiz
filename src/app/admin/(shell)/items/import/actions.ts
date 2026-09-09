"use server";
/**
 * Text Item bulk import server action (spec 4, ticket #94). Re-checks the
 * operator through assertOperator() (src/admin/auth/session.ts) the same
 * way the single Text Item form's actions.ts does -- the `deps` parameter
 * lets the integration suite bypass the Supabase Auth session with a stub.
 *
 * Atomicity: the Supabase JS client has no transactions, and a Postgres
 * function is out of scope for this ticket (no migration). Instead: every
 * row is validated first (parseTextItemsCsv), then the whole batch is
 * written by writeItemBatch (src/repository/admin/items.ts, extracted in
 * ticket #95 so the Picture import can reuse the same all-or-nothing write):
 * one `items` insert with `.select("id")`, then one `item_translations`
 * insert, with the just-inserted base rows deleted by their returned ids if
 * the translations insert fails (the whole batch never leaves a partial
 * trace). See that function's own docblock for the compensating-delete
 * failure case (fix round 1, PR #118).
 *
 * Row errors from the parser (RowError[]) are encoded into the flat
 * FieldErrors shape ActionResult's failure case already carries, rather
 * than extending ActionResult: a file-level error (row 0, e.g. "header" or
 * "tooManyRows") becomes the key `<field>` itself; a per-row error becomes
 * `rows.<row>.<field>`. The import page parses those keys back into a row
 * report table.
 */
import { revalidatePath } from "next/cache";
import { assertOperator } from "@/admin/auth/session";
import { type ActionResult, fail, succeed } from "@/admin/forms";
import { parseTextItemsCsv, type RowError } from "@/admin/items/import-csv";
import { createSupabaseClient, resolveLocalStackConfig } from "@/repository";
import { loadSubsubcategoryOptions, writeItemBatch } from "@/repository/admin/items";

export interface ImportActionDeps {
  assertOperator: typeof assertOperator;
  revalidateItems: () => void;
}

function defaultRevalidateItems(): void {
  revalidatePath("/admin/items");
}

const defaultDeps: ImportActionDeps = { assertOperator, revalidateItems: defaultRevalidateItems };

const ALLOWED_FILE_TYPES = new Set(["text/csv", "application/vnd.ms-excel", "text/plain"]);
const MAX_FILE_BYTES = 1024 * 1024;

function rowErrorsToFieldErrors(errors: RowError[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const error of errors) {
    const key = error.row === 0 ? error.field : `rows.${error.row}.${error.field}`;
    fieldErrors[key] = error.message;
  }
  return fieldErrors;
}

export async function importTextItems(
  formData: FormData,
  deps: ImportActionDeps = defaultDeps,
): Promise<ActionResult<{ count: number }>> {
  await deps.assertOperator();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail({ file: "itemsImport.errors.fileRequired" });
  }
  if (file.type !== "" && !ALLOWED_FILE_TYPES.has(file.type)) {
    return fail({ file: "itemsImport.errors.fileType" });
  }
  if (file.size > MAX_FILE_BYTES) {
    return fail({ file: "itemsImport.errors.fileTooLarge" });
  }

  const text = await file.text();

  const client = createSupabaseClient(resolveLocalStackConfig());
  const validIds = new Set((await loadSubsubcategoryOptions(client, "nl")).map((option) => option.id));

  const parsed = parseTextItemsCsv(text, validIds);
  if (!parsed.ok) {
    return fail(rowErrorsToFieldErrors(parsed.errors));
  }

  const { rows } = parsed;

  const insertedIds = await writeItemBatch(
    client,
    rows.map((row) => ({
      kind: "text" as const,
      subsubcategoryId: row.subsubcategoryId,
      difficulty: row.difficulty,
      translations: row.translations,
    })),
  );

  deps.revalidateItems();
  return succeed({ count: insertedIds.length });
}
