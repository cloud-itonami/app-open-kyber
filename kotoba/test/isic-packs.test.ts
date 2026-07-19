import { describe, it, expect } from "vitest";
import {
  ISIC_SECTIONS,
  SECTION_PACKS,
  DIVISION_PACKS,
  sectionForDivision,
  divisionOf,
  resolvePacks,
} from "../src/index.js";

describe("ISIC industry-pack loader (all industries → tailored ERP)", () => {
  it("covers all 21 ISIC Rev.4 sections A–U", () => {
    expect(ISIC_SECTIONS.length).toBe(21);
    expect(ISIC_SECTIONS[0]).toBe("A");
    expect(ISIC_SECTIONS[20]).toBe("U");
    for (const s of ISIC_SECTIONS) expect(SECTION_PACKS[s].id).toBe(`pack/${s}`);
  });

  it("maps divisions to sections (mirrors open-isic sectionForDivision)", () => {
    expect(sectionForDivision("01")).toBe("A"); // agriculture
    expect(sectionForDivision("29")).toBe("C"); // motor vehicles → manufacturing
    expect(sectionForDivision("35")).toBe("D"); // electricity
    expect(sectionForDivision("64")).toBe("K"); // financial
    expect(sectionForDivision("99")).toBe("U"); // extraterritorial
    expect(() => sectionForDivision("00")).toThrow();
    expect(() => sectionForDivision("34")).toThrow(); // gap (no section)
  });

  it("normalizes 2/3/4-digit ISIC codes to a division", () => {
    expect(divisionOf("01")).toBe("01");
    expect(divisionOf("011")).toBe("01");
    expect(divisionOf("0111")).toBe("01");
    expect(divisionOf("2910")).toBe("29");
    expect(() => divisionOf("X")).toThrow();
  });

  it("resolves a manufacturing auto-maker (4-digit) to section C + division C29", () => {
    const r = resolvePacks(["2910"]);
    expect(r.packIds).toContain("pack/C");
    expect(r.packIds).toContain("pack/C29");
    // section pack ordered before the more-specific division pack
    expect(r.packIds.indexOf("pack/C")).toBeLessThan(r.packIds.indexOf("pack/C29"));
    expect(r.perCode[0]).toMatchObject({ code: "2910", section: "C", division: "29" });
  });

  it("resolves a section-only activity (no division pack) to just the section pack", () => {
    const r = resolvePacks(["6800"]); // real estate, section L, no division pack
    expect(r.packIds).toEqual(["pack/L"]);
  });

  it("dedups across multiple codes in the same section", () => {
    const r = resolvePacks(["1010", "1071"]); // both division 10 → section C + pack/C10
    expect(r.packIds.filter((p) => p === "pack/C")).toHaveLength(1);
    expect(r.packIds.filter((p) => p === "pack/C10")).toHaveLength(1);
  });

  it("empty input → generic base (no packs); malformed code skipped", () => {
    expect(resolvePacks([]).packIds).toEqual([]);
    const r = resolvePacks(["bogus", "0111"]);
    expect(r.packIds).toContain("pack/A");
    expect(r.perCode.find((c) => c.code === "bogus")?.packIds).toEqual([]);
  });

  it("every division pack's section matches its division→section mapping", () => {
    for (const p of DIVISION_PACKS) {
      expect(sectionForDivision(p.division!)).toBe(p.section);
    }
  });
});
