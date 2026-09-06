/**
 * `npm run shop:order -- --email x@example.com --locale nl --difficulty easy
 *   --mode mixed --pick 0=<categoryId>` creates a paid order for the Pubquiz
 * product through WP-CLI, one line item per `--quiz` group (or a single
 * implicit group if `--quiz` is never given), with meta_data set exactly per
 * CHECKOUT_META_KEYS (src/domain/checkout.ts). The order is created directly
 * in status `processing` (WooCommerce's REST/WP-CLI order creation accepts a
 * status outright; no browser or gateway round trip is needed for this
 * scripted path -- see shop/README.md ("Key verification") for how the real
 * checkout path is proven separately, via curl against the actual add-to-cart
 * and checkout endpoints).
 *
 * Multiple quizzes in one order:
 *   npm run shop:order -- --email a@b.com \
 *     --locale nl --difficulty easy --mode mixed --pick 0=1 \
 *     --quiz --locale en --difficulty hard --mode single_category --pick 0=2 --quantity 2
 *
 * `--pick <slot>=<categoryId>` may repeat (slot 0-7). `--quantity <n>`
 * defaults to 1 and creates one line item with that quantity (n identical
 * Quizzes, per the spec).
 */
import { CHECKOUT_META_KEYS } from "../../src/domain/checkout";
import { SLOT_COUNT } from "../../src/domain/types";
import { wpCliJson } from "./lib/wp-cli";
import { getOrCreateProductId } from "./lib/product";

interface QuizArg {
  locale: string;
  difficulty: string;
  mode: string;
  picks: Map<number, string>;
  quantity: number;
}

function newQuiz(): QuizArg {
  return { locale: "nl", difficulty: "mixed", mode: "mixed", picks: new Map(), quantity: 1 };
}

function parseArgs(argv: string[]): { email: string; quizzes: QuizArg[] } {
  let email = "";
  const quizzes: QuizArg[] = [newQuiz()];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const current = quizzes[quizzes.length - 1];
    switch (arg) {
      case "--email":
        email = argv[++i];
        break;
      case "--quiz":
        quizzes.push(newQuiz());
        break;
      case "--locale":
        current.locale = argv[++i];
        break;
      case "--difficulty":
        current.difficulty = argv[++i];
        break;
      case "--mode":
        current.mode = argv[++i];
        break;
      case "--quantity":
        current.quantity = Number(argv[++i]);
        break;
      case "--pick": {
        const [slotStr, categoryId] = argv[++i].split("=");
        current.picks.set(Number(slotStr), categoryId);
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!email) {
    throw new Error("--email is required");
  }

  return { email, quizzes };
}

function toMetaData(quiz: QuizArg): Array<{ key: string; value: string }> {
  const meta: Array<{ key: string; value: string }> = [
    { key: CHECKOUT_META_KEYS.locale, value: quiz.locale },
    { key: CHECKOUT_META_KEYS.requestedDifficulty, value: quiz.difficulty },
    { key: CHECKOUT_META_KEYS.quizMode, value: quiz.mode },
  ];
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const pick = quiz.picks.get(slot);
    if (pick !== undefined) {
      meta.push({ key: CHECKOUT_META_KEYS.categoryPick(slot), value: pick });
    }
  }
  return meta;
}

function main() {
  const { email, quizzes } = parseArgs(process.argv.slice(2));
  const productId = getOrCreateProductId();

  const lineItems = quizzes.map((quiz) => ({
    product_id: productId,
    quantity: quiz.quantity,
    meta_data: toMetaData(quiz),
  }));

  const orderId = wpCliJson<number>([
    "wc",
    "shop_order",
    "create",
    "--status=processing",
    `--billing=${JSON.stringify({ email })}`,
    `--line_items=${JSON.stringify(lineItems)}`,
    "--porcelain",
  ]);

  console.log(String(orderId).trim());
}

main();
