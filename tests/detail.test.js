import test from "node:test";
import assert from "node:assert/strict";
import {
  freshState,
  soilColorRGB,
  sampleSoil,
  growRoots,
  HALF,
  TIME_RATES,
  rootThickness,
  stepWorms,
  WORM_STEP_DAYS,
  PLOT_FIRST,
  PLOT_END,
  COLS,
  ROWS,
  CH,
  CW,
  DEPTH,
  MAP_HALF,
  loadState,
  packState,
} from "../dist/ecology.js";
import { makeArchitecture } from "../dist/architecture.js";
import { getSpecies } from "../dist/ecology.js";
test("soil colors match all three reference swatches and blend between them", () => {
  const color = (m, n) => soilColorRGB({ m, n }).map(channel => Math.round(channel * 255));
  assert.deepEqual(color(75, 65), [73, 38, 19]);
  assert.deepEqual(color(18, 65), [173, 95, 47]);
  assert.deepEqual(color(75, 0), [90, 71, 59]);
  assert.deepEqual(color(18, 0), [90, 71, 59]);
  assert.deepEqual(color(46.5, 65), [123, 67, 33]);
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
test("time options contain pause and four progressively faster playback rates", () => {
  assert.deepEqual(
    TIME_RATES.map((r) => r.value),
    [0, 1, 3, 7, 30],
  );
  assert.equal(TIME_RATES[0].label, "Pause");
});
test("trunk widths taper toward the top while leaves retain branch anchors", () => {
  const tree = makeArchitecture(getSpecies("oak"), 42),
    trunk = tree.nodes.filter((n) => n.depth === 0);
  assert.ok(trunk[trunk.length - 1].width < trunk[0].width * 0.5);
  assert.ok(tree.leaves.every((l) => tree.nodes[l.branch]));
});

test("compact saves restore root paths and remain small for a dense forest", () => {
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
  const restored = loadState(JSON.parse(packed));
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
  assert.equal(s.soil[c].m, before[c].m - 16);
  assert.ok(s.soil[c + 1].m < before[c + 1].m);
  assert.equal(s.soil[0].d, before[0].d);
  prepareSoilAt(s, 0, "compost");
  assert.ok(s.soil[c].n > before[c].n);
  assert.ok(s.soil[c].c > before[c].c);
  assert.equal(s.soil[c + 1].n, before[c + 1].n);
  assert.equal(s.soil[COLS + c].n, before[COLS + c].n);
  assert.equal(s.soil[4 * COLS + c].n, before[4 * COLS + c].n);
  assert.equal(s.soil[0].n, before[0].n);
});

test("live roots draw moisture from the soil cells along their paths", async () => {
  const { stepDay, cellAt } = await import("../dist/ecology.js");
  const planted = freshState();
  const dryControl = structuredClone(planted);
  const root = { a: [-1.12, -1.6], b: [-0.95, -1.65], born: 0, radiusA: 0.06 };
  planted.plants.push({ id: "test-oak", sid: "oak", x: 0, age: 2, health: 100,
    biomass: 1.5, planted: true, roots: [root], tips: [{ x: 0, y: -0.1 }], nextRootDay: 50 });
  const x = (root.a[0] + root.b[0]) / 2;
  const y = (root.a[1] + root.b[1]) / 2;
  stepDay(planted);
  stepDay(dryControl);
  assert.ok(cellAt(planted, x, y).m < cellAt(dryControl, x, y).m);
  assert.equal(cellAt(planted, 4, y).m, cellAt(dryControl, 4, y).m);
});

test("worms seek a rich patch, then spread its nutrients without creating new ones", () => {
  const state = freshState();
  for (const cell of state.soil) cell.n = 20;
  const rich = state.soil[COLS + 11];
  rich.n = 90;
  state.worms.push({ id: 1, col: 10, row: 1, cargo: 0 });
  state.day = 17;
  const total = state.soil.reduce((sum, cell) => sum + cell.n, 0);
  stepWorms(state);
  assert.equal(state.worms[0].nextCol, 11);
  assert.equal(state.worms[0].nextRow, 1);
  for (let day = 18; day <= 17 + 2 * WORM_STEP_DAYS; day++) {
    state.day = day;
    stepWorms(state);
  }
  assert.ok(rich.n < 90);
  assert.ok(state.soil.some(cell => cell !== rich && cell.n > 20));
  const restored = loadState(JSON.parse(packState(state)));
  assert.deepEqual(restored.worms, state.worms);
  const transferred = restored.soil.reduce((sum, cell) => sum + cell.n, restored.worms[0].cargo);
  assert.ok(Math.abs(total - transferred) < 1e-8);
});

test("one seeded square grid gets wetter and richer with depth across the map", () => {
  const state = freshState(102);
  const rowStep = state.soil.slice(1, COLS).reduce((sum, cell, i) => sum + Math.abs(cell.n - state.soil[i].n), 0) / (COLS - 1);
  assert.ok(rowStep < 14);
  assert.equal(CW, CH);
  const average = (row, key) => state.soil.slice(row * COLS, (row + 1) * COLS)
    .reduce((sum, cell) => sum + cell[key], 0) / COLS;
  assert.ok(average(ROWS - 1, "n") > average(0, "n") + 30);
  assert.ok(average(ROWS - 1, "m") > average(0, "m") + 44);
  assert.ok(average(0, "d") > average(ROWS - 1, "d"));
  const deep = sampleSoil(state, MAP_HALF - CW / 2, -DEPTH + CH / 2);
  assert.equal(deep, state.soil.at(-1));
  assert.notEqual(deep.n, sampleSoil(freshState(103), MAP_HALF - CW / 2, -DEPTH + CH / 2).n);
  assert.deepEqual(deep, loadState(JSON.parse(packState(state))).soil.at(-1));
});

test("a worm keeps its horizontal heading across successive soil cells", () => {
  const state = freshState(20);
  const worm = { id: 1, col: 24, row: 3, cargo: 1.8 };
  state.worms.push(worm);
  state.day = 17;
  stepWorms(state);
  const first = worm.col, direction = worm.dx;
  for (let day = 18; day <= 17 + 5 * WORM_STEP_DAYS; day++) {
    state.day = day;
    stepWorms(state);
    assert.equal(worm.dx, direction);
  }
  assert.equal(worm.col, first + direction * 5);
  assert.ok(worm.cargo < 0.5);
});

test("worms emerge in both woods and travel gradually into the planting bed", () => {
  const state = freshState(42);
  for (const cell of state.soil) { cell.m = 60; cell.n = 55; }
  for (let day = 1; day <= 70; day++) {
    state.day = day;
    stepWorms(state);
    if (day === 12) {
      assert.ok(state.worms[0].col < PLOT_FIRST);
      assert.equal(state.worms[0].nextCol, state.worms[0].col + 1);
    }
    if (day === 24) {
      assert.ok(state.worms[1].col >= PLOT_END);
      assert.equal(state.worms[1].nextCol, state.worms[1].col - 1);
    }
  }
  assert.ok(state.worms.slice(0, 2).every(worm => worm.col >= PLOT_FIRST && worm.col < PLOT_END));
});

test("infiltrating water cannot move nutrients to neighboring cells", async () => {
  const { hydrology, stepDay, addWater, colAt, prepareSoilAt } = await import("../dist/ecology.js");
  const state = freshState(42);
  const center = colAt(0);
  for (const cell of state.soil) { cell.m = 45; cell.n = 20; }
  prepareSoilAt(state, 0, "compost");
  addWater(state, 0, 40);
  for (let day = 0; day < 4; day++) {
    hydrology(state, 0.4);
    stepDay(state);
  }
  assert.ok(state.soil[center].n > 20);
  assert.ok(state.soil[center + COLS].m > 45);
  assert.equal(state.soil[center + COLS].n, 20);
  assert.equal(state.soil[center + 1].n, 20);
});
