<?php
/**
 * Plugin Name: Pubquiz Downloads
 * Description: Renders the deliver module's line item meta_data
 *              (pubquiz_download_<file>, one per Deliverable -- see
 *              downloadMetaKey() in src/domain/checkout.ts) as labelled
 *              download links, since WooCommerce has no supported REST way
 *              to attach per-order downloadable files to a line item (see
 *              src/deliver/README.md "How downloads are attached"). Renders
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

/** Keep in sync with downloadMetaKey() in src/domain/checkout.ts. */
const PUBQUIZ_DOWNLOAD_META_PREFIX = 'pubquiz_download_';

/** Keep in sync with DELIVERABLE_FILES in src/domain/orders.ts. */
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

/**
 * @param WC_Order_Item $item
 * @return array<string,string> Deliverable file name => absolute download URL.
 */
function pubquiz_download_links_for_item( $item ) {
    $links = array();
    foreach ( PUBQUIZ_DELIVERABLE_FILES as $file ) {
        $url = (string) $item->get_meta( PUBQUIZ_DOWNLOAD_META_PREFIX . $file, true );
        if ( '' !== $url ) {
            $links[ $file ] = $url;
        }
    }
    return $links;
}

/** Hides the raw pubquiz_download_* keys from the customer-facing item meta table; the links are rendered separately below. */
add_filter(
    'woocommerce_hidden_order_itemmeta',
    function ( $hidden ) {
        foreach ( PUBQUIZ_DELIVERABLE_FILES as $file ) {
            $hidden[] = PUBQUIZ_DOWNLOAD_META_PREFIX . $file;
        }
        return $hidden;
    }
);

/**
 * Renders one labelled link per attached Deliverable, right after an order
 * item's own meta. Used by both the customer's order view and the
 * completed-order email: both render line items through the same
 * order-details-item template, which fires this action once per item.
 */
function pubquiz_render_download_links( $item_id, $item, $order ) {
    $links = pubquiz_download_links_for_item( $item );
    if ( empty( $links ) ) {
        return;
    }

    $locale = (string) $item->get_meta( 'pubquiz_locale', true );
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
                $links = pubquiz_download_links_for_item( $item );
                if ( empty( $links ) ) {
                    continue;
                }

                $locale = (string) $item->get_meta( 'pubquiz_locale', true );
                foreach ( $links as $file => $url ) {
                    $label       = pubquiz_download_label( $file, $locale );
                    $downloads[] = array(
                        'download_url'        => $url,
                        'download_id'         => md5( $order_id . '-' . $item->get_id() . '-' . $file ),
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

        return $downloads;
    }
);
