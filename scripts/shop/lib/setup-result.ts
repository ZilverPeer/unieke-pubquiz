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

/**
 * Parses setup-shop.php's stdout: exactly one non-empty line of JSON with
 * every key in {@link SetupResult}, each of the right shape (`productId`/
 * `webhookId` positive integers, the rest non-empty strings). Throws with
 * the offending key named in the message on anything else -- extra
 * diagnostic lines, a missing/malformed key, or invalid JSON -- since that
 * means setup-shop.php broke its "one JSON line, nothing else on stdout"
 * contract.
 */
export function parseSetupResult(stdout: string): SetupResult {
  const lines = stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length !== 1) {
    throw new Error(
      `Expected exactly one non-empty line of JSON from setup-shop.php, got ${lines.length}:\n${stdout}`,
    );
  }

  let parsed: Partial<Record<keyof SetupResult, unknown>>;
  try {
    parsed = JSON.parse(lines[0]) as Partial<Record<keyof SetupResult, unknown>>;
  } catch (cause) {
    throw new Error(`setup-shop.php's output was not valid JSON: ${lines[0]}`, { cause });
  }

  for (const key of INTEGER_KEYS) {
    if (!isPositiveInteger(parsed[key])) {
      throw new Error(
        `setup-shop.php's JSON output has an invalid "${key}" (expected a positive integer): ${lines[0]}`,
      );
    }
  }
  for (const key of STRING_KEYS) {
    if (!isNonEmptyString(parsed[key])) {
      throw new Error(
        `setup-shop.php's JSON output has an invalid "${key}" (expected a non-empty string): ${lines[0]}`,
      );
    }
  }

  return parsed as SetupResult;
}
