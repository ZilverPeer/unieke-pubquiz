import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "./verify-signature";

const SECRET = "test-secret";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

describe("verifySignature", () => {
  it("accepts a signature computed over the exact raw body with the shared secret", () => {
    const body = JSON.stringify({ id: 14, status: "processing" });

    expect(verifySignature(body, sign(body, SECRET), SECRET)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const body = JSON.stringify({ id: 14, status: "processing" });

    expect(verifySignature(body, sign(body, "not-the-secret"), SECRET)).toBe(false);
  });

  it("rejects a signature computed over a different body (tampered payload)", () => {
    const body = JSON.stringify({ id: 14, status: "processing" });
    const signatureForOtherBody = sign(JSON.stringify({ id: 14, status: "cancelled" }), SECRET);

    expect(verifySignature(body, signatureForOtherBody, SECRET)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    const body = JSON.stringify({ id: 14, status: "processing" });

    expect(verifySignature(body, null, SECRET)).toBe(false);
  });
});
