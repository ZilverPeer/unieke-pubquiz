"use client";
/**
 * Client components for the Categories admin page (spec 4, ticket #87):
 * useActionState is the documented pattern for a Server Action that returns
 * a value a form needs to render (node_modules/next/dist/docs's
 * mutating-data guide, "Showing a pending state"); addNode/renameNode/
 * deleteNode (./actions.ts) return ActionResult, so each form needs to be a
 * Client Component to read that return value back into field errors and the
 * delete refusal message. Server Components elsewhere in this page still do
 * the actual data read (page.tsx).
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/admin/forms";
import type { CategoryLevel } from "@/admin/categories/validate";
import { addNode, deleteNode, renameNode, type DeleteNodeValue } from "./actions";

const initialAddState: ActionResult<{ id: number }> = { ok: true, value: { id: 0 } };
const initialRenameState: ActionResult<void> = { ok: true, value: undefined };
const initialDeleteState: ActionResult<DeleteNodeValue> = { ok: true, value: { deleted: true } };

function fieldError(state: ActionResult<unknown>, field: string): string | undefined {
  return state.ok ? undefined : state.errors[field];
}

export function AddNodeForm({ level, parentId }: { level: CategoryLevel; parentId: number | null }) {
  const t = useTranslations("categories");
  const [state, formAction, pending] = useActionState(
    (_prev: ActionResult<{ id: number }>, formData: FormData) => addNode(formData),
    initialAddState,
  );
  const nameNlError = fieldError(state, "nameNl");
  const nameEnError = fieldError(state, "nameEn");
  const parentIdError = fieldError(state, "parentId");

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="level" value={level} />
      {parentId !== null && <input type="hidden" name="parentId" value={parentId} />}
      <label className="flex flex-col text-sm">
        <span>{t("form.nameNl")}</span>
        <input name="nameNl" className="border px-2 py-1" />
        {nameNlError && <span className="text-red-600">{t(nameNlError)}</span>}
      </label>
      <label className="flex flex-col text-sm">
        <span>{t("form.nameEn")}</span>
        <input name="nameEn" className="border px-2 py-1" />
        {nameEnError && <span className="text-red-600">{t(nameEnError)}</span>}
      </label>
      {parentIdError && <span className="text-red-600">{t(parentIdError)}</span>}
      <button type="submit" disabled={pending} className="border px-2 py-1">
        {t(`form.add.${level}`)}
      </button>
    </form>
  );
}

export function RenameNodeForm({
  level,
  id,
  locale,
  initialName,
}: {
  level: CategoryLevel;
  id: number;
  locale: "nl" | "en";
  initialName: string;
}) {
  const t = useTranslations("categories");
  const [state, formAction, pending] = useActionState(
    (_prev: ActionResult<void>, formData: FormData) => renameNode(formData),
    initialRenameState,
  );
  const nameError = fieldError(state, "name");

  return (
    <form action={formAction} className="flex items-center gap-1">
      <input type="hidden" name="level" value={level} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="locale" value={locale} />
      <input name="name" defaultValue={initialName} className="border px-1 py-0.5 text-sm" />
      <button type="submit" disabled={pending} className="text-sm underline">
        {t("form.rename")}
      </button>
      {nameError && <span className="text-red-600 text-sm">{t(nameError)}</span>}
    </form>
  );
}

export function DeleteNodeForm({ level, id }: { level: CategoryLevel; id: number }) {
  const t = useTranslations("categories");
  const [state, formAction, pending] = useActionState(
    (_prev: ActionResult<DeleteNodeValue>, formData: FormData) => deleteNode(formData),
    initialDeleteState,
  );
  const refused = state.ok && !state.value.deleted ? state.value : null;

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="level" value={level} />
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="text-sm text-red-700 underline">
        {t("form.delete")}
      </button>
      {refused && (
        <span className="text-red-600 text-sm">
          {t(refused.reason === "has-children" ? "errors.deleteHasChildren" : "errors.deleteHasItems", {
            count: refused.count,
          })}
        </span>
      )}
    </form>
  );
}
