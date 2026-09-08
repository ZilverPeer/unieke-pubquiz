/**
 * Pure request parser for POST /api/feasibility (ticket #102, spec 5). No
 * I/O: shape and enum validation only. Category id existence, the pick
 * count and duplicate picks are checked per line by check-feasibility.ts
 * (they need the repository's Category id set -- see route.ts, "invalid"
 * in README.md) and reported as a per-line `invalid` reason, not a 400 for
 * the whole request.
 */
import type { Locale, RequestedDifficulty } from "@/domain";

export interface ParsedFeasibilityLine {
  locale: Locale;
  requestedDifficulty: RequestedDifficulty;
  categoryPicks: string[];
}

export interface ParsedFeasibilityRequest {
  billingEmail: string;
  lines: ParsedFeasibilityLine[];
}

const VALID_LOCALES: readonly Locale[] = ["nl", "en"];
const VALID_REQUESTED_DIFFICULTIES: readonly RequestedDifficulty[] = ["easy", "medium", "hard", "mixed"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLine(raw: unknown, index: number): ParsedFeasibilityLine | string {
  if (!isRecord(raw)) return `line ${index}: must be an object`;

  const { locale, requestedDifficulty, categoryPicks } = raw;

  if (typeof locale !== "string" || !VALID_LOCALES.includes(locale as Locale)) {
    return `line ${index}: locale must be one of ${VALID_LOCALES.join(", ")}`;
  }
  if (
    typeof requestedDifficulty !== "string" ||
    !VALID_REQUESTED_DIFFICULTIES.includes(requestedDifficulty as RequestedDifficulty)
  ) {
    return `line ${index}: requestedDifficulty must be one of ${VALID_REQUESTED_DIFFICULTIES.join(", ")}`;
  }
  if (!Array.isArray(categoryPicks) || !categoryPicks.every((pick) => typeof pick === "string")) {
    return `line ${index}: categoryPicks must be an array of strings`;
  }

  return {
    locale: locale as Locale,
    requestedDifficulty: requestedDifficulty as RequestedDifficulty,
    categoryPicks: categoryPicks as string[],
  };
}

/** Parses the raw request body into a ParsedFeasibilityRequest, or returns a short English reason string. */
export function parseFeasibilityRequest(rawBody: string): ParsedFeasibilityRequest | string {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return "malformed JSON";
  }

  if (!isRecord(json)) return "body must be an object";

  const { billingEmail, lines } = json;

  if (typeof billingEmail !== "string" || billingEmail.trim() === "") {
    return "billingEmail must be a non-empty string";
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return "lines must be a non-empty array";
  }

  const parsedLines: ParsedFeasibilityLine[] = [];
  for (let index = 0; index < lines.length; index++) {
    const parsed = parseLine(lines[index], index);
    if (typeof parsed === "string") return parsed;
    parsedLines.push(parsed);
  }

  return { billingEmail, lines: parsedLines };
}
