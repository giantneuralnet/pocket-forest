import test from "node:test";
import assert from "node:assert/strict";
import {
  freshState,
  migrate,
  addWater,
  hydrology,
  growRoots,
  score,
  COLS,
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
    top = s.soil[32].m;
  addWater(s, 0, 20);
  assert.equal(s.soil[32].m, top);
  assert.equal(s.surface[32], 20);
  hydrology(s, 0.1);
  hydrology(control, 0.1);
  assert.ok(s.soil[32].m > control.soil[32].m);
  assert.ok(s.surface[32] > 0);
  assert.equal(s.soil[COLS * 10 + 32].m, control.soil[COLS * 10 + 32].m);
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
  const a = freshState(),
    b = freshState();
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
test("old saves migrate to the fine grid and retain budget and plant identities", () => {
  const s = freshState();
  const m = migrate({
    phase: 2,
    budget: 3400,
    survey: ["oak"],
    plants: [plant(1)],
    weeds: [],
    soil: Array(24).fill({
      m: 50,
      n: 40,
      d: 0.8,
      o: 1,
      c: 0.8,
      mulch: 1,
      litter: 0,
    }),
    prep: [true, true, true],
    day: 0,
    warned: {},
  });
  assert.equal(m.budget, 3400);
  assert.equal(m.plants[0].sid, "oak");
  assert.equal(m.soil.length, s.soil.length);
});
