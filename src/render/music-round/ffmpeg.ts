/**
 * Binary resolution and process spawning for the Music Round MP3 renderer.
 * Never imported outside src/render/music-round-mp3.ts and this directory.
 */
import { spawnSync } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

export interface FfmpegPaths {
  ffmpeg: string;
  ffprobe: string;
}

/** Runs `<bin> -version` and reports whether it exits cleanly. */
function respondsToVersion(bin: string): boolean {
  const result = spawnSync(bin, ["-version"]);
  return result.error === undefined && result.status === 0;
}

/**
 * Resolves working ffmpeg/ffprobe binaries, or null if none are available.
 *
 * Prefers the `ffmpeg-static` binary for ffmpeg (falling back to `ffmpeg` on
 * PATH if the static binary isn't available for this platform/arch), and
 * always uses `ffprobe` on PATH (ffmpeg-static ships no ffprobe binary).
 *
 * Honours `PUBQUIZ_FFMPEG_DISABLE=1` to force null, purely for tests that
 * need to exercise the "no ffmpeg available" skip path without actually
 * removing ffmpeg from the machine.
 */
export function resolveFfmpeg(): FfmpegPaths | null {
  if (process.env.PUBQUIZ_FFMPEG_DISABLE === "1") {
    return null;
  }

  const staticCandidate = ffmpegStatic as unknown as string | null;
  let ffmpegCandidate: string | null = null;
  if (staticCandidate && respondsToVersion(staticCandidate)) {
    ffmpegCandidate = staticCandidate;
  } else if (respondsToVersion("ffmpeg")) {
    ffmpegCandidate = "ffmpeg";
  }
  if (!ffmpegCandidate) {
    return null;
  }

  const ffprobeCandidate = "ffprobe";
  if (!respondsToVersion(ffprobeCandidate)) {
    return null;
  }

  return { ffmpeg: ffmpegCandidate, ffprobe: ffprobeCandidate };
}

/** Runs ffmpeg with the given args, throwing ffmpeg's stderr on failure. */
export function runFfmpeg(ffmpegPath: string, args: string[]): string {
  const result = spawnSync(ffmpegPath, ["-y", "-hide_banner", ...args], {
    encoding: "utf-8",
    maxBuffer: 1024 * 1024 * 64,
  });
  if (result.error) {
    throw new Error(`Failed to spawn ffmpeg (${ffmpegPath}): ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg exited with status ${result.status} (args: ${args.join(" ")}):\n${result.stderr}`,
    );
  }
  return result.stderr ?? "";
}
