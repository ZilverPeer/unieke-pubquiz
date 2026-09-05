import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { MusicItemContent, QuizContent } from "@/domain";
import { ITEMS_PER_SLOT } from "@/domain";
import { resolveFfmpeg, runFfmpeg } from "./music-round/ffmpeg";

export { resolveFfmpeg };

/** Integrated loudness target (LUFS) every clip is normalised to before mixing. */
export const MUSIC_ROUND_LOUDNESS_TARGET_LUFS = -16;
/** Silence inserted after each clip, in seconds. */
export const MUSIC_ROUND_GAP_SECONDS = 1;

const LOUDNORM_TP = -1.5;
const LOUDNORM_LRA = 11;
const SAMPLE_RATE = 44100;
const CHANNELS = 1;
const BITRATE = "128k";

/** The Music Round is slot index 7 (see domain/types.ts SLOT_KINDS). */
const MUSIC_ROUND_SLOT_INDEX = 7;

/** Repo-root-relative path to the committed Announcement assets, resolved from this file's location, not process.cwd(). */
function announcementsRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // src/render/music-round-mp3.ts -> repo root is two levels up.
  const repoRoot = join(dirname(thisFile), "..", "..");
  return join(repoRoot, "public", "audio", "announcements");
}

function announcementPath(locale: string, position: number): string {
  return join(announcementsRoot(), locale, `${position + 1}.mp3`);
}

/** The shared output format flags (44100 Hz mono 128 kbps CBR libmp3lame), appended to every ffmpeg call that produces audio for the final concat. */
function outputFormatArgs(): string[] {
  return ["-ar", String(SAMPLE_RATE), "-ac", String(CHANNELS), "-c:a", "libmp3lame", "-b:a", BITRATE];
}

function assertRenderableMusicRound(quiz: QuizContent): readonly MusicItemContent[] {
  const round = quiz.rounds[MUSIC_ROUND_SLOT_INDEX];
  if (!round || round.kind !== "music") {
    throw new Error(
      `Music Round MP3 renderer requires slot ${MUSIC_ROUND_SLOT_INDEX} to be a music Round, ` +
        `got kind "${round?.kind ?? "undefined"}"`,
    );
  }
  if (round.items.length !== ITEMS_PER_SLOT) {
    throw new Error(
      `Music Round must have exactly ${ITEMS_PER_SLOT} Items, got ${round.items.length}`,
    );
  }
  for (const item of round.items) {
    if (item.kind !== "music") {
      throw new Error(`Music Round contains a non-music Item (kind "${item.kind}")`);
    }
  }
  return round.items as readonly MusicItemContent[];
}

/** Loudness-normalises one clip's bytes into a fresh MP3 file (single-pass loudnorm). */
function normalizeClip(ffmpeg: string, inputPath: string, outputPath: string): void {
  const filter =
    `loudnorm=I=${MUSIC_ROUND_LOUDNESS_TARGET_LUFS}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}`;
  runFfmpeg(ffmpeg, ["-i", inputPath, "-af", filter, ...outputFormatArgs(), outputPath]);
}

/** Re-encodes a file (e.g. generated gap silence) to the shared output format so the concat demuxer mixes matching streams. */
function reencode(ffmpeg: string, inputArgs: string[], outputPath: string): void {
  runFfmpeg(ffmpeg, [...inputArgs, ...outputFormatArgs(), outputPath]);
}

function escapeConcatPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

/**
 * Renders the Music Round MP3 (slot 7): for each of the 10 Music Items, the
 * Locale's Announcement for its position, then the loudness-normalised
 * clip, then MUSIC_ROUND_GAP_SECONDS of silence, all concatenated into one
 * MP3 at 44100 Hz mono, 128 kbps CBR libmp3lame.
 *
 * See src/render/music-round/README.md for format and implementation notes.
 */
export async function renderMusicRoundMp3(quiz: QuizContent): Promise<Buffer> {
  const items = assertRenderableMusicRound(quiz);

  const ffmpegPaths = resolveFfmpeg();
  if (!ffmpegPaths) {
    throw new Error(
      "renderMusicRoundMp3 requires a working ffmpeg/ffprobe; resolveFfmpeg() returned null",
    );
  }
  const { ffmpeg } = ffmpegPaths;

  const tmpDir = await mkdtemp(join(tmpdir(), "pubquiz-music-round-"));
  try {
    const gapPath = join(tmpDir, "gap.mp3");
    reencode(
      ffmpeg,
      [
        "-f",
        "lavfi",
        "-i",
        `anullsrc=r=${SAMPLE_RATE}:cl=mono`,
        "-t",
        String(MUSIC_ROUND_GAP_SECONDS),
      ],
      gapPath,
    );

    const concatEntries: string[] = [];

    for (let position = 0; position < items.length; position++) {
      const item = items[position];

      const rawClipPath = join(tmpDir, `clip-${position}-raw.mp3`);
      await writeFile(rawClipPath, item.clip);

      const normalizedClipPath = join(tmpDir, `clip-${position}-normalized.mp3`);
      normalizeClip(ffmpeg, rawClipPath, normalizedClipPath);

      concatEntries.push(announcementPath(quiz.locale, position));
      concatEntries.push(normalizedClipPath);
      concatEntries.push(gapPath);
    }

    const listPath = join(tmpDir, "concat-list.txt");
    const listContents = concatEntries.map((path) => `file '${escapeConcatPath(path)}'`).join("\n");
    await writeFile(listPath, listContents, "utf-8");

    const outputPath = join(tmpDir, "output.mp3");
    runFfmpeg(ffmpeg, [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      ...outputFormatArgs(),
      outputPath,
    ]);

    return await readFile(outputPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
