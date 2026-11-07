import test from "node:test";
import assert from "node:assert/strict";
import {
  freshState,
  packState,
  loadState,
  addWater,
  hydrology,
  growRoots,
  score,
  COLS,
  ROWS,
  HALF,
  CW,
  colAt,
  stepDay,
} from "../dist/ecology.js";
function plant(i, sid = "oak") {
  return {
    id: "p" + i,
    sid,
    x: -9 + i * 0.8,
    age: 0,
    health: 100,
    biomass: 0.1,
    seed: i,
    planted: true,
    roots: [],
    tips: [],
  };
}
test("a pour pools first and wets the top before deep soil", () => {
  const s = freshState(),
    control = structuredClone(s),
    top = s.soil[colAt(0)].m;
  addWater(s, 0, 20);
  assert.equal(s.soil[colAt(0)].m, top);
  assert.equal(s.surface[colAt(0)], 20);
  hydrology(s, 0.1);
  hydrology(control, 0.1);
  assert.ok(s.soil[colAt(0)].m > control.soil[32].m);
  assert.ok(s.surface[colAt(0)] > 0);
  assert.equal(s.soil[COLS * (ROWS - 1) + colAt(0)].m, control.soil[COLS * (ROWS - 1) + colAt(0)].m);
});
test("existing root vertices are immutable while new tips extend", () => {
  const s = freshState(),
    p = plant(1);
  growRoots(s, p);
  const old = JSON.stringify(p.roots);
  s.day = 29;
  growRoots(s, p);
  assert.equal(JSON.stringify(p.roots.slice(0, JSON.parse(old).length)), old);
  assert.ok(p.roots.length > JSON.parse(old).length);
});
test("two healthy trees cannot produce an 87-point forest", () => {
  const s = freshState();
  s.plants = [plant(1), plant(2)];
  assert.ok(score(s).total < 60);
});
test("density, diversity and weed burden affect the score independently", () => {
  const s = freshState();
  s.day = 1000;
  s.plants = Array.from({ length: 20 }, (_, i) => plant(i));
  const monoculture = score(s).total;
  const ids = [
    "oak",
    "cinnamon",
    "privet",
    "eurya",
    "camellia",
    "ardisia",
    "castanopsis",
  ];
  s.plants.forEach((p, i) => (p.sid = ids[i % ids.length]));
  assert.ok(score(s).total > monoculture);
  const clean = score(s).total;
  s.weeds = Array.from({ length: 20 }, (_, i) => plant(i, "grass"));
  s.weedDays = 20000;
  assert.ok(score(s).total < clean);
});
test("weeds grow roots and mushrooms retain their own lifetimes", () => {
  const s = freshState();
  s.phase = 4;
  s.weeds = [plant(1, "grass")];
  s.mushrooms = [{ id: "m", x: 0, born: 0, until: 50 }];
  for (let i = 0; i < 9; i++) stepDay(s);
  assert.ok(s.weeds[0].roots.length > 0);
  assert.equal(s.mushrooms.length, 1);
});
test("neighbor shelter gives a growth bonus in suitable light", () => {
  const a = freshState(42),
    b = freshState(42);
  a.plants = [plant(1, "eurya")];
  b.plants = [plant(1, "eurya"), plant(2, "cinnamon")];
  for (const s of [a, b])
    s.soil.forEach((c) => {
      c.m = 56;
      c.n = 60;
    });
  stepDay(a, () => ({ light: 0.6, rain: 1 }));
  stepDay(b, () => ({ light: 0.6, rain: 1 }));
  assert.ok(b.plants[0].biomass > a.plants[0].biomass);
});
test("saves from before the map grid start a fresh forest", () => {
  const legacy = { ...freshState(), version: 2, phase: 5, budget: 3400, plants: [plant(1)] };
  const state = loadState(legacy);
  assert.equal(state.phase, 0);
  assert.equal(state.budget, 18000);
  assert.deepEqual(state.plants, []);
  assert.equal(state.soil.length, COLS * ROWS);
});

test("water flows across the plot fence and infiltrates woodland soil", () => {
  const state = freshState(42);
  const outside = colAt(HALF + CW / 2);
  state.soil[outside - 1].m = state.soil[outside].m = 40;
  addWater(state, HALF - CW / 2, 40);
  hydrology(state, 0.4);
  assert.ok(state.soil[outside].m > 40);
  const before = state.soil[outside].m;
  addWater(state, HALF + CW / 2, 40);
  hydrology(state, 0.4);
  assert.ok(state.soil[outside].m > before);
});

test("soil varies in both moisture and nutrients across the bed", () => {
  const s = freshState();
  assert.ok(new Set(s.soil.map((c) => Math.round(c.m))).size > 12);
  assert.ok(new Set(s.soil.map((c) => Math.round(c.n))).size > 12);
});


test("even a full puddle infiltrates within two simulated days", () => {
  const s = freshState(), control = structuredClone(s);
  s.phase = control.phase = 4;
  s.speed = control.speed = 30;
  addWater(s, 0, 90);
  for (let frame = 0; frame < 4; frame++) {
    hydrology(s, 1 / 60);
    hydrology(control, 1 / 60);
  }
  assert.equal(s.surface[colAt(0)], 0);
  assert.ok(s.soil[COLS + colAt(0)].m > control.soil[COLS + colAt(0)].m);
  assert.ok(s.soil[colAt(0) - 1].m > control.soil[colAt(0) - 1].m);
});

test("a dead plant keeps its cause of death after reload and improved soil", () => {
  const s = freshState(), oak = plant(11);
  oak.health = 0.1;
  s.plants = [oak];
  for (const cell of s.soil) {
    cell.m = 0;
    cell.n = 95;
  }
  stepDay(s);
  assert.equal(oak.health, 0);
  assert.match(oak.deathReason, /dry soil around the roots/);
  const saved = loadState(JSON.parse(packState(s)));
  for (const cell of saved.soil) cell.m = 55;
  stepDay(saved);
  assert.equal(saved.plants[0].health, 0);
  assert.equal(saved.plants[0].deathReason, oak.deathReason);
});
