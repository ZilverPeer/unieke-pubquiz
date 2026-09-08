/**
 * Builds the plain-words English text a failed Quiz's reason is stored and
 * reported as (spec 3c, ticket #84, parent #82 stories 12-13): the private
 * order note and, through it unchanged, the operator's "needs attention"
 * mail (see src/deliver/index.ts's noteFailure -- it prepends
 * OPERATOR_NOTE_PREFIX and the line item id itself; this module's output
 * carries no marker of its own).
 *
 * A pure function: every fact it needs (the Quiz's 1-based position within
 * its order -- the same number quizZipFilename's `sequence + 1` uses --
 * the billing email, the Locale, the requested Difficulty, and the
 * kind-specific detail) is passed in by the caller (src/worker/quiz-job.ts),
 * which is the one place allowed to read the Order and the shortfall result
 * this data comes from.
 */
import type { Locale, RequestedDifficulty } from "@/domain";
import { SLOT_KINDS } from "@/domain";

interface FailureReasonBase {
  /** The Quiz's 1-based position among every Quiz of its order (quizZipFilename's sequence + 1). */
  quizNumber: number;
  billingEmail: string;
  locale: Locale;
  requestedDifficulty: RequestedDifficulty;
}

export type FailureReasonInput =
  | (FailureReasonBase & {
      kind: "shortfall";
      /** 0-based Round slot index; SLOT_KINDS[slotIndex] gives the Round kind word. */
      slotIndex: number;
      /** The short Category's name (or raw id if the name is unknown). */
      categoryLabel: string;
      /** How many Items short of a full slot the pool ended up. */
      missingCount: number;
    })
  | (FailureReasonBase & {
      kind: "no-category-left";
      /** How many Round slots had no Category left to assign at all. */
      missingSlotCount: number;
    })
  | (FailureReasonBase & {
      kind: "invalid-config";
      /** The sentence describing what was wrong with the checkout configuration. */
      detail: string;
    });

function header(input: FailureReasonBase): string {
  return `Quiz ${input.quizNumber} of order for ${input.billingEmail} (locale ${input.locale}) could not be generated.`;
}

const RETRY_COMMAND = "`npm run generate -- --retry-quiz <quiz id>`";

/**
 * Builds the multi-line plain-words failure text. Every branch keeps the
 * same shape: a header naming the Quiz/order/email/Locale, a sentence
 * describing what went wrong, and a "What to do" paragraph naming the two
 * ways out.
 */
export function buildFailureReason(input: FailureReasonInput): string {
  const lines = [header(input)];

  switch (input.kind) {
    case "shortfall": {
      const roundKind = SLOT_KINDS[input.slotIndex];
      lines.push(
        `The ${roundKind} round for Category "${input.categoryLabel}" at Difficulty ${input.requestedDifficulty} is ${input.missingCount} Items short: the pool has too few Items this customer has not already received.`,
      );
      lines.push(
        `What to do: add at least ${input.missingCount} ${roundKind} Items to "${input.categoryLabel}" (${input.requestedDifficulty}, ${input.locale}) and retry this Quiz with ${RETRY_COMMAND}, or refund the order in WooCommerce.`,
      );
      break;
    }
    case "no-category-left": {
      lines.push(
        `${input.missingSlotCount} Round slots had no Category left to assign: the pool does not have enough distinct Categories with Items at Difficulty ${input.requestedDifficulty} (${input.locale}) to fill every Round.`,
      );
      lines.push(
        `What to do: add at least ${input.missingSlotCount} more Categories with Items at Difficulty ${input.requestedDifficulty} (${input.locale}) and retry this Quiz with ${RETRY_COMMAND}, or refund the order in WooCommerce.`,
      );
      break;
    }
    case "invalid-config": {
      lines.push(input.detail);
      lines.push(
        "What to do: this configuration cannot be generated as ordered, so refunding the order in WooCommerce is the only way out.",
      );
      break;
    }
  }

  return lines.join("\n");
}
