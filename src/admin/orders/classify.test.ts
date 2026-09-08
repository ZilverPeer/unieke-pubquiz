import { describe, expect, it } from "vitest";
import { classifyQuery } from "./classify";

describe("classifyQuery", () => {
  it("classifies a digits-only string as an order number", () => {
    expect(classifyQuery("12345")).toEqual({ kind: "order-number" });
  });

  it("trims surrounding whitespace before classifying as an order number", () => {
    expect(classifyQuery("  987  ")).toEqual({ kind: "order-number" });
  });

  it("classifies a string containing @ as an email", () => {
    expect(classifyQuery("customer@example.com")).toEqual({ kind: "email" });
  });

  it("classifies an empty string as invalid", () => {
    expect(classifyQuery("   ")).toEqual({ kind: "invalid" });
  });

  it("classifies a string that is neither digits-only nor an email as invalid", () => {
    expect(classifyQuery("abc123")).toEqual({ kind: "invalid" });
  });
});
