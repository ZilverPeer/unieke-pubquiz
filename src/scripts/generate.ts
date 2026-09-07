/**
 * Local dev script entry point: parses args, dispatches to one of three
 * commands, and sets the process exit code. Keep this file thin -- the
 * actual flow lives in generate-quiz.ts / retry-quiz.ts / recompose-quiz.ts.
 * See README.md for the documented commands.
 *
 * Run with `tsx` (`npx tsx src/scripts/generate.ts ...`, or `npm run
 * generate --`), never with plain `node` -- see src/scripts/README.md.
 *
 * `--retry-quiz`/`--composition` (ticket #42) import `@/worker` (pg-boss
 * lifecycle) and `@/deliver` (the pinned Deliverer interface) -- a
 * deliberate, documented exception to this module's usual `src/domain` +
 * `src/sample` + `src/repository` + `src/render` boundary (README.md),
 * needed to re-enqueue a Quiz's job and re-attach its Deliverables the same
 * way the worker itself does.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDeliverer } from "@/deliver";
import {
  createDeliverableUploader,
  createOrderRepository,
  createRepository,
  resolveLocalStackConfig,
} from "@/repository";
import { QUIZ_QUEUE, startBoss, stopBoss } from "@/worker";
import { parseScriptArgs } from "./cli-args";
import { generateQuiz, type GeneratedQuizFiles } from "./generate-quiz";
import { recomposeQuiz } from "./recompose-quiz";
import { retryQuiz } from "./retry-quiz";

const DEFAULT_APP_BASE_URL = "http://localhost:3000";

function resolveAppBaseUrl(): string {
  return process.env.APP_BASE_URL ?? DEFAULT_APP_BASE_URL;
}

async function main(): Promise<number> {
  const command = parseScriptArgs(process.argv.slice(2));

  if (command.kind === "retry-quiz") {
    const orderRepository = createOrderRepository(resolveLocalStackConfig());
    const boss = await startBoss();
    try {
      const result = await retryQuiz(command.options.quizId, {
        orderRepository,
        enqueue: (quizId) => boss.send(QUIZ_QUEUE, { quizId }, { singletonKey: quizId }),
      });
      console.log(result.message);
      return result.exitCode;
    } finally {
      await stopBoss(boss);
    }
  }

  if (command.kind === "composition") {
    const config = resolveLocalStackConfig();
    const result = await recomposeQuiz(command.options.compositionId, {
      contentRepository: createRepository(config),
      orderRepository: createOrderRepository(config),
      uploadDeliverable: createDeliverableUploader(config),
      createDeliverer,
      appBaseUrl: resolveAppBaseUrl(),
    });
    console.log(result.message);
    return result.exitCode;
  }

  const options = command.options;
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
