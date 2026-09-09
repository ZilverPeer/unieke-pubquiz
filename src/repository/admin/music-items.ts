/**
 * Music Item writes and the ffmpeg cut (spec 4, ticket #91) -- a sibling of
 * items.ts (admin-common brief "Data access"), the only place this ticket
 * writes music_item_details and the music-clips Storage bucket. Calls
 * writeItemBase/writeTranslations from items.ts for the shared parts; the
 * cut itself goes through resolveFfmpeg/runFfmpeg from
 * src/render/music-round/ffmpeg.ts (the only way this codebase calls
 * ffmpeg -- CONTEXT.md "Music clip", the ticket brief).
 *
 * Music translations carry question = null and answer = null (artist/title
 * in music_item_details serve that role, 00003_items.sql's header); fact
 * is optional. A Locale is "present" for Music only when the operator
 * ticks its checkbox in the form -- unlike Text Items, an empty fact does
 * not by itself mean the Locale is absent.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Difficulty } from "@/domain";
import { resolveFfmpeg, runFfmpeg } from "@/render/music-round/ffmpeg";
import type { Database } from "../database.types";
import { writeItemBase } from "./items";

const MUSIC_CLIPS_BUCKET = "music-clips";

/** How far a cut clip's measured duration may drift from `end - start` before createMusicItem/updateMusicItem throw. */
const CUT_DURATION_TOLERANCE_SECONDS = 0.5;

export interface MusicItemTranslationInput {
  fact?: string;
}

export interface MusicItemTranslations {
  nl?: MusicItemTranslationInput;
  en?: MusicItemTranslationInput;
}

/**
 * Upserts an item_translations row (question/answer null) per ticked
 * Locale, and deletes the row for any Locale not ticked -- the Music
 * analogue of items.ts's writeTranslations, kept separate because the
 * Music shape (no question/answer, presence driven by a checkbox rather
 * than filled-in text) doesn't fit TextItemTranslations' type.
 */
async function writeMusicTranslations(
  client: SupabaseClient<Database>,
  itemId: string,
  translations: MusicItemTranslations,
): Promise<void> {
  for (const locale of ["nl", "en"] as const) {
    const translation = translations[locale];
    if (translation) {
      const { error } = await client
        .from("item_translations")
        .upsert(
          { item_id: itemId, locale, question: null, answer: null, fact: translation.fact ?? null },
          { onConflict: "item_id,locale" },
        );
      if (error) throw error;
    } else {
      const { error } = await client.from("item_translations").delete().eq("item_id", itemId).eq("locale", locale);
      if (error) throw error;
    }
  }
}

/**
 * ffprobe's measured duration of the file at `path`, in seconds. Exported
 * for the integration test (measuring the stored clip after downloading it
 * to a temp copy) and used internally as the post-cut sanity check.
 */
export async function probeDurationSeconds(path: string): Promise<number> {
  const ffprobe = resolveFfmpeg()?.ffprobe ?? "ffprobe";
  // `ffprobe` here is a resolved binary name/path (never project source), so
  // there is nothing for Turbopack's build-time filesystem trace to follow --
  // without this hint it otherwise traces (and bundles) the whole project
  // into the server output for any route that imports this module.
  const result = spawnSync(/* turbopackIgnore: true */ ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    path,
  ], { encoding: "utf-8" });
  if (result.error) {
    throw new Error(`Failed to spawn ffprobe (${ffprobe}): ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`ffprobe exited with status ${result.status} on ${path}:\n${result.stderr}`);
  }
  return parseFloat(result.stdout.trim());
}

/**
 * Cuts `song` (the full uploaded file, any format ffmpeg reads) down to
 * `[startSeconds, endSeconds)` as an MP3 buffer, under a fresh
 * `pubquiz-music-*` temp directory removed in `finally` (no temp file
 * survives the call, ticket #91's fixed decision). Throws if the cut
 * clip's measured duration drifts from the requested length by more than
 * CUT_DURATION_TOLERANCE_SECONDS.
 */
async function cutClip(song: Buffer, startSeconds: number, endSeconds: number): Promise<Uint8Array> {
  const ffmpegPaths = resolveFfmpeg();
  if (!ffmpegPaths) {
    throw new Error("cutClip requires a working ffmpeg/ffprobe; resolveFfmpeg() returned null");
  }
  const { ffmpeg } = ffmpegPaths;

  const tmpDir = await mkdtemp(join(tmpdir(), "pubquiz-music-"));
  try {
    const inputPath = join(tmpDir, "input");
    await writeFile(inputPath, song);

    // -ss before -i (fast input seeking) shifts the output's own timeline
    // back to 0 at the seek point, so the stop point has to be given as a
    // duration (-t, relative to that shifted 0) rather than -to (which
    // would be read as 25s *of the shifted timeline*, i.e. up to
    // start+25s, not the requested end -- caught by the sanity check
    // below during development).
    const expectedSeconds = endSeconds - startSeconds;
    const outputPath = join(tmpDir, "output.mp3");
    runFfmpeg(ffmpeg, [
      "-ss",
      String(startSeconds),
      "-i",
      inputPath,
      "-t",
      String(expectedSeconds),
      "-vn",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      outputPath,
    ]);

    const actualSeconds = await probeDurationSeconds(outputPath);
    if (Math.abs(actualSeconds - expectedSeconds) > CUT_DURATION_TOLERANCE_SECONDS) {
      throw new Error(
        `Cut clip duration ${actualSeconds}s does not match the requested ${expectedSeconds}s ` +
          `(start ${startSeconds}, end ${endSeconds})`,
      );
    }

    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export interface CreateMusicItemInput {
  subsubcategoryId: string;
  difficulty: Difficulty;
  artist: string;
  title: string;
  translations: MusicItemTranslations;
  song: Buffer;
  startSeconds: number;
  endSeconds: number;
}

/**
 * Creates a Music Item: writes the base row, the translation row(s) and
 * the music_item_details row first, then cuts and uploads the clip
 * (upsert: true) at `<itemId>.mp3` -- see the ticket brief's ordering. If
 * the cut or the upload throws, the Item row (and, via ON DELETE CASCADE,
 * its translations and detail row) is deleted so nothing dangles.
 */
export async function createMusicItem(
  client: SupabaseClient<Database>,
  input: CreateMusicItemInput,
): Promise<{ id: string }> {
  const id = await writeItemBase(client, null, {
    kind: "music",
    subsubcategoryId: input.subsubcategoryId,
    difficulty: input.difficulty,
  });

  try {
    await writeMusicTranslations(client, id, input.translations);

    const storagePath = `${id}.mp3`;
    const { error: detailError } = await client
      .from("music_item_details")
      .insert({ item_id: id, storage_path: storagePath, artist: input.artist, title: input.title });
    if (detailError) throw detailError;

    const clip = await cutClip(input.song, input.startSeconds, input.endSeconds);
    const { error: uploadError } = await client.storage
      .from(MUSIC_CLIPS_BUCKET)
      .upload(storagePath, clip, { contentType: "audio/mpeg", upsert: true });
    if (uploadError) throw uploadError;

    return { id };
  } catch (error) {
    await client.from("items").delete().eq("id", id);
    throw error;
  }
}

export interface UpdateMusicItemInput {
  subsubcategoryId: string;
  difficulty: Difficulty;
  artist: string;
  title: string;
  translations: MusicItemTranslations;
  /** Given only when the operator uploaded a new song to re-cut; omitted, the stored clip is left untouched. */
  song?: Buffer;
  startSeconds?: number;
  endSeconds?: number;
}

/**
 * Updates a Music Item's base row, detail row (artist/title) and
 * translations unconditionally; when `song` is given, re-cuts it and
 * overwrites the object at the Item's existing storage_path (upsert:
 * true), keeping the Item id and storage path unchanged.
 */
export async function updateMusicItem(
  client: SupabaseClient<Database>,
  id: string,
  input: UpdateMusicItemInput,
): Promise<{ id: string }> {
  await writeItemBase(client, id, {
    kind: "music",
    subsubcategoryId: input.subsubcategoryId,
    difficulty: input.difficulty,
  });
  await writeMusicTranslations(client, id, input.translations);

  const { error: detailError } = await client
    .from("music_item_details")
    .update({ artist: input.artist, title: input.title })
    .eq("item_id", id);
  if (detailError) throw detailError;

  if (input.song) {
    if (input.startSeconds === undefined || input.endSeconds === undefined) {
      throw new Error("updateMusicItem: startSeconds and endSeconds are required when song is given");
    }

    const { data: detail, error: readError } = await client
      .from("music_item_details")
      .select("storage_path")
      .eq("item_id", id)
      .single();
    if (readError) throw readError;

    const clip = await cutClip(input.song, input.startSeconds, input.endSeconds);
    const { error: uploadError } = await client.storage
      .from(MUSIC_CLIPS_BUCKET)
      .upload(detail.storage_path, clip, { contentType: "audio/mpeg", upsert: true });
    if (uploadError) throw uploadError;
  }

  return { id };
}

/** A 10-minute signed URL for the stored clip, for the edit page's `<audio>` playback. */
export async function createMusicSignedUrl(client: SupabaseClient<Database>, storagePath: string): Promise<string> {
  const { data, error } = await client.storage.from(MUSIC_CLIPS_BUCKET).createSignedUrl(storagePath, 600);
  if (error) throw error;
  return data.signedUrl;
}
