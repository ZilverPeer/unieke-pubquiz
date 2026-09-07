/**
 * WooCommerce webhook signature verification (spec #36, ticket #39):
 * `X-WC-Webhook-Signature: base64(hmac-sha256(body, secret))`, computed over
 * the exact raw request body bytes -- see shop/README.md "The webhook".
 * Constant-time comparison so response timing never leaks how much of the
 * signature matched.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifySignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(signatureHeader, "utf8");

  // timingSafeEqual throws on a length mismatch rather than returning
  // false, so the differing-length case (any tampered/garbage header the
  // right length is astronomically unlikely to reach) is handled first.
  if (expectedBytes.length !== actualBytes.length) return false;

  return timingSafeEqual(expectedBytes, actualBytes);
}
