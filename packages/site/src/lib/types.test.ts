import { describe, expect, it } from "vitest";
import { STD_MACHINE, formulaMachine, type Json } from "@mark1russell7/coeval";
import { placeTypes } from "./types.ts";
import { pathKey } from "../glyphs/overlay.ts";
import { PROGRAMS } from "./programs.ts";
import { SITE_MACHINE } from "../glyphs/Explorer.tsx";
import { readText } from "./syntax.ts";

const machine = formulaMachine({ ops: { add: (a: number, b: number) => a + b }, sigs: { add: { params: ["number", "number"], to: "number" } } });
const add = (...value: Json[]): Json => ({ type: ["ops", "add"], value });
const lit = (value: Json): Json => ({ type: "lit", value });

describe("the types of the cards of a picture", () => {
  it("gives the text of the type of each card", () => {
    const found = placeTypes(machine, add(lit(1), lit(2)), {});
    expect(found.types.get(pathKey([]))).toBe("number");
    expect(found.issues).toEqual([]);
    expect(found.marked.size).toBe(0);
  });

  it("gives each #TYPE! issue at the path of its card", () => {
    const found = placeTypes(machine, add(lit("a"), lit(2)), {});
    expect(found.issues).toHaveLength(1);
    expect(found.marked.get(pathKey(found.issues[0]?.path ?? []))).toBe("#TYPE!");
  });

  it("gives the #VALUE! issue of a bare text at a place of the kind number, and marks its card (K243, D185)", () => {
    const read = readText('1 + "a"');
    if (!read.ok) throw new Error("The text does not parse.");
    const found = placeTypes(SITE_MACHINE, read.doc, {});
    expect(found.issues).toEqual([{ path: ["1"], code: "#VALUE!", reason: "The value must be a number. The kind is number." }]);
    expect(found.marked).toEqual(new Map([[pathKey(["1"]), "#VALUE!"]]));
    // A card of the kind text at that place gives a #TYPE! issue: the kind of the card is not the kind of the place.
    const text = readText('1 + text("a")');
    if (!text.ok) throw new Error("The text does not parse.");
    expect(placeTypes(SITE_MACHINE, text.doc, {}).issues.map((item) => item.code)).toEqual(["#TYPE!"]);
  });

  it("knows each name of the context", () => {
    const doc: Json = { type: "ref", value: ["names", "n"] };
    expect(placeTypes(machine, doc, { n: 1 }).issues).toEqual([]);
  });

  it("gives a type for a document of the standard machine", () => {
    const doc: Json = { type: "list", value: [lit(1), lit(2)] };
    expect(placeTypes(STD_MACHINE, doc, {}).types.size).toBeGreaterThan(0);
  });
});

describe("the programs of the site", () => {
  it("have no false #TYPE! mark, so that a picture of the guide stays clean", () => {
    for (const program of PROGRAMS) expect(placeTypes(SITE_MACHINE, program.doc, program.names ?? {}).issues, program.id).toEqual([]);
  });

  it("show a type for the root of each document", () => {
    const typed = PROGRAMS.filter((program) => placeTypes(SITE_MACHINE, program.doc, program.names ?? {}).types.get(pathKey([])) !== "unknown");
    expect(typed.length).toBeGreaterThan(0);
  });
});
