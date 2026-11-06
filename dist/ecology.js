import { species } from "./species.js";
export const HALF = 10,
  COLS = 64,
  ROWS = 14,
  DEPTH = 4.8,
  CW = (HALF * 2) / COLS,
  CH = DEPTH / ROWS;
export const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
export const random = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
export const getSpecies = (id) => species.find((s) => s.id === id);
export function freshState() {
  return {
    version: 2,
    phase: 0,
    budget: 6000,
    survey: [],
    surveyPlants: [],
    plants: [],
    weeds: [],
    mushrooms: [],
    day: 0,
    speed: 0,
    prep: [false, false, false],
    warned: {},
    review: null,
    weedDays: 0,
    soil: Array.from({ length: COLS * ROWS }, (_, i) => ({
      m: 38 + Math.floor(i / COLS) * 1.7 + random(i) * 7,
      n: 30,
      d: 0.15,
      o: 0,
      c: 0,
      mulch: 0,
      litter: 0,
    })),
    surface: Array(COLS).fill(0),
  };
}
export function migrate(saved) {
  if (saved?.version === 2 && saved.soil?.length === COLS * ROWS) {
    saved.speed = 0;
    return saved;
  }
  const s = freshState();
  if (!saved?.soil) return s;
  for (const key of [
    "phase",
    "budget",
    "survey",
    "plants",
    "weeds",
    "day",
    "prep",
    "warned",
  ])
    if (saved[key] != null) s[key] = saved[key];
  s.plants.forEach((p) => {
    p.x = (p.x / 6) * HALF;
    p.roots = [];
    p.tips = [];
  });
  s.weeds.forEach((w, i) =>
    Object.assign(w, {
      sid: i % 2 ? "grass" : "forb",
      age: 0,
      health: 100,
      biomass: 0.2,
      roots: [],
      tips: [],
      seed: i + 90,
      planted: true,
    }),
  );
  s.soil.forEach((cell, i) =>
    Object.assign(
      cell,
      saved.soil[Math.min(23, Math.floor(((i % COLS) / COLS) * 24))],
      { m: saved.soil[Math.min(23, Math.floor(((i % COLS) / COLS) * 24))].m },
    ),
  );
  if (s.phase === 5 || s.phase === 6) s.review = score(s);
  return s;
}
export const colAt = (x) => clamp(Math.floor((x + HALF) / CW), 0, COLS - 1);
export const cellAt = (s, x, y = 0) =>
  s.soil[clamp(Math.floor(-y / CH), 0, ROWS - 1) * COLS + colAt(x)];
export const plantHeight = (p) => {
  const sp = getSpecies(p.sid);
  return p.wild
    ? sp.height
    : p.planted
      ? Math.min(sp.height, 0.38 + (p.biomass || 0))
      : 0.45;
};
export const raining = (day) =>
  Math.floor((day % 365) / 91.25) === 1
    ? Math.floor(day) % 29 < 4
    : Math.floor(day) % 19 < 5;
export function addWater(s, x, amount = 10) {
  s.surface[colAt(x)] = clamp(s.surface[colAt(x)] + amount, 0, 90);
}
// Real-time infiltration is deliberately separate from calendar time. A pour ponds first.
export function hydrology(s, dt) {
  const factor = 1 + Math.sqrt(s.speed || 0) * 0.6;
  for (let c = 0; c < COLS; c++) {
    const top = s.soil[c],
      flux = Math.min(
        s.surface[c],
        dt * factor * (0.7 + top.d * 1.3),
        (100 - top.m) * 0.05,
      );
    s.surface[c] -= flux;
    top.m = clamp(top.m + flux * 1.8, 0, 100);
  }
  const transfer = new Float32Array(s.soil.length);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c,
        a = s.soil[i];
      if (r < ROWS - 1) {
        const below = s.soil[i + COLS],
          f =
            Math.max(0, a.m - below.m + 5) * dt * factor * 0.025 * (0.3 + a.d);
        transfer[i] -= f;
        transfer[i + COLS] += f;
      }
      if (c < COLS - 1) {
        const f = (a.m - s.soil[i + 1].m) * dt * factor * 0.008;
        transfer[i] -= f;
        transfer[i + 1] += f;
      }
    }
  s.soil.forEach((a, i) => (a.m = clamp(a.m + transfer[i], 0, 100)));
}
export function growRoots(s, p) {
  p.roots ??= [];
  p.tips ??= [];
  if (!p.tips.length)
    p.tips = [
      { x: p.x, y: -0.035, dir: -1 },
      { x: p.x, y: -0.035, dir: 1 },
    ];
  if (p.roots.length > 360) return;
  const next = [];
  for (let i = 0; i < p.tips.length; i++) {
    const a = p.tips[i];
    if (a.y <= -DEPTH + 0.1) continue;
    const step = 0.04 + random(p.seed + s.day + i) * 0.055;
    const candidates = [-0.65, 0, 0.65]
      .map((d) => {
        const x = clamp(
            a.x + d * step + a.dir * step * 0.3,
            -HALF + 0.02,
            HALF - 0.02,
          ),
          y = a.y - step;
        return {
          x,
          y,
          score:
            cellAt(s, x, y).m +
            cellAt(s, x, y).n * 0.08 +
            random(p.seed + i + s.day + d) * 2,
        };
      })
      .sort((a, b) => b.score - a.score);
    const b = candidates[0];
    p.roots.push({ a: [a.x, a.y], b: [b.x, b.y], born: s.day });
    next.push({ x: b.x, y: b.y, dir: a.dir });
    if (s.day % 29 === 0 && next.length < 8) {
      const branch = {
        x: clamp(b.x + a.dir * 0.13, -HALF, HALF),
        y: b.y - 0.03,
        dir: -a.dir,
      };
      p.roots.push({ a: [b.x, b.y], b: [branch.x, branch.y], born: s.day });
      next.push(branch);
    }
  }
  p.tips = next;
}
export function stepDay(s, exposure = () => ({ light: 1, rain: 1 })) {
  s.day++;
  const summer = Math.floor((s.day % 365) / 91.25) === 1,
    rain = raining(s.day);
  for (let c = 0; c < COLS; c++) {
    const x = -HALF + (c + 0.5) * CW,
      top = s.soil[c],
      e = exposure(x, 0, null);
    if (rain) s.surface[c] = clamp(s.surface[c] + 2.1 * e.rain, 0, 80);
    for (let r = 0; r < ROWS; r++) {
      const cell = s.soil[r * COLS + c],
        evap =
          (summer ? 0.48 : 0.26) *
          (1 - 0.6 * top.mulch) *
          (0.35 + 0.65 * e.light) *
          Math.exp(-r * 0.5);
      cell.m = clamp(cell.m - evap, 0, 100);
      const decay = Math.min(cell.litter, (0.025 * cell.c * cell.m) / 100);
      cell.litter -= decay;
      cell.n = clamp(cell.n + decay * 2 + 0.003 * cell.c, 0, 100);
    }
    top.mulch = Math.max(0, top.mulch - 0.00013);
  }
  for (const p of [...s.plants, ...s.weeds]) {
    if (!p.planted) continue;
    const sp = getSpecies(p.sid);
    p.age = (p.age || 0) + 1 / 365;
    const e = exposure(p.x, plantHeight(p) * 0.72, p.id);
    p.light = e.light;
    const roots = p.tips?.length ? p.tips : [{ x: p.x, y: -0.08 }],
      samples = roots.map((t) => cellAt(s, t.x, t.y));
    const m = samples.reduce((a, c) => a + c.m, 0) / samples.length,
      n = samples.reduce((a, c) => a + c.n, 0) / samples.length;
    const neighbors = s.plants.filter(
      (q) => q !== p && q.planted && q.health > 0 && Math.abs(q.x - p.x) < 1.8,
    ).length;
    const sheltered = clamp(neighbors * 0.09, 0, 0.28);
    const moisture = clamp(1 - Math.max(0, Math.abs(m - sp.water) - 19) / 42),
      nutrients = clamp(n / 45);
    const light =
      e.light > 0.88
        ? 1
        : e.light < 0.2
          ? 0.28 + sp.shade * 0.45
          : 0.88 + sp.shade * 0.3;
    const fitness = moisture * nutrients * light;
    p.health = clamp(
      (p.health ?? 95) + (fitness > 0.48 ? 0.1 : -(0.48 - fitness) * 0.55),
      0,
      100,
    );
    p.biomass = clamp(
      (p.biomass || 0) +
        (sp.height / 2100) * fitness * (1 + sheltered) * (p.health / 100),
      0,
      sp.height - 0.38,
    );
    for (const cell of samples) {
      cell.m = clamp(cell.m - (sp.type === "weed" ? 0.15 : 0.035), 0, 100);
      cell.n = clamp(cell.n - (sp.type === "weed" ? 0.027 : 0.008), 0, 100);
    }
    if (s.day % 3 === 0) growRoots(s, p);
    if (sp.deciduous && s.day % 365 === 274) cellAt(s, p.x).litter += 2.5;
  }
  s.weedDays += s.weeds.length;
  // Open, unmulched patches recruit often; mulch and a closed canopy lower the probability.
  if (s.day % 4 === 0 && s.weeds.length < 42) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const x = random(s.day * 4 + attempt) * 19 - 9.5,
        top = cellAt(s, x),
        e = exposure(x, 0.2, null);
      if (
        random(s.day * 3 + attempt) > 0.42 * top.mulch + 0.38 * (1 - e.light) &&
        !s.weeds.some((w) => Math.abs(w.x - x) < 0.38)
      )
        s.weeds.push({
          id: "w" + s.day + "-" + attempt,
          sid: attempt ? "grass" : "forb",
          x,
          z: 2.8,
          age: 0,
          health: 100,
          biomass: 0.05,
          seed: s.day + attempt,
          planted: true,
          roots: [],
          tips: [],
        });
    }
  }
  // Each mushroom has its own persistent birth and death date, instead of a modulo flash.
  s.mushrooms = s.mushrooms.filter((m) => m.until > s.day);
  if (rain && s.day % 47 === 0 && s.mushrooms.length < 6) {
    const x = random(s.day) * 19 - 9.5,
      c = cellAt(s, x);
    if (c.c > 0.3 && c.m > 48)
      s.mushrooms.push({
        id: "m" + s.day,
        x,
        born: s.day,
        until: s.day + 40 + Math.floor(random(s.day + 1) * 35),
      });
  }
  return s.day >= 1095 && s.phase === 4;
}
export function score(s) {
  const planted = s.plants.filter((p) => p.planted),
    alive = planted.filter((p) => p.health > 0);
  const health =
      planted.reduce((a, p) => a + p.health, 0) / Math.max(1, planted.length),
    variety = new Set(alive.map((p) => p.sid)).size,
    layers = new Set(alive.map((p) => getSpecies(p.sid).layer)).size,
    native =
      alive.filter((p) => getSpecies(p.sid).native === true).length /
      Math.max(1, alive.length);
  const density = clamp(alive.length / 20),
    weedLoad = s.weedDays / Math.max(1, s.day),
    weedCare = clamp(1 - (s.weeds.length * 0.5 + weedLoad * 0.5) / 18),
    soil = s.soil.reduce((a, c) => a + c.n, 0) / s.soil.length;
  const points = {
    health: (health / 100) * 25,
    diversity: clamp(variety / 7) * 25,
    density: density * 25,
    layers: (layers / 4) * 10,
    native: native * 5,
    weeds: weedCare * 10,
  };
  return {
    total: Math.round(Object.values(points).reduce((a, b) => a + b, 0)),
    points,
    health: Math.round(health),
    variety,
    layers,
    native: Math.round(native * 100),
    density: Math.round(density * 100),
    weeds: s.weeds.length,
    weedLoad: Math.round(weedLoad),
    soil: Math.round(soil),
    alive: alive.length,
    planted: planted.length,
  };
}
