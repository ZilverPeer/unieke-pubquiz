/**
 * Pure CLI argument parsing for the local dev generation script. No I/O,
 * no defaults that require a DB. See src/scripts/README.md for the
 * documented command.
 */
import { join } from "node:path";
import type { CategoryPick, Locale, QuizMode, QuizRequest, RequestedDifficulty } from "@/domain";
import { SLOT_COUNT } from "@/domain";

/** A QuizRequest plus the two dev-script-only knobs: seed and output folder. */
export interface GenerateOptions extends QuizRequest {
  seed: number;
  out: string;
}

const LOCALES: readonly Locale[] = ["nl", "en"];
const MODES: readonly QuizMode[] = ["mixed", "single_category"];
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
 */
export function parseGenerateArgs(argv: readonly string[]): GenerateOptions {
  let locale: Locale | undefined;
  let quizMode: QuizMode | undefined;
  let requestedDifficulty: RequestedDifficulty | undefined;
  let billingEmail: string | undefined;
  let seed: number | undefined;
  let out: string | undefined;
  const categoryPicks: CategoryPick[] = new Array(SLOT_COUNT).fill(undefined);

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
      case "--mode": {
        const value = requireValue(argv, ++i, flag);
        if (!MODES.includes(value as QuizMode)) {
          throw new Error(`--mode must be one of ${MODES.join("|")}, got "${value}"`);
        }
        quizMode = value as QuizMode;
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
        const match = /^(\d+)=(.+)$/.exec(value);
        if (!match) {
          throw new Error(`--pick must be formatted <slot>=<categoryId>, got "${value}"`);
        }
        const slot = Number(match[1]);
        if (slot < 0 || slot >= SLOT_COUNT) {
          throw new Error(`--pick slot must be between 0 and ${SLOT_COUNT - 1}, got ${slot}`);
        }
        if (categoryPicks[slot] !== undefined) {
          throw new Error(`--pick specified more than once for slot ${slot}`);
        }
        categoryPicks[slot] = match[2];
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
  if (!quizMode) throw new Error("--mode is required");
  if (!requestedDifficulty) throw new Error("--difficulty is required");
  if (!billingEmail) throw new Error("--email is required");

  const pickCount = categoryPicks.filter((pick) => pick !== undefined).length;
  if (quizMode === "single_category" && pickCount === 0) {
    throw new Error("--mode single_category requires exactly one --pick");
  }
  if (quizMode === "single_category" && pickCount > 1) {
    throw new Error("--mode single_category accepts only one --pick");
  }

  return {
    locale,
    quizMode,
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
