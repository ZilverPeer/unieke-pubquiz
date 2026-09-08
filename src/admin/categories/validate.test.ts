import { describe, expect, it } from "vitest";
import { validateAddNode, validateDeleteNode, validateRenameNode } from "./validate";

describe("validateAddNode", () => {
  it("accepts a Category with both names, no parent required", () => {
    const result = validateAddNode({ level: "category", parentId: null, nameNl: "Sport", nameEn: "Sports" });
    expect(result).toEqual({ ok: true, value: { level: "category", parentId: null, names: { nl: "Sport", en: "Sports" } } });
  });

  it("trims names", () => {
    const result = validateAddNode({ level: "category", parentId: null, nameNl: "  Sport  ", nameEn: " Sports " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.names).toEqual({ nl: "Sport", en: "Sports" });
  });

  it("requires a valid parentId for a Subcategory", () => {
    const result = validateAddNode({ level: "subcategory", parentId: "not-a-number", nameNl: "Voetbal", nameEn: "Football" });
    expect(result).toEqual({ ok: false, errors: { parentId: "categories.errors.invalidParent" } });
  });

  it("requires a valid parentId for a Subsubcategory", () => {
    const result = validateAddNode({ level: "subsubcategory", parentId: null, nameNl: "Eredivisie", nameEn: "Eredivisie" });
    expect(result).toEqual({ ok: false, errors: { parentId: "categories.errors.invalidParent" } });
  });

  it("rejects an empty nl name", () => {
    const result = validateAddNode({ level: "category", parentId: null, nameNl: "  ", nameEn: "Sports" });
    expect(result).toEqual({ ok: false, errors: { nameNl: "categories.errors.nameRequired" } });
  });

  it("rejects an empty en name", () => {
    const result = validateAddNode({ level: "category", parentId: null, nameNl: "Sport", nameEn: "" });
    expect(result).toEqual({ ok: false, errors: { nameEn: "categories.errors.nameRequired" } });
  });

  it("rejects a name over 120 characters", () => {
    const tooLong = "a".repeat(121);
    const result = validateAddNode({ level: "category", parentId: null, nameNl: tooLong, nameEn: "Sports" });
    expect(result).toEqual({ ok: false, errors: { nameNl: "categories.errors.nameTooLong" } });
  });

  it("accepts a name of exactly 120 characters", () => {
    const maxLength = "a".repeat(120);
    const result = validateAddNode({ level: "category", parentId: null, nameNl: maxLength, nameEn: "Sports" });
    expect(result.ok).toBe(true);
  });

  it("rejects an invalid level", () => {
    const result = validateAddNode({ level: "nonsense", parentId: null, nameNl: "Sport", nameEn: "Sports" });
    expect(result).toEqual({ ok: false, errors: { level: "categories.errors.invalidLevel" } });
  });

  it("reports every field error at once, nothing written", () => {
    const result = validateAddNode({ level: "subcategory", parentId: null, nameNl: "", nameEn: "" });
    expect(result).toEqual({
      ok: false,
      errors: {
        parentId: "categories.errors.invalidParent",
        nameNl: "categories.errors.nameRequired",
        nameEn: "categories.errors.nameRequired",
      },
    });
  });
});

describe("validateRenameNode", () => {
  it("accepts a valid rename", () => {
    const result = validateRenameNode({ level: "category", id: "3", locale: "nl", name: "Sport" });
    expect(result).toEqual({ ok: true, value: { level: "category", id: 3, locale: "nl", name: "Sport" } });
  });

  it("rejects an invalid locale", () => {
    const result = validateRenameNode({ level: "category", id: "3", locale: "fr", name: "Sport" });
    expect(result).toEqual({ ok: false, errors: { locale: "categories.errors.invalidLocale" } });
  });

  it("rejects a non-numeric id", () => {
    const result = validateRenameNode({ level: "category", id: "abc", locale: "nl", name: "Sport" });
    expect(result).toEqual({ ok: false, errors: { id: "categories.errors.invalidId" } });
  });

  it("rejects an empty name", () => {
    const result = validateRenameNode({ level: "category", id: "3", locale: "nl", name: "   " });
    expect(result).toEqual({ ok: false, errors: { name: "categories.errors.nameRequired" } });
  });
});

describe("validateDeleteNode", () => {
  it("accepts a valid delete request", () => {
    const result = validateDeleteNode({ level: "subsubcategory", id: "5" });
    expect(result).toEqual({ ok: true, value: { level: "subsubcategory", id: 5 } });
  });

  it("rejects an invalid level", () => {
    const result = validateDeleteNode({ level: "nonsense", id: "5" });
    expect(result).toEqual({ ok: false, errors: { level: "categories.errors.invalidLevel" } });
  });

  it("rejects a zero or negative id", () => {
    const result = validateDeleteNode({ level: "category", id: "0" });
    expect(result).toEqual({ ok: false, errors: { id: "categories.errors.invalidId" } });
  });
});
