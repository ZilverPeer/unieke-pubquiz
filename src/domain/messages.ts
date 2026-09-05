import type { Locale } from "./types";
import type { MessageKey } from "./messages/keys";
import en from "./messages/en";
import nl from "./messages/nl";

export type { MessageKey } from "./messages/keys";

const catalogs: Record<Locale, Record<MessageKey, string>> = { nl, en };

/**
 * Looks up a round heading or Deliverable label for the given Locale.
 * Locale is data, not code: never branch on `nl`/`en` in calling code —
 * call this instead and let generation fail loudly if a translation is missing.
 */
export function message(locale: Locale, key: MessageKey): string {
  const catalog = catalogs[locale];
  if (!catalog || !(key in catalog)) {
    throw new Error(`No message for key "${key}" in locale "${locale}"`);
  }
  return catalog[key];
}
