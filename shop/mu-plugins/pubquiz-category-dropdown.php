<?php
/**
 * Plugin Name: Pubquiz Category Dropdown
 * Description: Turns the Advanced Product Fields `categories` checkbox
 *              group on the product page into a searchable multi-select
 *              with removable chips (spec 3c, #82/#83), using a vendored
 *              copy of Tom Select (`shop/assets/tom-select/`, MIT-style
 *              permissive licence -- see that directory's own LICENSE and
 *              VERSION files; no CDN). The checkbox group itself, and the
 *              `wapf[field_categories][]` POST format it produces, are
 *              untouched: this plugin only adds a second, cosmetic control
 *              that mirrors its selection back onto the (now hidden)
 *              checkboxes, so `pubquiz-checkout-meta.php`'s bridge and the
 *              webhook parser never see a difference. Without JavaScript
 *              nothing runs: the checkbox group stays visible and posts
 *              exactly as it did before this ticket.
 *
 * `shop/assets/tom-select/` is served through a second wp-env mapping,
 * `wp-content/mu-plugins/assets` -> `./shop/assets` (`.wp-env.json`) -- a
 * subdirectory of the existing mu-plugins mount, so `plugins_url()` (which
 * resolves relative to WPMU_PLUGIN_DIR for a file living directly in
 * `wp-content/mu-plugins`) finds it without any new top-level mount.
 *
 * The browser-side pick cap (`data-pubquiz-max-picks`) and its message
 * (`data-pubquiz-max-picks-message`) are printed from the same
 * `PUBQUIZ_MAX_CATEGORY_PICKS` / `PUBQUIZ_MAX_CATEGORY_PICKS_MESSAGE`
 * constants `pubquiz-checkout-meta.php` defines and the server-side
 * `woocommerce_add_to_cart_validation` cap check already uses, so the two
 * can never drift. Read only from inside a hook callback below (never at
 * this file's top level): all mu-plugin files finish loading, in
 * alphabetical order, before any hook fires, so it doesn't matter that
 * `pubquiz-category-dropdown.php` sorts before `pubquiz-checkout-meta.php`
 * -- the constants already exist by the time `wp_footer` runs.
 *
 * This is a must-use plugin: it ships with the wp-env setup and,
 * unmodified, with the WordPress container on the VPS later. No
 * environment guard -- the picker is meant to run in production too.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/** Field id of the Categorieën checkboxes field (setup-field-group.php). Kept in sync with pubquiz-checkout-meta.php's own copy by hand -- both are literal strings, PHP has no shared constants file across mu-plugins here. */
const PUBQUIZ_CATEGORY_DROPDOWN_FIELD_ID = 'categories';

/**
 * Read straight from `pubquiz-checkout-meta.php`'s constants -- no
 * fallback literal: the mu-plugin loader requires every top-level `.php`
 * file it finds unconditionally, and both constants are only ever read
 * from inside a hook callback (never at this file's top level, see the
 * file docblock above), so they are guaranteed to exist by the time
 * either function below runs. A missing constant is a real configuration
 * error and should fail loudly rather than silently duplicate the number
 * or the message a second place in the codebase.
 */
function pubquiz_category_dropdown_max_picks() {
    return PUBQUIZ_MAX_CATEGORY_PICKS;
}

function pubquiz_category_dropdown_max_picks_message() {
    return PUBQUIZ_MAX_CATEGORY_PICKS_MESSAGE;
}

/** The vendored Tom Select version, read from shop/assets/tom-select/VERSION -- used as both scripts' cache-busting version string. */
function pubquiz_category_dropdown_asset_version() {
    static $version = null;
    if ( null === $version ) {
        $version_file = __DIR__ . '/assets/tom-select/VERSION';
        $version      = file_exists( $version_file ) ? trim( file_get_contents( $version_file ) ) : 'unknown';
    }
    return $version;
}

/** Enqueues the vendored Tom Select JS/CSS, only on the single product page. */
function pubquiz_category_dropdown_enqueue_assets() {
    if ( ! is_product() ) {
        return;
    }

    $version = pubquiz_category_dropdown_asset_version();

    wp_enqueue_style(
        'pubquiz-tom-select',
        plugins_url( 'assets/tom-select/tom-select.min.css', __FILE__ ),
        array(),
        $version
    );

    wp_enqueue_script(
        'pubquiz-tom-select',
        plugins_url( 'assets/tom-select/tom-select.complete.min.js', __FILE__ ),
        array(),
        $version,
        true
    );
}
add_action( 'wp_enqueue_scripts', 'pubquiz_category_dropdown_enqueue_assets' );

/**
 * Prints the config + the small inline script that turns the checkbox
 * group into a Tom Select dropdown. Runs on `wp_footer` (after the
 * checkbox group has definitely rendered earlier in the page); the script
 * itself still waits for `DOMContentLoaded` before touching the DOM.
 */
function pubquiz_category_dropdown_print_script() {
    if ( ! is_product() ) {
        return;
    }
    ?>
    <div
        id="pubquiz-category-dropdown-config"
        data-pubquiz-field-id="<?php echo esc_attr( PUBQUIZ_CATEGORY_DROPDOWN_FIELD_ID ); ?>"
        data-pubquiz-max-picks="<?php echo esc_attr( pubquiz_category_dropdown_max_picks() ); ?>"
        data-pubquiz-max-picks-message="<?php echo esc_attr( pubquiz_category_dropdown_max_picks_message() ); ?>"
        hidden
    ></div>
    <div id="pubquiz-category-dropdown-notice" class="pubquiz-category-dropdown-notice" role="alert" hidden></div>
    <script>
    ( function () {
        function init() {
            var config = document.getElementById( 'pubquiz-category-dropdown-config' );
            if ( ! config || typeof window.TomSelect === 'undefined' ) {
                return;
            }

            var fieldId = config.getAttribute( 'data-pubquiz-field-id' );
            var maxPicks = parseInt( config.getAttribute( 'data-pubquiz-max-picks' ), 10 ) || 0;
            var maxPicksMessage = config.getAttribute( 'data-pubquiz-max-picks-message' ) || '';
            var notice = document.getElementById( 'pubquiz-category-dropdown-notice' );

            var container = document.querySelector(
                '.wapf-field-container.wapf-field-checkboxes[for="' + fieldId + '"]'
            );
            if ( ! container ) {
                return;
            }

            var group = container.querySelector( '.wapf-checkboxes' );
            var checkboxes = group ? Array.prototype.slice.call(
                group.querySelectorAll( 'input[type="checkbox"][data-field-id="' + fieldId + '"]' )
            ) : [];
            if ( ! group || checkboxes.length === 0 ) {
                return;
            }

            // Build the <select multiple> in DOM order (Category id order,
            // per setup-field-group.php's choice order -- see
            // shop/README.md "Pick order").
            var select = document.createElement( 'select' );
            select.multiple = true;
            select.setAttribute( 'aria-label', container.querySelector( '.wapf-field-label' )
                ? container.querySelector( '.wapf-field-label' ).textContent.trim()
                : 'Categorieën' );

            checkboxes.forEach( function ( checkbox ) {
                var label = checkbox.parentElement
                    ? checkbox.parentElement.querySelector( '.wapf-label-text' )
                    : null;
                var option = document.createElement( 'option' );
                option.value = checkbox.value;
                option.textContent = label ? label.textContent.trim() : checkbox.value;
                if ( checkbox.checked ) {
                    option.selected = true;
                }
                select.appendChild( option );
            } );

            group.hidden = true;
            group.insertAdjacentElement( 'afterend', select );

            function showNotice( message ) {
                if ( ! notice ) {
                    return;
                }
                notice.textContent = message;
                notice.hidden = ! message;
            }

            var tomSelect = new window.TomSelect( select, {
                plugins: [ 'remove_button' ],
                maxItems: maxPicks > 0 ? maxPicks : null,
                onItemAdd: function () {
                    showNotice( '' );
                },
                onOptionAdd: function () {},
                onChange: function ( values ) {
                    checkboxes.forEach( function ( checkbox ) {
                        checkbox.checked = values.indexOf( checkbox.value ) !== -1;
                    } );
                },
            } );

            // Tom Select's own maxItems silently refuses a pick beyond the
            // cap rather than firing a dedicated event for it; catch the
            // refusal on the underlying dropdown input instead so the
            // customer still sees the server's own message before ever
            // clicking "Toevoegen aan winkelwagen".
            tomSelect.on( 'dropdown_open', function () {
                if ( maxPicks > 0 && tomSelect.items.length >= maxPicks ) {
                    showNotice( maxPicksMessage );
                } else {
                    showNotice( '' );
                }
            } );
        }

        if ( document.readyState === 'loading' ) {
            document.addEventListener( 'DOMContentLoaded', init );
        } else {
            init();
        }
    } )();
    </script>
    <?php
}
add_action( 'wp_footer', 'pubquiz_category_dropdown_print_script' );
