import { describe, expect, it } from "vitest";
import { LAWS, MANDATES, RACES } from "../src/engine/content.ts";
import { SECTIONS, search } from "../src/ui/manual/content.ts";

describe("manual", () => {
  it("covers every implemented race, Law and Mandate", () => {
    for (const r of RACES) expect(SECTIONS.some((s) => s.race === r.id)).toBe(true);
    const laws = SECTIONS.find((s) => s.id === "laws")!.items!.map((i) => i.title);
    expect(laws).toEqual(LAWS.map((l) => l.name));
    const mandates = SECTIONS.find((s) => s.id === "mandates")!.items!.map((i) => i.title);
    expect(mandates).toEqual(MANDATES.map((m) => m.name));
  });

  it("has unique section ids", () => {
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
  });

  it("search finds races by name and narrows lists to matching items", () => {
    const tithe = search("tithe");
    expect(tithe.some((m) => m.section.id === "race-tithe")).toBe(true);
    const cap = search("fleet cap").find((m) => m.section.id === "laws")!;
    expect(cap.items!.map((i) => i.title)).toEqual(["Fleet Cap"]);
    expect(search("zzzz-nothing")).toEqual([]);
    expect(search("").length).toBe(SECTIONS.length);
  });
});
