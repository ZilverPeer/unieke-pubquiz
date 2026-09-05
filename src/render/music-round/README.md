# Music Round MP3 renderer — implementation notes

Private helpers behind `src/render/music-round-mp3.ts` (the only file other
modules import from). See `src/render/README.md` for the module boundary.

## Format

MP3, 44100 Hz, **mono**, 128 kbps CBR (`libmp3lame`) — matching the
committed Announcement assets (`scripts/announcements/README.md`) so the
concat demuxer mixes streams with identical parameters throughout.

## Pipeline

1. Resolve ffmpeg/ffprobe (`ffmpeg.ts`); fail fast if neither is available.
2. Write each Music Item's clip bytes to a temp file, then loudness-normalise
   it with a **single-pass** `loudnorm` (`I=-16:TP=-1.5:LRA=11`, see
   `MUSIC_ROUND_LOUDNESS_TARGET_LUFS`). Two-pass loudnorm (measure, then
   apply) is more accurate but requires probing every clip twice per
   render; single-pass is accepted here as "good enough" for the ±3 LU
   tolerance this renderer targets, and keeps the pipeline to one ffmpeg
   invocation per clip. Announcements are already normalised at generation
   time and are not re-processed.
3. Generate one silence file (`anullsrc`, `MUSIC_ROUND_GAP_SECONDS` long)
   and one normalised clip file per Item, all already in the final mono/
   44100 Hz format.
4. Build a concat-demuxer list interleaving, per Item in slot order: the
   Locale's Announcement for that position (`public/audio/announcements/
   <locale>/<position + 1>.mp3`, resolved from this file's own location via
   `import.meta.url`, never `process.cwd()`), the normalised clip, then the
   silence file.
5. Run the concat demuxer once (`-f concat -safe 0`) with explicit output
   codec/format flags, forcing ffmpeg to decode and re-encode every input
   rather than attempting a stream copy — this is what makes mixing
   differently-sourced MP3s (TTS output, tone fixtures) safe.
6. Read the resulting file into a `Buffer` and always clean up the temp
   directory (`fs.mkdtemp` + `finally`).

Nothing is ever written into the repo tree; all intermediates live under
`os.tmpdir()`.

## Test-only escape hatch

`resolveFfmpeg()` honours `PUBQUIZ_FFMPEG_DISABLE=1` to force it to return
`null` regardless of what's actually on the machine. This exists solely so
`music-round-mp3.test.ts` can prove the "no ffmpeg available" skip path
without needing to actually uninstall ffmpeg or edit `PATH` for a CI run —
set the env var, re-run the test file, and the `describe.skipIf` block
reports as skipped.
