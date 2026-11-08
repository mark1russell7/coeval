import { describe, expect, it } from "vitest";
import { acceptHold, acceptedRecords, readAccepted } from "./accepted.ts";

const RECORD = { case: "x", head: "abcdef012345", cost: "+10 %", reason: "a test", owner: "coeval" };
const file = (records: unknown) => ({ name: "1.json", text: typeof records === "string" ? records : JSON.stringify(records) });

describe("the records that accept a held slower reading (K239, D173)", () => {
  it("reads a list of correct records, with the name of their file", () => {
    expect(acceptedRecords([file([RECORD])])).toEqual({ records: [{ ...RECORD, file: "1.json" }], faults: [] });
  });

  it("gives a fault for a file that is not JSON, not a list, or an empty list", () => {
    expect(acceptedRecords([file("not JSON")]).faults).toEqual(["The file accepted/1.json is not JSON (K239)."]);
    expect(acceptedRecords([file(RECORD)]).faults).toEqual(["The file accepted/1.json is not a list of records (K239)."]);
    expect(acceptedRecords([file([])]).faults).toEqual(["The file accepted/1.json is not a list of records (K239)."]);
  });

  it("gives a fault for each empty or absent field, and no record of that file counts", () => {
    const read = acceptedRecords([file([RECORD, { ...RECORD, cost: "", reason: undefined }])]);
    expect(read.records).toEqual([]);
    expect(read.faults).toEqual(["The record 2 of accepted/1.json has no cost, reason (K239)."]);
  });

  it("gives a fault for a head that is not 12 to 64 characters of a hash", () => {
    for (const head of ["abc", "ABCDEF012345", "abcdef01234g"]) expect(acceptedRecords([file([{ ...RECORD, head }])]).faults).toHaveLength(1);
  });

  it("accepts a case only on a head of the hash of its record, in each run", () => {
    const records = acceptedRecords([file([RECORD])]).records;
    const full = "abcdef0123456789";
    expect(acceptHold(["x"], [full, full], records)).toMatchObject({ missing: [], accepted: [{ case: "x" }] });
    expect(acceptHold(["x"], [full, "abcdef0123450000"], records).missing).toEqual(["x"]);
    expect(acceptHold(["x"], [full, undefined], records).missing).toEqual(["x"]);
    expect(acceptHold(["x"], ["ffffff0123456789", "ffffff0123456789"], records).missing).toEqual(["x"]);
    expect(acceptHold(["x", "y"], [full, full], records)).toMatchObject({
      missing: ["y"],
      lines: [expect.stringContaining("Accepted (K239): x"), expect.stringContaining("Not accepted (K239): y")],
    });
  });

  it("reads no records from a folder that does not exist", () => {
    expect(readAccepted("no-such-folder-of-records")).toEqual({ records: [], faults: [] });
  });
});
