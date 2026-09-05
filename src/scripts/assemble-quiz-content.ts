/**
 * Resolves a sampled Composition to a QuizContent, the render seam's input.
 * Pure apart from the injected `downloads` boundary (Storage reads live in
 * the repository; this module only calls the two functions it's handed).
 * A translation field a kind needs but doesn't have is a hard error -- never
 * a fallback (see CONTEXT.md "Locale is data, not code").
 */
import type {
  Composition,
  ItemContent,
  Locale,
  MusicItemContent,
  PictureItemContent,
  QuizContent,
  RoundContent,
  TextItemContent,
} from "@/domain";
import { SLOT_KINDS } from "@/domain";
import type { PoolEntry } from "@/repository";

export interface QuizContentDownloads {
  picture(storagePath: string): Promise<Uint8Array>;
  music(storagePath: string): Promise<Uint8Array>;
}

async function buildItemContent(
  entry: PoolEntry,
  downloads: QuizContentDownloads,
): Promise<ItemContent> {
  const { item, translation } = entry;

  if (item.kind === "text") {
    if (!translation.question) {
      throw new Error(`Text Item "${item.id}" has no question translation`);
    }
    if (!translation.answer) {
      throw new Error(`Text Item "${item.id}" has no answer translation`);
    }
    const content: TextItemContent = {
      id: item.id,
      kind: "text",
      question: translation.question,
      answer: translation.answer,
    };
    if (translation.fact) content.fact = translation.fact;
    return content;
  }

  if (item.kind === "picture") {
    if (!translation.answer) {
      throw new Error(`Picture Item "${item.id}" has no answer translation`);
    }
    if (!entry.picture) {
      throw new Error(`Picture Item "${item.id}" has no picture detail row`);
    }
    const image = await downloads.picture(entry.picture.storagePath);
    const content: PictureItemContent = {
      id: item.id,
      kind: "picture",
      answer: translation.answer,
      image,
    };
    if (translation.fact) content.fact = translation.fact;
    return content;
  }

  // Music
  if (!entry.music) {
    throw new Error(`Music Item "${item.id}" has no music detail row`);
  }
  const clip = await downloads.music(entry.music.storagePath);
  const content: MusicItemContent = {
    id: item.id,
    kind: "music",
    artist: entry.music.artist,
    title: entry.music.title,
    clip,
  };
  if (translation.fact) content.fact = translation.fact;
  return content;
}

/**
 * Builds a complete QuizContent from a sampled Composition, the requested
 * Locale, and the pool entries (keyed by Item id) it was sampled from.
 * `downloads` fetches Picture/Music bytes lazily, only for the Items
 * actually in the Composition.
 */
export async function assembleQuizContent(
  composition: Composition,
  locale: Locale,
  entriesById: ReadonlyMap<string, PoolEntry>,
  downloads: QuizContentDownloads,
): Promise<QuizContent> {
  const rounds: RoundContent[] = [];

  for (let slotIndex = 0; slotIndex < composition.slots.length; slotIndex++) {
    const itemIds = composition.slots[slotIndex];
    const items: ItemContent[] = [];
    let categoryName: string | undefined;

    for (const itemId of itemIds) {
      const entry = entriesById.get(itemId);
      if (!entry) {
        throw new Error(`No pool entry for Item id "${itemId}" (slot ${slotIndex})`);
      }
      categoryName ??= entry.categoryName;
      items.push(await buildItemContent(entry, downloads));
    }

    rounds.push({
      slotIndex,
      kind: SLOT_KINDS[slotIndex],
      categoryName: categoryName ?? "",
      items,
    });
  }

  return { locale, rounds };
}
