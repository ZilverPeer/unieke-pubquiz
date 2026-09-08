/**
 * Shared result shape for admin server actions (spec 4 wave pin). Every
 * write action validates on the server and returns field errors keyed by
 * form field name; the page renders each error next to its field. Error
 * values are message keys (resolved with next-intl in the page), never
 * user-facing literals.
 */
export type FieldErrors = Record<string, string>;

export type ActionResult<T = void> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export function fail(errors: FieldErrors): ActionResult<never> {
  return { ok: false, errors };
}

export function succeed<T>(value: T): ActionResult<T> {
  return { ok: true, value };
}
