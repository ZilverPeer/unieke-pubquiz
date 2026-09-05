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
