/**
 * Unit tests for buildFailureReason (spec 3c, ticket #84): one per reason
 * kind, each asserting the full expected text -- the exact wording is the
 * contract (it lands unchanged in the private order note and the
 * operator's alert mail).
 */
import { describe, expect, it } from "vitest";
import { buildFailureReason } from "./failure-reason";

describe("buildFailureReason", () => {
  it("text Round shortfall", () => {
    const reason = buildFailureReason({
      kind: "shortfall",
      quizNumber: 1,
      billingEmail: "jane@example.com",
      locale: "nl",
      requestedDifficulty: "hard",
      slotIndex: 0,
      categoryLabel: "Sport",
      missingCount: 10,
    });

    expect(reason).toBe(
      [
        "Quiz 1 of order for jane@example.com (locale nl) could not be generated.",
        'The text round for Category "Sport" at Difficulty hard is 10 Items short: the pool has too few Items this customer has not already received.',
        'What to do: add at least 10 text Items to "Sport" (hard, nl) and retry this Quiz with `npm run generate -- --retry-quiz <quiz id>`, or refund the order in WooCommerce.',
      ].join("\n"),
    );
  });

  it("picture Round shortfall", () => {
    const reason = buildFailureReason({
      kind: "shortfall",
      quizNumber: 2,
      billingEmail: "jane@example.com",
      locale: "nl",
      requestedDifficulty: "hard",
      slotIndex: 6,
      categoryLabel: "Geschiedenis",
      missingCount: 4,
    });

    expect(reason).toBe(
      [
        "Quiz 2 of order for jane@example.com (locale nl) could not be generated.",
        'The picture round for Category "Geschiedenis" at Difficulty hard is 4 Items short: the pool has too few Items this customer has not already received.',
        'What to do: add at least 4 picture Items to "Geschiedenis" (hard, nl) and retry this Quiz with `npm run generate -- --retry-quiz <quiz id>`, or refund the order in WooCommerce.',
      ].join("\n"),
    );
  });

  it("music Round shortfall", () => {
    const reason = buildFailureReason({
      kind: "shortfall",
      quizNumber: 1,
      billingEmail: "jan@example.com",
      locale: "en",
      requestedDifficulty: "easy",
      slotIndex: 7,
      categoryLabel: "Movies",
      missingCount: 3,
    });

    expect(reason).toBe(
      [
        "Quiz 1 of order for jan@example.com (locale en) could not be generated.",
        'The music round for Category "Movies" at Difficulty easy is 3 Items short: the pool has too few Items this customer has not already received.',
        'What to do: add at least 3 music Items to "Movies" (easy, en) and retry this Quiz with `npm run generate -- --retry-quiz <quiz id>`, or refund the order in WooCommerce.',
      ].join("\n"),
    );
  });

  it("no Category left for a slot (categoryId null)", () => {
    const reason = buildFailureReason({
      kind: "no-category-left",
      quizNumber: 3,
      billingEmail: "piet@example.com",
      locale: "nl",
      requestedDifficulty: "mixed",
      missingSlotCount: 2,
    });

    expect(reason).toBe(
      [
        "Quiz 3 of order for piet@example.com (locale nl) could not be generated.",
        "2 Round slots had no Category left to assign: the pool does not have enough distinct Categories with Items at Difficulty mixed (nl) to fill every Round.",
        "What to do: add at least 2 more Categories with Items at Difficulty mixed (nl) and retry this Quiz with `npm run generate -- --retry-quiz <quiz id>`, or refund the order in WooCommerce.",
      ].join("\n"),
    );
  });

  it("unknown Category id", () => {
    const reason = buildFailureReason({
      kind: "invalid-config",
      quizNumber: 1,
      billingEmail: "jane@example.com",
      locale: "nl",
      requestedDifficulty: "hard",
      detail: 'This Quiz was configured with Category id "999999", which does not exist.',
    });

    expect(reason).toBe(
      [
        "Quiz 1 of order for jane@example.com (locale nl) could not be generated.",
        'This Quiz was configured with Category id "999999", which does not exist.',
        "What to do: this configuration cannot be generated as ordered, so refunding the order in WooCommerce is the only way out.",
      ].join("\n"),
    );
  });

  it("invalid picks (too many or duplicate)", () => {
    const reason = buildFailureReason({
      kind: "invalid-config",
      quizNumber: 1,
      billingEmail: "jane@example.com",
      locale: "nl",
      requestedDifficulty: "hard",
      detail: "This Quiz was configured with duplicate Category picks; each pick must be a distinct Category.",
    });

    expect(reason).toBe(
      [
        "Quiz 1 of order for jane@example.com (locale nl) could not be generated.",
        "This Quiz was configured with duplicate Category picks; each pick must be a distinct Category.",
        "What to do: this configuration cannot be generated as ordered, so refunding the order in WooCommerce is the only way out.",
      ].join("\n"),
    );
  });
});
