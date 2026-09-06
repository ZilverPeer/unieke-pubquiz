const MAX_UNBROKEN_RUN = 14;

/**
 * @react-pdf/renderer's default hyphenation only inserts break points inside
 * words its heuristic recognises; a long run with no such points (a long
 * technical term, an all-caps abbreviation, ...) is laid out as one
 * unbreakable line that overflows the page's right edge instead of wrapping.
 * Falls back to forcing a break every MAX_UNBROKEN_RUN characters so any
 * Category name wraps within the page width. Pass this as a Text
 * component's `hyphenationCallback` prop.
 */
export function wrapLongRuns(word: string, builtinHyphenate?: (word: string) => string[]): string[] {
  const parts = builtinHyphenate ? builtinHyphenate(word) : [word];
  if (parts.length > 1 || word.length <= MAX_UNBROKEN_RUN) return parts;

  const chunks: string[] = [];
  for (let i = 0; i < word.length; i += MAX_UNBROKEN_RUN) {
    chunks.push(word.slice(i, i + MAX_UNBROKEN_RUN));
  }
  return chunks;
}
