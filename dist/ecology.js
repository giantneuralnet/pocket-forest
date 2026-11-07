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
export const TIME_RATES = [
  { label: "Real time", value: 1 / 86400 },
  { label: "1 day / sec", value: 1 },
  { label: "1 week / sec", value: 7 },
  { label: "1 month / sec", value: 30 },
];
export function soilBaseline(x, y) {
  return {
    m: clamp(
      42 -
        y * 2 +
        Math.sin(x * 0.47) * 13 +
        Math.cos(x * 0.19 + y) * 8 +
        random(Math.floor(x / CW) + Math.floor(-y / CH) * 79) * 9,
      12,
      92,
    ),
    n: clamp(
      36 +
        Math.sin(x * 0.32 + y * 0.7) * 17 +
        Math.cos(x * 0.81 - y * 0.3) * 9 +
        random(Math.floor(x / CW) * 5 + Math.floor(-y / CH) * 17) * 12,
      8,
      88,
    ),
    d: 0.15,
    o: 0,
    c: 0,
    mulch: 0,
    litter: 0,
  };
}
export function sampleSoil(s, x, y = 0, create = false) {
  const col = Math.floor((x + HALF) / CW),
    row = Math.floor(-y / CH);
  if (col >= 0 && col < COLS && row >= 0 && row < ROWS)
    return s.soil[row * COLS + col];
  const key = Math.floor(x / CW) + ":" + row;
  if (s.extraSoil?.[key]) return s.extraSoil[key];
  const cell = soilBaseline(x, y);
  if (create) {
    s.extraSoil ??= {};
    s.extraSoil[key] = cell;
  }
  return cell;
}
export function soilColorHSL(cell) {
  return {
    h: 0.074,
    s: 0.24 + clamp(cell.n / 100) * 0.48,
    l: 0.12 - clamp(cell.m / 100) * 0.08,
  };
}
export function rootThickness(segment) {
  const depth = Math.hypot(
    segment.a[0] - (segment.originX ?? segment.a[0]),
    segment.a[1],
  );
  return segment.radiusA ?? Math.max(0.006, 0.055 / (1 + depth * 1.4));
}
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
    speed: 1,
    prep: [false, false, false],
    warned: {},
    review: null,
    weedDays: 0,
    soilVariation: 1,
    extraSoil: {},
    soil: Array.from({ length: COLS * ROWS }, (_, i) => ({
      ...soilBaseline(
        -HALF + ((i % COLS) + 0.5) * CW,
        -(Math.floor(i / COLS) + 0.5) * CH,
      ),
      d: 0.15,
      o: 0,
      c: 0,
      mulch: 0,
      litter: 0,
    })),
    surface: Array(COLS).fill(0),
  };
}
export function packState(state) {
  const q = (n) => Math.round(n * 1e6) / 1e6,
    compact = (p) => ({
      ...p,
      roots: (p.roots || []).map((r) => [
        q(r.a[0]),
        q(r.a[1]),
        q(r.b[0]),
        q(r.b[1]),
        r.born,
        q(r.radiusA || 0),
        q(r.radiusB || 0),
      ]),
    });
  return JSON.stringify({
    ...state,
    storageFormat: 1,
    plants: state.plants.map(compact),
    weeds: state.weeds.map(compact),
  });
}
export function migrate(saved) {
  if (saved?.storageFormat === 1) {
    for (const p of [...saved.plants, ...saved.weeds])
      p.roots = (p.roots || []).map((a) =>
        Array.isArray(a)
          ? {
              a: [a[0], a[1]],
              b: [a[2], a[3]],
              born: a[4],
              ...(a[5] > 0 ? { radiusA: a[5], radiusB: a[6] } : {}),
              originX: a[7] ?? p.x,
            }
          : a,
      );
  }

  if (saved?.version === 2 && saved.soil?.length === COLS * ROWS) {
    if (!TIME_RATES.some((r) => r.value === saved.speed)) saved.speed = 1;
    if (!saved.soilVariation) {
      saved.soil.forEach((cell, i) => {
        const base = soilBaseline(
          -HALF + ((i % COLS) + 0.5) * CW,
          -(Math.floor(i / COLS) + 0.5) * CH,
        );
        cell.m = clamp(cell.m + (base.m - 50) * 0.4, 0, 100);
        cell.n = clamp(cell.n + (base.n - 45) * 0.6, 0, 100);
      });
      saved.soilVariation = 1;
    }
    saved.extraSoil ??= {};
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
export const cellAt = (s, x, y = 0) => sampleSoil(s, x, y, true);
export const plantHeight = (p) => {
  const sp = getSpecies(p.sid);
  return p.wild
    ? sp.height
    : p.planted
      ? Math.min(
          sp.height * (sp.type === "weed" ? 1.35 : 1),
          (sp.type === "weed" ? 0.53 : 0.38) + (p.biomass || 0),
        )
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
const waterBuffers = new WeakMap();
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
  let transfer = waterBuffers.get(s);
  if (!transfer) {
    transfer = new Float32Array(s.soil.length);
    waterBuffers.set(s, transfer);
  }
  transfer.fill(0);
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
  if (!p.tips.length && p.roots.length === 0)
    p.tips = [
      { x: p.x, y: -0.035, dir: -1, angle: -0.4, age: 0 },
      { x: p.x, y: -0.035, dir: 1, angle: 0.4, age: 0 },
    ];
  if (p.roots.length >= 720) return;
  const next = [],
    forks = [];
  for (let i = 0; i < p.tips.length; i++) {
    const a = p.tips[i];
    if (a.y <= -11.8) continue;
    const key = p.seed * 101 + s.day * 13 + i * 37,
      step =
        (0.045 + random(key) * 0.07) * (0.15 + 0.85 / (1 + (p.age || 0) * 0.9)),
      heading = a.angle ?? a.dir * 0.4;
    const candidates = [-0.6, -0.3, 0, 0.3, 0.6]
      .map((turn, j) => {
        const angle = clamp(
            heading * 0.9 + turn + (random(key + j * 11) - 0.5) * 0.8,
            -1.49,
            1.49,
          ),
          x = clamp(a.x + Math.sin(angle) * step, -69, 69),
          y = a.y - Math.cos(angle) * step;
        return {
          x,
          y,
          angle,
          score:
            cellAt(s, x, y).m * 0.8 +
            cellAt(s, x, y).n * 0.06 +
            random(key + j * 7) * 14 -
            Math.abs(angle - heading) * 1.5,
        };
      })
      .sort((a, b) => b.score - a.score);
    const b = candidates[0];
    const radiusA =
        a.radius ?? (getSpecies(p.sid)?.type === "weed" ? 0.023 : 0.06),
      radiusB = Math.max(0.003, radiusA * (0.965 - random(key + 12) * 0.012));
    p.roots.push({
      a: [a.x, a.y],
      b: [b.x, b.y],
      born: s.day,
      radiusA,
      radiusB,
      originX: p.x,
    });
    const tip = {
      x: b.x,
      y: b.y,
      angle: b.angle,
      dir: b.angle < 0 ? -1 : 1,
      age: (a.age || 0) + 1,
      radius: radiusB,
    };
    next.push(tip);
    if (
      tip.age > 4 &&
      random(key + 97) < 0.24 &&
      next.length + forks.length < 10
    ) {
      const turn =
        (random(key + 5) < 0.5 ? -1 : 1) * (0.5 + random(key + 31) * 0.45);
      forks.push({
        ...tip,
        angle: clamp(b.angle + turn, -1.49, 1.49),
        dir: turn < 0 ? -1 : 1,
        age: 0,
        radius: radiusB * 0.6,
      });
    }
  }
  p.tips = [...next, ...forks].slice(0, 10);
}
export function prepareSoilAt(s, x, tool) {
  const center = colAt(x);
  const digging = tool === "drainage";
  const depth = digging ? 5 : 3;
  for (let c = Math.max(0, center - 2); c <= Math.min(COLS - 1, center + 2); c++) {
    const spread = 1 - Math.abs(c - center) * 0.25;
    for (let r = 0; r < depth; r++) {
      const cell = s.soil[r * COLS + c];
      const dose = spread * (1 - r / depth);
      if (digging) cell.d = Math.min(1, cell.d + 0.42 * dose);
      else {
        cell.n = Math.min(100, cell.n + 2.4 * dose);
        cell.o = Math.min(1, cell.o + 0.07 * dose);
        cell.c = Math.min(1, cell.c + 0.06 * dose);
      }
    }
  }
  if (!digging) s.prep[1] = s.prep[2] = true;
}
export function returnWeedToSoil(s, weed) {
  for (let offset = -2; offset <= 2; offset++) {
    const cell = cellAt(s, weed.x + offset * CW, -CH * 0.5);
    cell.litter += (1.5 + (weed.biomass || 0.5)) * (1 - Math.abs(offset) * 0.2);
  }
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
    if (p.health > 0 && s.day >= (p.nextRootDay ?? 0)) {
      growRoots(s, p);
      p.nextRootDay = s.day + Math.max(3, Math.round(3 + p.age * 9));
    }
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
