<?php
/**
 * Plugin Name: Pubquiz Test Gateway
 * Description: Local-only WooCommerce payment gateway that always succeeds
 *              and moves the order straight to `processing`, never
 *              `completed`, regardless of the Pubquiz product being virtual
 *              and downloadable (WooCommerce's default payment_complete()
 *              would otherwise jump straight to `completed` for a fully
 *              virtual order, skipping the status the pipeline's webhook
 *              listens for). Used by both the order-placing script and a
 *              real Store API checkout (spec #36, ticket #37). Never enable
 *              this outside local development.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
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
                $order->update_status( 'processing', 'Paid via the local Pubquiz test gateway.' );
                $order->save();

                if ( function_exists( 'wc_reduce_stock_levels' ) ) {
                    wc_reduce_stock_levels( $order_id );
                }
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
