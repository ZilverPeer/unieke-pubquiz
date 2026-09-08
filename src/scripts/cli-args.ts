/**
 * Pure CLI argument parsing for the local dev generation script. No I/O,
 * no defaults that require a DB. See src/scripts/README.md for the
 * documented command.
 */
import { join } from "node:path";
import type { Locale, QuizRequest, RequestedDifficulty } from "@/domain";
import { SLOT_COUNT } from "@/domain";

/** A QuizRequest plus the two dev-script-only knobs: seed and output folder. */
export interface GenerateOptions extends QuizRequest {
  seed: number;
  out: string;
}

const LOCALES: readonly Locale[] = ["nl", "en"];
const DIFFICULTIES: readonly RequestedDifficulty[] = ["easy", "medium", "hard", "mixed"];

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function defaultOutDir(locale: Locale, now: Date): string {
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return join("content", "generated", `${stamp}-${locale}`);
}

/**
 * Parses `npm run generate --` arguments into a GenerateOptions. Throws a
 * clear message on bad input. `--seed` defaults to a random 32-bit integer;
 * `--out` defaults to `content/generated/<yyyymmdd-hhmmss>-<locale>/`.
 *
 * `--pick <categoryId>` may repeat (up to 8 times); the customer's picks are
 * collected in the order given (ticket #71: slot i gets pick `i mod k` for k
 * picks, 0 picks fills every slot with a random Category -- see
 * `resolveSlotCategories`, src/sample/index.ts). Duplicate picks are
 * rejected here as well, matching the sampler's own check.
 */
export function parseGenerateArgs(argv: readonly string[]): GenerateOptions {
  let locale: Locale | undefined;
  let requestedDifficulty: RequestedDifficulty | undefined;
  let billingEmail: string | undefined;
  let seed: number | undefined;
  let out: string | undefined;
  const categoryPicks: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--locale": {
        const value = requireValue(argv, ++i, flag);
        if (!LOCALES.includes(value as Locale)) {
          throw new Error(`--locale must be one of ${LOCALES.join("|")}, got "${value}"`);
        }
        locale = value as Locale;
        break;
      }
      case "--difficulty": {
        const value = requireValue(argv, ++i, flag);
        if (!DIFFICULTIES.includes(value as RequestedDifficulty)) {
          throw new Error(`--difficulty must be one of ${DIFFICULTIES.join("|")}, got "${value}"`);
        }
        requestedDifficulty = value as RequestedDifficulty;
        break;
      }
      case "--email": {
        billingEmail = requireValue(argv, ++i, flag);
        break;
      }
      case "--pick": {
        const value = requireValue(argv, ++i, flag);
        if (categoryPicks.length >= SLOT_COUNT) {
          throw new Error(`--pick may be given at most ${SLOT_COUNT} times`);
        }
        if (categoryPicks.includes(value)) {
          throw new Error(`--pick category ids must be distinct, got "${value}" twice`);
        }
        categoryPicks.push(value);
        break;
      }
      case "--seed": {
        const value = requireValue(argv, ++i, flag);
        const parsed = Number(value);
        if (!Number.isInteger(parsed)) {
          throw new Error(`--seed must be an integer, got "${value}"`);
        }
        seed = parsed;
        break;
      }
      case "--out": {
        out = requireValue(argv, ++i, flag);
        break;
      }
      default:
        throw new Error(`Unknown argument "${flag}"`);
    }
  }

  if (!locale) throw new Error("--locale is required");
  if (!requestedDifficulty) throw new Error("--difficulty is required");
  if (!billingEmail) throw new Error("--email is required");

  return {
    locale,
    categoryPicks,
    requestedDifficulty,
    billingEmail,
    seed: seed ?? randomSeed(),
    out: out ?? defaultOutDir(locale, new Date()),
  };
}

/** `--retry-quiz <id>`: moves a `failed` Quiz back to `pending` and re-enqueues it. */
export interface RetryQuizOptions {
  quizId: string;
}

/** `--composition <id>`: re-renders an existing Composition's Deliverables without re-sampling. */
export interface ComposeOptions {
  compositionId: string;
}

export type ScriptCommand =
  | { kind: "generate"; options: GenerateOptions }
  | { kind: "retry-quiz"; options: RetryQuizOptions }
  | { kind: "composition"; options: ComposeOptions };

/**
 * Dispatches `npm run generate --` argv to one of three commands (ticket
 * #42's dev-script flags, plus the original `generate` flow, unchanged and
 * still reachable via `parseGenerateArgs` directly for existing callers).
 * `--retry-quiz` and `--composition` are single-argument commands with no
 * other flags -- reprocessing an existing Quiz/Composition, not building a
 * new request.
 */
export function parseScriptArgs(argv: readonly string[]): ScriptCommand {
  if (argv[0] === "--retry-quiz") {
    const quizId = requireValue(argv, 1, "--retry-quiz");
    if (argv.length > 2) {
      throw new Error("--retry-quiz takes no other arguments");
    }
    return { kind: "retry-quiz", options: { quizId } };
  }

  if (argv[0] === "--composition") {
    const compositionId = requireValue(argv, 1, "--composition");
    if (argv.length > 2) {
      throw new Error("--composition takes no other arguments");
    }
    return { kind: "composition", options: { compositionId } };
  }

  return { kind: "generate", options: parseGenerateArgs(argv) };
}
