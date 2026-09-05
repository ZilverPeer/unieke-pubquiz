import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildQuizContentFixture } from "@/domain";
import { MUSIC_ROUND_LOUDNESS_TARGET_LUFS, renderMusicRoundMp3, resolveFfmpeg } from "./music-round-mp3";

const TONE_A = join(__dirname, "..", "..", "supabase", "seed-assets", "music-clips", "tone-a.mp3");
const TONE_B = join(__dirname, "..", "..", "supabase", "seed-assets", "music-clips", "tone-b.mp3");
const ANNOUNCEMENTS_ROOT = join(__dirname, "..", "..", "public", "audio", "announcements");
const DURATION_TOLERANCE_SECONDS = 2.0;
const LOUDNESS_TOLERANCE_LU = 3;
// Independent of MUSIC_ROUND_GAP_SECONDS (the value under test) — must match
// the documented gap length in src/render/music-round/README.md.
const EXPECTED_GAP_SECONDS = 1;

function ffprobeDurationSeconds(file: string): number {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(`ffprobe failed on ${file}:\n${result.stderr}`);
  }
  return parseFloat(result.stdout.trim());
}

function measureIntegratedLufs(file: string): number {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", file, "-af", "loudnorm=print_format=json", "-f", "null", "-"],
    { encoding: "utf-8" },
  );
  const stderr = result.stderr ?? "";
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Could not find loudnorm JSON in ffmpeg stderr for ${file}:\n${stderr}`);
  }
  const parsed = JSON.parse(stderr.slice(start, end + 1));
  return parseFloat(parsed.input_i);
}

async function readClip(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path));
}

function announcementSumSeconds(locale: "nl" | "en"): number {
  let total = 0;
  for (let n = 1; n <= 10; n++) {
    total += ffprobeDurationSeconds(join(ANNOUNCEMENTS_ROOT, locale, `${n}.mp3`));
  }
  return total;
}

function looksLikeMp3(buffer: Buffer): boolean {
  if (buffer.length < 3) return false;
  const isId3 = buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33; // "ID3"
  const isFrameSync = buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
  return isId3 || isFrameSync;
}

test("resolveFfmpeg returns either null or paths that respond to -version", () => {
  const resolved = resolveFfmpeg();
  if (resolved === null) {
    expect(resolved).toBeNull();
    return;
  }
  const ffmpegVersion = spawnSync(resolved.ffmpeg, ["-version"]);
  const ffprobeVersion = spawnSync(resolved.ffprobe, ["-version"]);
  expect(ffmpegVersion.status).toBe(0);
  expect(ffprobeVersion.status).toBe(0);
});

describe.skipIf(resolveFfmpeg() === null)("renderMusicRoundMp3 (needs ffmpeg)", () => {
  test("nl fixture with tone-a clips: valid MP3 with duration matching announcements + clips + gaps", async () => {
    const toneABytes = await readClip(TONE_A);
    const quiz = buildQuizContentFixture({ locale: "nl", clip: toneABytes });

    const output = await renderMusicRoundMp3(quiz);

    expect(looksLikeMp3(output)).toBe(true);

    const tmpDir = await mkdtemp(join(tmpdir(), "pubquiz-music-round-test-"));
    try {
      const outputPath = join(tmpDir, "output.mp3");
      await writeFile(outputPath, output);
      const actualDuration = ffprobeDurationSeconds(outputPath);

      const announcementSum = announcementSumSeconds("nl");
      const toneADuration = ffprobeDurationSeconds(TONE_A);
      const expectedDuration = announcementSum + 10 * toneADuration + 10 * EXPECTED_GAP_SECONDS;

      expect(Math.abs(actualDuration - expectedDuration)).toBeLessThanOrEqual(
        DURATION_TOLERANCE_SECONDS,
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);

  test("locale changes the Announcements used, and therefore the output", async () => {
    const toneABytes = await readClip(TONE_A);
    const nlQuiz = buildQuizContentFixture({ locale: "nl", clip: toneABytes });
    const enQuiz = buildQuizContentFixture({ locale: "en", clip: toneABytes });

    const nlOutput = await renderMusicRoundMp3(nlQuiz);
    const enOutput = await renderMusicRoundMp3(enQuiz);

    const nlHash = createHash("sha256").update(nlOutput).digest("hex");
    const enHash = createHash("sha256").update(enOutput).digest("hex");
    expect(nlHash).not.toBe(enHash);

    const tmpDir = await mkdtemp(join(tmpdir(), "pubquiz-music-round-test-"));
    try {
      const nlPath = join(tmpDir, "nl.mp3");
      const enPath = join(tmpDir, "en.mp3");
      await writeFile(nlPath, nlOutput);
      await writeFile(enPath, enOutput);

      const nlDuration = ffprobeDurationSeconds(nlPath);
      const enDuration = ffprobeDurationSeconds(enPath);

      const toneADuration = ffprobeDurationSeconds(TONE_A);
      const nlAnnouncementSum = announcementSumSeconds("nl");
      const enAnnouncementSum = announcementSumSeconds("en");
      const nlExpected = nlAnnouncementSum + 10 * toneADuration + 10 * EXPECTED_GAP_SECONDS;
      const enExpected = enAnnouncementSum + 10 * toneADuration + 10 * EXPECTED_GAP_SECONDS;

      expect(Math.abs(nlDuration - nlExpected)).toBeLessThanOrEqual(DURATION_TOLERANCE_SECONDS);
      expect(Math.abs(enDuration - enExpected)).toBeLessThanOrEqual(DURATION_TOLERANCE_SECONDS);

      if (Math.abs(nlAnnouncementSum - enAnnouncementSum) > 0.5) {
        const expectedDiff = nlExpected - enExpected;
        const actualDiff = nlDuration - enDuration;
        expect(Math.sign(actualDiff)).toBe(Math.sign(expectedDiff));
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);

  test("loudness-normalises clips of differing input levels to within tolerance of the target", async () => {
    // Generate a very quiet clip from tone-a to make normalisation observable.
    const tmpDir = await mkdtemp(join(tmpdir(), "pubquiz-music-round-quiet-"));
    let quietBytes: Uint8Array;
    try {
      const quietPath = join(tmpDir, "quiet.mp3");
      const result = spawnSync("ffmpeg", [
        "-y",
        "-hide_banner",
        "-i",
        TONE_A,
        "-af",
        "volume=-20dB",
        quietPath,
      ]);
      if (result.status !== 0) {
        throw new Error(`Failed to generate quiet fixture: ${result.stderr}`);
      }
      quietBytes = await readClip(quietPath);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }

    // Mix the quiet clip with a normal-level clip (tone-b) across items so
    // both ends of the input-level range go through normalisation together.
    const toneBBytes = await readClip(TONE_B);
    const quiz = buildQuizContentFixture({ locale: "nl", clip: quietBytes });
    const mixedQuiz = {
      ...quiz,
      rounds: quiz.rounds.map((round, index) => {
        if (index !== 7) return round;
        return {
          ...round,
          items: round.items.map((item, position) =>
            position % 2 === 0 ? { ...item, clip: toneBBytes } : item,
          ),
        };
      }),
    };

    const output = await renderMusicRoundMp3(mixedQuiz);

    const outDir = await mkdtemp(join(tmpdir(), "pubquiz-music-round-loudness-"));
    try {
      const outputPath = join(outDir, "output.mp3");
      await writeFile(outputPath, output);
      const integratedLufs = measureIntegratedLufs(outputPath);

      expect(Math.abs(integratedLufs - MUSIC_ROUND_LOUDNESS_TARGET_LUFS)).toBeLessThanOrEqual(
        LOUDNESS_TOLERANCE_LU,
      );
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }, 60_000);

});

// Pre-flight validation happens before ffmpeg is ever spawned, so these run
// unconditionally, independent of whether ffmpeg is available on this machine.
test("throws before invoking ffmpeg on a Round with the wrong number of Items", async () => {
  const quiz = buildQuizContentFixture({ locale: "nl" });
  const musicRound = quiz.rounds[7];
  const brokenQuiz = {
    ...quiz,
    rounds: quiz.rounds.map((round, index) =>
      index === 7 ? { ...musicRound, items: musicRound.items.slice(0, 5) } : round,
    ),
  };

  await expect(renderMusicRoundMp3(brokenQuiz)).rejects.toThrow(/exactly 10 Items/);
});

test("throws before invoking ffmpeg when slot 7 is not a music Round", async () => {
  const quiz = buildQuizContentFixture({ locale: "nl" });
  const textRound = quiz.rounds[0];
  const brokenQuiz = {
    ...quiz,
    rounds: quiz.rounds.map((round, index) => (index === 7 ? textRound : round)),
  };

  await expect(renderMusicRoundMp3(brokenQuiz)).rejects.toThrow(/music Round/);
});
