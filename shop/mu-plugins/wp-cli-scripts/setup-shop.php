<?php
/**
 * Single-bootstrap WordPress-side setup for `npm run shop:up` (ticket #61).
 * Run via:
 *
 *   wp eval-file wp-content/mu-plugins/wp-cli-scripts/setup-shop.php \
 *     <webhookDeliveryUrl> <webhookSecret>
 *
 * by scripts/shop/setup.ts, in place of what used to be about 26 separate
 * WP-CLI invocations, each costing roughly 14 seconds against this container
 * on Windows bind mounts (see shop/README.md "Single bootstrap"). This one
 * `wp eval-file` call does, in order: theme activation, the Dutch site/
 * plugin/theme language, WooCommerce's Dutch store settings, the Dutch page
 * renames (plus deleting the leftover "Sample Page"), the Pubquiz product,
 * the Advanced Product Fields field group (setup-field-group.php, required
 * below), the classic Cart/Checkout shortcodes, the `order.updated` webhook,
 * and a freshly rotated WooCommerce REST API key.
 *
 * Every step is read-before-write idempotent: it reads the current state
 * first and only writes when something differs, exactly like the individual
 * `wp` calls in scripts/shop/lib/*.ts did before this ticket (#56, #37) --
 * only the number of bootstraps changes, not what gets configured or how
 * idempotency works.
 *
 * STDOUT contract: the ONLY thing this script ever writes to STDOUT is the
 * single closing line of JSON that scripts/shop/setup.ts's
 * parseSetupResult() parses. Every diagnostic goes to STDERR via
 * pubquiz_log() below.
 *
 * This directory lives under the mu-plugins mount but one level down, so
 * WordPress's must-use loader (which only scans the top level of
 * wp-content/mu-plugins/*.php) never auto-loads it -- see
 * setup-field-group.php's own docblock for the same note.
 */

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
    exit;
}

/** Writes a diagnostic line to STDERR. STDOUT is reserved for the closing JSON line -- see the file docblock. */
function pubquiz_log( $message ) {
    fwrite( STDERR, $message . "\n" );
}

global $args;
$webhook_delivery_url = isset( $args[0] ) ? $args[0] : 'http://host.docker.internal:3000/api/webhooks/woocommerce';
$webhook_secret       = isset( $args[1] ) ? $args[1] : 'test-secret';

// -----------------------------------------------------------------------
// 1. Theme: Storefront is installed declaratively by .wp-env.json's
//    `themes` array; only activate it if it isn't already active.
// -----------------------------------------------------------------------
define( 'PUBQUIZ_STOREFRONT_THEME_SLUG', 'storefront' );

if ( get_stylesheet() !== PUBQUIZ_STOREFRONT_THEME_SLUG ) {
    pubquiz_log( 'Activating theme ' . PUBQUIZ_STOREFRONT_THEME_SLUG );
    switch_theme( PUBQUIZ_STOREFRONT_THEME_SLUG );
} else {
    pubquiz_log( 'Theme already active: ' . PUBQUIZ_STOREFRONT_THEME_SLUG );
}

// -----------------------------------------------------------------------
// 2. Language: nl_NL for core (site language), WooCommerce and Storefront.
//    Installs a pack only if it is missing; never re-downloads or
//    "refreshes" an already-installed one -- see the README's "Single
//    bootstrap" section for why that's an intentional behaviour change
//    from `wp language core update`'s unconditional refresh.
// -----------------------------------------------------------------------
require_once ABSPATH . 'wp-admin/includes/translation-install.php';
require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
if ( ! function_exists( 'get_plugin_data' ) ) {
    require_once ABSPATH . 'wp-admin/includes/plugin.php';
}

define( 'PUBQUIZ_SITE_LOCALE', 'nl_NL' );

/** Downloads and activates the core language pack for $locale, only if it isn't already installed. */
function pubquiz_ensure_core_language( $locale ) {
    if ( in_array( $locale, get_available_languages(), true ) ) {
        pubquiz_log( "Core language pack already installed: {$locale}" );
    } else {
        pubquiz_log( "Downloading core language pack: {$locale}" );
        $result = wp_download_language_pack( $locale );
        if ( ! $result ) {
            WP_CLI::error( "Failed to download core language pack: {$locale}" );
        }
    }

    if ( get_option( 'WPLANG' ) !== $locale ) {
        pubquiz_log( "Setting site language (WPLANG) to {$locale}" );
        update_option( 'WPLANG', $locale );
    } else {
        pubquiz_log( "Site language (WPLANG) already {$locale}" );
    }
}

/**
 * Downloads a plugin's or theme's translation for $locale, only if the
 * corresponding .mo file isn't already present under WP_LANG_DIR. Mirrors
 * what `wp language plugin install` / `wp language theme install` do
 * internally (translations_api() + Language_Pack_Upgrader), since there is
 * no supported way to invoke a `wp` subcommand from inside an eval-file'd
 * script without shelling out (which this ticket removes).
 */
function pubquiz_ensure_component_language( $type, $slug, $locale ) {
    $lang_subdir = 'plugin' === $type ? 'plugins' : 'themes';
    $mo_file     = WP_LANG_DIR . "/{$lang_subdir}/{$slug}-{$locale}.mo";

    if ( file_exists( $mo_file ) ) {
        pubquiz_log( "{$type} language pack already installed: {$slug} {$locale}" );
        return;
    }

    if ( 'plugin' === $type ) {
        $plugin_file = WP_PLUGIN_DIR . "/{$slug}/{$slug}.php";
        $version     = file_exists( $plugin_file ) ? get_plugin_data( $plugin_file )['Version'] : '';
        $api_type    = 'plugins';
    } else {
        $theme    = wp_get_theme( $slug );
        $version  = $theme->exists() ? $theme->get( 'Version' ) : '';
        $api_type = 'themes';
    }

    $translations = translations_api( $api_type, array( 'slug' => $slug, 'version' => $version ) );
    if ( is_wp_error( $translations ) || empty( $translations['translations'] ) ) {
        pubquiz_log( "No translations available for {$type} {$slug}; skipping." );
        return;
    }

    $translation = null;
    foreach ( $translations['translations'] as $candidate ) {
        if ( $candidate['language'] === $locale ) {
            $translation = (object) $candidate;
            break;
        }
    }
    if ( ! $translation ) {
        pubquiz_log( "No {$locale} translation available for {$type} {$slug}; skipping." );
        return;
    }
    $translation->type = $type;
    $translation->slug = $slug;

    pubquiz_log( "Downloading {$type} language pack: {$slug} {$locale}" );
    $skin     = new Automatic_Upgrader_Skin();
    $upgrader = new Language_Pack_Upgrader( $skin );
    $result   = $upgrader->upgrade( $translation, array( 'clear_update_cache' => false ) );
    if ( ! $result || is_wp_error( $result ) ) {
        pubquiz_log( "Failed installing {$type} {$slug} {$locale} language pack." );
    }
}

pubquiz_ensure_core_language( PUBQUIZ_SITE_LOCALE );
pubquiz_ensure_component_language( 'plugin', 'woocommerce', PUBQUIZ_SITE_LOCALE );
pubquiz_ensure_component_language( 'theme', PUBQUIZ_STOREFRONT_THEME_SLUG, PUBQUIZ_SITE_LOCALE );

// -----------------------------------------------------------------------
// 3. WooCommerce store settings for a Dutch guest checkout (spec #55).
//    Option names verified against the installed WooCommerce's own
//    options (`wp option list --search=woocommerce_*`), not assumed.
// -----------------------------------------------------------------------
function pubquiz_ensure_option( $name, $value ) {
    if ( get_option( $name ) !== $value ) {
        pubquiz_log( "Setting option {$name} = {$value}" );
        update_option( $name, $value );
    } else {
        pubquiz_log( "Option {$name} already {$value}" );
    }
}

pubquiz_ensure_option( 'woocommerce_currency', 'EUR' );
pubquiz_ensure_option( 'woocommerce_default_country', 'NL' );
pubquiz_ensure_option( 'woocommerce_enable_guest_checkout', 'yes' );
pubquiz_ensure_option( 'woocommerce_enable_signup_and_login_from_checkout', 'yes' );

// -----------------------------------------------------------------------
// 4. Dutch pages: rename WooCommerce's Shop/Cart/Checkout/My account pages
//    in place (by `woocommerce_<page>_page_id` option, never by slug), and
//    delete the "Sample Page" WooCommerce's install leaves behind.
// -----------------------------------------------------------------------
$pubquiz_dutch_pages = array(
    'woocommerce_shop_page_id'      => array( 'title' => 'Winkel', 'slug' => 'winkel' ),
    'woocommerce_cart_page_id'      => array( 'title' => 'Winkelwagen', 'slug' => 'winkelwagen' ),
    'woocommerce_checkout_page_id'  => array( 'title' => 'Afrekenen', 'slug' => 'afrekenen' ),
    'woocommerce_myaccount_page_id' => array( 'title' => 'Mijn account', 'slug' => 'mijn-account' ),
);

foreach ( $pubquiz_dutch_pages as $option_key => $page ) {
    $id = (int) get_option( $option_key );
    if ( ! $id ) {
        WP_CLI::error( "{$option_key} is not set -- has WooCommerce finished installing its pages?" );
    }
    $post = get_post( $id );
    if ( ! $post ) {
        WP_CLI::error( "{$option_key} points at post #{$id}, which does not exist." );
    }
    if ( $post->post_title !== $page['title'] || $post->post_name !== $page['slug'] ) {
        pubquiz_log( "Renaming page #{$id} to \"{$page['title']}\" / {$page['slug']}" );
        wp_update_post(
            array(
                'ID'         => $id,
                'post_title' => $page['title'],
                'post_name'  => $page['slug'],
            )
        );
    } else {
        pubquiz_log( "Page #{$id} already \"{$page['title']}\" / {$page['slug']}" );
    }
}

$pubquiz_sample_page = get_page_by_path( 'sample-page' );
if ( $pubquiz_sample_page ) {
    pubquiz_log( 'Deleting Sample Page #' . $pubquiz_sample_page->ID );
    wp_delete_post( $pubquiz_sample_page->ID, true );
} else {
    pubquiz_log( 'Sample Page already gone.' );
}

// -----------------------------------------------------------------------
// 5. The Pubquiz product: Dutch name/short description/placeholder price,
//    converged onto an already-existing product too (see
//    scripts/shop/lib/config.ts -- these three literal strings are the
//    single source, pinned against this file by
//    src/domain/shop-fixture.test.ts).
// -----------------------------------------------------------------------
define( 'PUBQUIZ_PRODUCT_SLUG', 'pubquiz' );
define( 'PUBQUIZ_PRODUCT_NAME', 'Pubquiz – digitale download' );
define( 'PUBQUIZ_PRODUCT_SHORT_DESCRIPTION', 'Een kant-en-klare pubquiz om zelf te presenteren: quizmasterscript, beeldronde, antwoordenblad en muziekronde, direct na aankoop per download.' );
define( 'PUBQUIZ_PRODUCT_PRICE', '14.95' );

function pubquiz_ensure_product() {
    $existing = get_page_by_path( PUBQUIZ_PRODUCT_SLUG, OBJECT, 'product' );

    if ( $existing ) {
        $product = wc_get_product( $existing->ID );
        $changed = false;
        if ( $product->get_name() !== PUBQUIZ_PRODUCT_NAME ) {
            $product->set_name( PUBQUIZ_PRODUCT_NAME );
            $changed = true;
        }
        if ( $product->get_short_description() !== PUBQUIZ_PRODUCT_SHORT_DESCRIPTION ) {
            $product->set_short_description( PUBQUIZ_PRODUCT_SHORT_DESCRIPTION );
            $changed = true;
        }
        if ( $product->get_regular_price() !== PUBQUIZ_PRODUCT_PRICE ) {
            $product->set_regular_price( PUBQUIZ_PRODUCT_PRICE );
            $changed = true;
        }
        if ( $changed ) {
            pubquiz_log( 'Updating Pubquiz product #' . $product->get_id() );
            $product->save();
        } else {
            pubquiz_log( 'Pubquiz product #' . $product->get_id() . ' already up to date.' );
        }
        return $product->get_id();
    }

    pubquiz_log( 'Creating Pubquiz product.' );
    $product = new WC_Product_Simple();
    $product->set_name( PUBQUIZ_PRODUCT_NAME );
    $product->set_slug( PUBQUIZ_PRODUCT_SLUG );
    $product->set_short_description( PUBQUIZ_PRODUCT_SHORT_DESCRIPTION );
    $product->set_regular_price( PUBQUIZ_PRODUCT_PRICE );
    $product->set_status( 'publish' );
    $product->set_virtual( true );
    $product->set_downloadable( true );
    $product->set_download_expiry( 30 );
    $product->save();
    return $product->get_id();
}

$pubquiz_product_id = pubquiz_ensure_product();

// -----------------------------------------------------------------------
// 6. The Advanced Product Fields field group (ticket #37/#56 -- see that
//    file's own docblock). Always re-applies in place; this is the same
//    idempotency it had before this ticket.
// -----------------------------------------------------------------------
require __DIR__ . '/setup-field-group.php';

// -----------------------------------------------------------------------
// 7. Classic Cart/Checkout shortcodes -- required for the Advanced Product
//    Fields plugin's free tier, which has no Store API/Blocks integration
//    (see shop/README.md "Interface gaps").
// -----------------------------------------------------------------------
function pubquiz_ensure_page_shortcode( $page_id_option, $shortcode ) {
    $id   = (int) get_option( $page_id_option );
    $post = get_post( $id );
    if ( ! $post ) {
        WP_CLI::error( "{$page_id_option} points at post #{$id}, which does not exist." );
    }
    if ( $post->post_content !== $shortcode ) {
        pubquiz_log( "Setting page #{$id} content to {$shortcode}" );
        wp_update_post(
            array(
                'ID'           => $id,
                'post_content' => $shortcode,
            )
        );
    } else {
        pubquiz_log( "Page #{$id} content already {$shortcode}" );
    }
}

pubquiz_ensure_page_shortcode( 'woocommerce_cart_page_id', '[woocommerce_cart]' );
pubquiz_ensure_page_shortcode( 'woocommerce_checkout_page_id', '[woocommerce_checkout]' );

// -----------------------------------------------------------------------
// 8. The `order.updated` webhook. Uses WC_Webhook's own setters directly
//    (including set_delivery_url(), which the native `wp wc webhook
//    update` WP-CLI command does not expose -- see shop/README.md
//    "Interface gaps"), so unlike the old delete+recreate workaround, a
//    delivery-url change here updates the existing webhook in place and
//    keeps its id stable.
// -----------------------------------------------------------------------
define( 'PUBQUIZ_WEBHOOK_NAME', 'pubquiz-order-updated' );
define( 'PUBQUIZ_WEBHOOK_TOPIC', 'order.updated' );

function pubquiz_ensure_webhook( $name, $topic, $delivery_url, $secret ) {
    $data_store = WC_Data_Store::load( 'webhook' );
    $existing   = null;
    foreach ( $data_store->get_webhooks_ids() as $id ) {
        $webhook = new WC_Webhook( $id );
        if ( $webhook->get_name() === $name ) {
            $existing = $webhook;
            break;
        }
    }

    if ( $existing ) {
        $changed = false;
        if ( $existing->get_topic() !== $topic ) {
            $existing->set_topic( $topic );
            $changed = true;
        }
        if ( $existing->get_delivery_url() !== $delivery_url ) {
            $existing->set_delivery_url( $delivery_url );
            $changed = true;
        }
        if ( $existing->get_secret() !== $secret ) {
            $existing->set_secret( $secret );
            $changed = true;
        }
        if ( $existing->get_status() !== 'active' ) {
            $existing->set_status( 'active' );
            $changed = true;
        }
        if ( $changed ) {
            pubquiz_log( 'Updating webhook #' . $existing->get_id() );
            $existing->save();
        } else {
            pubquiz_log( 'Webhook #' . $existing->get_id() . ' already up to date.' );
        }
        return $existing->get_id();
    }

    pubquiz_log( "Creating webhook {$name}" );
    $admin   = get_user_by( 'login', 'admin' );
    $webhook = new WC_Webhook();
    $webhook->set_name( $name );
    $webhook->set_topic( $topic );
    $webhook->set_delivery_url( $delivery_url );
    $webhook->set_secret( $secret );
    $webhook->set_status( 'active' );
    $webhook->set_user_id( $admin ? $admin->ID : 1 );
    $webhook->save();
    return $webhook->get_id();
}

$pubquiz_webhook_id = pubquiz_ensure_webhook( PUBQUIZ_WEBHOOK_NAME, PUBQUIZ_WEBHOOK_TOPIC, $webhook_delivery_url, $webhook_secret );

// -----------------------------------------------------------------------
// 9. A fresh WooCommerce REST API key for the deliver module (#41).
//    Rotated on every run: WooCommerce stores only a one-way hash of the
//    consumer key (wc_api_hash()), so an existing key's plaintext can
//    never be recovered for reuse -- see shop/README.md "REST
//    credentials". Folded in from the former create-rest-api-key.php.
// -----------------------------------------------------------------------
function pubquiz_rotate_rest_api_key( $description ) {
    global $wpdb;
    $table = $wpdb->prefix . 'woocommerce_api_keys';
    $wpdb->delete( $table, array( 'description' => $description ) );

    $admin   = get_user_by( 'login', 'admin' );
    $user_id = $admin ? $admin->ID : 1;

    $consumer_key    = 'ck_' . bin2hex( random_bytes( 20 ) );
    $consumer_secret = 'cs_' . bin2hex( random_bytes( 20 ) );

    $inserted = $wpdb->insert(
        $table,
        array(
            'user_id'         => $user_id,
            'description'     => $description,
            'permissions'     => 'read_write',
            'consumer_key'    => wc_api_hash( $consumer_key ),
            'consumer_secret' => $consumer_secret,
            'truncated_key'   => substr( $consumer_key, -7 ),
        )
    );

    if ( false === $inserted ) {
        WP_CLI::error( 'Failed to insert the pubquiz-pipeline REST API key: ' . $wpdb->last_error );
    }

    pubquiz_log( "Rotated REST API key ({$description})." );
    return array( $consumer_key, $consumer_secret );
}

list( $pubquiz_consumer_key, $pubquiz_consumer_secret ) = pubquiz_rotate_rest_api_key( 'pubquiz-pipeline' );

// -----------------------------------------------------------------------
// Closing line: exactly one line of JSON on STDOUT, nothing else.
// -----------------------------------------------------------------------
echo json_encode(
    array(
        'productId'      => $pubquiz_product_id,
        'webhookId'      => $pubquiz_webhook_id,
        'deliveryUrl'    => $webhook_delivery_url,
        'consumerKey'    => $pubquiz_consumer_key,
        'consumerSecret' => $pubquiz_consumer_secret,
    )
) . "\n";
