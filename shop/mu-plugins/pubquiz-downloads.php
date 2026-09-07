<?php
/**
 * Plugin Name: Pubquiz Downloads
 * Description: Renders the deliver module's line item meta_data
 *              (pubquiz_download_<sequence>_<file>, one per Deliverable per
 *              Quiz -- see downloadMetaKey() in src/domain/checkout.ts) as
 *              labelled download links, since WooCommerce has no supported
 *              REST way to attach per-order downloadable files to a line
 *              item (see src/deliver/README.md "How downloads are
 *              attached"). A line item's quantity can be above one, so
 *              several Quizzes can share one line item -- the key's
 *              1-based sequence keeps each Quiz's four files distinct, and
 *              this plugin groups them back by sequence, showing a "Quiz N"
 *              heading per group only when there is more than one. Renders
 *              in the customer order view, the completed-order email (both
 *              use the same order-details-item template, hence one hook),
 *              and My Account -> Downloads. Hides the raw meta_data
 *              key/value pairs from the customer-facing item meta table.
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

/** Matches a downloadMetaKey() key: capture group 1 is the 1-based sequence, group 2 the file name. */
const PUBQUIZ_DOWNLOAD_META_PATTERN = '/^pubquiz_download_(\d+)_(.+)$/';

/** Keep in sync with DELIVERABLE_FILES in src/domain/orders.ts -- display order within a Quiz's group. */
const PUBQUIZ_DELIVERABLE_FILES = array( 'quizmaster.pdf', 'picture-handout.pdf', 'answer-sheet.pdf', 'music-round.mp3' );

/**
 * Dutch labels with an English fallback, keyed by file name and the
 * `pubquiz_locale` line item meta -- PHP shop text, not the Next.js admin
 * UI, so this hand-kept table (not next-intl) is fine here.
 */
function pubquiz_download_label( $file, $locale ) {
    $labels = array(
        'nl' => array(
            'quizmaster.pdf'      => 'Quizmaster-script',
            'picture-handout.pdf' => 'Beeldronde hand-out',
            'answer-sheet.pdf'    => 'Antwoordenblad',
            'music-round.mp3'     => 'Muziekronde',
        ),
        'en' => array(
            'quizmaster.pdf'      => 'Quizmaster script',
            'picture-handout.pdf' => 'Picture round handout',
            'answer-sheet.pdf'    => 'Answer sheet',
            'music-round.mp3'     => 'Music round',
        ),
    );

    $set = isset( $labels[ $locale ] ) ? $labels[ $locale ] : $labels['en'];
    return isset( $set[ $file ] ) ? $set[ $file ] : $file;
}

/** "Quiz N" heading for a group -- same word in Dutch and English, so no locale table needed. */
function pubquiz_quiz_heading( $sequence ) {
    return sprintf( 'Quiz %d', $sequence );
}

/**
 * Groups an order item's pubquiz_download_* meta_data by the Quiz sequence
 * baked into the key (downloadMetaKey(), src/domain/checkout.ts) -- a line
 * item's quantity can be above one, so more than one Quiz's files can live
 * on the same item.
 *
 * @param WC_Order_Item $item
 * @return array<int,array<string,string>> 1-based sequence => (Deliverable file name => absolute download URL), ordered by sequence then by PUBQUIZ_DELIVERABLE_FILES.
 */
function pubquiz_download_groups_for_item( $item ) {
    $groups = array();
    foreach ( $item->get_meta_data() as $meta ) {
        if ( preg_match( PUBQUIZ_DOWNLOAD_META_PATTERN, $meta->key, $captured ) ) {
            $sequence                          = (int) $captured[1];
            $file                              = $captured[2];
            $groups[ $sequence ][ $file ] = (string) $meta->value;
        }
    }
    ksort( $groups );
    foreach ( $groups as $sequence => $files ) {
        uksort(
            $files,
            fn( $a, $b ) => array_search( $a, PUBQUIZ_DELIVERABLE_FILES, true ) <=> array_search( $b, PUBQUIZ_DELIVERABLE_FILES, true )
        );
        $groups[ $sequence ] = $files;
    }
    return $groups;
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
            foreach ( PUBQUIZ_DELIVERABLE_FILES as $file ) {
                $hidden[] = PUBQUIZ_DOWNLOAD_META_PREFIX . $sequence . '_' . $file;
            }
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
 * Renders one labelled link per attached Deliverable, right after an order
 * item's own meta. Used by both the customer's order view and the
 * completed-order email: both render line items through the same
 * order-details-item template, which fires this action once per item.
 */
function pubquiz_render_download_links( $item_id, $item, $order ) {
    $groups = pubquiz_download_groups_for_item( $item );
    if ( empty( $groups ) ) {
        return;
    }

    $locale     = (string) $item->get_meta( 'pubquiz_locale', true );
    $show_headings = count( $groups ) > 1; // only when the line item's quantity is above one
    foreach ( $groups as $sequence => $links ) {
        if ( $show_headings ) {
            printf( '<p class="pubquiz-downloads-heading"><strong>%s</strong></p>', esc_html( pubquiz_quiz_heading( $sequence ) ) );
        }
        echo '<ul class="pubquiz-downloads">';
        foreach ( $links as $file => $url ) {
            printf(
                '<li><a href="%1$s">%2$s</a></li>',
                esc_url( $url ),
                esc_html( pubquiz_download_label( $file, $locale ) )
            );
        }
        echo '</ul>';
    }
}
add_action( 'woocommerce_order_item_meta_end', 'pubquiz_render_download_links', 10, 3 );

/** Adds a row per attached Deliverable to My Account -> Downloads for the logged-in customer. */
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

            foreach ( $order->get_items() as $item ) {
                $groups = pubquiz_download_groups_for_item( $item );
                if ( empty( $groups ) ) {
                    continue;
                }

                $locale        = (string) $item->get_meta( 'pubquiz_locale', true );
                $show_sequence = count( $groups ) > 1; // only when the line item's quantity is above one
                foreach ( $groups as $sequence => $links ) {
                    foreach ( $links as $file => $url ) {
                        $label = pubquiz_download_label( $file, $locale );
                        if ( $show_sequence ) {
                            $label = pubquiz_quiz_heading( $sequence ) . ' – ' . $label;
                        }
                        $downloads[] = array(
                            'download_url'        => $url,
                            'download_id'         => md5( $order_id . '-' . $item->get_id() . '-' . $sequence . '-' . $file ),
                            'product_id'          => $item->get_product_id(),
                            'product_name'        => $label,
                            'product_url'         => '',
                            'download_name'       => $label,
                            'order_id'            => $order_id,
                            'order_key'           => $order->get_order_key(),
                            'downloads_remaining' => '',
                            'access_expires'      => '',
                            'file'                => array(
                                'name' => $label,
                                'file' => $url,
                            ),
                        );
                    }
                }
            }
        }

        return $downloads;
    }
);
