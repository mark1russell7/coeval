import { describe, expect, it } from "vitest";
import {
  STD_CAPS,
  STD_MACHINE,
  THING,
  agree,
  check,
  context,
  evaluate,
  fail,
  flatten,
  isHostThing,
  lookupKind,
  makeContext,
  nearestWalker,
  nodeAt,
  ok,
  placeOf,
  prepare,
  ref,
  resolve,
  typed,
  worldThing,
  type HostThing,
  type Json,
  type Key,
  type Machine,
  type Resolution,
  type Result,
  type Thing,
  type WalkInput,
  type Walker,
  type DerefCode,
  mergeMachines,
} from "./index.ts";
import { compilePath } from "./deref.ts";

const run = (doc: Json, names: Record<string, Json> = {}) => evaluate(STD_MACHINE, doc, makeContext(names, STD_CAPS));

describe("resolve", () => {
  const ctx = context({ names: { cards: { ids: [7, 8] } }, world: worldThing(STD_MACHINE.world) });

  it("[DEREF.ROOT] starts at a root of the context, and goes into fields and items", () => {
    const found = resolve(STD_MACHINE, ctx, ["names", "cards", "ids", 1]);
    expect(found).toMatchObject({ ok: true, thing: 8 });
    if (found.ok) expect(found.hops.map((hop) => hop.by)).toEqual(["root", "default", "default", "default"]);
  });

  it("[DEREF.NO-ROOT] refuses a path without a root", () => {
    expect(resolve(STD_MACHINE, ctx, ["cards", "ids"])).toMatchObject({ ok: false, code: "#REF!" });
  });

  it("[DEREF.MISS] gives #N/A for a step that reaches nothing, with the hops before it", () => {
    const found = resolve(STD_MACHINE, ctx, ["names", "cards", "count"]);
    expect(found).toMatchObject({ ok: false, code: "#N/A" });
    expect(found.hops).toHaveLength(2);
  });

  it("[DEREF.COLLAPSE] follows a reference that a step reaches (collapse)", () => {
    const aliasCtx = context({ names: { alias: ref("names", "real"), real: 42 } });
    const found = resolve(STD_MACHINE, aliasCtx, ["names", "alias"]);
    expect(found).toMatchObject({ ok: true, thing: 42 });
    if (found.ok) expect(found.hops.some((hop) => hop.by === "collapse")).toBe(true);
  });

  it("[DEREF.CYCLE] stops a cycle of references with #CYCLE!", () => {
    const loop = context({ names: { a: ref("names", "b"), b: ref("names", "a") } });
    expect(resolve(STD_MACHINE, loop, ["names", "a"])).toMatchObject({ ok: false, code: "#CYCLE!" });
  });

  it("[DEREF.HOST] lets a host thing answer its own steps", () => {
    const thing: HostThing = {
      [THING]: true,
      label: "counter",
      deref: (key: Key): Thing | undefined => (key === "double" ? 84 : undefined),
      toJson: () => 42,
    };
    expect(resolve(STD_MACHINE, context({ self: thing }), ["self", "double"])).toMatchObject({ ok: true, thing: 84 });
  });

  it("[DEREF.HOST-UNDEFINED] a host thing tells a field that holds undefined from a missing field, with has or with resolve", () => {
    const fields: Record<string, unknown> = { gone: undefined, here: 1 };
    const old: HostThing = { [THING]: true, label: "fields", deref: (key) => fields[String(key)], toJson: () => fields };
    const told: HostThing = { ...old, has: (key) => Object.hasOwn(fields, String(key)) };
    const paths: HostThing = { ...old, resolve: (keys) => (keys.length === 1 && Object.hasOwn(fields, String(keys[0])) ? { thing: fields[String(keys[0])] } : undefined) };
    const read = (self: HostThing, step: string, hops = true) => resolve(STD_MACHINE, context({ self }), ["self", step], { hops });
    const holdsUndefined = (found: ReturnType<typeof read>): boolean => found.ok && found.thing === undefined;
    // A thing without has keeps the old reading: undefined is a missing field.
    expect(read(old, "gone")).toMatchObject({ ok: false, code: "#N/A" });
    expect(holdsUndefined(read(told, "gone"))).toBe(true);
    expect(read(told, "nope")).toMatchObject({ ok: false, code: "#N/A" });
    expect(read(told, "here")).toMatchObject({ ok: true, thing: 1 });
    for (const hops of [true, false]) {
      expect(holdsUndefined(read(paths, "gone", hops))).toBe(true);
      expect(read(paths, "nope", hops)).toMatchObject({ ok: false, code: "#N/A" });
    }
  });

  it("[DEREF.HOST-UNDEFINED] a host that adopts the names root keeps a name that is bound to undefined", () => {
    const names: Record<string, unknown> = { gone: undefined };
    const adopt = (withHas: boolean) => (value: unknown): unknown =>
      value !== names
        ? value
        : { [THING]: true, label: "names", deref: (key: Key) => names[String(key)], toJson: () => names, ...(withHas ? { has: (key: Key) => Object.hasOwn(names, String(key)) } : {}) };
    const doc = ref("names", "gone");
    expect(evaluate({ ...STD_MACHINE, adopt: adopt(true) }, doc, context({ names })).result).toEqual(ok(undefined));
    expect(evaluate({ ...STD_MACHINE, adopt: adopt(false) }, doc, context({ names })).result).toMatchObject({ ok: false, error: { code: "#NAME?" } });
    expect(evaluate({ ...STD_MACHINE, adopt: adopt(true) }, ref("names", "nope"), context({ names })).result).toMatchObject({ ok: false, error: { code: "#NAME?" } });
  });

  it("[WORLD.WALK] walks the world, and follows an alias of a namespace", () => {
    expect(resolve(STD_MACHINE, ctx, ["world", "math", "sum", "verbs", "eval"])).toMatchObject({ ok: true, thing: "math.add" });
  });
});

describe("a field that holds undefined behind the code of a kind and in a walker", () => {
  const fields: Record<string, unknown> = { gone: undefined, here: 1 };
  const hasField = (key: Key): boolean => Object.hasOwn(fields, String(key));
  const old: DerefCode = (_doc, key) => fields[String(key)];
  const told: DerefCode = Object.assign((_doc: unknown, key: Key) => fields[String(key)], { has: (_doc: unknown, key: Key) => hasField(key) });
  /** A walker that steps by the key of its document. It tells a field that holds undefined with `has`. */
  const pick: Walker = ({ data, here, deref, has }) => {
    const key = data as Key;
    const reached = deref(here, key);
    return reached !== undefined || has?.(here, key) === true ? { ok: true, thing: reached } : { ok: false, reason: `No field ${String(key)}.` };
  };
  const machine = mergeMachines(STD_MACHINE, {
    world: { kinds: { old: { verbs: { deref: "test.old" } }, told: { verbs: { deref: "test.told" } }, pick: { verbs: { step: "test.pick" } } } },
    derefs: { "test.old": old, "test.told": told },
    walkers: { "test.pick": pick },
  });
  const oldHost: HostThing = { [THING]: true, label: "fields", deref: (key) => fields[String(key)], toJson: () => fields };
  const toldHost: HostThing = { ...oldHost, has: hasField };
  const ctx = context({
    names: { old: { type: "old", value: null }, told: { type: "told", value: null }, data: { gone: undefined, here: 1 }, oldHost, toldHost },
  });
  const step = (key: string): Json => ({ type: "pick", value: key });
  const holdsUndefined = (found: Resolution): boolean => found.ok && found.thing === undefined;
  /** This function tells that the reference, a plan, a compiled path and resolve without hops give one answer. */
  const same = (path: readonly Json[]): Resolution => {
    const found = resolve(machine, ctx, path);
    const quick = resolve(machine, ctx, path, { hops: false });
    const { hops: _hops, ...answer } = found;
    expect({ ...quick, hops: [] }).toEqual({ ...answer, hops: [] });
    expect(compilePath(machine, path).resolve(ctx)).toEqual(quick);
    const outcome = agree(machine, ref(...path), ctx, { strict: true });
    expect(outcome.ok).toBe(true);
    if (outcome.ok && found.ok) expect(outcome.result).toEqual(ok(found.thing));
    if (outcome.ok && !found.ok) expect(outcome.result).toMatchObject({ ok: false, error: { code: found.code, reason: found.reason } });
    return found;
  };

  it("[DEREF.KIND-UNDEFINED] the has of the code of a kind tells a field that holds undefined from a missing field", () => {
    // A code without has keeps the old reading: undefined is a missing field.
    expect(same(["names", "old", "gone"])).toMatchObject({ ok: false, code: "#N/A" });
    const found = same(["names", "told", "gone"]);
    expect(holdsUndefined(found)).toBe(true);
    expect(found.hops.at(-1)?.by).toBe("kind");
    expect(same(["names", "told", "nope"])).toMatchObject({ ok: false, code: "#N/A" });
    expect(same(["names", "told", "here"])).toMatchObject({ ok: true, thing: 1 });
    expect(evaluate(machine, ref("names", "told", "gone"), ctx).result).toEqual(ok(undefined));
    expect(prepare(machine, ref("names", "told", "gone")).evaluate(ctx)).toEqual(ok(undefined));
  });

  it("[DEREF.WALKER-UNDEFINED] the has of the input of a walker tells a field that holds undefined from a missing field, on each rung", () => {
    for (const name of ["told", "data", "toldHost"]) {
      expect(holdsUndefined(same(["names", name, step("gone")]))).toBe(true);
      expect(same(["names", name, step("nope")])).toMatchObject({ ok: false, code: "#N/A" });
      expect(same(["names", name, step("here")])).toMatchObject({ ok: true, thing: 1 });
    }
    // A code of a kind and a host thing without has keep the old reading.
    for (const name of ["old", "oldHost"]) expect(same(["names", name, step("gone")])).toMatchObject({ ok: false, code: "#N/A" });
    // A resolution gives has with and without a record of hops.
    const given: boolean[] = [];
    const probe = mergeMachines(machine, { world: { kinds: { probe: { verbs: { step: "test.probe" } } } }, walkers: { "test.probe": (input: WalkInput) => (given.push(input.has !== undefined), { ok: true, thing: 1 }) } });
    for (const hops of [true, false]) resolve(probe, ctx, ["names", "data", { type: "probe", value: null }], { hops });
    expect(given).toEqual([true, true]);
  });
});

describe("types are references into the world", () => {
  it("[WORLD.ALIAS] finds a kind by a path, and follows an alias", () => {
    const found = lookupKind(STD_MACHINE.world, ["math", "sum"]);
    expect(found).toMatchObject({ ok: true, path: ["add"], aliases: 1 });
  });

  it("[WORLD.ALIAS-EVAL] evaluates a document whose type is a path to an alias", () => {
    expect(run(typed(["math", "product"], [6, 7])).result).toEqual({ ok: true, value: 42 });
  });

  it("[WORLD.EXPANDED] accepts the expanded form of a type", () => {
    expect(run(typed({ type: "ref", value: ["world", "add"] }, [1, 2])).result).toEqual({ ok: true, value: 3 });
  });

  it("[WORLD.NO-KIND] gives #KIND? for a path that reaches no kind", () => {
    expect(run(typed(["math", "nope"], [1])).result).toMatchObject({ ok: false, error: { code: "#KIND?" } });
  });
});

describe("trees: self, parent and nearest", () => {
  const tree: Json = {
    type: "panel",
    value: {
      width: 300,
      children: {
        type: "list",
        value: [
          {
            type: "box",
            value: {
              width: { type: "add", value: [{ type: "ref", value: ["self", "parent", "width"] }, -20] },
              children: {
                type: "list",
                value: [
                  {
                    type: "box",
                    value: {
                      width: {
                        type: "ref",
                        value: ["self", "parent", { type: "nearest", value: { type: "panel" } }, "width"],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    },
  };

  it("[TREE.PARENT] reads the parent through the field parent, as any other field", () => {
    const out = run(tree);
    expect(out.result.ok).toBe(true);
    if (out.result.ok) {
      const panel = out.result.value as { children: { width: number; children: { width: number }[] }[] };
      expect(panel.children[0]?.width).toBe(280);
      expect(panel.children[0]?.children[0]?.width).toBe(300);
    }
  });

  it("[TREE.NEAREST-SELF] starts a nearest walk at the node itself with self: true", () => {
    const inner = (step: Json): Json => ({
      type: "panel",
      value: {
        width: 300,
        children: {
          type: "list",
          value: [{ type: "panel", value: { width: { type: "ref", value: ["self", "parent", step, "width"] } } }],
        },
      },
    });
    const widthOf = (step: Json): Json | undefined => {
      const out = run(inner(step));
      return out.result.ok ? (out.result.value as { children: { width: Json }[] }).children[0]?.width : undefined;
    };
    expect(widthOf({ type: "nearest", value: { type: "panel", self: true } })).toBe(300);
    expect(run(inner({ type: "nearest", value: { type: "panel" } })).result).toMatchObject({ ok: false, error: { code: "#N/A" } });
  });

  it("[TREE.ONCE] evaluates a field of a node only one time, also when two readers ask", () => {
    const out = run(tree);
    // The JSON of the panel reads its width, and the first box reads it again.
    const widthEvaluations = flatten(out.trace).filter((node) => node.path.join("/") === "width");
    expect(widthEvaluations).toHaveLength(1);
  });
});

describe("the hops of a walk in a tree", () => {
  const NEAREST: Json = { type: "nearest", value: { type: "panel" } };
  /** A machine whose kind `probe` resolves a path from its node with hops. The probe gives 0. */
  const probing = (walkers?: Machine["walkers"]): { readonly machine: Machine; readonly found: Resolution[] } => {
    const found: Resolution[] = [];
    const machine: Machine = {
      ...STD_MACHINE,
      world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, probe: { verbs: { eval: "test.probe" } } } },
      evaluators: {
        ...STD_MACHINE.evaluators,
        "test.probe": ({ data, resolve: find }) => {
          found.push(find(["self", ...(data as readonly Json[])], { hops: true }));
          return ok(0);
        },
      },
      ...(walkers === undefined ? {} : { walkers }),
    };
    return { machine, found };
  };
  /** A panel, a box in it, and a box in that box. The inner box resolves the steps of the probe. */
  const nested = (steps: readonly Json[]): Json => ({
    type: "panel",
    value: {
      children: {
        type: "list",
        value: [{ type: "box", value: { children: { type: "list", value: [{ type: "box", value: { width: { type: "probe", value: steps } } }] } } }],
      },
    },
  });

  it("[HOP.PLACE] placeOf gives the place of each node that a hop reaches, and undefined for another thing", () => {
    const { machine, found } = probing();
    expect(evaluate(machine, nested(["parent", "parent"]), makeContext({}, STD_CAPS)).result.ok).toBe(true);
    const [resolution] = found;
    expect(resolution?.ok).toBe(true);
    const places = resolution?.hops.map((hop) => placeOf(hop.thing));
    expect(places).toEqual([
      ["children", 0, "children", 0],
      ["children", 0],
      [],
    ]);
    // A value, a host thing and a plain record of the document have no place.
    const host: HostThing = { [THING]: true, label: "host", deref: () => undefined, toJson: () => null };
    expect([placeOf(3), placeOf(null), placeOf({ width: 1 }), placeOf(host)]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("[HOP.EACH-STEP] the walker nearest with eachStep records one hop for each node on the way", () => {
    const one = probing();
    const each = probing({ ...STD_MACHINE.walkers, "walk.nearest": nearestWalker({ eachStep: true }) });
    const doc = nested([NEAREST, "type"]);
    const before = evaluate(one.machine, doc, makeContext({}, STD_CAPS)).result;
    expect(evaluate(each.machine, doc, makeContext({}, STD_CAPS)).result).toEqual(before);
    const [plain] = one.found;
    const [stepped] = each.found;
    expect([plain, stepped]).toMatchObject([{ ok: true, thing: "panel" }, { ok: true, thing: "panel" }]);
    // The default gives one hop for the whole walk. The option adds a hop for the box between, with the key parent.
    expect(plain?.hops.map((hop) => [hop.step, hop.by])).toEqual([["self", "root"], [NEAREST, "step"], ["type", "own"]]);
    expect(stepped?.hops.map((hop) => [hop.step, hop.by])).toEqual([["self", "root"], ["parent", "step"], [NEAREST, "step"], ["type", "own"]]);
    expect(stepped?.hops.slice(1, 3).map((hop) => placeOf(hop.thing))).toEqual([["children", 0], []]);
    // The walk stops at the node itself with self: true, thus it has no hop between.
    const self = probing({ ...STD_MACHINE.walkers, "walk.nearest": nearestWalker({ eachStep: true }) });
    evaluate(self.machine, nested([{ type: "nearest", value: { type: "box", self: true } }]), makeContext({}, STD_CAPS));
    expect(self.found[0]?.hops.map((hop) => hop.by)).toEqual(["root", "step"]);
    // A failed walk keeps the hops of the nodes on the way.
    const failed = probing({ ...STD_MACHINE.walkers, "walk.nearest": nearestWalker({ eachStep: true }) });
    evaluate(failed.machine, nested([{ type: "nearest", value: { type: "card" } }]), makeContext({}, STD_CAPS));
    expect(failed.found[0]).toMatchObject({ ok: false, code: "#N/A" });
    expect(failed.found[0]?.hops.map((hop) => hop.step)).toEqual(["self", "parent", "parent"]);
    // A resolution without a record of hops gives the walker no visit.
    const visits: boolean[] = [];
    const nav = { world: { kinds: { near: { verbs: { step: "near" } } }, defaults: {} }, walkers: { near: (input: WalkInput) => (visits.push(input.visit !== undefined), { ok: true, thing: 1 } as const) } };
    resolve(nav, context(), ["names", { type: "near", value: null }], { hops: false });
    resolve(nav, context(), ["names", { type: "near", value: null }]);
    expect(visits).toEqual([false, true]);
  });
});

describe("the decorated tree", () => {
  /** A machine with a kind `count`: its evaluator counts its evaluations and gives the count. */
  const counted = (): { readonly machine: Machine; readonly count: () => number } => {
    let count = 0;
    const machine: Machine = {
      ...STD_MACHINE,
      world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, count: { verbs: { eval: "test.count" } } } },
      evaluators: {
        ...STD_MACHINE.evaluators,
        "test.count": () => {
          count += 1;
          return ok(count);
        },
      },
    };
    return { machine, count: () => count };
  };
  const box = (value: Record<string, Json>): Json => ({ type: "box", value });
  const panel = (value: Record<string, Json>): Json => ({ type: "panel", value });
  const children = (...items: Json[]): Json => ({ type: "list", value: items });
  const path = (...steps: Json[]): Json => ({ type: "ref", value: steps });
  /** The plan, the traced plan, a second evaluation and the reference give the same result, also the same reason. */
  const agreed = (machine: Machine, doc: Json, caps: readonly string[] = STD_CAPS): Result => {
    const outcome = agree(machine, doc, makeContext({}, caps), { strict: true });
    expect(outcome, outcome.ok ? "" : outcome.reason).toMatchObject({ ok: true });
    return outcome.ok ? outcome.result : fail("#N/A", "The tiers disagree.");
  };

  it("[TREE.LAZY] a node in an open tree gives its host thing, and an attribute that nothing reads does not evaluate", () => {
    const { machine, count } = counted();
    // add gets the thing of the box, not a number. Thus the width of the box does not evaluate.
    const unread = panel({ width: { type: "add", value: [box({ width: { type: "count", value: null } }), 1] } });
    expect(agreed(machine, unread)).toMatchObject({ ok: false, error: { code: "#VALUE!", place: ["width"], reason: "Part 0 of add is not a number." } });
    expect(count()).toBe(0);
    const out = evaluate(machine, panel({ children: children(box({ width: 1 })) }), makeContext());
    const thing = nodeAt(out.trace, ["children", 0])?.result;
    expect(thing?.ok === true && isHostThing(thing.value)).toBe(true);
    expect(out.result).toEqual(ok({ children: [{ width: 1 }] }));
  });

  it("[TREE.SIBLING] a node reads an attribute of a sibling through its parent, before or after the sibling", () => {
    const doc = panel({
      children: children(
        box({ width: path("self", "parent", "children", 1, "width") }),
        box({ width: 120 }),
        box({ width: { type: "add", value: [path("self", "parent", "children", 0, "width"), 10] } }),
      ),
    });
    expect(agreed(STD_MACHINE, doc)).toEqual(ok({ children: [{ width: 120 }, { width: 120 }, { width: 130 }] }));
  });

  it("[TREE.CYCLE] a demand that reaches an attribute in evaluation gives #CYCLE!, with the chain of attributes", () => {
    expect(agreed(STD_MACHINE, panel({ width: path("self", "width") }))).toEqual(
      fail("#CYCLE!", "The attributes form a cycle: width of panel at [] -> width of panel at [].", { place: ["width"] }),
    );
    const chain = panel({ width: path("self", "children", 0, "width"), children: children(box({ width: path("self", "parent", "width") })) });
    expect(agreed(STD_MACHINE, chain)).toEqual(
      fail("#CYCLE!", "The attributes form a cycle: width of panel at [] -> width of box at [children, 0] -> width of panel at [].", {
        place: ["children", 0, "width"],
      }),
    );
    // The value of a node is its JSON, thus a reference to the node itself reads each of its attributes.
    expect(agreed(STD_MACHINE, panel({ width: 1, height: path("self") }))).toEqual(
      fail("#CYCLE!", "The attributes form a cycle: height of panel at [] -> height of panel at [].", { place: ["height"] }),
    );
  });

  it("[TREE.ERROR] a reference to a failed attribute gives the error of the attribute: its code, reason, place and cause", () => {
    const failed = agreed(STD_MACHINE, panel({ height: path("self", "width"), width: { type: "add", value: [1, true] } }));
    expect(failed).toEqual(fail("#VALUE!", "The value must be a number.", { place: ["width", 1] }));
    const boom = new Error("boom");
    const machine: Machine = {
      ...STD_MACHINE,
      world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, boom: { verbs: { eval: "test.boom" } } } },
      evaluators: {
        ...STD_MACHINE.evaluators,
        "test.boom": () => {
          throw boom;
        },
      },
    };
    const doc = panel({ children: children(box({ width: path("self", "parent", "children", 1, "width") }), box({ width: { type: "boom", value: null } })) });
    const result = agreed(machine, doc);
    expect(result).toMatchObject({ ok: false, error: { code: "#CALC!", place: ["children", 1, "width"], reason: "The evaluator test.boom threw: Error: boom" } });
    expect(result.ok ? undefined : result.error.cause).toBe(boom);
  });

  it("[DEREF.HOST-UNDEFINED] an attribute with the value undefined gives undefined, not #N/A, and a missing attribute gives #N/A", () => {
    const machine: Machine = {
      ...STD_MACHINE,
      world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, nothing: { verbs: { eval: "test.nothing" } } } },
      evaluators: { ...STD_MACHINE.evaluators, "test.nothing": () => ok(undefined) },
    };
    const doc = panel({ children: children(box({ width: path("self", "parent", "children", 1, "width") }), box({ width: { type: "nothing", value: null } })) });
    const result = agreed(machine, doc);
    expect(result.ok && (result.value as { children: { width?: unknown }[] }).children.map((child) => Object.hasOwn(child, "width") && child.width === undefined)).toEqual([true, true]);
    expect(agreed(machine, panel({ width: 1, height: path("self", "depth") }))).toMatchObject({ ok: false, error: { code: "#N/A", place: ["height"] } });
  });

  it("[TREE.MEMO] each node keeps one memo for each attribute, for one evaluation", () => {
    const { machine, count } = counted();
    const doc = panel({
      width: { type: "count", value: null },
      children: children(box({ width: path("self", "parent", "width"), height: { type: "count", value: null } }), box({ width: path("self", "parent", "width") })),
    });
    const plan = prepare(machine, doc);
    expect(plan.evaluate()).toEqual(ok({ width: 1, children: [{ width: 1, height: 2 }, { width: 1 }] }));
    expect(count()).toBe(2);
    // A second evaluation makes new nodes with new memos. Nothing stays between two evaluations.
    expect(plan.evaluate()).toEqual(ok({ width: 3, children: [{ width: 3, height: 4 }, { width: 3 }] }));
    expect(count()).toBe(4);
  });

  it("[TREE.PURE] an attribute causes no effect: an effect in it gives #CAP!, and check finds it", () => {
    const doc = panel({ width: { type: "log", value: ["x"] } });
    expect(agreed(STD_MACHINE, doc)).toMatchObject({ ok: false, error: { code: "#CAP!", place: ["width"] } });
    expect(check(STD_MACHINE, doc, { caps: STD_CAPS })).toMatchObject([{ code: "#CAP!", place: ["width"] }]);
  });

  it("[TREE.RESULT] the root gives the JSON of the tree, and a node in a value gives its JSON there", () => {
    const doc = panel({
      width: 10,
      height: { type: "list", value: [box({ width: 2 }), { type: "if", value: { test: { type: "bool", value: true }, then: box({ height: path("self", "parent", "width") }) } }] },
    });
    expect(agreed(STD_MACHINE, doc)).toEqual(ok({ width: 10, height: [{ width: 2 }, { height: 10 }] }));
    // A node of a closed tree is the root of a new tree. Its reads see the finished attributes.
    const first = prepare(STD_MACHINE, box({ children: children(box({ width: 3 })) }));
    expect(first.evaluate()).toEqual(ok({ children: [{ width: 3 }] }));
  });
});

describe("sequences bind last", () => {
  it("[SEQ.LAST] gives the result of the step before under the name last", () => {
    const out = run({
      type: "seq",
      value: [{ type: "number", value: 4 }, { type: "multiply", value: [{ type: "ref", value: ["names", "last"] }, 10] }],
    });
    expect(out.result).toEqual({ ok: true, value: 40 });
  });
});
