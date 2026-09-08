<?php
/**
 * Plugin Name: Pubquiz Downloads
 * Description: Renders the deliver module's line item meta_data
 *              (pubquiz_download_<sequence>, one per Quiz -- see
 *              downloadMetaKey() in src/domain/checkout.ts) as one labelled
 *              download link per Quiz, since WooCommerce has no supported
 *              REST way to attach per-order downloadable files to a line
 *              item (see src/deliver/README.md "How downloads are
 *              attached"). A line item's quantity can be above one, so
 *              several Quizzes can share one line item -- the key's
 *              1-based sequence keeps each Quiz's link distinct. Renders in
 *              the customer order view, the completed-order email (both use
 *              the same order-details-item template, hence one hook), and
 *              My Account -> Downloads. Hides the raw meta_data key/value
 *              pairs from the customer-facing item meta table.
 *
 * This is a must-use plugin: it ships with the wp-env setup and, unmodified,
 * with the WordPress container on the VPS later. No environment guard, same
 * as pubquiz-hold-processing.php and pubquiz-operator-mail.php.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/** Keep in sync with downloadMetaKey()'s stem in src/domain/checkout.ts. */
const PUBQUIZ_DOWNLOAD_META_PREFIX = 'pubquiz_download_';

/** Matches a downloadMetaKey() key: capture group 1 is the 1-based sequence. */
const PUBQUIZ_DOWNLOAD_META_PATTERN = '/^pubquiz_download_(\d+)$/';

/**
 * Same pattern as quizZipFilename() in src/domain/orders.ts -- pinned by
 * src/domain/shop-fixture.test.ts so the two literal patterns can't
 * silently drift apart (PHP cannot import the TypeScript function).
 * `$sequence` here is already 1-based (the meta key's own convention).
 */
function pubquiz_zip_filename( $order_id, $sequence, $locale ) {
    return sprintf( 'pubquiz-%d-%d-%s.zip', $order_id, $sequence, $locale );
}

/**
 * An order item's pubquiz_download_* meta_data, keyed by the 1-based Quiz
 * sequence baked into the key (downloadMetaKey(), src/domain/checkout.ts)
 * -- a line item's quantity can be above one, so more than one Quiz's zip
 * can live on the same item.
 *
 * @param WC_Order_Item $item
 * @return array<int,string> 1-based sequence => absolute zip download URL, ordered by sequence.
 */
function pubquiz_download_urls_for_item( $item ) {
    $urls = array();
    foreach ( $item->get_meta_data() as $meta ) {
        if ( preg_match( PUBQUIZ_DOWNLOAD_META_PATTERN, $meta->key, $captured ) ) {
            $urls[ (int) $captured[1] ] = (string) $meta->value;
        }
    }
    ksort( $urls );
    return $urls;
}

/**
 * Every Quiz-zip in an order, numbered 1-based across the *whole* order --
 * not `pubquiz_download_urls_for_item`'s per-item sequence, which restarts
 * at 1 on every line item. Two different line items (two `--quiz` groups at
 * checkout, the normal multi-Quiz case) each have their own Quiz at
 * sequence 0, so using the per-item sequence directly here would give two
 * different Quizzes in one order the identical zip file name -- reproduced
 * empirically against the running local loop (ticket #73, PR review): two
 * Quizzes both named "pubquiz-<order>-1-nl.zip". This walks
 * `$order->get_items()` in its own (stable, creation-order) sequence and
 * assigns one running counter across every item's URLs, matching the order
 * `listQuizzesByOrderId` uses on the TypeScript side
 * (src/app/download/resolve-download.ts's DownloadQuizLookup).
 *
 * @param WC_Order $order
 * @return array<int,array<int,int>> item id => [per-item sequence => order-wide 1-based number].
 */
function pubquiz_order_zip_numbers( $order ) {
    static $cache = array();
    $order_id = $order->get_id();
    if ( isset( $cache[ $order_id ] ) ) {
        return $cache[ $order_id ];
    }

    $numbers = array();
    $counter = 0;
    foreach ( $order->get_items() as $item ) {
        foreach ( pubquiz_download_urls_for_item( $item ) as $sequence => $url ) {
            $counter++;
            $numbers[ $item->get_id() ][ $sequence ] = $counter;
        }
    }

    $cache[ $order_id ] = $numbers;
    return $numbers;
}

/**
 * The Quiz's picked Category names, for display beneath its download link.
 * Read from the line item's own *visible* meta_data -- the Advanced
 * Product Fields plugin writes each checkout field as
 * `$field->label => $field->value` (see pubquiz-checkout-meta.php's own
 * doc comment), so a Category pick shows up as a meta entry whose key is
 * the Dutch field label itself: "Categorie 1".."Categorie 8" today, or
 * "Categorieën" for the multiselect field (#72) -- both start with
 * "Categorie", which is the only thing this needs to match on. Not the
 * same thing as the hidden, machine-readable `pubquiz_category_N` keys
 * (pubquiz-checkout-meta.php), which this plugin never reads.
 *
 * @param WC_Order_Item $item
 * @return string[] Category names in field order, empty values skipped.
 */
function pubquiz_categories_summary_for_item( $item ) {
    $names = array();
    foreach ( $item->get_meta_data() as $meta ) {
        if ( is_string( $meta->key ) && str_starts_with( $meta->key, 'Categorie' ) ) {
            $value = (string) $meta->value;
            if ( '' !== $value ) {
                $names[] = $value;
            }
        }
    }
    return $names;
}

/**
 * Hides the raw pubquiz_download_* keys from the wp-admin order screen's item
 * meta box; the links are rendered separately below. `woocommerce_hidden_order_itemmeta`
 * only supports exact-match keys, not patterns, so this enumerates every
 * sequence up to a generous bound rather than matching the regex -- the meta
 * box only reads this list to decide what to skip, it never needs a group.
 */
add_filter(
    'woocommerce_hidden_order_itemmeta',
    function ( $hidden ) {
        foreach ( range( 1, 20 ) as $sequence ) {
            $hidden[] = PUBQUIZ_DOWNLOAD_META_PREFIX . $sequence;
        }
        return $hidden;
    }
);

/**
 * Hides the raw pubquiz_download_* keys from the *customer-facing* item meta
 * table (order-details-item.php, used by both the order view and the
 * completed-order email, and by My Account). `woocommerce_hidden_order_itemmeta`
 * above does not apply here -- WC_Order_Item::get_formatted_meta_data() only
 * skips underscore-prefixed keys for that path, so this is the filter it
 * actually runs through instead.
 */
add_filter(
    'woocommerce_order_item_get_formatted_meta_data',
    function ( $formatted_meta ) {
        foreach ( $formatted_meta as $meta_id => $meta ) {
            if ( str_starts_with( $meta->key, PUBQUIZ_DOWNLOAD_META_PREFIX ) ) {
                unset( $formatted_meta[ $meta_id ] );
            }
        }
        return $formatted_meta;
    }
);

/**
 * Renders one row per Quiz -- the zip file name as a plain link (no
 * `target`, so the download starts on the first click) with the Quiz's
 * picked Categories beneath it -- right after an order item's own meta.
 * Used by both the customer's order view and the completed-order email:
 * both render line items through the same order-details-item template,
 * which fires this action once per item.
 */
function pubquiz_render_download_links( $item_id, $item, $order ) {
    $urls = pubquiz_download_urls_for_item( $item );
    if ( empty( $urls ) ) {
        return;
    }

    $locale     = (string) $item->get_meta( 'pubquiz_locale', true );
    $categories = pubquiz_categories_summary_for_item( $item );
    $numbers    = pubquiz_order_zip_numbers( $order );

    echo '<ul class="pubquiz-downloads">';
    foreach ( $urls as $sequence => $url ) {
        $filename = pubquiz_zip_filename( $order->get_id(), $numbers[ $item->get_id() ][ $sequence ], $locale );
        echo '<li>';
        printf( '<a href="%1$s">%2$s</a>', esc_url( $url ), esc_html( $filename ) );
        if ( ! empty( $categories ) ) {
            printf(
                '<br><small class="pubquiz-downloads-categories">%s</small>',
                esc_html( 'Categorieën: ' . implode( ', ', $categories ) )
            );
        }
        echo '</li>';
    }
    echo '</ul>';
}
add_action( 'woocommerce_order_item_meta_end', 'pubquiz_render_download_links', 10, 3 );

/** Adds a row per Quiz to My Account -> Downloads for the logged-in customer. */
add_filter(
    'woocommerce_customer_get_downloadable_products',
    function ( $downloads ) {
        if ( ! is_user_logged_in() ) {
            return $downloads;
        }

        $order_ids = wc_get_orders(
            array(
                'customer_id' => get_current_user_id(),
                'limit'       => -1,
                'return'      => 'ids',
            )
        );

        foreach ( $order_ids as $order_id ) {
            $order = wc_get_order( $order_id );
            if ( ! $order ) {
                continue;
            }

            $numbers = pubquiz_order_zip_numbers( $order );

            foreach ( $order->get_items() as $item ) {
                $urls = pubquiz_download_urls_for_item( $item );
                if ( empty( $urls ) ) {
                    continue;
                }

                $locale = (string) $item->get_meta( 'pubquiz_locale', true );
                foreach ( $urls as $sequence => $url ) {
                    $filename    = pubquiz_zip_filename( $order->get_id(), $numbers[ $item->get_id() ][ $sequence ], $locale );
                    $downloads[] = array(
                        'download_url'        => $url,
                        'download_id'         => md5( $order_id . '-' . $item->get_id() . '-' . $sequence ),
                        'product_id'          => $item->get_product_id(),
                        'product_name'        => $filename,
                        'product_url'         => '',
                        'download_name'       => $filename,
                        'order_id'            => $order_id,
                        'order_key'           => $order->get_order_key(),
                        'downloads_remaining' => '',
                        'access_expires'      => '',
                        'file'                => array(
                            'name' => $filename,
                            'file' => $url,
                        ),
                    );
                }
            }
        }

        return $downloads;
    }
);
