# api/feasibility

Checkout feasibility endpoint (spec 5, ticket #102, parent #98). Answers, per cart line, whether a Quiz can be generated for a billing email against the live pool and that email's delivered Compositions (the no-repeat rule) -- before payment, so the shop can refuse checkout with a plain-language reason instead of letting generation fail after the sale. Persists nothing.

## Files

- `route.ts` -- `POST` only, a thin Request/Response adapter. Verifies the signature, delegates parsing to `parse-request.ts` and the dry-run orchestration to `check-feasibility.ts`, wires the real repository (`createRepository`, `createCategoryIdLookup`, `resolveLocalStackConfig`, `@/repository`).
- `parse-request.ts` -- pure request-shape parser: `rawBody -> ParsedFeasibilityRequest | string` (a short English reason on failure). No I/O -- Category id existence, the 8-pick limit and duplicate picks are not shape errors and are checked later, per line, by `check-feasibility.ts`.
- `check-feasibility.ts` -- pure orchestration: given the parsed request and the pool/exclusion loaders as plain functions plus the Category id set (not a `ContentRepository`, so the route stays the only I/O wiring and this module can be driven directly in tests), answers each line in cart order (ticket #121), carrying every feasible line's Item ids into the next line's exclusion set -- see "Lines and cart order" below. Loads the pool once per distinct Locale used by the request and the billing email's excluded Item ids once for the whole request (every line shares one `billingEmail`). Uses a fixed seed per line (a seeded sample stands in for the real one the worker would draw -- only its counts matter here, not its identities).
- `route.integration.test.ts` -- drives the exported `POST` against the real local Supabase stack, in the style of `src/app/api/webhooks/woocommerce/route.integration.test.ts`. No pg-boss here: this route never enqueues anything.

## Signature

`X-Pubquiz-Signature: base64(hmac-sha256(rawBody, secret))`, the same HMAC-SHA256-over-the-raw-body scheme as the WooCommerce webhook route (`src/app/api/webhooks/woocommerce/verify-signature.ts`, imported directly rather than copied), verified against the same `WOOCOMMERCE_WEBHOOK_SECRET` environment variable, under a header name of this route's own. Missing or wrong signature -> `401 { "error": "invalid signature" }`, nothing read from the repository.

## Request

```json
{
  "billingEmail": "jane@example.com",
  "lines": [{ "locale": "nl", "requestedDifficulty": "hard", "categoryPicks": ["12"] }]
}
```

`lines` is 1 or more cart lines, each with a `Locale` (`"nl" | "en"`), a `RequestedDifficulty` (`"easy" | "medium" | "hard" | "mixed"`) and `categoryPicks` (0 to `SLOT_COUNT` Category ids, distinct, in pick order -- see `src/domain/types.ts`, `src/sample/README.md` "Categories"). Malformed JSON or a body/line that doesn't match this shape (missing `billingEmail`, missing or empty `lines`, an unknown `locale`/`requestedDifficulty` value, `categoryPicks` not an array of strings) -> `400 { "error": "<reason>" }`. This is shape validation only -- an unknown Category id, more than `SLOT_COUNT` picks, or a duplicate pick is a well-formed line and comes back as an `invalid` line in the 200 response, not a 400.

## Response

`200`:

```json
{
  "lines": [
    {
      "feasible": false,
      "invalid": null,
      "shortfalls": [{ "slotIndex": 0, "kind": "text", "categoryId": "12", "requestedDifficulty": "hard", "shortfall": 4 }]
    },
    { "feasible": false, "invalid": "unknown category 999999", "shortfalls": [] }
  ]
}
```

Lines are answered in request order, which is cart order. Each line result:

- `feasible` -- `true` when the line samples a full Composition with no shortfall at all.
- `invalid` -- a short English reason when the line's picks aren't well-formed (unknown Category id, more than `SLOT_COUNT` picks, a duplicate pick); otherwise `null`. An invalid line is never sampled or dry-run (there is nothing meaningful to sample against) and always has `feasible: false`, `shortfalls: []`.
- `shortfalls` -- every slot (not just the first) the line would fall short on, same shape as `DryRunShortfall` (`@/sample`): `slotIndex`, `kind`, `categoryId` (`null` only in the pool-wide "not enough distinct Categories" case, unreachable here except with 0 picks -- see `src/sample/README.md`), `requestedDifficulty`, `shortfall` (the missing count). No Category names: the shop translates ids to its own Dutch labels from the product field's own choice list.

### Lines and cart order (ticket #121)

A cart line's verdict depends on the lines before it in the same request: the worker generates a multi-Quiz order line by line, each Composition excluding the Items the previous lines already used, so judging every line against the same starting exclusion set (as this route did before #121) can pass a cart at checkout that then fails at generation once an earlier line has consumed the pool the next one needed. `check-feasibility.ts` instead keeps one exclusion set that grows as it walks the cart: it starts from the billing email's already-delivered Items (the no-repeat rule) and, for each valid line in cart order, seed-samples a full Composition (`sampleComposition`, `@/sample`) against the exclusion set so far. A feasible line adds every one of its sampled Item ids to the exclusion set before the next line is judged; a failed line adds nothing (it never consumed anything for real) and is reported with the full shortfall list `dryRunRequest` gives for that same exclusion set, so the shop's notice still names every short Category and Difficulty for that line, not just the first one the sampler happened to stop on. An invalid line is skipped without touching the exclusion set either way.

The seeded sample used for a feasible line is a stand-in for the real generation the worker will do later with its own random draws -- only the *counts* it consumes from the pool matter for the next line's exclusion set, not which particular Items it names. A different seed would carry a different set of Item ids forward but the same counts, and therefore the same feasible/short verdicts down the cart.

## Out of scope here

Rate limiting/caching of the check, retrying at payment capture, and suggesting alternative Categories are all out of scope (spec 5's "Out of Scope"). Fail-open (checkout proceeds if this endpoint is unreachable, times out, or answers unexpectedly) is the shop's mu-plugin's job, not this route's -- this route always answers definitively or fails loudly (a thrown repository error propagates to a 500; WooCommerce's own timeout budget on the shop side is what makes that fail open in practice).
