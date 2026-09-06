<?php
/**
 * Plugin Name: Pubquiz Test Gateway
 * Description: Local-only WooCommerce payment gateway that always succeeds.
 *              Calls the order's standard payment_complete() exactly like a
 *              real gateway would -- it does NOT special-case the resulting
 *              status itself. Holding the order at `processing` instead of
 *              WooCommerce's default `completed` (for a fully virtual,
 *              downloadable product) is pubquiz-hold-processing.php's job,
 *              so that this gateway proves the same path production
 *              gateways take. Used by both the order-placing script and a
 *              real checkout (spec #36, ticket #37). Never enable this
 *              outside local development.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// Belt-and-braces: never register this gateway outside local development,
// even if this mu-plugin were ever mapped into a non-local wp-env config.
if ( ! in_array( wp_get_environment_type(), [ 'local', 'development' ], true ) ) {
    return;
}

add_action(
    'plugins_loaded',
    function () {
        if ( ! class_exists( 'WC_Payment_Gateway' ) || class_exists( 'Pubquiz_Test_Gateway' ) ) {
            return;
        }

        class Pubquiz_Test_Gateway extends WC_Payment_Gateway {
            public function __construct() {
                $this->id                 = 'pubquiz_test_gateway';
                $this->method_title       = 'Pubquiz Test Gateway';
                $this->method_description = 'Always succeeds and sets the order to processing. Local development only.';
                $this->has_fields         = false;
                $this->title              = 'Test payment (local only)';

                $this->init_form_fields();
                $this->init_settings();

                $this->enabled = $this->get_option( 'enabled', 'yes' );
                $this->title   = $this->get_option( 'title', $this->title );

                add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, [ $this, 'process_admin_options' ] );
            }

            public function init_form_fields() {
                $this->form_fields = [
                    'enabled' => [
                        'title'   => 'Enable/Disable',
                        'type'    => 'checkbox',
                        'label'   => 'Enable Pubquiz Test Gateway',
                        'default' => 'yes',
                    ],
                    'title'   => [
                        'title'       => 'Title',
                        'type'        => 'text',
                        'default'     => 'Test payment (local only)',
                        'desc_tip'    => true,
                    ],
                ];
            }

            public function process_payment( $order_id ) {
                $order = wc_get_order( $order_id );
                $order->set_transaction_id( 'pubquiz-test-' . $order_id );
                $order->payment_complete();

                if ( WC()->cart ) {
                    WC()->cart->empty_cart();
                }

                return [
                    'result'   => 'success',
                    'redirect' => $this->get_return_url( $order ),
                ];
            }
        }

        add_filter(
            'woocommerce_payment_gateways',
            function ( $gateways ) {
                $gateways[] = 'Pubquiz_Test_Gateway';
                return $gateways;
            }
        );
    }
);
