import { describe, expect, it } from "vitest";
import { groupsOf, type Share } from "../vitest.share.ts";
import { corpus } from "./corpus.test-support.ts";

/** This function gives the share of a test with the default timeout. */
function share(name: string, ms: number): Share {
  return { name, ms, timeout: 5000, share: ms / 5000 };
}

describe("the groups of parts of the share reporter", () => {
  it("reads the parts of one split test as one test, with the total time", () => {
    const groups = groupsOf([share("a.test.ts > one test, part 1 of 2", 300), share("a.test.ts > one test, part 2 of 2", 700)]);
    expect(groups).toEqual([{ name: "a.test.ts > one test", parts: 2, ms: 1000, share: 0.2, fraction: 1 }]);
  });

  it("reads the name that the function corpus gives to a part", () => {
    const names = corpus(10, 5).parts.map((part) => "a.test.ts > one test, " + part.name);
    expect(groupsOf(names.map((name) => share(name, 100))).map((group) => [group.name, group.parts])).toEqual([["a.test.ts > one test", 2]]);
  });

  it("puts a test with no part name in no group, and counts its time in the fraction", () => {
    const groups = groupsOf([share("a.test.ts > the last test", 750), share("a.test.ts > one test, part 1 of 1", 250)]);
    expect(groups.map((group) => [group.name, group.fraction])).toEqual([["a.test.ts > one test", 0.25]]);
  });

  it("keeps the same test name in two files apart, and gives the largest share first", () => {
    const groups = groupsOf([share("a.test.ts > one test, part 1 of 1", 100), share("b.test.ts > one test, part 1 of 1", 900)]);
    expect(groups.map((group) => group.name)).toEqual(["b.test.ts > one test", "a.test.ts > one test"]);
  });

  it("gives no group for a run with no parts", () => {
    expect(groupsOf([share("a.test.ts > the last test", 100)])).toEqual([]);
  });
});
