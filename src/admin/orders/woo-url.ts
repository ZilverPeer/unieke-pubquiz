/**
 * The WooCommerce admin order URL a support view links to (spec 4, ticket
 * #93): the HPOS order-edit screen, `wp-admin/admin.php?page=wc-orders&
 * action=edit&id=<id>`. Pure function of the configured shop URL
 * (WOOCOMMERCE_URL, see src/deliver/config.ts) and the WooCommerce order id
 * -- no fetch, no env read, so it's trivially unit-testable and the page
 * that renders it is the only caller that touches process.env.
 */
export function wooAdminOrderUrl(shopUrl: string, wooOrderId: number): string {
  const base = shopUrl.replace(/\/+$/, "");
  return `${base}/wp-admin/admin.php?page=wc-orders&action=edit&id=${wooOrderId}`;
}
