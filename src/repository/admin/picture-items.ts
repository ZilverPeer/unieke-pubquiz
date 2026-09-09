/**
 * Picture Item detail-table write and bucket upload/replace (spec 4,
 * ticket #90). Own file per the items-kind-common brief ("Files, so the
 * two tickets do not collide") -- calls writeItemBase/writeTranslations
 * from ./items.ts, the only new part here is picture_item_details and the
 * `pictures` bucket object.
 *
 * Storage path is `<itemId>.jpg` (items-kind-common brief: "pictures" ->
 * ".jpg"). Uploads use `upsert: true` so replacing an image overwrites the
 * object at the same path -- the Item id and its storage_path never
 * change, so past Compositions and the no-repeat rule are unaffected
 * (ticket #90 acceptance criteria, CONTEXT.md "Admin UI" scope).
 *
 * Picture Items have no question (00003_items.sql's kind-shape comment):
 * translations carry answer/fact only, question is written as `null`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { PICTURE_MAX_EDGE_PX } from "@/domain";
import type { Difficulty } from "@/domain";
import type { Database } from "../database.types";
import { writeItemBase, writeItemBatch, writeTranslations, type TextItemTranslations } from "./items";

const BUCKET = "pictures";

/** Thrown by resizeToJpeg when the uploaded bytes are not a real image (sharp's metadata() throws). Caught by the server action and mapped to a `file` field error. */
export class PictureNotAnImageError extends Error {
  constructor() {
    super("Uploaded file is not a valid image");
    this.name = "PictureNotAnImageError";
  }
}

export interface PictureItemLocaleTranslation {
  answer: string;
  fact?: string;
}

export interface PictureItemTranslations {
  nl?: PictureItemLocaleTranslation;
  en?: PictureItemLocaleTranslation;
}

export interface CreatePictureItemInput {
  subsubcategoryId: string;
  difficulty: Difficulty;
  translations: PictureItemTranslations;
  image: Buffer;
}

export interface UpdatePictureItemInput {
  subsubcategoryId: string;
  difficulty: Difficulty;
  translations: PictureItemTranslations;
  /** Omitted (or undefined) leaves the stored object untouched. */
  image?: Buffer;
}

function toTextItemTranslations(translations: PictureItemTranslations): TextItemTranslations {
  const result: TextItemTranslations = {};
  for (const locale of ["nl", "en"] as const) {
    const translation = translations[locale];
    if (translation) result[locale] = { question: null, answer: translation.answer, fact: translation.fact };
  }
  return result;
}

/**
 * Throws PictureNotAnImageError when `image` is not real image bytes
 * (`sharp(...).metadata()` throws first). Extracted from resizeToJpeg
 * (ticket #95) so the Picture Item bulk import can check every zip entry is
 * a real image before writing anything, the same check resizeToJpeg itself
 * still runs first below.
 */
export async function assertImage(image: Buffer): Promise<void> {
  try {
    await sharp(image).metadata();
  } catch {
    throw new PictureNotAnImageError();
  }
}

/**
 * Resizes to at most PICTURE_MAX_EDGE_PX on the longest edge (`fit:
 * "inside"`, `withoutEnlargement: true` -- a smaller source is never
 * upscaled) and re-encodes as JPEG quality 85.
 */
async function resizeToJpeg(image: Buffer): Promise<Buffer> {
  await assertImage(image);
  return sharp(image)
    .resize(PICTURE_MAX_EDGE_PX, PICTURE_MAX_EDGE_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

/**
 * Rows first, then the object: writeItemBase/writeTranslations/the detail
 * row all succeed before the bucket upload is attempted; if the upload
 * fails, the Item row (and, via `on delete cascade`, its translations and
 * detail row) is deleted and the error rethrown, so a failed upload never
 * leaves an orphan Item behind (ticket #90 "What to build").
 */
export async function createPictureItem(
  client: SupabaseClient<Database>,
  input: CreatePictureItemInput,
): Promise<{ id: string }> {
  const resized = await resizeToJpeg(input.image);
  const id = await writeItemBase(client, null, {
    kind: "picture",
    subsubcategoryId: input.subsubcategoryId,
    difficulty: input.difficulty,
  });
  const storagePath = `${id}.jpg`;

  try {
    await writeTranslations(client, id, toTextItemTranslations(input.translations));

    const { error: detailError } = await client
      .from("picture_item_details")
      .insert({ item_id: id, storage_path: storagePath });
    if (detailError) throw detailError;

    const { error: uploadError } = await client.storage.from(BUCKET).upload(storagePath, resized, {
      upsert: true,
      contentType: "image/jpeg",
    });
    if (uploadError) throw uploadError;
  } catch (err) {
    const { error: deleteError } = await client.from("items").delete().eq("id", id);
    if (deleteError) throw deleteError;
    throw err;
  }

  return { id };
}

export interface CreatePictureItemsInput {
  subsubcategoryId: string;
  difficulty: Difficulty;
  translations: PictureItemTranslations;
  image: Buffer;
}

/**
 * All-or-nothing batch create for the Picture Item bulk import (spec 4,
 * ticket #95). Order: writeItemBatch first (kind "picture", so every base
 * `items` row and its `item_translations` are written or none are, the same
 * as the single-Item createPictureItem above and the Text import's own
 * batch write), then one `picture_item_details` insert for every id
 * (`<id>.jpg`, the same fixed storage path shape createPictureItem uses),
 * then every image resized and uploaded in order (`upsert: true`,
 * `contentType: "image/jpeg"`). If the detail insert or any resize/upload
 * fails, every object already uploaded in this call is removed
 * (`storage.remove`) and all base ids are deleted (cascading away their
 * translations and detail rows, the same as a single failed
 * createPictureItem), then the error is rethrown -- a failure never leaves
 * a partial batch (rows without objects, or objects without rows) behind.
 *
 * The remove and the delete are both attempted regardless of the other's
 * outcome (a failed `storage.remove` must never skip the base-row delete,
 * or a partial upload orphans rows too, Standards review on this ticket's
 * PR): if either the remove or the delete itself fails, the original error
 * alone would hide that failure, so this throws a new Error naming every
 * failure (`{ cause: err }`, the original) instead of discarding it; only
 * when both the remove and the delete succeed is the original `err`
 * rethrown unchanged (writeItemBatch's own compensating-delete failure
 * case, fix round 1 PR #118, is the same reasoning for a single failure).
 */
export async function createPictureItems(
  client: SupabaseClient<Database>,
  inputs: CreatePictureItemsInput[],
): Promise<string[]> {
  const ids = await writeItemBatch(
    client,
    inputs.map((input) => ({
      kind: "picture" as const,
      subsubcategoryId: input.subsubcategoryId,
      difficulty: input.difficulty,
      translations: toTextItemTranslations(input.translations),
    })),
  );

  const uploadedPaths: string[] = [];
  try {
    const detailRows = ids.map((id) => ({ item_id: id, storage_path: `${id}.jpg` }));
    const { error: detailError } = await client.from("picture_item_details").insert(detailRows);
    if (detailError) throw detailError;

    for (let i = 0; i < ids.length; i++) {
      const storagePath = `${ids[i]}.jpg`;
      const resized = await resizeToJpeg(inputs[i].image);
      const { error: uploadError } = await client.storage.from(BUCKET).upload(storagePath, resized, {
        upsert: true,
        contentType: "image/jpeg",
      });
      if (uploadError) throw uploadError;
      uploadedPaths.push(storagePath);
    }
  } catch (err) {
    let removeError: unknown = null;
    if (uploadedPaths.length > 0) {
      const { error } = await client.storage.from(BUCKET).remove(uploadedPaths);
      removeError = error;
    }
    const { error: deleteError } = await client.from("items").delete().in("id", ids);

    if (removeError || deleteError) {
      const originalMessage = err instanceof Error ? err.message : String(err);
      const removeMessage = removeError ? (removeError instanceof Error ? removeError.message : String(removeError)) : "none";
      const deleteMessage = deleteError ? deleteError.message : "none";
      throw new Error(
        `createPictureItems: the batch write failed and the rollback also failed -- an orphaned batch of rows or objects may remain. originalError=${originalMessage}; removeError=${removeMessage}; deleteError=${deleteMessage}`,
        { cause: err },
      );
    }
    throw err;
  }

  return ids;
}

/**
 * Base and translations write unconditionally; the stored object is only
 * touched when `image` is given, and then overwrites the object at the
 * Item's existing `storage_path` (read from the detail row) -- the path
 * itself is never changed, keeping the Item id and past Compositions
 * intact (ticket #90 "What to build").
 */
export async function updatePictureItem(
  client: SupabaseClient<Database>,
  id: string,
  input: UpdatePictureItemInput,
): Promise<{ id: string }> {
  await writeItemBase(client, id, {
    kind: "picture",
    subsubcategoryId: input.subsubcategoryId,
    difficulty: input.difficulty,
  });
  await writeTranslations(client, id, toTextItemTranslations(input.translations));

  if (input.image) {
    const { data: detail, error: detailError } = await client
      .from("picture_item_details")
      .select("storage_path")
      .eq("item_id", id)
      .single();
    if (detailError) throw detailError;

    const resized = await resizeToJpeg(input.image);
    const { error: uploadError } = await client.storage.from(BUCKET).upload(detail.storage_path, resized, {
      upsert: true,
      contentType: "image/jpeg",
    });
    if (uploadError) throw uploadError;
  }

  return { id };
}

/** A short-lived signed URL for the edit page's current-image preview. */
export async function createPictureSignedUrl(
  client: SupabaseClient<Database>,
  storagePath: string,
): Promise<string> {
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(storagePath, 600);
  if (error) throw error;
  return data.signedUrl;
}
