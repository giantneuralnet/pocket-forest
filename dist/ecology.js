import { species } from "./species.js";
const SAVE_VERSION = 6;
export const HALF = 20 / 3,
  PLOT_COLS = 20,
  COLS = 100,
  ROWS = 11,
  CW = (HALF * 2) / PLOT_COLS,
  CH = CW,
  DEPTH = ROWS * CH,
  MAP_HALF = COLS * CW / 2,
  PLOT_FIRST = (COLS - PLOT_COLS) / 2,
  PLOT_END = PLOT_FIRST + PLOT_COLS;
export const soilX = col => (col + 0.5 - COLS / 2) * CW;
export const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
export const random = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
export const getSpecies = (id) => species.find((s) => s.id === id);
export const TIME_RATES = [
  { label: "Pause", value: 0, icon: "pause" },
  { label: "Play · 1 day per second", value: 1, icon: "play" },
  { label: "Fast forward · 3 days per second", value: 3, icon: "fast" },
  { label: "Super fast forward · 1 week per second", value: 7, icon: "super" },
  { label: "Triple fast forward · 1 month per second", value: 30, icon: "triple" },
];
function perlin(x, y, seed) {
  const col = Math.floor(x), row = Math.floor(y);
  const dx = x - col, dy = y - row;
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const gradient = (ix, iy, sx, sy) => {
    const key = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ seed;
    const direction = Math.imul(key ^ (key >>> 13), 1274126177) >>> 29;
    const u = direction & 4 ? sy : sx, v = direction & 4 ? sx : sy;
    return (direction & 1 ? -u : u) + (direction & 2 ? -v : v) * 0.5;
  };
  const left = gradient(col, row, dx, dy);
  const lower = left + (gradient(col + 1, row, dx - 1, dy) - left) * fade(dx);
  const upperLeft = gradient(col, row + 1, dx, dy - 1);
  const upper = upperLeft + (gradient(col + 1, row + 1, dx - 1, dy - 1) - upperLeft) * fade(dx);
  return lower + (upper - lower) * fade(dy);
}

export function soilBaseline(x, y, seed = 0) {
  const cx = (Math.floor(x / CW) + 0.5) * CW;
  const cy = (Math.floor(-y / CH) + 0.5) * CH;
  const patch = (a, b, salt) =>
    perlin(a * 0.8, b * 0.8, salt) + 0.28 * perlin(a * 1.9, b * 1.9, salt + 500);
  const depth = clamp(cy / DEPTH);
  return {
    m: clamp(38 + 57 * depth + 24 * patch(cx + 0.21, cy, seed), 18, 98),
    n: clamp(31 + 44 * depth + 43 * patch(cx, cy + 0.37, seed + 1501), 10, 95),
    d: 0.48 - 0.34 * depth,
    o: 0,
    c: 0,
    mulch: 0,
    litter: 0,
  };
}
export const colAt = x => clamp(Math.floor(x / CW + COLS / 2), 0, COLS - 1);
export function sampleSoil(state, x, y = 0) {
  const row = clamp(Math.floor(-y / CH), 0, ROWS - 1);
  return state.soil[row * COLS + colAt(x)];
}
const healthySoil = [73, 38, 19];
const drySoil = [173, 95, 47];
const depletedSoil = [90, 71, 59];
export function soilColorRGB(cell) {
  const moisture = clamp((cell.m - 18) / 57);
  const fertility = clamp(cell.n / 65);
  return healthySoil.map((healthy, channel) => {
    const dry = drySoil[channel];
    const nourished = dry + (healthy - dry) * moisture;
    return (depletedSoil[channel] + (nourished - depletedSoil[channel]) * fertility) / 255;
  });
}
export function rootThickness(segment) {
  const depth = Math.hypot(
    segment.a[0] - (segment.originX ?? segment.a[0]),
    segment.a[1],
  );
  return segment.radiusA ?? Math.max(0.006, 0.055 / (1 + depth * 1.4));
}
export function freshState(soilSeed = Math.floor(Math.random() * 1e7)) {
  return {
    version: SAVE_VERSION,
    phase: 0,
    budget: 36000,
    reachedPhase: 0,
    survey: [],
    surveyPlants: [],
    plants: [],
    weeds: [],
    mushrooms: [],
    worms: [],
    day: 0,
    speed: 1,
    prep: [false, false, false],
    warned: {},
    review: null,
    weedDays: 0,
    soilSeed,
    soil: Array.from({ length: COLS * ROWS }, (_, i) =>
      soilBaseline(soilX(i % COLS), -(Math.floor(i / COLS) + 0.5) * CH, soilSeed)),
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
export function loadState(saved) {
  if (saved?.version !== SAVE_VERSION || saved.soil?.length !== COLS * ROWS) return freshState();
  if (saved.storageFormat === 1) {
    for (const plant of [...saved.plants, ...saved.weeds]) {
      plant.roots = (plant.roots ?? []).map(([ax, ay, bx, by, born, radiusA, radiusB]) => ({
        a: [ax, ay],
        b: [bx, by],
        born,
        ...(radiusA > 0 ? { radiusA, radiusB } : {}),
        originX: plant.x,
      }));
    }
    delete saved.storageFormat;
  }
  return saved;
}
export const cellAt = sampleSoil;
export function plantSoilCells(state, plant) {
  const roots = plant.tips?.length ? plant.tips : [{ x: plant.x, y: -0.08 }];
  return [...new Set(roots.map(tip => sampleSoil(state, tip.x, tip.y)))];
}
export const plantHeight = (p) => {
  const sp = getSpecies(p.sid);
  return p.wild
    ? sp.height
    : p.planted
      ? Math.min(
          sp.height * (sp.type === "weed" ? 1.35 : 1),
          (sp.type === "weed" ? 0.53 : 0.38) + (p.biomass || 0),
        )
      : Math.min(sp.height, 0.38 + (p.biomass || 0.07));
};
export const raining = (day) =>
  Math.floor((day % 365) / 91.25) === 1
    ? Math.floor(day) % 29 < 4
    : Math.floor(day) % 19 < 5;
export function addWater(s, x, amount = 10) {
  s.surface[colAt(x)] = clamp(s.surface[colAt(x)] + amount, 0, 90);
}
// A pour ponds first, then infiltrates over roughly one to two simulated days.
const waterBuffers = new WeakMap();
export function hydrology(s, dt) {
  if (!((s.phase === 4 && !s.review) || s.phase === 6) || !s.speed) return;
  const factor = s.speed;
  const diffusion = Math.min(dt * factor, 0.8);
  for (let c = 0; c < COLS; c++) {
    const top = s.soil[c],
      flux = Math.min(
        s.surface[c],
        dt * factor * (61 + top.d * 26),
      );
    s.surface[c] -= flux;
    let moisture = flux * 1.35;
    for (let r = 0; r < ROWS && moisture > 0; r++) {
      const cell = s.soil[r * COLS + c];
      const share = r === 0 ? moisture * 0.70 : r === 1 ? moisture * 0.73 : moisture;
      const absorbed = Math.min(share, 100 - cell.m);
      cell.m += absorbed;
      moisture -= absorbed;
    }
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
            Math.max(0, a.m - below.m + 5) * diffusion * 0.46 * (0.3 + a.d);
        transfer[i] -= f;
        transfer[i + COLS] += f;
      } else {
        transfer[i] -= Math.max(0, a.m - 72) * a.d * diffusion * 0.025;
      }
      if (c < COLS - 1) {
        const f = (a.m - s.soil[i + 1].m) * diffusion * 0.22;
        transfer[i] -= f;
        transfer[i + 1] += f;
      }
    }
  s.soil.forEach((a, i) => (a.m = clamp(a.m + transfer[i], 0, 100)));
}
const nutrientBuffers = new WeakMap();
function diffuseNutrients(state) {
  const { soil } = state;
  let transfer = nutrientBuffers.get(state);
  if (!transfer) {
    transfer = new Float64Array(soil.length);
    nutrientBuffers.set(state, transfer);
  }
  transfer.fill(0);
  const exchange = (i, j) => {
    const a = soil[i], b = soil[j];
    const moisture = clamp((Math.min(a.m, b.m) - 15) / 25);
    const fertility = clamp((Math.min(a.n, b.n) - 8) / 20);
    const flux = (a.n - b.n) * 0.003 * moisture * fertility;
    transfer[i] -= flux;
    transfer[j] += flux;
  };
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col;
      if (col + 1 < COLS) exchange(i, i + 1);
      if (row + 1 < ROWS) exchange(i, i + COLS);
    }
  soil.forEach((cell, i) => { cell.n += transfer[i]; });
}
export function growRoots(s, p) {
  p.roots ??= [];
  p.tips ??= [];
  if (!p.tips.length && p.roots.length === 0)
    p.tips = [
      { x: p.x, y: -0.01, dir: -1, angle: -0.2, age: 0 },
      { x: p.x, y: -0.01, dir: 1, angle: 0.2, age: 0 },
    ];
  if (p.roots.length >= 720) return;
  const next = [],
    forks = [];
  for (let i = 0; i < p.tips.length; i++) {
    const a = p.tips[i];
    const atBedrock = a.y <= -DEPTH + 0.01;
    const key = p.seed * 101 + s.day * 13 + i * 37,
      step =
        (0.12 + random(key) * 0.17) * (0.15 + 0.85 / (1 + (p.age || 0) * 0.9)),
      heading = a.angle ?? a.dir * 0.2;
    const limit = !p.roots.length || (a.age === 0 && a.y >= -0.04) ? 0.46 : 1.49;
    const turns = atBedrock ? [-Math.PI / 2, Math.PI / 2] : [-0.6, -0.3, 0, 0.3, 0.6];
    const candidates = turns.map((turn, j) => {
        const angle = atBedrock ? turn : clamp(
            heading * 0.9 + turn + (random(key + j * 11) - 0.5) * 0.8,
            -limit,
            limit,
          ),
          x = clamp(a.x + Math.sin(angle) * step, -MAP_HALF + 0.01, MAP_HALF - 0.01),
          y = Math.max(-DEPTH + 0.01, a.y - Math.cos(angle) * step);
        const cell = cellAt(s, x, y);
        return {
          x,
          y,
          angle,
          score: x === a.x && y === a.y ? -Infinity :
            cell.m * 0.8 + cell.n * 0.06 +
            random(key + j * 7) * 14 -
            Math.abs(angle - heading) * 1.5,
        };
      })
      .sort((a, b) => b.score - a.score);
    const b = candidates[0];
    if (!Number.isFinite(b.score)) continue;
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
      sinceFork: (a.sinceFork ?? a.age ?? 0) + 1,
    };
    next.push(tip);
    if (
      tip.sinceFork >= 7 &&
      random(key + 97) < 0.24 &&
      next.length + forks.length < 10
    ) {
      const turn =
        (random(key + 5) < 0.5 ? -1 : 1) * (0.5 + random(key + 31) * 0.45);
      tip.sinceFork = 0;
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
export function prepareSoilAt(s, x, tool, y = 0) {
  const center = colAt(x);
  if (tool === "compost") {
    const cell = s.soil[center];
    cell.n = Math.min(100, cell.n + 3.6);
    cell.o = Math.min(1, cell.o + 0.07);
    cell.c = Math.min(1, cell.c + 0.06);
    if (s.phase === 1) s.prep[1] = s.prep[2] = true;
    return;
  }
  const targetRow = clamp(Math.floor(-y / CH), 0, ROWS - 1);
  for (let row = Math.max(0, targetRow - 1); row <= Math.min(ROWS - 1, targetRow + 1); row++) {
    for (let col = Math.max(0, center - 1); col <= Math.min(COLS - 1, center + 1); col++) {
      const distance = Math.abs(col - center) + Math.abs(row - targetRow);
      const dose = 0.34 ** distance;
      const cell = s.soil[row * COLS + col];
      cell.d = Math.min(1, cell.d + 0.42 * dose);
      cell.m = Math.max(0, cell.m - 16 * dose);
      if (row === 0) s.surface[col] = Math.max(0, s.surface[col] - 10 * dose);
    }
  }

}

export function returnLeafToSoil(state, x, area) {
  const cell = cellAt(state, x);
  const dose = clamp(area, 0.01, 0.4);
  cell.litter += dose * 0.25;
  cell.n = clamp(cell.n + dose * 0.12, 0, 100);
}
export function returnWeedToSoil(s, weed) {
  for (let offset = -2; offset <= 2; offset++) {
    const cell = cellAt(s, weed.x + offset * CW, -CH * 0.5);
    cell.litter += (1.5 + (weed.biomass || 0.5)) * (1 - Math.abs(offset) * 0.2);
  }
}
export const WORM_LIMIT = 10;
export const WORM_STEP_DAYS = 10;
export function stepWorms(state) {
  const { worms, soil, day } = state;
  if (day % 12 === 0 && worms.length < WORM_LIMIT) {
    const inward = worms.length % 2 === 0 ? 1 : -1;
    const edge = inward === 1 ? PLOT_FIRST - 1 : PLOT_END;
    const habitat = [];
    for (let row = 2; row <= 6; row++)
      for (let offset = 1; offset <= 2; offset++) {
        const col = edge - inward * offset;
        const cell = soil[row * COLS + col];
        if (cell.m >= 30 && cell.n >= 36 &&
            !worms.some(worm => Math.abs(worm.col - col) + Math.abs(worm.row - row) < 2))
          habitat.push({ col, row });
      }
    if (habitat.length) {
      const start = habitat[Math.floor(random(day * 4.3) * habitat.length)];
      worms.push({ ...start, id: day, cargo: 0, inward });
    }
  }
  for (const worm of worms) {
    if (worm.nextCol != null) {
      if (day - worm.moveStart < WORM_STEP_DAYS) continue;
      worm.col = worm.nextCol;
      worm.row = worm.nextRow;
      const target = soil[worm.row * COLS + worm.col];
      const deposit = Math.min(worm.cargo, 100 - target.n, 0.30);
      target.n += deposit;
      worm.cargo -= deposit;
    }
    // Bring wandering worms from older saves back to the bed.
    if (worm.col < PLOT_FIRST) worm.inward = 1;
    else if (worm.col >= PLOT_END) worm.inward = -1;
    else if ((worm.inward === 1 && worm.col >= PLOT_FIRST + 1) ||
        (worm.inward === -1 && worm.col <= PLOT_END - 2)) {
      delete worm.inward;
      worm.turnDay = day;
    }
    const source = soil[worm.row * COLS + worm.col];
    if (worm.cargo === 0 && source.n >= 45) {
      const load = Math.min(2.1, (source.n - 43) * 0.15);
      source.n -= load;
      worm.cargo += load;
    }
    const key = day * 13.7 + worm.id * 9.1;
    const inPlot = worm.col >= PLOT_FIRST && worm.col < PLOT_END;
    const left = inPlot ? PLOT_FIRST : 0, right = inPlot ? PLOT_END : COLS;
    const atEdge = worm.col + worm.dx < left || worm.col + worm.dx >= right;
    const chooseHeading = !worm.turnDay || day >= worm.turnDay || atEdge;
    let forageDy = 0;
    if (worm.inward) {
      worm.heading = worm.inward;
    } else if (chooseHeading) {
      let best = -Infinity;
      for (const dx of [-1, 1])
        for (const dy of [-1, 0, 1]) {
          const col = worm.col + dx, row = worm.row + dy;
          if (col < left || col >= right || row < 0 || row >= ROWS) continue;
          const noise = random(key + row * 33 + col * 1.9);
          const forage = worm.cargo === 0 ? (soil[row * COLS + col].n - source.n) * 0.05 : 0;
          const weight = noise + forage - Math.abs(dy) * 0.25 + (dx === worm.dx ? 0.18 : 0);
          if (weight <= best) continue;
          best = weight;
          worm.heading = dx;
          forageDy = dy;
        }
      worm.turnDay = day + WORM_STEP_DAYS * (6 + Math.floor(random(key + 10) * 5));
    }
    const seekingFood = !worm.inward && chooseHeading && worm.cargo === 0;
    if (!seekingFood && random(key + 20) < (worm.inward ? 0.35 : 0.68)) {
      if (worm.row === 0) worm.slope = 1;
      else if (worm.row === ROWS - 1) worm.slope = -1;
      else if (!worm.slope || random(key + 21) < 0.13)
        worm.slope = random(key + 22) < 0.5 ? -1 : 1;
      worm.nextRow = worm.row + worm.slope;
    } else {
      worm.nextRow = worm.row + (seekingFood ? forageDy : 0);
    }
    worm.dx = worm.heading;
    worm.dy = worm.nextRow - worm.row;
    worm.nextCol = worm.col + worm.dx;
    worm.moveStart = day;
  }
}

export function stepDay(s, exposure = () => ({ light: 1, rain: 1 })) {
  s.day++;
  const summer = Math.floor((s.day % 365) / 91.25) === 1,
    rain = raining(s.day);
  let lastSample = -1, sky;
  for (let c = 0; c < COLS; c++) {
    const plotColumn = c >= PLOT_FIRST && c < PLOT_END;
    const woodlandStart = c < PLOT_FIRST ? 0 : PLOT_END;
    const woodlandEnd = c < PLOT_FIRST ? PLOT_FIRST : COLS;
    const group = Math.floor((c - woodlandStart) / 4) * 4;
    const sampleColumn = plotColumn ? c : Math.min(woodlandEnd - 1, woodlandStart + group + 2);
    if (sampleColumn !== lastSample) {
      sky = exposure(soilX(sampleColumn), 0, null);
      lastSample = sampleColumn;
    }
    const top = s.soil[c];
    if (rain) s.surface[c] = clamp(s.surface[c] + 2.1 * sky.rain, 0, 80);
    for (let r = 0; r < ROWS; r++) {
      const cell = s.soil[r * COLS + c],
        evap =
          (summer ? 0.75 : 0.42) *
          (1 - 0.6 * top.mulch) *
          (0.35 + 0.65 * sky.light) *
          Math.exp(-r * 0.5);
      cell.m = clamp(cell.m - evap, 0, 100);
      const decay = Math.min(cell.litter, (0.025 * cell.c * cell.m) / 100);
      cell.litter -= decay;
      cell.n = clamp(cell.n + decay * 2 + 0.003 * cell.c, 0, 100);
    }
    top.mulch = Math.max(0, top.mulch - 0.00013);
  }
  diffuseNutrients(s);
  for (const p of [...s.plants, ...s.weeds]) {
    if (!p.planted || p.health === 0) continue;
    const sp = getSpecies(p.sid);
    p.age = (p.age || 0) + 1 / 365;
    const e = exposure(p.x, plantHeight(p) * 0.72, p.id);
    p.light = e.light;
    const samples = plantSoilCells(s, p);
    const m = samples.reduce((a, c) => a + c.m, 0) / samples.length,
      n = samples.reduce((a, c) => a + c.n, 0) / samples.length;
    const neighbors = s.plants.filter(
      (q) => q !== p && q.planted && q.health > 0 && Math.abs(q.x - p.x) < 1.8,
    ).length;
    const sheltered = clamp(neighbors * 0.09, 0, 0.28);
    const moisture = m < sp.water
      ? clamp(m / (sp.water - 10))
      : clamp(1 - (m - sp.water - 10) / 32);
    const nutrients = clamp(n / 60);
    const light = clamp(e.light / (0.65 - sp.shade * 0.35));
    // The root zone sets sustainable health. Shade has a larger effect on growth.
    const soilFitness = moisture ** 0.6 * nutrients ** 0.4;
    const targetHealth = 100 * soilFitness * (0.9 + 0.1 * light);
    const previousHealth = p.health ?? 95;
    const change = targetHealth - previousHealth;
    const nextHealth = previousHealth + clamp(change * 0.055, -2.5, 1.5);
    p.health = Math.abs(targetHealth - nextHealth) < 0.1
      ? targetHealth
      : nextHealth;
    if (change < 0) {
      const loss = previousHealth - p.health;
      const stress = p.stressHistory ??= [0, 0, 0, 0];
      stress[m < sp.water ? 0 : 1] += 0.6 * (1 - moisture) * loss;
      stress[2] += 0.4 * (1 - nutrients) * loss;
      stress[3] += 0.1 * (1 - light) * loss;
    } else if (p.stressHistory) {
      if (p.health >= 95) delete p.stressHistory;
      else if (change > 0)
        p.stressHistory = p.stressHistory.map(value => value * 0.997);
    }
    if (p.health === 0) {
      const reasons = [
        "dry soil around the roots",
        "waterlogged soil around the roots",
        "too few soil nutrients",
        "too little light",
      ];
      const strongest = p.stressHistory
        .map((value, index) => ({ value, reason: reasons[index] }))
        .sort((a, b) => b.value - a.value);
      p.deathReason = strongest[1].value >= strongest[0].value * 0.8
        ? `The strongest stresses were ${strongest[0].reason} and ${strongest[1].reason}.`
        : `The strongest stress was ${strongest[0].reason}.`;
      delete p.stressHistory;
      continue;
    }
    p.biomass = clamp(
      (p.biomass || 0) +
        (sp.height / 2100) * soilFitness * (0.35 + 0.65 * light) *
          (1 + sheltered) * (p.health / 100),
      0,
      sp.height - 0.38,
    );
    if (p.health > 0) {
      const active = new Set(samples);
      const stride = Math.max(1, Math.floor((p.roots?.length ?? 0) / 12));
      for (let i = 0; i < (p.roots?.length ?? 0); i += stride) {
        const { a, b } = p.roots[i];
        active.add(cellAt(s, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2));
      }
      const demand = (sp.type === "weed" ? 0.33 : 0.48 + Math.min(1.9, plantHeight(p) * 0.16)) * (summer ? 1.22 : 1);
      const perCell = demand * (p.health / 100) / Math.sqrt(active.size);
      for (const cell of active) {
        cell.m = Math.max(0, cell.m - perCell);
        cell.n = Math.max(0, cell.n - 0.015);
      }
    }
    if (p.health > 0 && s.day >= (p.nextRootDay ?? 0)) {
      growRoots(s, p);
      p.nextRootDay = s.day + Math.round(6 + p.age * 15);
    }
  }
  s.weedDays += s.weeds.length;
  // Open, unmulched patches recruit often; mulch and a closed canopy lower the probability.
  if (s.day % 4 === 0 && s.weeds.length < 42) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const x = (random(s.day * 4 + attempt) * 2 - 1) * (HALF - 0.35),
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
    const x = (random(s.day) * 2 - 1) * (HALF - 0.35),
      c = cellAt(s, x);
    if (c.c > 0.3 && c.m > 48)
      s.mushrooms.push({
        id: "m" + s.day,
        x,
        born: s.day,
        until: s.day + 40 + Math.floor(random(s.day + 1) * 35),
      });
  }
  stepWorms(s);
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
