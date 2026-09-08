import { describe, expect, it } from "vitest";
import { wooAdminOrderUrl } from "./woo-url";

describe("wooAdminOrderUrl", () => {
  it("builds the HPOS admin order URL for a shop URL without a trailing slash", () => {
    expect(wooAdminOrderUrl("http://localhost:45330", 123)).toBe(
      "http://localhost:45330/wp-admin/admin.php?page=wc-orders&action=edit&id=123",
    );
  });

  it("strips a trailing slash from the shop URL", () => {
    expect(wooAdminOrderUrl("http://localhost:45330/", 123)).toBe(
      "http://localhost:45330/wp-admin/admin.php?page=wc-orders&action=edit&id=123",
    );
  });

  it("strips multiple trailing slashes", () => {
    expect(wooAdminOrderUrl("http://localhost:45330//", 123)).toBe(
      "http://localhost:45330/wp-admin/admin.php?page=wc-orders&action=edit&id=123",
    );
  });

  it("interpolates the WooCommerce order id", () => {
    expect(wooAdminOrderUrl("http://localhost:45330", 987654)).toBe(
      "http://localhost:45330/wp-admin/admin.php?page=wc-orders&action=edit&id=987654",
    );
  });
});
