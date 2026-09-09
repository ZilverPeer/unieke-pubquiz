/**
 * Render input: a Composition resolved to the Items' full content for one
 * Locale. Produced by the composer (scripts) from repository data; consumed
 * by every renderer. Renderers never see storage paths or database rows.
 */
import type { ItemKind, Locale } from "./types";

export interface TextItemContent {
  id: string;
  kind: "text";
  question: string;
  answer: string;
  fact?: string;
}

export interface PictureItemContent {
  id: string;
  kind: "picture";
  answer: string;
  fact?: string;
  /** Encoded image bytes (PNG or JPEG) as stored in the pictures bucket. */
  image: Uint8Array;
}

export interface MusicItemContent {
  id: string;
  kind: "music";
  /** Language-neutral, not translated. */
  artist: string;
  title: string;
  fact?: string;
  /** Encoded MP3 bytes of the pre-cut clip as stored in the music-clips bucket. */
  clip: Uint8Array;
}

export type ItemContent = TextItemContent | PictureItemContent | MusicItemContent;

/** One Round slot of a Composition with its Items in position order. */
export interface RoundContent {
  /** 0-7, matches Composition.slots and SLOT_KINDS. */
  slotIndex: number;
  kind: ItemKind;
  /** The slot's Category name in the Quiz Locale, used as the round title. */
  categoryName: string;
  /** Exactly ITEMS_PER_SLOT Items, all of `kind`. */
  items: readonly ItemContent[];
}

/** A whole Quiz ready to render: 8 Rounds in slot order, all in one Locale. */
export interface QuizContent {
  locale: Locale;
  rounds: readonly RoundContent[];
}

// --- Admin: Music Item constants (spec 4, ticket #91) -----------------------
// Fixed bounds for the operator-chosen clip cut (CONTEXT.md "Music clip"):
// the clip length after cutting must fall within this range, and the
// uploaded full song may be at most MUSIC_UPLOAD_MAX_BYTES before cutting.

/** Shortest allowed Music clip length after cutting, in seconds. */
export const MUSIC_CLIP_MIN_SECONDS = 10;
/** Longest allowed Music clip length after cutting, in seconds. */
export const MUSIC_CLIP_MAX_SECONDS = 45;
/** Largest accepted upload for the full song, in bytes, before cutting. */
export const MUSIC_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Maximum long edge, in pixels, a Picture Item's uploaded image is resized
 * to on the server before storage (spec 4, ticket #90; admin-common brief
 * "Domain constants"). Keeps Storage within the free tier and PDFs
 * rendering at the same quality regardless of the source upload's size.
 */
export const PICTURE_MAX_EDGE_PX = 1600;
