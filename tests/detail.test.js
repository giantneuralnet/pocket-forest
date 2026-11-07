import test from "node:test";
import assert from "node:assert/strict";
import {
  freshState,
  soilColorHSL,
  sampleSoil,
  growRoots,
  HALF,
  TIME_RATES,
  rootThickness,
} from "../dist/ecology.js";
import { makeArchitecture } from "../dist/architecture.js";
import { getSpecies } from "../dist/ecology.js";
test("soil nutrients control saturation and moisture controls darkness", () => {
  const poor = soilColorHSL({ m: 40, n: 10 }),
    rich = soilColorHSL({ m: 40, n: 90 }),
    wet = soilColorHSL({ m: 90, n: 10 });
  assert.ok(rich.s > poor.s);
  assert.equal(rich.l, poor.l);
  assert.ok(wet.l < poor.l);
  assert.equal(wet.s, poor.s);
});
test("roots can cross the plot border into persistent external soil", () => {
  const s = freshState();
  const p = {
    x: HALF - 0.005,
    seed: 12,
    sid: "oak",
    age: 0,
    roots: [],
    tips: [{ x: HALF - 0.005, y: -0.3, angle: 1.2, dir: 1, age: 0 }],
  };
  for (let day = 0; day < 30; day += 3) {
    s.day = day;
    growRoots(s, p);
  }
  assert.ok(p.roots.some((r) => r.b[0] > HALF));
  const cell = sampleSoil(s, HALF + 1, -1, true);
  cell.m = 12;
  assert.equal(sampleSoil(s, HALF + 1, -1).m, 12);
});
test("mature roots grow more slowly and every segment tapers", () => {
  const a = freshState(),
    b = freshState();
  const young = { x: 0, seed: 42, sid: "oak", age: 0, roots: [], tips: [] },
    old = { ...young, age: 12, roots: [], tips: [] };
  growRoots(a, young);
  growRoots(b, old);
  const length = (r) => Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
  assert.ok(length(old.roots[0]) < length(young.roots[0]));
  assert.ok(young.roots[0].radiusB < rootThickness(young.roots[0]));
});
test("time options contain real time, day, week and month with no pause", () => {
  assert.deepEqual(
    TIME_RATES.map((r) => r.value),
    [1 / 86400, 1, 7, 30],
  );
  assert.ok(TIME_RATES.every((r) => r.value > 0));
});
test("trunk widths taper toward the top while leaves retain branch anchors", () => {
  const tree = makeArchitecture(getSpecies("oak"), 42),
    trunk = tree.nodes.filter((n) => n.depth === 0);
  assert.ok(trunk[trunk.length - 1].width < trunk[0].width * 0.5);
  assert.ok(tree.leaves.every((l) => tree.nodes[l.branch]));
});

test("compact saves restore root paths and remain small for a dense forest", async () => {
  const { packState, migrate } = await import("../dist/ecology.js");
  const s = freshState();
  s.plants = Array.from({ length: 60 }, (_, i) => ({
    id: "p" + i,
    x: i / 4,
    sid: "oak",
    roots: Array.from({ length: 720 }, (_, j) => ({
      a: [i / 4 + j * 0.001, -j * 0.01],
      b: [i / 4 + j * 0.0011, -j * 0.01 - 0.03],
      born: j,
      radiusA: 0.03,
      radiusB: 0.029,
      originX: i / 4,
    })),
    tips: [],
  }));
  const packed = packState(s);
  assert.ok(packed.length < 4e6);
  const restored = migrate(JSON.parse(packed));
  assert.deepEqual(
    restored.plants[0].roots[0],
    JSON.parse(JSON.stringify(s.plants[0].roots[0])),
  );
  assert.equal(restored.plants.length, 60);
});


test("plucked weeds release nutrients into nearby surface soil as litter decays", async () => {
  const {returnWeedToSoil, stepDay, colAt} = await import("../dist/ecology.js");
  const s = freshState();
  for (const cell of s.soil) { cell.m=70; cell.n=25; cell.c=0.8; }
  const control = structuredClone(s);
  returnWeedToSoil(s, {x:0,biomass:1});
  for(let i=0;i<30;i++){stepDay(s);stepDay(control);}
  const c=colAt(0);
  assert.ok(s.soil[c].n > control.soil[c].n);
  assert.ok(s.soil[c-1].n > control.soil[c-1].n);
});

test("soil preparation changes only the clicked area and compost stays near the surface", async () => {
  const { prepareSoilAt, colAt, COLS } = await import("../dist/ecology.js");
  const s = freshState();
  const before = structuredClone(s.soil);
  const c = colAt(0);
  prepareSoilAt(s, 0, "drainage");
  assert.ok(s.soil[c].d > before[c].d);
  assert.equal(s.soil[0].d, before[0].d);
  prepareSoilAt(s, 0, "compost");
  assert.ok(s.soil[c].n > before[c].n);
  assert.ok(s.soil[c].c > before[c].c);
  assert.equal(s.soil[4 * COLS + c].n, before[4 * COLS + c].n);
  assert.equal(s.soil[0].n, before[0].n);
});
