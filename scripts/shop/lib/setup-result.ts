/**
 * Pure parsing of setup-shop.php's single line of JSON on stdout. Kept in its
 * own module, with no imports of wp-cli/mailpit/anything that talks to a
 * running shop, so `scripts/shop/setup.test.ts` can import it without also
 * pulling in (and running) `setup.ts`'s top-level `main()` call.
 */
export interface SetupResult {
  productId: number;
  webhookId: number;
  deliveryUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

const INTEGER_KEYS: ReadonlyArray<keyof SetupResult> = ["productId", "webhookId"];
const STRING_KEYS: ReadonlyArray<keyof SetupResult> = ["deliveryUrl", "consumerKey", "consumerSecret"];

/** True for a positive integer (`Number.isInteger` and `> 0`) -- ids setup-shop.php returns are always WordPress/WooCommerce post/webhook ids, never 0 or negative. */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** `typeof`, with `null` and `array` told apart from a plain `object` -- used only in error messages, never the value itself, which may be a credential. */
function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * A safe-to-log summary of one line of setup-shop.php's stdout, for the
 * "wrong number of lines" error only: the one line that's the actual JSON
 * result (and so may contain WOOCOMMERCE_CONSUMER_SECRET) is never shown --
 * only lines that don't parse as JSON (i.e. genuine diagnostic lines that
 * broke the "one JSON line on stdout" contract) get a truncated preview.
 */
function summarizeLine(line: string): string {
  try {
    JSON.parse(line);
    return "<valid JSON, omitted>";
  } catch {
    return line.length > 80 ? `${line.slice(0, 80)}…` : line;
  }
}

/**
 * Parses setup-shop.php's stdout: exactly one non-empty line of JSON with
 * every key in {@link SetupResult}, each of the right shape (`productId`/
 * `webhookId` positive integers, the rest non-empty strings). Throws with
 * the offending key (and, for a shape mismatch, the received `typeof`)
 * named in the message on anything else -- extra diagnostic lines, a
 * missing/malformed key, or invalid JSON -- since that means setup-shop.php
 * broke its "one JSON line, nothing else on stdout" contract. Error
 * messages never include the parsed value or the raw line: `deliveryUrl`,
 * `consumerKey` and `consumerSecret` are credentials, and this error can end
 * up in a console or a pasted report.
 */
export function parseSetupResult(stdout: string): SetupResult {
  const lines = stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length !== 1) {
    throw new Error(
      `Expected exactly one non-empty line of JSON from setup-shop.php, got ${lines.length}: ${lines
        .map(summarizeLine)
        .join(" | ")}`,
    );
  }

  let parsed: Partial<Record<keyof SetupResult, unknown>>;
  try {
    parsed = JSON.parse(lines[0]) as Partial<Record<keyof SetupResult, unknown>>;
  } catch {
    throw new Error("setup-shop.php's output was not valid JSON.");
  }

  for (const key of INTEGER_KEYS) {
    const value = parsed[key];
    if (!isPositiveInteger(value)) {
      throw new Error(
        `setup-shop.php's JSON output has an invalid "${key}" (expected a positive integer, got ${describeType(value)}).`,
      );
    }
  }
  for (const key of STRING_KEYS) {
    const value = parsed[key];
    if (!isNonEmptyString(value)) {
      throw new Error(
        `setup-shop.php's JSON output has an invalid "${key}" (expected a non-empty string, got ${describeType(value)}).`,
      );
    }
  }

  return parsed as SetupResult;
}
