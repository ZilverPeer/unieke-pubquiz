/**
 * Local dev script entry point: parses args, runs generateQuiz (handing it
 * the file-writing boundary), and sets the process exit code. Keep this
 * file thin -- the actual flow lives in generate-quiz.ts. See README.md for
 * the documented command.
 *
 * Run with `tsx` (`npx tsx src/scripts/generate.ts ...`, or `npm run
 * generate --`), never with plain `node` -- see src/scripts/README.md.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRepository, resolveLocalStackConfig } from "@/repository";
import { parseGenerateArgs } from "./cli-args";
import { generateQuiz, type GeneratedQuizFiles } from "./generate-quiz";

async function main(): Promise<number> {
  const options = parseGenerateArgs(process.argv.slice(2));
  const repository = createRepository(resolveLocalStackConfig());

  const writeDeliverables = async (files: GeneratedQuizFiles): Promise<void> => {
    await mkdir(options.out, { recursive: true });
    for (const [name, bytes] of Object.entries(files)) {
      await writeFile(join(options.out, name), bytes);
    }
  };

  const result = await generateQuiz(options, repository, writeDeliverables);

  if (!result.ok) {
    const { slotIndex, shortfall } = result.failure;
    console.error(
      `Generation failed: slot ${slotIndex}, Category ${result.categoryLabel}, shortfall ${shortfall}`,
    );
    // A failed run must still be reproducible.
    console.error(`Seed: ${options.seed}`);
    return 1;
  }

  await writeFile(
    join(options.out, "composition.json"),
    JSON.stringify(
      { compositionId: result.compositionId, ...result.compositionRecord },
      null,
      2,
    ),
  );

  console.log(`Quiz written to ${options.out}`);
  console.log(`Seed: ${options.seed}`);
  console.log(`Composition id: ${result.compositionId}`);
  return 0;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
