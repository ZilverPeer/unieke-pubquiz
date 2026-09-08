import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CHECKOUT_META_KEYS, downloadMetaKey, OPERATOR_NOTE_PREFIX } from "./checkout";
import { SLOT_COUNT } from "./types";

/**
 * Drift check for ticket #37's shop assets (shop/fixtures/, shop/mu-plugins/):
 * these files are hand-maintained outside src/ and duplicate CHECKOUT_META_KEYS
 * / OPERATOR_NOTE_PREFIX as PHP/JSON literals (PHP cannot import a TS
 * constant). This test fails loudly if either pinned interface changes
 * without the shop assets being updated to match.
 */

const REPO_ROOT = join(__dirname, "..", "..");

interface MetaDatum {
  key: string;
  value: string;
}

function readFixture(): MetaDatum[] {
  const raw = readFileSync(join(REPO_ROOT, "shop", "fixtures", "order-updated-processing.json"), "utf8");
  const fixture = JSON.parse(raw) as { body: { line_items: Array<{ meta_data: MetaDatum[] }> } };
  return fixture.body.line_items[0].meta_data;
}

describe("shop/fixtures/order-updated-processing.json", () => {
  const allowedKeys = new Set<string>([
    CHECKOUT_META_KEYS.locale,
    CHECKOUT_META_KEYS.requestedDifficulty,
    CHECKOUT_META_KEYS.quizMode,
    ...Array.from({ length: SLOT_COUNT }, (_, slot) => CHECKOUT_META_KEYS.categoryPick(slot)),
    "_wapf_meta",
  ]);

  test("every line item meta_data key is one CHECKOUT_META_KEYS produces, or the plugin's own bookkeeping key", () => {
    const meta = readFixture();
    for (const { key } of meta) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });

  test("the four required keys are all present", () => {
    const keys = readFixture().map((m) => m.key);
    expect(keys).toEqual(
      expect.arrayContaining([CHECKOUT_META_KEYS.locale, CHECKOUT_META_KEYS.requestedDifficulty, CHECKOUT_META_KEYS.quizMode]),
    );
    expect(keys.some((key) => key === CHECKOUT_META_KEYS.categoryPick(0))).toBe(true);
  });
});

describe("shop/mu-plugins/pubquiz-operator-mail.php", () => {
  test("references OPERATOR_NOTE_PREFIX's literal value", () => {
    const php = readFileSync(join(REPO_ROOT, "shop", "mu-plugins", "pubquiz-operator-mail.php"), "utf8");
    expect(php).toContain(OPERATOR_NOTE_PREFIX);
  });
});

describe("shop/mu-plugins/pubquiz-downloads.php", () => {
  test("declares the PUBQUIZ_DOWNLOAD_META_PREFIX literal matching downloadMetaKey's stem", () => {
    const php = readFileSync(join(REPO_ROOT, "shop", "mu-plugins", "pubquiz-downloads.php"), "utf8");
    // downloadMetaKey's stem is everything before "<1-based sequence>_<file>".
    const stem = downloadMetaKey(0, "quizmaster.pdf").replace("1_quizmaster.pdf", "");
    expect(php).toContain(`PUBQUIZ_DOWNLOAD_META_PREFIX = '${stem}'`);
  });
});

describe("shop/mu-plugins/pubquiz-hold-processing.php", () => {
  test("matches on CHECKOUT_META_KEYS.locale's literal value", () => {
    const php = readFileSync(join(REPO_ROOT, "shop", "mu-plugins", "pubquiz-hold-processing.php"), "utf8");
    expect(php).toContain(`'${CHECKOUT_META_KEYS.locale}'`);
  });
});

describe("shop/mu-plugins/pubquiz-customer-notice.php", () => {
  test("matches on CHECKOUT_META_KEYS.locale's literal value", () => {
    const php = readFileSync(join(REPO_ROOT, "shop", "mu-plugins", "pubquiz-customer-notice.php"), "utf8");
    expect(php).toContain(`'${CHECKOUT_META_KEYS.locale}'`);
  });
});

describe("shop/mu-plugins/wp-cli-scripts/setup-field-group.php", () => {
  /**
   * Ticket #57: field labels are now Dutch (Taal/Moeilijkheid/Soort quiz/
   * Categorie N), not the literal CHECKOUT_META_KEYS strings -- the wire
   * format moved to pubquiz-checkout-meta.php's `_wapf_meta` bridge (pinned
   * below). This file still fixes the field *ids* the bridge plugin reads
   * (locale/difficulty/mode/category_N) and no longer hardcodes a Category
   * id list -- Categories come from $pubquiz_categories, set by
   * setup-shop.php from the Supabase stack (scripts/shop/lib/categories.ts).
   */
  const php = readFileSync(
    join(REPO_ROOT, "shop", "mu-plugins", "wp-cli-scripts", "setup-field-group.php"),
    "utf8",
  );

  test("declares field ids matching CHECKOUT_META_KEYS's key stems", () => {
    expect(php).toContain("'locale'");
    expect(php).toContain("'difficulty'");
    expect(php).toContain("'mode'");
    expect(php).toContain("'category_' . ( $slot + 1 )");
  });

  test("no longer hardcodes a Category id list", () => {
    expect(php).not.toContain("[ 1, 2, 3, 4, 5, 6, 7, 8 ]");
    expect(php).not.toMatch(/\$category_ids\s*=/);
    expect(php).toContain("$pubquiz_categories");
  });
});

describe("shop/mu-plugins/pubquiz-checkout-meta.php", () => {
  /**
   * Ticket #57: bridges the field group's `_wapf_meta` (id/label/value/raw
   * per field) back to the `pubquiz_*` keys the webhook parser expects.
   * Pins the four CHECKOUT_META_KEYS literals and the field ids the bridge
   * matches on -- a mismatch here silently breaks the webhook wire format
   * without any test in shop-fixture.test.ts's other describe blocks
   * catching it, since this plugin (not setup-field-group.php) is now the
   * only place those literals appear together.
   */
  const php = readFileSync(join(REPO_ROOT, "shop", "mu-plugins", "pubquiz-checkout-meta.php"), "utf8");

  test("maps the fixed field ids to CHECKOUT_META_KEYS's literal values", () => {
    expect(php).toContain("'locale'");
    expect(php).toContain(`=> '${CHECKOUT_META_KEYS.locale}'`);
    expect(php).toContain("'difficulty'");
    expect(php).toContain(`=> '${CHECKOUT_META_KEYS.requestedDifficulty}'`);
    expect(php).toContain("'mode'");
    expect(php).toContain(`=> '${CHECKOUT_META_KEYS.quizMode}'`);
  });

  test("maps category_N field ids to the pubquiz_category_ stem", () => {
    const stem = CHECKOUT_META_KEYS.categoryPick(0).replace("_1", "_");
    expect(php).toContain(`'${stem}'`);
    expect(php).toContain("category_(\\d+)");
  });
});

describe("shop/mu-plugins/pubquiz-fast-scheduler.php", () => {
  /**
   * Ticket #58 fix round: the cron ticker (scripts/shop/lib/cron-ticker.ts)
   * pings wp-cron.php every 5 seconds, but Action Scheduler's own queue
   * runner is itself a WP-Cron *event* scheduled on the `every_minute`
   * schedule (ActionScheduler_QueueRunner::WP_CRON_SCHEDULE) -- ticking
   * wp-cron.php more often doesn't make that event due any sooner. This
   * plugin reschedules it onto a `pubquiz_every_5s` schedule via the
   * `action_scheduler_run_schedule` filter. Pinned here (PHP can't import a
   * TS constant) so the schedule name used by the filter and the one this
   * test expects can't silently drift apart.
   */
  const php = readFileSync(join(REPO_ROOT, "shop", "mu-plugins", "pubquiz-fast-scheduler.php"), "utf8");

  test("registers a pubquiz_every_5s cron schedule with a 5-second interval", () => {
    expect(php).toContain("'pubquiz_every_5s'");
    expect(php).toContain("'interval' => 5");
  });

  test("filters action_scheduler_run_schedule to the fast schedule", () => {
    expect(php).toContain("action_scheduler_run_schedule");
    expect(php).toContain("return 'pubquiz_every_5s'");
  });

  test("reschedules ActionScheduler_QueueRunner::WP_CRON_HOOK when it isn't already on the fast schedule", () => {
    expect(php).toContain("ActionScheduler_QueueRunner::WP_CRON_HOOK");
    expect(php).toContain("wp_get_schedule(");
    expect(php).toContain("wp_schedule_event(");
  });
});

describe(".wp-env.json", () => {
  /**
   * Ticket #58 fix round 3: spawn_cron() (wp-includes/cron.php) writes the
   * `doing_cron` transient lock BEFORE firing its loopback POST to
   * wp-cron.php, and that loopback never completes inside the wp-env
   * container -- so the lock sits for the full WP_CRON_LOCK_TIMEOUT (60s)
   * every time a normal page load (checkout, REST, admin) re-arms it,
   * which is why the cron ticker's own external wp-cron.php requests kept
   * getting turned away early (wp-cron.php's own lock check) and webhook
   * latency clustered near 0s or near 60s instead of consistently under
   * the ticket's 30s target. DISABLE_WP_CRON makes _wp_cron() a no-op on
   * page loads (it returns 0 before ever taking the lock) without
   * affecting wp-cron.php itself, which the ticker calls directly and
   * which does not check the constant.
   */
  test("disables WordPress's own page-load cron spawn (DISABLE_WP_CRON)", () => {
    const config = JSON.parse(readFileSync(join(REPO_ROOT, ".wp-env.json"), "utf8")) as {
      config?: Record<string, unknown>;
    };
    expect(config.config?.DISABLE_WP_CRON).toBe(true);
  });
});

describe("shop/mu-plugins/wp-cli-scripts/setup-shop.php", () => {
  /**
   * Ticket #61 (single-bootstrap shop:up) moved the Pubquiz product's slug,
   * Dutch name/short description and placeholder price out of
   * scripts/shop/lib/config.ts (a TypeScript module) into this PHP file
   * (the only remaining consumer of those strings); PHP cannot import a TS
   * constants module, so this pins the literal values here instead, the
   * same way the other describe blocks in this file pin CHECKOUT_META_KEYS.
   */
  const php = readFileSync(join(REPO_ROOT, "shop", "mu-plugins", "wp-cli-scripts", "setup-shop.php"), "utf8");

  test("declares the pinned Pubquiz product slug, name, short description and price", () => {
    expect(php).toContain("PUBQUIZ_PRODUCT_SLUG', 'pubquiz'");
    expect(php).toContain("PUBQUIZ_PRODUCT_NAME', 'Pubquiz – digitale download'");
    expect(php).toContain(
      "PUBQUIZ_PRODUCT_SHORT_DESCRIPTION', 'Een kant-en-klare pubquiz om zelf te presenteren: quizmasterscript, beeldronde, antwoordenblad en muziekronde, direct na aankoop per download.'",
    );
    expect(php).toContain("PUBQUIZ_PRODUCT_PRICE', '14.95'");
  });

  test("prints exactly the closing JSON keys parseSetupResult expects", () => {
    expect(php).toContain("'productId'");
    expect(php).toContain("'webhookId'");
    expect(php).toContain("'deliveryUrl'");
    expect(php).toContain("'consumerKey'");
    expect(php).toContain("'consumerSecret'");
  });

  /**
   * Tickets #68/#70: Winkel must be the visible front page for a logged-out
   * visitor -- no WooCommerce coming-soon placeholder, no default blog
   * front page. Pins the three option names/values setup-shop.php writes.
   */
  test("declares the front-page option names and values from #68/#70", () => {
    expect(php).toContain("'woocommerce_coming_soon', 'no'");
    expect(php).toContain("'show_on_front', 'page'");
    expect(php).toContain("'page_on_front', (string) wc_get_page_id( 'shop' )");
  });

  /**
   * Fix round on #70 (Standards review): writes `page_on_front` before
   * `show_on_front`, so a run that dies between the two writes degrades to
   * "still shows the blog" rather than a blank front page.
   */
  test("writes page_on_front before show_on_front", () => {
    expect(php.indexOf("'page_on_front'")).toBeLessThan(php.indexOf("'show_on_front'"));
  });

  /**
   * Fix round on #70 (Standards review): post id 1 is only ever trashed
   * when it matches the default "Hello world!" post's identity (post_type
   * plus slug or title), never on id alone.
   */
  test("only trashes post #1 when it matches the default Hello world! post's identity", () => {
    expect(php).toContain("PUBQUIZ_HELLO_WORLD_POST_TYPE', 'post'");
    expect(php).toContain("PUBQUIZ_HELLO_WORLD_SLUG', 'hello-world'");
    expect(php).toContain("PUBQUIZ_HELLO_WORLD_TITLE', 'Hello world!'");
    expect(php).toContain("PUBQUIZ_HELLO_WORLD_POST_TYPE !== $pubquiz_hello_world->post_type");
  });
});

describe("shop/mu-plugins/pubquiz-storefront-chrome.php", () => {
  /**
   * Ticket #70: bare Storefront chrome -- no primary menu, breadcrumb,
   * sidebar or footer widgets. PHP cannot import a TS constant, and these
   * are WordPress/Storefront hook names, not values this repo owns
   * elsewhere, but pinning them here still catches a hook name typo or an
   * accidental removal of the whole block, the same drift-check role every
   * other describe block in this file plays.
   */
  const php = readFileSync(join(REPO_ROOT, "shop", "mu-plugins", "pubquiz-storefront-chrome.php"), "utf8");

  test("removes the primary and secondary navigation from storefront_header", () => {
    expect(php).toContain("remove_action( 'storefront_header', 'storefront_secondary_navigation', 30 )");
    expect(php).toContain("remove_action( 'storefront_header', 'storefront_primary_navigation_wrapper', 42 )");
    expect(php).toContain("remove_action( 'storefront_header', 'storefront_primary_navigation', 50 )");
    expect(php).toContain("remove_action( 'storefront_header', 'storefront_primary_navigation_wrapper_close', 68 )");
  });

  test("removes the breadcrumb, sidebar and footer widgets", () => {
    expect(php).toContain("remove_action( 'storefront_before_content', 'woocommerce_breadcrumb', 10 )");
    expect(php).toContain("remove_action( 'storefront_sidebar', 'storefront_get_sidebar', 10 )");
    expect(php).toContain("remove_action( 'storefront_footer', 'storefront_footer_widgets', 10 )");
    expect(php).toContain("remove_action( 'storefront_footer', 'storefront_handheld_footer_bar', 999 )");
  });

  test("adds an account icon link right after the cart, on storefront_header priority 61", () => {
    expect(php).toMatch(/'storefront_header',\s*function \(\) \{[\s\S]*wc_get_page_permalink\( 'myaccount' \)/);
    expect(php).toContain("Mijn account");
    expect(php).toContain("<svg");
    expect(php).toMatch(/\},\s*61\s*\);/);
  });
});
