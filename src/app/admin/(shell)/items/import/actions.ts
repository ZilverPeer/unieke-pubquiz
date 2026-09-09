"use server";
/**
 * Text Item bulk import server action (spec 4, ticket #94). Re-checks the
 * operator through assertOperator() (src/admin/auth/session.ts) the same
 * way the single Text Item form's actions.ts does -- the `deps` parameter
 * lets the integration suite bypass the Supabase Auth session with a stub.
 *
 * Atomicity: the Supabase JS client has no transactions, and a Postgres
 * function is out of scope for this ticket (no migration). Instead: every
 * row is validated first (parseTextItemsCsv), then all base `items` rows
 * are written in one `insert([...]).select("id")` call, then all
 * `item_translations` rows in one `insert([...])` call; if the
 * translations insert fails, the just-inserted base rows are deleted by
 * the ids the first insert returned, and the error is thrown (the whole
 * batch never leaves a partial trace). PostgreSQL's multi-row INSERT
 * processes rows in the given order and RETURNING reflects that order, so
 * `insertedBases[i]` always corresponds to `rows[i]`. If that compensating
 * delete itself fails, the original translationsError alone would hide an
 * orphaned batch of base rows -- this throws a new Error naming both
 * failures (`{ cause: translationsError }`) instead of silently discarding
 * the delete error (fix round 1, PR #118).
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
import { loadSubsubcategoryOptions } from "@/repository/admin/items";

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

  const baseInserts = rows.map((row) => ({
    kind: "text" as const,
    subsubcategory_id: Number(row.subsubcategoryId),
    difficulty: row.difficulty,
  }));
  const { data: insertedBases, error: baseError } = await client.from("items").insert(baseInserts).select("id");
  if (baseError) throw baseError;

  const translationInserts: { item_id: string; locale: "nl" | "en"; question: string | null; answer: string; fact: string | null }[] =
    [];
  insertedBases.forEach((base, index) => {
    const row = rows[index];
    for (const locale of ["nl", "en"] as const) {
      const translation = row.translations[locale];
      if (translation) {
        translationInserts.push({
          item_id: base.id,
          locale,
          question: translation.question,
          answer: translation.answer,
          fact: translation.fact ?? null,
        });
      }
    }
  });

  const { error: translationsError } = await client.from("item_translations").insert(translationInserts);
  if (translationsError) {
    const { error: compensatingDeleteError } = await client
      .from("items")
      .delete()
      .in(
        "id",
        insertedBases.map((base) => base.id),
      );
    if (compensatingDeleteError) {
      throw new Error(
        `Text Item import: translations insert failed and the compensating delete of the base rows also failed -- an orphaned batch may remain. translationsError=${translationsError.message}; deleteError=${compensatingDeleteError.message}`,
        { cause: translationsError },
      );
    }
    throw translationsError;
  }

  deps.revalidateItems();
  return succeed({ count: rows.length });
}
