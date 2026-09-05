# Announcements

The 20 spoken track-number Announcements used by the Music Round renderer
("Nummer 1".."Nummer 10" in Dutch, "Track 1".."Track 10" in English).

These files are **static app assets (code), not Content**. They are generated
once by this script and committed to the repo, not produced at runtime, and
not customer-facing quiz content. See `.gitignore`'s `!public/audio/**`
whitelist and `CLAUDE.md`'s "Content never enters git" rule.

## Output

```
public/audio/announcements/<locale>/<n>.mp3
```

- `<locale>`: `nl`, `en`
- `<n>`: `1`..`10` (no zero padding)

## Format

- MP3, 44100 Hz, mono, 128 kbps CBR (`libmp3lame`)
- Loudness-normalised to -16 LUFS integrated (EBU R128, ffmpeg `loudnorm`,
  two-pass: a first pass measures the source, a second pass applies the
  filter with the measured values so the target is hit precisely rather than
  approximated)
- Leading/trailing silence trimmed (ffmpeg `silenceremove`), then ~100 ms of
  silence padding re-added at both ends (`adelay` + `apad`) so playback
  doesn't click
- Each file ends up roughly 1-2 seconds long

## Voice and service

Microsoft Edge's neural "Read Aloud" text-to-speech, accessed with no API
key via the `msedge-tts` npm package (a devDependency here, not a runtime
dependency — see "No runtime TTS" below):

- Dutch: `nl-NL-FennaNeural`
- English: `en-GB-SoniaNeural` (a natural British English voice; any other
  `en-*-*Neural` voice from the Edge voice list would also work)

This is free with no recurring cost and no account/API key, satisfying the
"no new recurring cost" constraint. It is an undocumented Microsoft
consumer-facing API (the same one Edge's browser "Read Aloud" feature uses),
which is why it is only ever run as a one-off local script, not at runtime
against the live app.

## Regenerating

```
npm run announcements:generate
```

This requires `ffmpeg` and `ffprobe` on `PATH`. It regenerates all 20 files
from scratch, overwriting whatever is in `public/audio/announcements/`, and
prints a table of each file's duration and measured integrated loudness.

## Verifying without regenerating

```
npm run announcements:generate -- --verify
```

Uses `ffprobe` to assert that:

- all 20 files exist and are non-empty
- they all share the same codec, sample rate, and channel layout
- each file is between 0.5 and 2.5 seconds long

Exits non-zero and prints the offending file(s) if any check fails. This is
the acceptance check for this ticket; there are no Vitest tests for these
generated binary assets.

## No runtime TTS

This script is run once, locally, whenever the announcement texts or voices
change. The app never calls a text-to-speech service — the Music Round
renderer only ever plays back the committed files above.
