/**
 * Public types for the content repository seam. See src/repository/README.md.
 */
import type { PoolItem } from "@/domain";

export interface ItemTranslation {
  question: string | null;
  answer: string | null;
  fact: string | null;
}

export interface PoolEntry {
  /** ids as strings (bigint ids stringified, uuid as-is). */
  item: PoolItem;
  /** The requested Locale's translation row. */
  translation: ItemTranslation;
  /** Category name in the requested Locale. */
  categoryName: string;
  picture?: { storagePath: string };
  music?: { storagePath: string; artist: string; title: string };
}
