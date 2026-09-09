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
import { writeItemBase, writeTranslations, type TextItemTranslations } from "./items";

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
 * Resizes to at most PICTURE_MAX_EDGE_PX on the longest edge (`fit:
 * "inside"`, `withoutEnlargement: true` -- a smaller source is never
 * upscaled) and re-encodes as JPEG quality 85. `sharp(...).metadata()`
 * throws first on bytes that are not a real image, translated to
 * PictureNotAnImageError so the caller does not have to know sharp's own
 * error shape.
 */
async function resizeToJpeg(image: Buffer): Promise<Buffer> {
  try {
    await sharp(image).metadata();
  } catch {
    throw new PictureNotAnImageError();
  }
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
