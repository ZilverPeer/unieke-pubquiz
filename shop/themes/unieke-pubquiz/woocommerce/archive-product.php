<?php
/**
 * Unieke Pubquiz child theme -- the front page / landing page (ticket #145,
 * spec #142 "Front page").
 *
 * WooCommerce's template loader (`woocommerce_template_loader()`,
 * `class-wc-template-loader.php`) resolves the Winkel archive to
 * `woocommerce/archive-product.php` via `wc_locate_template()`, theme
 * override first -- and `page_on_front` is set to the Winkel page's id with
 * `show_on_front = page` (setup-shop.php, ticket #70 fix round, unchanged by
 * this ticket), so a request for `/` resolves to the *same* product-archive
 * query and loads this exact file, not `front-page.php` (WordPress only
 * looks for that template when `show_on_front = page` *and* no more specific
 * template matches first -- the product archive query here already does).
 * Verified empirically against a running `shop:up` (ticket #145 PR body):
 * `curl http://localhost:45330/` before this ticket's change showed
 * `woocommerce-products-header` and the `products columns-*` loop markup
 * that only `archive-product.php` prints.
 *
 * Guarded to only replace the default archive markup with the landing page
 * on the front page or the Winkel archive itself (`is_front_page() ||
 * is_shop()`) -- both are already true together under the fixed
 * `page_on_front`/`show_on_front` setup, but the guard means a future
 * un-set of `page_on_front` (or WooCommerce loading this file for some other
 * product-archive-shaped request) falls back to WooCommerce's own default
 * archive template instead of silently keeping the landing page somewhere
 * it doesn't belong. The fallback includes the *plugin's* own
 * `templates/archive-product.php` directly (not `wc_get_template()`, which
 * would re-locate this very file in the theme and recurse forever).
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

if ( ! ( is_front_page() || is_shop() ) ) {
    include untrailingslashit( WC()->plugin_path() ) . '/templates/archive-product.php';
    return;
}

require_once get_stylesheet_directory() . '/inc/seo.php';

/**
 * Local copy of setup-shop.php's `PUBQUIZ_PRODUCT_SLUG` literal ('pubquiz').
 * This ticket does not edit setup-shop.php (owned by #144's bootstrap step,
 * per the orchestrator's file-ownership split for spec 6) so the value is
 * duplicated here, the same way `pubquiz-category-dropdown.php` and
 * `pubquiz-checkout-meta.php` each keep their own copy of field ids that
 * live in another file, by hand.
 */
const PUBQUIZ_LANDING_PRODUCT_SLUG = 'pubquiz';

$pubquiz_landing_product_post = get_page_by_path( PUBQUIZ_LANDING_PRODUCT_SLUG, OBJECT, 'product' );
$pubquiz_landing_product_id   = $pubquiz_landing_product_post ? $pubquiz_landing_product_post->ID : 0;

/**
 * Not assigned to `global $product` yet -- this ticket only needs the
 * global set for the duration of the add-to-cart form render inside
 * `#samenstellen` below (`global $product` is WooCommerce's own convention
 * for "the product this template part is about"; leaving it set for the
 * rest of the request would be a global with no owner once this template
 * finishes rendering). Saved and restored around that one render, the same
 * way the `$wp_query` bridges above save and restore their own state.
 */
$pubquiz_landing_product = $pubquiz_landing_product_id ? wc_get_product( $pubquiz_landing_product_id ) : false;

wp_enqueue_style(
    'pubquiz-landing',
    get_stylesheet_directory_uri() . '/assets/css/landing.css',
    array( 'storefront-child-style' ),
    (string) filemtime( get_stylesheet_directory() . '/assets/css/landing.css' )
);

/**
 * Bridge for `pubquiz-category-dropdown.php`'s searchable Categorieën
 * dropdown (spec 3c, #83): both its asset enqueue and its inline-script
 * print are gated on `is_product()` (see that file's own docblock --
 * "enqueues ... on the single product page"), which is false here even
 * though `global $product` is set, because the front page's *main query* is
 * a product archive (`is_shop()`), not a singular product query. This
 * ticket's file ownership excludes editing that plugin (spec 6 orchestrator
 * split, ticket brief "File ownership"), so instead of duplicating its
 * ~100-line dropdown-wiring script here, each bridge below calls the
 * plugin's own (unmodified, still-hooked) function directly, with
 * `$wp_query`'s singular/queried-object state pointed at the Pubquiz
 * product only for the duration of that one direct call -- immediately
 * saved and restored, never left flipped for the rest of the request, so
 * nothing else reading `is_shop()`/`is_singular()` on this request (the
 * `rel_canonical()` tag included; it prints later, from `wp_head` priority
 * 10, well after this narrow window) sees anything but the real front-page
 * query state.
 */
if ( $pubquiz_landing_product_id ) {
    add_action(
        'wp_enqueue_scripts',
        function () use ( $pubquiz_landing_product_id ) {
            if ( ! function_exists( 'pubquiz_category_dropdown_enqueue_assets' ) ) {
                return;
            }
            global $wp_query;
            $pubquiz_saved_singular       = $wp_query->is_singular;
            $pubquiz_saved_queried_object = $wp_query->queried_object;
            $pubquiz_saved_queried_id     = $wp_query->queried_object_id;

            $wp_query->is_singular       = true;
            $wp_query->queried_object    = get_post( $pubquiz_landing_product_id );
            $wp_query->queried_object_id = $pubquiz_landing_product_id;

            pubquiz_category_dropdown_enqueue_assets();

            $wp_query->is_singular       = $pubquiz_saved_singular;
            $wp_query->queried_object    = $pubquiz_saved_queried_object;
            $wp_query->queried_object_id = $pubquiz_saved_queried_id;
        },
        5
    );

    add_action(
        'wp_footer',
        function () use ( $pubquiz_landing_product_id ) {
            if ( ! function_exists( 'pubquiz_category_dropdown_print_script' ) ) {
                return;
            }
            global $wp_query;
            $pubquiz_saved_singular       = $wp_query->is_singular;
            $pubquiz_saved_queried_object = $wp_query->queried_object;
            $pubquiz_saved_queried_id     = $wp_query->queried_object_id;

            $wp_query->is_singular       = true;
            $wp_query->queried_object    = get_post( $pubquiz_landing_product_id );
            $wp_query->queried_object_id = $pubquiz_landing_product_id;

            pubquiz_category_dropdown_print_script();

            $wp_query->is_singular       = $pubquiz_saved_singular;
            $wp_query->queried_object    = $pubquiz_saved_queried_object;
            $wp_query->queried_object_id = $pubquiz_saved_queried_id;
        },
        5
    );
}

get_header();
?>

<main id="primary" class="site-main pubquiz-landing">

	<section id="hero" class="pubquiz-hero">
		<h1><?php esc_html_e( 'Jouw avond. Jouw quiz. Niemand anders zijn quiz.', 'unieke-pubquiz' ); ?></h1>
		<p class="pubquiz-hero-lede"><?php esc_html_e( 'Een complete, unieke pubquiz — als PDF en muziekronde-MP3, klaar om te printen en te hosten bij jou thuis. Elke quiz wordt speciaal voor jou gegenereerd: je kiest je categorieën, moeilijkheid en taal, en je krijgt nooit dezelfde vraag twee keer.', 'unieke-pubquiz' ); ?></p>
		<a class="button pubquiz-btn-cta" href="#samenstellen"><?php esc_html_e( 'Stel je quiz samen', 'unieke-pubquiz' ); ?></a>
	</section>

	<section id="hoe-werkt-het" class="pubquiz-how-it-works">
		<h2><?php esc_html_e( 'Hoe werkt het', 'unieke-pubquiz' ); ?></h2>
		<ol class="pubquiz-steps">
			<li><span class="pubquiz-step-num">1</span><span><?php esc_html_e( 'Kies je categorieën', 'unieke-pubquiz' ); ?></span></li>
			<li><span class="pubquiz-step-num">2</span><span><?php esc_html_e( 'Betaal', 'unieke-pubquiz' ); ?></span></li>
			<li><span class="pubquiz-step-num">3</span><span><?php esc_html_e( 'Binnen enkele minuten de downloadlink in je mail', 'unieke-pubquiz' ); ?></span></li>
		</ol>
	</section>

	<section id="wat-krijg-je" class="pubquiz-what-you-get">
		<h2><?php esc_html_e( 'Wat krijg je', 'unieke-pubquiz' ); ?></h2>
		<p class="pubquiz-structure-note"><?php esc_html_e( '8 rondes: 6 tekstrondes, 1 fotoronde, 1 muziekronde, 10 vragen per ronde', 'unieke-pubquiz' ); ?></p>
		<div class="pubquiz-deliverable-grid">
			<div class="pubquiz-deliverable-card">
				<svg class="pubquiz-thumb" viewBox="0 0 80 100" aria-hidden="true"><rect x="1" y="1" width="78" height="98" rx="4" fill="#fff" stroke="var(--pubquiz-accent)" stroke-width="2"/><line x1="12" y1="20" x2="68" y2="20" stroke="var(--pubquiz-accent)" stroke-width="2"/><line x1="12" y1="32" x2="68" y2="32" stroke="#ccc" stroke-width="2"/><line x1="12" y1="42" x2="68" y2="42" stroke="#ccc" stroke-width="2"/><line x1="12" y1="60" x2="68" y2="60" stroke="var(--pubquiz-accent)" stroke-width="2"/><line x1="12" y1="72" x2="68" y2="72" stroke="#ccc" stroke-width="2"/></svg>
				<h3><?php esc_html_e( 'Quizmaster-PDF', 'unieke-pubquiz' ); ?></h3>
				<p><?php esc_html_e( 'Alle vragen, antwoorden en weetjes.', 'unieke-pubquiz' ); ?></p>
			</div>
			<div class="pubquiz-deliverable-card">
				<svg class="pubquiz-thumb" viewBox="0 0 80 100" aria-hidden="true"><rect x="1" y="1" width="78" height="98" rx="4" fill="#fff" stroke="var(--pubquiz-accent)" stroke-width="2"/><rect x="10" y="10" width="26" height="26" fill="none" stroke="var(--pubquiz-accent)" stroke-width="2"/><rect x="44" y="10" width="26" height="26" fill="none" stroke="var(--pubquiz-accent)" stroke-width="2"/><rect x="10" y="44" width="26" height="26" fill="none" stroke="var(--pubquiz-accent)" stroke-width="2"/><rect x="44" y="44" width="26" height="26" fill="none" stroke="var(--pubquiz-accent)" stroke-width="2"/></svg>
				<h3><?php esc_html_e( 'Fotoronde-PDF', 'unieke-pubquiz' ); ?></h3>
				<p><?php esc_html_e( 'Genummerde afbeeldingen voor de teams.', 'unieke-pubquiz' ); ?></p>
			</div>
			<div class="pubquiz-deliverable-card">
				<svg class="pubquiz-thumb" viewBox="0 0 80 100" aria-hidden="true"><rect x="1" y="1" width="78" height="98" rx="4" fill="#fff" stroke="var(--pubquiz-accent)" stroke-width="2"/><line x1="1" y1="50" x2="79" y2="50" stroke="var(--pubquiz-accent)" stroke-width="2" stroke-dasharray="4 3"/><line x1="40" y1="1" x2="40" y2="99" stroke="var(--pubquiz-accent)" stroke-width="2" stroke-dasharray="4 3"/></svg>
				<h3><?php esc_html_e( 'Antwoordbladen-PDF', 'unieke-pubquiz' ); ?></h3>
				<p><?php esc_html_e( 'Eén per team, om uit te knippen.', 'unieke-pubquiz' ); ?></p>
			</div>
			<div class="pubquiz-deliverable-card">
				<svg class="pubquiz-thumb" viewBox="0 0 80 100" aria-hidden="true"><rect x="1" y="1" width="78" height="98" rx="4" fill="#fff" stroke="var(--pubquiz-accent)" stroke-width="2"/><circle cx="30" cy="70" r="9" fill="var(--pubquiz-accent)"/><rect x="38" y="30" width="2.5" height="42" fill="var(--pubquiz-accent)"/><path d="M40 30 L60 24 L60 34 L40 40 Z" fill="var(--pubquiz-accent)"/></svg>
				<h3><?php esc_html_e( 'Muziekronde-MP3', 'unieke-pubquiz' ); ?></h3>
				<p><?php esc_html_e( '10 fragmenten met aankondiging.', 'unieke-pubquiz' ); ?></p>
			</div>
		</div>
		<p class="pubquiz-sample-link"><a href="<?php echo esc_url( home_url( '/voorbeeld/' ) ); ?>"><?php esc_html_e( 'Bekijk een voorbeeld', 'unieke-pubquiz' ); ?></a></p>
	</section>

	<section id="samenstellen" class="pubquiz-configurator">
		<h2><?php esc_html_e( 'Stel je quiz samen', 'unieke-pubquiz' ); ?></h2>
		<?php if ( $pubquiz_landing_product instanceof WC_Product ) : ?>
			<p class="pubquiz-configurator-price"><?php echo wp_kses_post( $pubquiz_landing_product->get_price_html() ); ?></p>
			<?php
			global $product;
			$pubquiz_saved_global_product = $product;
			$product                      = $pubquiz_landing_product;

			woocommerce_template_single_add_to_cart();

			$product = $pubquiz_saved_global_product;
			?>
		<?php else : ?>
			<p class="pubquiz-configurator-missing"><?php esc_html_e( 'Het product is nog niet beschikbaar.', 'unieke-pubquiz' ); ?></p>
		<?php endif; ?>
	</section>

	<section id="faq" class="pubquiz-faq">
		<h2><?php esc_html_e( 'Veelgestelde vragen', 'unieke-pubquiz' ); ?></h2>
		<div class="pubquiz-faq-list">
			<details>
				<summary><?php esc_html_e( 'Voor hoeveel mensen?', 'unieke-pubquiz' ); ?></summary>
				<p><?php esc_html_e( 'Voor elk gezelschap — druk zoveel antwoordbladen af als je teams hebt.', 'unieke-pubquiz' ); ?></p>
			</details>
			<details>
				<summary><?php esc_html_e( 'Hoe lang duurt een quiz?', 'unieke-pubquiz' ); ?></summary>
				<p><?php esc_html_e( 'Reken op een avondvullend programma, ongeveer 1,5 tot 2 uur met 8 rondes.', 'unieke-pubquiz' ); ?></p>
			</details>
			<details>
				<summary><?php esc_html_e( 'Moet ik iets installeren?', 'unieke-pubquiz' ); ?></summary>
				<p><?php esc_html_e( 'Nee. Je krijgt een PDF en een MP3 in je mail, klaar om te printen en af te spelen.', 'unieke-pubquiz' ); ?></p>
			</details>
			<details>
				<summary><?php esc_html_e( 'Kan ik dezelfde quiz twee keer krijgen?', 'unieke-pubquiz' ); ?></summary>
				<p><?php esc_html_e( 'Nee. Elke bestelling levert nieuwe vragen — je krijgt nooit dezelfde vraag twee keer.', 'unieke-pubquiz' ); ?></p>
			</details>
			<details>
				<summary><?php esc_html_e( 'Hoe betaal ik?', 'unieke-pubquiz' ); ?></summary>
				<p><?php esc_html_e( 'Je rekent direct online af bij het afrekenen; na betaling ontvang je de bestanden per e-mail.', 'unieke-pubquiz' ); ?></p>
			</details>
			<details>
				<summary><?php esc_html_e( 'Krijg ik mijn geld terug?', 'unieke-pubquiz' ); ?></summary>
				<p><?php esc_html_e( 'Het is een digitaal product: zodra je de bestanden hebt ontvangen, is terugbetalen niet meer mogelijk. Kloppen de bestanden niet? Mail ons, dan lossen we het op.', 'unieke-pubquiz' ); ?></p>
			</details>
		</div>
	</section>

</main>

<?php
get_footer();
