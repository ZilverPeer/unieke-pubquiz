/**
 * Generates the 20 Announcement audio files ("Nummer 1".."Nummer 10" in nl,
 * "Track 1".."Track 10" in en) used by the Music Round renderer.
 *
 * One-off script: no runtime text-to-speech. Regenerate with:
 *   npm run announcements:generate
 * Verify existing output without regenerating:
 *   npm run announcements:generate -- --verify
 *
 * See scripts/announcements/README.md for the voice, service, and format decisions.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, existsSync, statSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

type Locale = "nl" | "en";

const LOCALES: Record<Locale, { voice: string; text: (n: number) => string }> = {
  nl: { voice: "nl-NL-FennaNeural", text: (n) => `Nummer ${n}` },
  en: { voice: "en-GB-SoniaNeural", text: (n) => `Track ${n}` },
};

const COUNT = 10;
const SAMPLE_RATE = 44100;
const CHANNELS = 1;
const BITRATE = "128k";
const TARGET_LUFS = -16;
const TARGET_TP = -1.5;
const TARGET_LRA = 11;
const PAD_SECONDS = 0.1;
const SILENCE_THRESHOLD_DB = -40;

const OUTPUT_ROOT = join(__dirname, "..", "..", "public", "audio", "announcements");

interface LoudnormMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

interface FileReport {
  locale: Locale;
  n: number;
  path: string;
  durationSeconds: number;
  integratedLufs: number;
}

function runFfmpeg(args: string[]): { stdout: string; stderr: string } {
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", ...args], {
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (args: ${args.join(" ")}):\n${result.stderr}`);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function runFfprobe(args: string[]): string {
  const result = spawnSync("ffprobe", ["-hide_banner", ...args], {
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`ffprobe failed (args: ${args.join(" ")}):\n${result.stderr}`);
  }
  return result.stdout ?? "";
}

function extractLoudnormJson(stderr: string): LoudnormMeasurement {
  // loudnorm's print_format=json writes a JSON blob to stderr, sandwiched
  // between other ffmpeg log lines.
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Could not find loudnorm JSON in ffmpeg stderr:\n${stderr}`);
  }
  return JSON.parse(stderr.slice(start, end + 1));
}

async function synthesize(voice: string, text: string, outFile: string): Promise<void> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const dir = dirname(outFile);
  const { audioFilePath } = await tts.toFile(dir, text);
  // msedge-tts names the file after the text; move it to our expected path.
  if (audioFilePath !== outFile) {
    renameSync(audioFilePath, outFile);
  }
}

function trimSilence(rawMp3: string, trimmedWav: string): void {
  // Trim only leading/trailing silence (not mid-word pauses, e.g. between
  // "Nummer" and "1"). silenceremove's stop_periods only removes trailing
  // silence when set to 0 (disabled) on the forward pass, so trailing
  // silence is trimmed by reversing, trimming "leading" silence again, and
  // reversing back.
  const leadingTrimFilter =
    `silenceremove=start_periods=1:start_duration=0:` +
    `start_threshold=${SILENCE_THRESHOLD_DB}dB:start_silence=0:stop_periods=0`;
  const filter = `${leadingTrimFilter},areverse,${leadingTrimFilter},areverse`;
  runFfmpeg(["-i", rawMp3, "-af", filter, trimmedWav]);
}

function measureLoudness(trimmedWav: string): LoudnormMeasurement {
  const filter = `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:print_format=json`;
  const { stderr } = runFfmpeg(["-i", trimmedWav, "-af", filter, "-f", "null", "-"]);
  return extractLoudnormJson(stderr);
}

function applyLoudnormAndEncode(
  trimmedWav: string,
  measurement: LoudnormMeasurement,
  outputMp3: string,
): void {
  const filter =
    `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:` +
    `measured_I=${measurement.input_i}:measured_TP=${measurement.input_tp}:` +
    `measured_LRA=${measurement.input_lra}:measured_thresh=${measurement.input_thresh}:` +
    `offset=${measurement.target_offset}:linear=true,` +
    `adelay=${Math.round(PAD_SECONDS * 1000)}:all=1,` +
    `apad=pad_dur=${PAD_SECONDS}`;
  runFfmpeg([
    "-i",
    trimmedWav,
    "-af",
    filter,
    "-ar",
    String(SAMPLE_RATE),
    "-ac",
    String(CHANNELS),
    "-c:a",
    "libmp3lame",
    "-b:a",
    BITRATE,
    outputMp3,
  ]);
}

function probeDurationSeconds(file: string): number {
  const out = runFfprobe([
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  return parseFloat(out.trim());
}

async function generateOne(locale: Locale, n: number, tmpDir: string): Promise<FileReport> {
  const { voice, text } = LOCALES[locale];
  const spoken = text(n);
  const rawMp3 = join(tmpDir, `${locale}-${n}-raw.mp3`);
  const trimmedWav = join(tmpDir, `${locale}-${n}-trimmed.wav`);
  const outDir = join(OUTPUT_ROOT, locale);
  const outputMp3 = join(outDir, `${n}.mp3`);

  mkdirSync(outDir, { recursive: true });

  await synthesize(voice, spoken, rawMp3);
  trimSilence(rawMp3, trimmedWav);
  const measurement = measureLoudness(trimmedWav);
  applyLoudnormAndEncode(trimmedWav, measurement, outputMp3);

  const durationSeconds = probeDurationSeconds(outputMp3);
  const finalMeasurement = measureLoudness(outputMp3);

  return {
    locale,
    n,
    path: outputMp3,
    durationSeconds,
    integratedLufs: parseFloat(finalMeasurement.input_i),
  };
}

async function generateAll(): Promise<FileReport[]> {
  const tmpDir = mkdtempSync(join(tmpdir(), "pubquiz-announcements-"));
  try {
    const reports: FileReport[] = [];
    for (const locale of Object.keys(LOCALES) as Locale[]) {
      for (let n = 1; n <= COUNT; n++) {
        console.log(`Generating ${locale}/${n}.mp3 ("${LOCALES[locale].text(n)}")...`);
        const report = await generateOne(locale, n, tmpDir);
        reports.push(report);
      }
    }
    return reports;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

interface ProbeInfo {
  durationSeconds: number;
  sampleRate: string;
  channels: string;
  codecName: string;
}

function probeFile(file: string): ProbeInfo {
  const out = runFfprobe([
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=sample_rate,channels,codec_name:format=duration",
    "-of",
    "json",
    file,
  ]);
  const parsed = JSON.parse(out);
  const stream = parsed.streams[0];
  return {
    durationSeconds: parseFloat(parsed.format.duration),
    sampleRate: String(stream.sample_rate),
    channels: String(stream.channels),
    codecName: String(stream.codec_name),
  };
}

function verify(): boolean {
  let ok = true;
  const infos: Array<{ locale: Locale; n: number; info: ProbeInfo }> = [];

  for (const locale of Object.keys(LOCALES) as Locale[]) {
    for (let n = 1; n <= COUNT; n++) {
      const file = join(OUTPUT_ROOT, locale, `${n}.mp3`);
      if (!existsSync(file)) {
        console.error(`MISSING: ${file}`);
        ok = false;
        continue;
      }
      const stat = statSync(file);
      if (stat.size === 0) {
        console.error(`EMPTY FILE: ${file}`);
        ok = false;
        continue;
      }
      const info = probeFile(file);
      infos.push({ locale, n, info });
      if (info.durationSeconds < 0.5 || info.durationSeconds > 2.5) {
        console.error(
          `DURATION OUT OF RANGE: ${file} is ${info.durationSeconds.toFixed(2)}s (expected 0.5-2.5s)`,
        );
        ok = false;
      }
    }
  }

  if (infos.length > 0) {
    const first = infos[0].info;
    for (const { locale, n, info } of infos) {
      if (
        info.sampleRate !== first.sampleRate ||
        info.channels !== first.channels ||
        info.codecName !== first.codecName
      ) {
        console.error(
          `FORMAT MISMATCH: ${locale}/${n}.mp3 is ${info.codecName} ${info.sampleRate}Hz ` +
            `${info.channels}ch, expected ${first.codecName} ${first.sampleRate}Hz ${first.channels}ch`,
        );
        ok = false;
      }
    }
  }

  const expectedCount = Object.keys(LOCALES).length * COUNT;
  if (infos.length !== expectedCount) {
    console.error(`Expected ${expectedCount} files, found ${infos.length} valid files.`);
    ok = false;
  }

  console.log("\nVerification results:");
  console.log("locale\tn\tduration(s)\tsampleRate\tchannels\tcodec");
  for (const { locale, n, info } of infos) {
    console.log(
      `${locale}\t${n}\t${info.durationSeconds.toFixed(3)}\t${info.sampleRate}\t${info.channels}\t${info.codecName}`,
    );
  }

  console.log(ok ? "\nVerification PASSED" : "\nVerification FAILED");
  return ok;
}

async function main() {
  const verifyOnly = process.argv.includes("--verify");

  if (verifyOnly) {
    const ok = verify();
    process.exit(ok ? 0 : 1);
  }

  const reports = await generateAll();

  console.log("\nGenerated files:");
  console.log("locale\tn\tduration(s)\tintegrated LUFS");
  for (const report of reports) {
    console.log(
      `${report.locale}\t${report.n}\t${report.durationSeconds.toFixed(3)}\t${report.integratedLufs.toFixed(1)}`,
    );
  }

  const ok = verify();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
