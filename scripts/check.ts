// Runs the pre-push checks concurrently. Usage:
//   npm run check                 -> all of them
//   npm run check -- unit eslint  -> only the named ones
import concurrently from "concurrently";

const CHECKS: Record<string, string> = {
  typecheck: "npm run typecheck",
  unit: "npx vitest run",
  eslint: "npx eslint src scripts",
};

const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !(name in CHECKS));
if (unknown.length > 0) {
  console.error(
    `Unknown check(s): ${unknown.join(", ")}. Known: ${Object.keys(CHECKS).join(", ")}.`,
  );
  process.exit(2);
}

const names = requested.length > 0 ? requested : Object.keys(CHECKS);
const { result } = concurrently(
  names.map((name) => ({ name, command: CHECKS[name] })),
  { group: true, prefix: "name" },
);

result.then(
  () => process.exit(0),
  () => process.exit(1),
);
