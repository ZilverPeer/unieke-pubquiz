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

const REQUIRED_KEYS: ReadonlyArray<keyof SetupResult> = [
  "productId",
  "webhookId",
  "deliveryUrl",
  "consumerKey",
  "consumerSecret",
];

/**
 * Parses setup-shop.php's stdout: exactly one non-empty line of JSON with
 * every key in {@link SetupResult}. Throws with a specific message on
 * anything else -- extra diagnostic lines, missing keys, or invalid JSON --
 * since that means setup-shop.php broke its "one JSON line, nothing else on
 * stdout" contract.
 */
export function parseSetupResult(stdout: string): SetupResult {
  const lines = stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length !== 1) {
    throw new Error(
      `Expected exactly one non-empty line of JSON from setup-shop.php, got ${lines.length}:\n${stdout}`,
    );
  }

  let parsed: Partial<SetupResult>;
  try {
    parsed = JSON.parse(lines[0]) as Partial<SetupResult>;
  } catch (cause) {
    throw new Error(`setup-shop.php's output was not valid JSON: ${lines[0]}`, { cause });
  }

  for (const key of REQUIRED_KEYS) {
    if (parsed[key] === undefined) {
      throw new Error(`setup-shop.php's JSON output is missing "${key}": ${lines[0]}`);
    }
  }

  return parsed as SetupResult;
}
