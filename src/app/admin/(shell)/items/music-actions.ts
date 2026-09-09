"use server";
/**
 * Music Item create/edit server actions (spec 4, ticket #91). Same `deps`
 * seam as actions.ts (assertOperator re-checked here, not trusted from the
 * page render -- admin-common brief "Tests"); imports ActionDeps from
 * actions.ts rather than redeclaring it, per the items-kind-common brief.
 */
import { revalidatePath } from "next/cache";
import type { Difficulty } from "@/domain";
import { assertOperator } from "@/admin/auth/session";
import { type ActionResult, fail, succeed } from "@/admin/forms";
import { validateMusicItem, type MusicItemFileInput, type MusicItemFormInput } from "@/admin/items/validate-music";
import { createSupabaseClient, resolveLocalStackConfig } from "@/repository";
import { loadSubsubcategoryOptions } from "@/repository/admin/items";
import {
  createMusicItem as createMusicItemRepo,
  updateMusicItem as updateMusicItemRepo,
  type MusicItemTranslations,
} from "@/repository/admin/music-items";
import type { ActionDeps } from "./actions";

function defaultRevalidateItems(id?: string): void {
  revalidatePath("/admin/items");
  if (id) revalidatePath(`/admin/items/${id}`);
}

const defaultDeps: ActionDeps = { assertOperator, revalidateItems: defaultRevalidateItems };

function readFile(formData: FormData): File | null {
  const value = formData.get("file");
  return value instanceof File && value.size > 0 ? value : null;
}

function readFormInput(formData: FormData, file: File | null): MusicItemFormInput {
  const fileInput: MusicItemFileInput | null = file ? { type: file.type, size: file.size } : null;
  return {
    subsubcategoryId: String(formData.get("subsubcategoryId") ?? ""),
    difficulty: String(formData.get("difficulty") ?? ""),
    artist: String(formData.get("artist") ?? ""),
    title: String(formData.get("title") ?? ""),
    nlChecked: formData.get("nl.included") === "on",
    enChecked: formData.get("en.included") === "on",
    startSeconds: String(formData.get("startSeconds") ?? ""),
    endSeconds: String(formData.get("endSeconds") ?? ""),
    file: fileInput,
  };
}

function readFact(formData: FormData, locale: "nl" | "en"): string | undefined {
  const value = String(formData.get(`${locale}.fact`) ?? "").trim();
  return value ? value : undefined;
}

function buildTranslations(input: MusicItemFormInput, formData: FormData): MusicItemTranslations {
  const translations: MusicItemTranslations = {};
  if (input.nlChecked) translations.nl = { fact: readFact(formData, "nl") };
  if (input.enChecked) translations.en = { fact: readFact(formData, "en") };
  return translations;
}

export async function createMusicItem(
  formData: FormData,
  deps: ActionDeps = defaultDeps,
): Promise<ActionResult<{ id: string }>> {
  await deps.assertOperator();

  const client = createSupabaseClient(resolveLocalStackConfig());
  const file = readFile(formData);
  const input = readFormInput(formData, file);
  const validIds = new Set((await loadSubsubcategoryOptions(client, "nl")).map((option) => option.id));

  const errors = validateMusicItem(input, validIds, { fileRequired: true });
  if (errors) return fail(errors);

  try {
    const song = Buffer.from(await file!.arrayBuffer());
    const { id } = await createMusicItemRepo(client, {
      subsubcategoryId: input.subsubcategoryId,
      difficulty: input.difficulty as Difficulty,
      artist: input.artist,
      title: input.title,
      translations: buildTranslations(input, formData),
      song,
      startSeconds: Number(input.startSeconds),
      endSeconds: Number(input.endSeconds),
    });
    deps.revalidateItems();
    return succeed({ id });
  } catch {
    return fail({ file: "musicItems.errors.cut.failed" });
  }
}

export async function updateMusicItem(
  id: string,
  formData: FormData,
  deps: ActionDeps = defaultDeps,
): Promise<ActionResult<{ id: string }>> {
  await deps.assertOperator();

  const client = createSupabaseClient(resolveLocalStackConfig());
  const file = readFile(formData);
  const input = readFormInput(formData, file);
  const validIds = new Set((await loadSubsubcategoryOptions(client, "nl")).map((option) => option.id));

  const errors = validateMusicItem(input, validIds, { fileRequired: false });
  if (errors) return fail(errors);

  try {
    const song = file ? Buffer.from(await file.arrayBuffer()) : undefined;
    const result = await updateMusicItemRepo(client, id, {
      subsubcategoryId: input.subsubcategoryId,
      difficulty: input.difficulty as Difficulty,
      artist: input.artist,
      title: input.title,
      translations: buildTranslations(input, formData),
      song,
      startSeconds: song ? Number(input.startSeconds) : undefined,
      endSeconds: song ? Number(input.endSeconds) : undefined,
    });
    deps.revalidateItems(id);
    return succeed(result);
  } catch {
    return fail({ file: "musicItems.errors.cut.failed" });
  }
}
