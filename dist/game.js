import * as T from "./vendor/three.module.js";
import { species, layers, sources } from "./species.js";
const $ = (id) => document.getElementById(id),
  clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const rand = (n) => {
  let a = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return a - Math.floor(a);
};
const phases = [
  "Survey",
  "Prepare",
  "Buy & plant",
  "Mulch & water",
  "Tend & observe",
  "Review",
  "Free growth",
];
const instructions = [
  "Drag the landscape to explore. Tap five different plants to collect them in your notebook.",
  "Loosen the bed for drainage, mix organic matter, then add living compost.",
  "Buy surveyed seedlings. Drag the pots to design your forest, then confirm each planting.",
  "Drag mulch and the watering can across the planting bed. Cover and water the whole plot.",
  "Tap weeds marked ! to pluck them. Water dry soil and inspect your growing plants.",
  "Three years of care, measured in a living forest.",
  "Keep tending your forest and watch the layers mature.",
];
let state = {
  phase: 0,
  budget: 6000,
  survey: [],
  plants: [],
  soil: Array.from({ length: 24 }, (_, i) => ({
    m: 42 + rand(i) * 10,
    n: 30,
    d: 0.15,
    o: 0,
    c: 0,
    mulch: 0,
    litter: 0,
  })),
  prep: [false, false, false],
  day: 0,
  speed: 0,
  weeds: [],
  warned: {},
  review: null,
};
try {
  const saved = JSON.parse(localStorage.getItem("pocket-forest-v1"));
  if (
    saved?.version === 1 &&
    Array.isArray(saved.state.soil) &&
    saved.state.soil.length === 24
  )
    state = saved.state;
} catch {}
state.speed = 0;
let resetInProgress = false;
let pointerWorld = { x: 0, y: 1 },
  selected = null,
  tool = null,
  pan = 0,
  zoom = 1,
  avatarTarget = 0,
  avatarX = 0,
  lastFrame = 0,
  simAccumulator = 0,
  saveTimer = 0,
  uiTimer = 0,
  visualDay = -999,
  toastTimer,
  drag = null,
  needsRebuild = true,
  continued = false;
const scene = new T.Scene();
scene.background = new T.Color("#e7eddf");
scene.fog = new T.Fog("#e7eddf", 45, 120);
let renderer;
try {
  renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
} catch (e) {
  $("fatal").hidden = false;
  $("fatal").textContent =
    "This forest needs WebGL. Please open it in a browser with hardware acceleration enabled.";
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = T.SRGBColorSpace;
$("scene").appendChild(renderer.domElement);
const camera = new T.OrthographicCamera(-25, 25, 20, -9, 0.1, 200);
camera.position.set(0, 4, 65);
camera.lookAt(0, 4, 0);
scene.add(new T.HemisphereLight(0xfffbe8, 0x79836b, 2.5));
const sun = new T.DirectionalLight(0xffefc4, 2.2);
sun.position.set(-15, 35, 28);
scene.add(sun);
const matCache = new Map(),
  boxGeo = new T.BoxGeometry(1, 1, 1);
function material(color, opacity = 1) {
  const k = (color?.isColor ? color.getHexString() : color) + "-" + opacity;
  if (!matCache.has(k))
    matCache.set(
      k,
      new T.MeshLambertMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity > 0.5,
      }),
    );
  return matCache.get(k);
}
function box(parent, x, y, z, w, h, d, color, opacity = 1) {
  const b = new T.Mesh(boxGeo, material(color, opacity));
  b.position.set(x, y, z);
  b.scale.set(w, h, d);
  parent.add(b);
  return b;
}
function segment(parent, a, b, width, color, opacity = 1) {
  const delta = new T.Vector3().subVectors(b, a);
  const m = box(parent, 0, 0, 0, width, delta.length(), width, color, opacity);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
  return m;
}
const world = new T.Group();
scene.add(world);
const rootsGroup = new T.Group(),
  plantsGroup = new T.Group(),
  ghosts = new T.Group(),
  soilGroup = new T.Group(),
  fauna = new T.Group();
world.add(soilGroup, rootsGroup, plantsGroup, ghosts, fauna);
const mature = [];
const matureGroup = new T.Group();
world.add(matureGroup);
const sway = [];
const markerElements = new Map();
// A strict front elevation: x pans, y is height. No orbit controls or perspective camera.
for (let i = 0; i < 44; i++) {
  let x = -65 + i * 3.1;
  if (Math.abs(x) < 8) continue;
  const sp = species[i % species.length];
  if (sp.id === "four" && i % 2) continue;
  const p = {
    id: "wild" + i,
    sid: sp.id,
    x,
    y: 0,
    z: -3 - rand(i) * 5,
    age: 20,
    health: 95,
    seed: 100 + i,
    planted: true,
  };
  mature.push(p);
}
// Faint woodland beyond the survey strip.
for (let i = 0; i < 28; i++) {
  const x = -70 + i * 5;
  box(world, x, 5 + rand(i) * 2, -16, 0.2, 15 + rand(i) * 9, 0.25, 0xb7c6a7);
  for (let j = 0; j < 4; j++)
    box(
      world,
      x + (rand(i + j) * 4 - 2),
      12 + j * 2,
      -17,
      2 + rand(i + j) * 2,
      1.4,
      1,
      0xc8d3b7,
    );
}
box(world, 0, -4.5, -1, 160, 9, 6, 0x6f6046);
box(world, 0, -1, -0.8, 160, 2, 6, 0x8f7956);
box(world, 0, -0.12, 0, 160, 0.22, 6, 0x9a865f);
for (let i = 0; i < 380; i++) {
  const x = rand(i + 2) * 155 - 77.5,
    y = -rand(i + 33) * 8.8;
  box(
    world,
    x,
    y,
    3.02,
    0.08 + rand(i) * 0.17,
    0.08,
    0.025,
    i % 3 ? 0x9c8a65 : 0x5b503b,
  );
}
for (let i = 0; i < 14; i++) {
  const x = rand(i + 91) * 145 - 72;
  if (Math.abs(x) < 6.5) continue;
  box(world, x, 0.12, 0, 0.9 + rand(i) * 1.3, 0.3, 0.8, 0x87926a);
}
const gardener = new T.Group();
world.add(gardener);
box(gardener, 0, 1.15, 3.8, 0.48, 0.66, 0.32, 0x6b8258);
box(gardener, 0, 1.73, 3.8, 0.42, 0.45, 0.38, 0xc9a27e);
box(gardener, 0, 2.02, 3.8, 0.66, 0.12, 0.57, 0xc8b78c);
box(gardener, 0, 2.1, 3.8, 0.4, 0.15, 0.35, 0xb5a577);
const legs = [
  box(gardener, -0.14, 0.49, 3.8, 0.19, 0.65, 0.25, 0x40584e),
  box(gardener, 0.14, 0.49, 3.8, 0.19, 0.65, 0.25, 0x40584e),
];
const arms = [
  box(gardener, -0.34, 1.1, 3.8, 0.16, 0.62, 0.22, 0xc9a27e),
  box(gardener, 0.34, 1.1, 3.8, 0.16, 0.62, 0.22, 0xc9a27e),
];
for (let i = 0; i < 14; i++)
  box(
    gardener,
    rand(i) * 0.4 - 0.2,
    0.9 + rand(i + 2) * 0.55,
    3.975,
    0.065,
    0.07,
    0.01,
    0x7e9367,
  );
box(gardener, -0.09, 1.77, 4.0, 0.04, 0.04, 0.01, 0x3c4034);
box(gardener, 0.09, 1.77, 4.0, 0.04, 0.04, 0.01, 0x3c4034);
function clear(g) {
  for (const c of [...g.children]) {
    c.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
    g.remove(c);
  }
}
const byId = (id) => species.find((s) => s.id === id),
  cellAt = (x) => state.soil[clamp(Math.floor(((x + 6) / 12) * 24), 0, 23)];
function canopySun(x, y, self) {
  const ray = new T.Raycaster(
    new T.Vector3(x, y + 0.2, 2),
    new T.Vector3(-0.18, 1, 0).normalize(),
    0.1,
    40,
  );
  const hits = ray.intersectObjects(plantsGroup.children, true);
  return hits.some(
    (h) => h.object.userData.leaf && h.object.userData.pid !== self,
  )
    ? 0.25
    : 1;
}
function growth(p, sp) {
  if (!p.planted) return 0.55;
  return Math.min(sp.height, 0.55 + (p.biomass ?? (p.age * sp.height) / 12));
}
function makePlant(p, group, ghost = false) {
  const sp = byId(p.sid),
    height = ghost ? sp.height : growth(p, sp),
    health = p.health ?? 100;
  const opacity = ghost ? 0.16 : 1;
  const root = new T.Group();
  root.position.set(p.x, p.planted ? 0 : Math.max(0.13, p.drop ?? 0), p.z ?? 1);
  group.add(root);
  if (!ghost) sway.push({ root, seed: p.seed, base: root.rotation.z });
  let color = new T.Color(sp.color);
  if (health < 65) color.lerp(new T.Color(0xb5a36b), (65 - health) / 75);
  const winter = (sp.deciduous && Math.floor((state.day % 365) / 91) === 3) || health <= 0;
  const autumn = sp.deciduous && Math.floor((state.day % 365) / 91) === 2;
  if (autumn) color.lerp(new T.Color(0xb88d46), 0.7);
  const width = Math.max(0.035, height * 0.032);
  const trunkHeight = height * (sp.layer === 0 ? 0.5 : 0.68);
  segment(
    root,
    new T.Vector3(0, 0, 0),
    new T.Vector3(0.06, trunkHeight, 0),
    width,
    0x726047,
    opacity,
  );
  let leafCount = 0;
  const leafData = [];
  const branches = sp.id === "ardisia" ? 4 : 8;
  for (let j = 0; j < branches; j++) {
    const sign = j % 2 ? 1 : -1;
    let startY = trunkHeight * (0.3 + (j / branches) * 0.66),
      spread =
        height * (sp.layer === 0 ? 0.32 : 0.26) * (1 - (j / branches) * 0.5);
    let start = new T.Vector3(0, startY, 0);
    let end = new T.Vector3(
      sign * spread,
      height * (0.52 + (j / branches) * 0.46),
      0,
    );
    if (!ghost && p.planted && p.age < 15) {
      const light = canopySun(p.x + end.x, end.y, p.id);
      end.x += sign * (1 - light) * 0.22;
      end.y += light * 0.12;
    }
    end.y -= health < 35 ? height * 0.1 : 0;
    const joint = new T.Group();
    joint.position.copy(start);
    root.add(joint);
    if (!ghost) sway.push({root:joint,seed:p.seed+j*2,mature:p.id.startsWith("wild")});
    const rel = end.clone().sub(start);
    segment(joint, new T.Vector3(), rel, width * 0.45, 0x7a674b, opacity);
    for (let k = 0; k < 5; k++) {
      const f = 0.25 + k * 0.16;
      const a = rel.clone().multiplyScalar(f);
      a.x += (rand(p.seed + j * 11 + k) * 2 - 1) * height * 0.07;
      const scale = sp.leaf === "small" ? 0.75 : sp.leaf === "long" ? 1.25 : 1;
      const leafW =
          Math.max(0.09, Math.min(0.85, height * 0.16)) *
          (0.7 + rand(j + k) * 0.6),
        leafH = leafW * (sp.leaf === "long" ? 1.65 : 0.68);
      if (!winter || k === 0) {
        leafData.push({
          x: a.x + start.x,
          y: a.y + start.y,
          z: rand(j + k) * 0.15,
          w: leafW * scale,
          h: leafH,
          r: sign * (0.3 + rand(k) * 0.5),
        });
        leafCount++;
      }
      if (
        k === 4 &&
        sp.flower &&
        height > sp.height * 0.23 &&
        health > 55 &&
        !ghost &&
        (state.day % 365 < 140 ||
          (sp.id === "camellia" && state.day % 365 > 280))
      ) {
        box(
          joint,
          a.x,
          a.y + 0.04,
          0.2,
          leafW * 0.6,
          leafW * 0.6,
          0.14,
          sp.flower,
        );
        p.flowers = true;
      }
    }
  }
  if (height > 2 && !winter)
    for (let j = 0; j < 12; j++)
      for (let k = 0; k < 9; k++) {
        const angle = rand(p.seed + j * 31 + k) * Math.PI * 2,
          rr = Math.sqrt(rand(p.seed + j * 13 + k + 3));
        const cy = 0.55 + (j / 12) * 0.4;
        const spread = height * 0.29 * (1 - (j / 12) * 0.65);
        leafData.push({
          x: Math.cos(angle) * rr * spread,
          y: height * cy + Math.sin(angle) * rr * height * 0.12,
          z: 0.15 + rand(j + k) * 0.3,
          w: 0.28 + rand(j + k) * 0.6,
          h: sp.leaf === "long" ? 0.65 : 0.3,
          r: angle,
        });
      }
  if (leafData.length) {
    const leaves = new T.InstancedMesh(
        boxGeo,
        material(0xffffff, opacity),
        leafData.length,
      ),
      dummy = new T.Object3D();
    leafData.forEach((l, i) => {
      dummy.position.set(l.x, l.y, l.z);
      dummy.rotation.set(0, 0, l.r);
      dummy.scale.set(l.w, l.h, 0.07);
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
      leaves.setColorAt(
        i,
        color.clone().multiplyScalar(0.75 + rand(i + p.seed) * 0.4),
      );
    });
    leaves.userData = { leaf: true, pid: p.id };
    root.add(leaves);
  }
  if (!p.planted && !ghost) {
    box(root, 0, 0.12, 0.15, 0.38, 0.36, 0.38, 0xa77a58);
    box(root, 0, 0.31, 0.15, 0.45, 0.09, 0.45, 0xbe9370);
  }
  root.userData = { pid: p.id };
  return root;
}
function rebuild() {
  clear(plantsGroup);
  clear(ghosts);
  clear(rootsGroup);
  clear(soilGroup);
  sway.splice(
    0,
    sway.length,
    ...sway.filter((s) => (s.root.parent === matureGroup || s.mature)),
  );
  for (const p of state.plants) {
    p.flowers = false;
    makePlant(p, plantsGroup);
    if (p.planted) drawRoots(p);
  }
  if (selected && state.phase === 2)
    for (const p of state.plants) makePlant(p, ghosts, true);
  state.soil.forEach((s, i) => {
    const x = -5.75 + i * 0.5;
    box(
      soilGroup,
      x,
      -1.1,
      3.1,
      0.49,
      2,
      0.02,
      new T.Color(0x8e7651).lerp(new T.Color(0x4b5c48), (Math.round(s.m / 10) * 10) / 160),
    );
    if (s.o) box(soilGroup, x, -0.2, 3.12, 0.48, 0.15, 0.025, 0x756344);
    if (s.mulch)
      for (let k = 0; k < 5; k++) {
        const m = box(
          soilGroup,
          x + (rand(i + k) * 0.44 - 0.22),
          0.03 + k * 0.016,
          3.2,
          0.14,
          0.035,
          0.08,
          0xc5ac70,
        );
        m.rotation.z = rand(k + i) * 0.8;
      }
    if (s.c > 0.2 && state.day % 51 < 6 && state.phase >= 4)
      for (let k = 0; k < 2; k++) {
        box(soilGroup, x + k * 0.15, 0.11, 3.3, 0.035, 0.15, 0.035, 0xd5c7a7);
        box(soilGroup, x + k * 0.15, 0.2, 3.3, 0.12, 0.05, 0.1, 0xb28d68);
      }
  });
  for (const w of state.weeds) {
    for (let k = 0; k < 3; k++) {
      const m = box(
        soilGroup,
        w.x + (k - 1) * 0.07,
        0.2,
        3.4,
        0.07,
        0.4,
        0.06,
        0x83a14b,
      );
      m.rotation.z = (k - 1) * 0.55;
    }
  }
  needsRebuild = false;
  visualDay = state.day;
}
function drawRoots(p) {
  const sp = byId(p.sid);
  const depth = Math.min(4.5, 0.12 + p.age * 0.55),
    max = Math.min(18, Math.ceil(depth * 4));
  for (let r = 0; r < 4; r++) {
    let a = new T.Vector3(p.x, -0.05, 3.2);
    for (let j = 0; j < max; j++) {
      const alternatives = [-0.23, 0, 0.23]
        .map((dx) => {
          const x = clamp(a.x + dx + (r - 1.5) * 0.08, -6, 6);
          return {
            x,
            score: cellAt(x).m + rand(p.seed + r * 22 + j + dx) * 12,
          };
        })
        .sort((a, b) => b.score - a.score);
      const b = new T.Vector3(alternatives[0].x, a.y - depth / max, 3.2);
      segment(
        rootsGroup,
        a,
        b,
        Math.max(0.012, 0.045 * (1 - j / max)),
        0xc6ad7c,
      );
      if (j % 4 === 0)
        segment(
          rootsGroup,
          b,
          b.clone().add(new T.Vector3(r % 2 ? 0.22 : -0.22, -0.1, 0)),
          0.013,
          0xb9a375,
        );
      a = b;
    }
  }
}
for (const p of mature) makePlant(p, matureGroup);
const toolVisual = new T.Group();
world.add(toolVisual);
const mulchModel = new T.Group(),
  waterModel = new T.Group();
toolVisual.add(mulchModel, waterModel);
box(mulchModel, 0, 0.35, 5, 0.6, 0.8, 0.2, 0xc3ad73);
box(mulchModel, 0, 0.8, 5, 0.5, 0.1, 0.2, 0xa58c52);
box(mulchModel, 0, 0.35, 5.12, 0.35, 0.3, 0.02, 0x5d7850);
box(waterModel, 0, 0.3, 5, 0.5, 0.45, 0.3, 0x71938e);
const spout = box(waterModel, 0.42, 0.35, 5, 0.45, 0.1, 0.13, 0x71938e);
spout.rotation.z = 0.4;
box(waterModel, -0.37, 0.5, 5, 0.12, 0.4, 0.12, 0x71938e);
box(waterModel, -0.25, 0.72, 5, 0.32, 0.08, 0.12, 0x71938e);
const rainGroup = new T.Group();
world.add(rainGroup);
for (let i = 0; i < 55; i++)
  box(
    rainGroup,
    rand(i) * 50 - 25,
    rand(i + 5) * 24,
    5,
    0.018,
    0.4,
    0.018,
    0x94b8b5,
    0.45,
  );
const tanuki = new T.Group();
world.add(tanuki);
box(tanuki, 0, 0.4, 4, 0.7, 0.45, 0.3, 0x88785e);
box(tanuki, 0.4, 0.65, 4, 0.35, 0.34, 0.3, 0x8e7b5d);
box(tanuki, 0.45, 0.7, 4.17, 0.32, 0.1, 0.03, 0x514d40);
box(tanuki, 0.5, 0.67, 4.2, 0.05, 0.05, 0.03, 0x242f2a);
box(tanuki, 0.3, 0.87, 4, 0.1, 0.14, 0.14, 0x655e4e);
box(tanuki, -0.5, 0.35, 4, 0.4, 0.16, 0.2, 0x69614c);
for (let i = 0; i < 2; i++)
  box(tanuki, (i - 0.5) * 0.45, 0.16, 4, 0.13, 0.3, 0.15, 0x514f42);
const bees = [];
for (let i = 0; i < 9; i++) {
  const g = new T.Group();
  box(g, 0, 0, 0, 0.15, 0.13, 0.13, 0xdbb44e);
  box(g, 0.025, 0, 0.075, 0.045, 0.135, 0.02, 0x504a36);
  const wing = box(g, 0, 0.1, 0, 0.26, 0.035, 0.15, 0xf2f0d8, 0.85);
  fauna.add(g);
  bees.push({ g, wing, i });
}
function resize() {
  const w = $("world").clientWidth,
    h = $("world").clientHeight;
  renderer.setSize(w, h);
  const half = 17 / zoom;
  camera.left = (-half * w) / h;
  camera.right = (half * w) / h;
  const center = half * 0.53 - 4;
  camera.top = half + center;
  camera.bottom = -half + center;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe($("world"));
function project(x, y, z = 4) {
  const p = new T.Vector3(x, y, z).project(camera);
  return {
    x: (p.x * 0.5 + 0.5) * $("world").clientWidth,
    y: (-p.y * 0.5 + 0.5) * $("world").clientHeight,
  };
}
function marker(key, text, x, y, fn, cls = "") {
  let el = markerElements.get(key);
  if (!el) {
    el = document.createElement("button");
    el.className = "plant-marker " + cls;
    el.onclick = (e) => {
      e.stopPropagation();
      fn();
    };
    $("markers").appendChild(el);
    markerElements.set(key, el);
  }
  el.textContent = text;
  el.className = "plant-marker " + cls;
  const p = project(x, y);
  el.style.left = p.x + "px";
  el.style.top = p.y + "px";
  el.style.display =
    p.x < 0 ||
    p.x > $("world").clientWidth ||
    p.y < 65 ||
    p.y > $("world").clientHeight - 45
      ? "none"
      : "";
  return key;
}
function updateMarkers() {
  const keep = new Set();
  if (state.phase === 0) {
    const shown = new Set();
    for (const p of [...mature].sort((a, b) => Math.abs(a.x) - Math.abs(b.x))) {
      if (shown.has(p.sid)) continue;
      shown.add(p.sid);
      const sp = byId(p.sid),
        seen = state.survey.includes(sp.id);
      keep.add(
        marker(
          p.id,
          (seen ? "✓ " : "＋ ") + sp.name,
          p.x,
          Math.min(sp.height * 0.6, 9),
          () => survey(sp, p),
          seen ? "seen" : "",
        ),
      );
    }
  }
  for (const p of state.plants) {
    const sp = byId(p.sid);
    keep.add(
      marker(
        p.id,
        (p.planted ? "" : "↕ ") + sp.name,
        p.x,
        Math.min(growth(p, sp) + 0.7, 17),
        () => selectPlant(p),
        p.planted ? "seen" : "",
      ),
    );
  }
  if (state.phase >= 4)
    for (const w of state.weeds)
      keep.add(marker(w.id, "!", w.x, 0.65, () => pluck(w), "weed"));
  for (const [key, el] of markerElements)
    if (!keep.has(key)) {
      el.remove();
      markerElements.delete(key);
    }
}
function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 6500);
}
function panel(html) {
  $("panelContent").innerHTML = html;
  if (!$("panel").open) $("panel").showModal();
}
$("closePanel").onclick = () => $("panel").close();
$("panel").addEventListener("click", (e) => {
  if (
    e.target === $("panel") &&
    (e.clientX < $("panel").getBoundingClientRect().left ||
      e.clientX > $("panel").getBoundingClientRect().right)
  )
    $("panel").close();
});
function entry(sp) {
  return `<span class="eyebrow">Field note · ${sp.jp}</span><h2>${sp.name}</h2><i>${sp.latin}</i><div><span class="badge ${sp.native ? "" : "exotic"}">${sp.native ? "Native to the region" : "Introduced to Japan"}</span><span class="badge">${layers[sp.layer]} · ${sp.height} m mature reference</span></div>${sp.photo ? `<img class="ref-photo" src="photos/${sp.photo}.jpg" alt="Your reference photograph for ${sp.name}">` : ""}<p>${sp.desc}</p><p><strong>Reference confidence:</strong> ${sp.confidence}</p><p>Prefers ${sp.shade > 0.7 ? "sheltered shade" : sp.shade > 0.4 ? "sun to partial shade" : "a bright, open position"} and moist, well-drained soil. Height and layer are simplified design references; actual growth depends on the site.</p>`;
}
function survey(sp, p) {
  if (!state.survey.includes(sp.id)) {
    state.survey.push(sp.id);
    toast(
      `${sp.name} added to your notebook. ${Math.min(5, state.survey.length)}/5 surveyed.`,
    );
  }
  avatarTarget = p.x;
  panel(entry(sp));
  updateUI();
  save();
}
function notebook() {
  panel(
    `<span class="eyebrow">Your discoveries</span><h2>Field notebook</h2><p>${state.survey.length} species recorded. Photo identifications are tentative; native status describes the named reference species.</p>${
      state.survey
        .map((id) => {
          const s = byId(id);
          return `<div class="entry"><div><h3>${s.name} <span class="badge ${s.native ? "" : "exotic"}">${s.native ? "Native" : "Introduced"}</span></h3><small>${s.latin}</small><p>${layers[s.layer]} · mature reference ${s.height} m</p></div><button data-note="${s.id}">Read note</button></div>`;
        })
        .join("") || "<p>Tap a plant in the woodland to begin.</p>"
    }`,
  );
  document
    .querySelectorAll("[data-note]")
    .forEach((b) => (b.onclick = () => panel(entry(byId(b.dataset.note)))));
}
$("notebook").onclick = notebook;
function shop() {
  panel(
    `<span class="eyebrow">The local nursery · ¥${state.budget.toLocaleString()} remaining</span><h2>A forest begins small.</h2><p>Only surveyed species are available. Buy at least two seedlings, then drag each pot onto the bed and plant it. Try all four height layers.</p>${state.survey
      .map((id) => {
        const s = byId(id);
        return `<div class="entry"><div><h3>${s.name}</h3><small>${s.latin}</small><p>${layers[s.layer]} · ${s.native ? "Native" : "Introduced"} · ${s.height} m mature reference</p></div><button data-buy="${s.id}" ${state.budget < s.price ? "disabled" : ""}>¥${s.price} · Buy</button></div>`;
      })
      .join("")}`,
  );
  document
    .querySelectorAll("[data-buy]")
    .forEach((b) => (b.onclick = () => buy(b.dataset.buy)));
}
function buy(id) {
  const sp = byId(id);
  if (state.budget < sp.price) return;
  if (!sp.native && !state.warned.nonNative) {
    state.warned.nonNative = true;
    panel(
      `<h2>A visitor from elsewhere</h2><p>${sp.name} is introduced to Japan. Non-native plants can compete for space and resources, and may support different wildlife. Being non-native does not automatically mean a plant is invasive.</p><p>For restoration, locally appropriate native species are the starting point. You can still choose to plant this species.</p><button id="buyAnyway" class="primary">Buy anyway · ¥${sp.price}</button>`,
    );
    $("buyAnyway").onclick = () => buy(id);
    return;
  }
  state.budget -= sp.price;
  const p = {
    id: "p" + Date.now() + Math.floor(Math.random() * 1000),
    sid: id,
    x: clamp(-4.7 + state.plants.length * 0.85, -5.5, 5.5),
    z: 1 + rand(state.plants.length),
    age: 0,
    health: 95,
    biomass: 0,
    seed: state.plants.length + 23,
    planted: false,
    drop: 9,
  };
  state.plants.push(p);
  selected = p;
  avatarTarget = p.x;
  $("panel").close();
  pan = 0;
  needsRebuild = true;
  toast(
    "Your seedling is arriving. Drag its pot onto the bed; tap it to confirm planting.",
  );
  updateUI();
  save();
}
function selectPlant(p) {
  selected = p;
  avatarTarget = p.x;
  needsRebuild = true;
  if (p.planted) {
    const s = cellAt(p.x),
      sp = byId(p.sid);
    panel(
      entry(sp) +
        `<div class="entry"><p>Health <strong>${Math.round(p.health)}%</strong><br>Height ${growth(p, sp).toFixed(1)} m<br>Local moisture ${Math.round(s.m)}% · nutrients ${Math.round(s.n)}%<br>Light available ${Math.round((p.light ?? 1) * 100)}%</p></div>`,
    );
  } else updateSelection();
}
function updateSelection() {
  const el = $("selection");
  if (selected && !selected.planted && state.phase === 2) {
    el.style.display = "block";
    el.innerHTML = `${byId(selected.sid).name} · Plant this seedling here?<br><button id="plantYes" class="primary">Yes, plant here</button><button id="plantLater">Keep arranging</button>`;
    $("plantYes").onclick = confirmPlant;
    $("plantLater").onclick = () => {
      selected = null;
      needsRebuild = true;
      updateSelection();
    };
  } else el.style.display = "none";
}
function confirmPlant() {
  if (!selected) return;
  const p = selected,
    sp = byId(p.sid);
  if (
    state.plants.some(
      (o) =>
        o !== p &&
        o.planted &&
        byId(o.sid).layer === sp.layer &&
        Math.abs(o.x - p.x) < 1.3,
    ) &&
    !state.warned.crowd
  ) {
    state.warned.crowd = true;
    toast(
      "Similar-height neighbors may compete for light and root space. Mixed layers can use space differently. You may still plant here.",
    );
  }
  if (
    state.plants.some((o) => o !== p && o.planted && Math.abs(o.x - p.x) < 0.2)
  ) {
    toast(
      "Give the stems a little room. Move this pot slightly to either side.",
    );
    return;
  }
  p.planted = true;
  p.drop = 0;
  selected = null;
  needsRebuild = true;
  updateUI();
  save();
}
function action(label, fn, active = false) {
  const b = document.createElement("button");
  b.textContent = label;
  b.classList.toggle("active-tool", active);
  b.onclick = fn;
  $("actions").appendChild(b);
}
function setTool(t) {
  tool = tool === t ? null : t;
  toast(
    tool
      ? `Drag ${tool === "mulch" ? "the mulch bag" : "the watering can"} across the soil. You can also tap a patch.`
      : "Tool put away.",
  );
  updateUI();
}
function updateUI() {
  const p = state.phase;
  $("phaseTitle").textContent = [
    "Survey the woodland",
    "Prepare a living soil",
    "Design your little forest",
    "Tuck your seedlings in",
    "Tend. Observe. Let it grow.",
    "Three years, a new beginning.",
    "A forest, becoming.",
  ][p];
  $("instruction").textContent = instructions[p];
  $("steps").innerHTML = phases
    .slice(0, 6)
    .map(
      (_, i) =>
        `<span class="${i < p ? "done" : i === p ? "active" : ""}" title="${phases[i]}"></span>`,
    )
    .join("");
  $("money").textContent = "¥" + state.budget.toLocaleString();
  $("count").textContent = state.survey.length;
  $("actions").innerHTML = "";
  const n = $("next");
  n.hidden = false;
  n.disabled = false;
  if (p === 0) {
    n.textContent =
      state.survey.length < 5
        ? `${state.survey.length}/5 surveyed`
        : "Next · Prepare →";
    n.disabled = state.survey.length < 5;
    action("Explore left", () => {
      pan = -25;
    });
    action("Explore right", () => {
      pan = 25;
    });
  }
  if (p === 1) {
    [
      "1 · Improve drainage · ¥400",
      "2 · Organic matter + mulch supply · ¥800",
      "3 · Add living compost · ¥400",
    ].forEach((label, i) =>
      action(state.prep[i] ? "✓ " + label.split(" · ¥")[0] : label, () =>
        prepare(i),
      ),
    );
    n.textContent = "Next · Buy & plant →";
    n.disabled = !state.prep.every(Boolean);
  }
  if (p === 2) {
    action("Open seedling shop", shop);
    n.textContent = "Next · Mulch & water →";
    n.disabled =
      state.plants.filter((p) => p.planted).length < 2 ||
      state.plants.some((p) => !p.planted);
  }
  if (p === 3) {
    action(
      state.warned.mulchPaid ? "▱ Mulch bag · included" : "▱ Mulch bag · ¥300",
      () => setTool("mulch"),
      tool === "mulch",
    );
    action("♧ Watering can", () => setTool("water"), tool === "water");
    const coverage = state.soil.filter((s) => s.mulch > 0.5).length;
    n.textContent =
      coverage < 24 ? `Mulch ${coverage}/24 patches` : "Begin tending →";
    n.disabled = coverage < 24 || state.soil.some((s) => s.m < 60);
  }
  if (p === 4 || p === 6) {
    action("♧ Watering can", () => setTool("water"), tool === "water");
    action("Inspect / put tool away", () => {
      tool = null;
      updateUI();
    });
    n.hidden = true;
  }
  if (p === 5) {
    n.textContent = "Keep growing →";
    action("View forest review", showReview);
  }
  $("timeline").hidden = ![4, 6].includes(p);
  document.body.classList.toggle("growing", [4, 6].includes(p));
  updateSelection();
  updateStats();
}
function prepare(i) {
  if (state.prep[i]) return;
  if (i && !state.prep[i - 1]) {
    toast("Prepare the soil in order, starting with drainage.");
    return;
  }
  const cost = [400, 800, 400][i];
  if (state.budget < cost) {
    toast("There is not enough forest fund for this supply.");
    return;
  }
  state.budget -= cost;
  state.prep[i] = true;
  if (i === 1) state.warned.mulchPaid = true;
  state.soil.forEach((s) => {
    if (i === 0) s.d = 0.85;
    if (i === 1) {
      s.o = 1;
      s.n += 12;
    }
    if (i === 2) {
      s.c = 0.8;
      s.n += 15;
    }
  });
  avatarTarget = 0;
  toast(
    [
      "Loosened soil drains excess water while keeping air around young roots.",
      "Organic matter holds moisture and creates space for air. Your bundle includes mulch to apply after planting.",
      "Compost adds organic matter and decomposer organisms that release nutrients.",
    ][i],
  );
  needsRebuild = true;
  updateUI();
  save();
}
$("next").onclick = () => {
  if ($("next").disabled) return;
  if (state.phase === 5) {
    state.phase = 6;
    state.speed = 3;
  } else state.phase++;
  selected = null;
  tool = null;
  pan = 0;
  zoom = state.phase >= 1 && state.phase <= 4 ? 1.45 : 1;
  resize();
  needsRebuild = true;
  updateUI();
  if (state.phase === 2) shop();
  if (state.phase === 4) {
    state.speed = 3;
    toast(
      "Three years begin now. Normal speed: 3 days per second. Pause whenever you need.",
    );
  }
  save();
};
function applyTool(x) {
  if (x < -6 || x > 6) return;
  const index = clamp(Math.floor((x + 6) * 2), 0, 23);
  if (tool === "mulch") {
    if (!state.warned.mulchPaid) {
      if (state.budget < 300) {
        toast("Insufficient fund for mulch.");
        return;
      }
      state.budget -= 300;
      state.warned.mulchPaid = true;
    }
    for (let i = Math.max(0, index - 1); i <= Math.min(23, index + 1); i++)
      state.soil[i].mulch = 1;
  }
  if (tool === "water")
    for (let i = Math.max(0, index - 1); i <= Math.min(23, index + 1); i++)
      state.soil[i].m = clamp(state.soil[i].m + 22, 0, 100);
  avatarTarget = x;
  needsRebuild = true;
  updateUI();
}
function pluck(w) {
  state.weeds = state.weeds.filter((o) => o !== w);
  cellAt(w.x).litter += 0.5;
  avatarTarget = w.x;
  needsRebuild = true;
  toast(
    "Weed plucked and left as mulch. Decomposition returns its nutrients over time.",
  );
  save();
}
function updateStats() {
  const avg = (k) => Math.round(state.soil.reduce((a, s) => a + s[k], 0) / 24);
  $("moisture").textContent = avg("m") + "%";
  $("nutrients").textContent = avg("n") + "%";
  $("moistureMeter").value = avg("m");
  $("nutrientMeter").value = avg("n");
  $("weather").textContent =
    state.phase >= 4
      ? `${isRain(state.day) ? "Rain passing through" : "Dry weather"} · ${["Spring", "Summer", "Autumn", "Winter"][Math.floor((state.day % 365) / 91.25)]}`
      : "SOIL CROSS SECTION · 0–4 m";
  $("date").textContent =
    `Year ${Math.floor(state.day / 365) + 1} · day ${Math.floor(state.day % 365) + 1}`;
  $("remaining").textContent =
    state.phase === 6
      ? "Free growth"
      : `${Math.max(0, 1095 - Math.floor(state.day))} days remaining`;
  $("progress").value = Math.min(state.day, 1095);
  $("speeds").innerHTML = [
    ["Pause", 0],
    ["1×", 3],
    ["4×", 12],
    ["12×", 36],
  ]
    .map(
      ([l, v]) =>
        `<button data-speed="${v}" class="${state.speed === v ? "chosen" : ""}">${l}</button>`,
    )
    .join("");
  document.querySelectorAll("[data-speed]").forEach(
    (b) =>
      (b.onclick = () => {
        state.speed = +b.dataset.speed;
        updateStats();
      }),
  );
}
const isRain = (day) =>
  Math.floor((day % 365) / 91.25) === 1
    ? Math.floor(day) % 29 < 3
    : Math.floor(day) % 17 < 4;
function simulateDay() {
  if (![4, 6].includes(state.phase)) return;
  state.day++;
  const rain = isRain(state.day),
    summer = Math.floor((state.day % 365) / 91.25) === 1;
  for (let i = 0; i < 24; i++) {
    const s = state.soil[i],
      x = -5.75 + i * 0.5;
    const cover = state.plants.filter(
      (p) => p.planted && Math.abs(p.x - x) < growth(p, byId(p.sid)) * 0.2,
    ).length;
    s.m = clamp(
      s.m +
        (rain ? 3.2 : 0) -
        (summer ? 1.25 : 0.7) *
          (1 - 0.45 * s.mulch) *
          (1 - Math.min(0.55, cover * 0.12)),
      0,
      100,
    );
    if (s.m > 78) s.m -= (s.m - 78) * s.d * 0.16;
    const release = Math.min(s.litter, 0.015 * s.c * (s.m / 100));
    s.litter -= release;
    s.n = clamp(s.n + release * 2 + 0.007 * s.c, 0, 100);
    s.mulch = Math.max(0, s.mulch - 0.00018);
  }
  for (const p of state.plants) {
    if (!p.planted) continue;
    const sp = byId(p.sid),
      s = cellAt(p.x);
    p.age += 1 / 365;
    p.light = canopySun(p.x, growth(p, sp) * 0.7, p.id);
    const water = clamp(
        1 - Math.max(0, Math.abs(s.m - sp.water) - 16) / 40,
        0,
        1,
      ),
      nutrient = clamp(s.n / 45, 0, 1),
      light = p.light >= 0.9 ? 1 : 0.4 + sp.shade * 0.6;
    const same = state.plants.filter(
      (o) =>
        o !== p &&
        o.planted &&
        byId(o.sid).layer === sp.layer &&
        Math.abs(o.x - p.x) < 1.1,
    ).length;
    const fitness = (water * nutrient * light) / (1 + same * 0.12);
    p.health = clamp(
      p.health + (fitness > 0.5 ? 0.15 : -(0.5 - fitness) * 0.6),
      0,
      100,
    );
    p.biomass = clamp(
      (p.biomass ?? 0) + (sp.height / 4500) * fitness * (p.health / 100),
      0,
      sp.height - 0.55,
    );
    s.m = Math.max(0, s.m - 0.06);
    s.n = Math.max(0, s.n - 0.012);
    if (sp.deciduous && Math.floor(state.day) % 365 === 274) {
      s.litter += 3;
      spawnLeaf(p);
    }
    if (p.health < 20 && !state.warned.stress) {
      state.warned.stress = true;
      toast(
        "A seedling is struggling. Tap it to inspect moisture, nutrients and light.",
      );
    }
  }
  for (const w of state.weeds) {
    const s = cellAt(w.x);
    s.m = Math.max(0, s.m - 0.17);
    s.n = Math.max(0, s.n - 0.035);
  }
  if (state.day % 24 === 0 && state.weeds.length < 14) {
    const x = rand(state.day) * 11.5 - 5.75;
    const shade = state.plants.filter(
      (p) => p.planted && Math.abs(p.x - x) < growth(p, byId(p.sid)) * 0.2,
    ).length;
    const s = cellAt(x);
    if (rand(state.day + 4) > s.mulch * 0.55 + Math.min(0.4, shade * 0.08))
      state.weeds.push({ id: "w" + state.day, x });
  }
  if (state.phase === 4 && state.day >= 1095) {
    state.phase = 5;
    state.speed = 0;
    state.review = calculateScore();
    updateUI();
    showReview();
    save();
  }
}
function calculateScore() {
  const ps = state.plants.filter((p) => p.planted),
    health = ps.reduce((a, p) => a + p.health, 0) / Math.max(1, ps.length);
  const native =
      ps.filter((p) => byId(p.sid).native).length / Math.max(1, ps.length),
    diversity = new Set(ps.map((p) => p.sid)).size,
    layer = new Set(ps.map((p) => byId(p.sid).layer)).size,
    soil = state.soil.reduce((a, s) => a + s.n, 0) / 24;
  return {
    total: Math.round(
      health * 0.6 +
        native * 10 +
        Math.min(1, diversity / 5) * 10 +
        (layer / 4) * 10 +
        Math.min(1, soil / 55) * 10,
    ),
    health: Math.round(health),
    native: Math.round(native * 100),
    diversity,
    layer,
    soil: Math.round(soil),
    surviving: ps.filter((p) => p.health > 0).length,
    totalPlants: ps.length,
  };
}
function showReview() {
  const s = state.review ?? calculateScore();
  panel(
    `<span class="eyebrow">Your three-year forest review</span><h2>A little care becomes a habitat.</h2><div class="score">${s.total}<small> / 100</small></div><div class="entry"><p><strong>${s.health}%</strong> average plant health · ${s.surviving}/${s.totalPlants} plants surviving<br><strong>${s.native}%</strong> native planting · ${s.diversity} species · ${s.layer}/4 layers<br><strong>${s.soil}%</strong> soil nutrients</p></div><p>Plant health contributes 60 points. Native planting, species diversity, layer balance and soil nutrients each contribute 10.</p><p>${s.health < 65 ? "Some plants struggled. More consistent watering and less crowding could help." : "Your young plants have established well."} ${s.layer < 4 ? "Try a wider mix of mature heights to build all four layers." : "Your mix of heights creates a layered forest."}</p><p>This is an educational model, not a prediction of real restoration outcomes. Your score is saved at year three.</p><button id="continueReview" class="primary">Continue growing →</button>`,
  );
  $("continueReview").onclick = () => {
    $("panel").close();
    state.phase = 6;
    state.speed = 3;
    updateUI();
    save();
  };
}
const falling = [];
function spawnLeaf(p) {
  for (let i = 0; i < 8; i++) {
    const mesh = box(
      world,
      p.x + (rand(i) * 2 - 1),
      growth(p, byId(p.sid)) * 0.7,
      4,
      0.13,
      0.08,
      0.03,
      0xae8c4d,
    );
    falling.push({ mesh, x: p.x, t: i * 0.2 });
  }
}
function screenPoint(e) {
  const rect = $("world").getBoundingClientRect();
  const v = new T.Vector3(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    0,
  ).unproject(camera);
  return { x: v.x, y: v.y };
}
$("world").addEventListener("pointerdown", (e) => {
  if (
    e.target.closest("button") &&
    !e.target.classList.contains("plant-marker")
  )
    return;
  const pos = screenPoint(e);
  const p =
    state.phase === 2
      ? state.plants
          .filter((p) => !p.planted)
          .sort((a, b) => Math.abs(a.x - pos.x) - Math.abs(b.x - pos.x))[0]
      : null;
  const near = p && Math.abs(p.x - pos.x) < 0.8 && pos.y < 2.5;
  drag = {
    startX: e.clientX,
    startY: e.clientY,
    pan,
    plant: near ? p : null,
    moved: false,
  };
  if (near) {
    selected = p;
    needsRebuild = true;
    updateSelection();
  }
  if (tool) applyTool(pos.x);
  if (e.target === renderer.domElement)
    $("world").setPointerCapture(e.pointerId);
});
$("world").addEventListener("pointermove", (e) => {
  const pos = screenPoint(e);
  pointerWorld = pos;
  if (!drag) return;
  if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 5)
    drag.moved = true;
  if (drag.plant) {
    drag.plant.x = clamp(pos.x, -5.75, 5.75);
    avatarTarget = drag.plant.x;
    needsRebuild = true;
  } else if (tool) applyTool(pos.x);
  else if (drag.moved) {
    const scale = (camera.right - camera.left) / $("world").clientWidth;
    pan = clamp(drag.pan - (e.clientX - drag.startX) * scale, -46, 46);
  }
});
$("world").addEventListener("pointerup", (e) => {
  if (drag?.plant) updateSelection();
  drag = null;
  save();
});
$("world").addEventListener("pointercancel", () => {
  drag = null;
});
$("panLeft").onclick = () => (pan = clamp(pan - 12, -46, 46));
$("panRight").onclick = () => (pan = clamp(pan + 12, -46, 46));
$("home").onclick = () => {
  pan = 0;
  zoom = 1;
  resize();
};
$("zoomIn").onclick = () => {
  zoom = clamp(zoom * 1.2, 0.65, 2.4);
  resize();
};
$("zoomOut").onclick = () => {
  zoom = clamp(zoom / 1.2, 0.65, 2.4);
  resize();
};
window.addEventListener("keydown", (e) => {
  if ($("panel").open || e.target.tagName === "BUTTON") return;
  if (e.key === "ArrowLeft") pan = clamp(pan - 3, -46, 46);
  if (e.key === "ArrowRight") pan = clamp(pan + 3, -46, 46);
  if (e.code === "Space" && [4, 6].includes(state.phase)) {
    e.preventDefault();
    state.speed = state.speed ? 0 : 3;
    updateStats();
  }
});
function save() {
  if (resetInProgress) return;
  try {
    localStorage.setItem(
      "pocket-forest-v1",
      JSON.stringify({ version: 1, state }),
    );
  } catch {}
}
$("restart").onclick = () => {
  panel(
    '<h2>Start a new forest?</h2><p>This replaces the saved forest on this browser.</p><button id="resetYes" class="primary">Start again</button>',
  );
  $("resetYes").onclick = () => {
    resetInProgress = true;
    try {
      localStorage.removeItem("pocket-forest-v1");
    } catch {}
    location.reload();
  };
};
$("about").onclick = () =>
  panel(
    `<span class="eyebrow">Pocket Forest · Tokushima</span><h2>Learn by growing.</h2><p>Inspired by the Miyawaki method: survey local vegetation, prepare soil, plant densely with varied native species, mulch, and care for young plants.</p><p>The 6 × 2 m bed is shown in front elevation. Depth and planting density are compressed for interaction. Growth rates, weather and health are illustrative. Mature previews show species reference heights, not guaranteed sizes. Fungi help decompose organic matter; mushroom appearance is not proof of nutrient sharing or forest health.</p><p>Your reference photos inform the plant forms. Photos 2–3, 5, 7, 9 and 13 show woodland structure but do not establish an exact tree identification. Photo 8 and 14 serrated leaves are unresolved. Photo 10 is consistent with a three-veined tree leaf but remains unresolved. Photo 1 also contains a likely holly fern, used as a visual understory reference.</p><p>The named native references are supported by regional flora; photo matches remain tentative. All simulation runs in your browser, with local saving and no account required.</p><h3>Sources & credits</h3>${sources.map(([title, url]) => `<p><a href="${url}" target="_blank" rel="noopener">${title} ↗</a></p>`).join("")}<p>Three.js, MIT license. Reference photographs supplied by you. Original game code is MIT licensed; supplied photographs are excluded from that license.</p>`,
  );
function animate(time) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.1, (time - lastFrame) / 1000 || 0.016);
  lastFrame = time;
  camera.position.x += (pan - camera.position.x) * Math.min(1, dt * 7);
  camera.updateMatrixWorld();
  if (needsRebuild || Math.abs(state.day - visualDay) > 5) rebuild();
  for (const p of state.plants)
    if (!p.planted && (p.drop ?? 0) > 0) {
      p.drop = Math.max(0, p.drop - dt * 9);
      needsRebuild = true;
    }
  for (const item of sway)
    item.root.rotation.z = Math.sin(time * 0.00065 + item.seed) * 0.012;
  toolVisual.visible = !!tool;
  mulchModel.visible = tool === "mulch";
  waterModel.visible = tool === "water";
  toolVisual.position.set(pointerWorld.x, pointerWorld.y, 0);
  rainGroup.visible = state.phase >= 4 && isRain(state.day);
  rainGroup.children.forEach((m, i) => {
    m.position.y = 24 - ((time * 0.004 + i * 0.43) % 24);
  });
  tanuki.visible =
    state.day > 730 &&
    state.plants.filter((p) => p.health > 65 && byId(p.sid).native).length >= 3;
  tanuki.position.x = Math.sin(time * 0.0001) * 9;
  const dx = avatarTarget - avatarX;
  avatarX += Math.sign(dx) * Math.min(Math.abs(dx), dt * 2);
  gardener.position.x = avatarX;
  const walk = Math.abs(dx) > 0.08 ? Math.sin(time * 0.009) * 0.35 : 0;
  legs[0].rotation.z = walk;
  legs[1].rotation.z = -walk;
  arms[0].rotation.z = -walk;
  arms[1].rotation.z = walk;
  const flowering = state.plants.filter((p) => p.flowers && p.health > 55);
  bees.forEach(({ g, wing, i }) => {
    g.visible = flowering.length > 0 && state.phase >= 4;
    if (g.visible) {
      const p = flowering[Math.floor(time / 7000 + i) % flowering.length];
      g.position.set(
        p.x + Math.sin(time * 0.0008 + i) * 1.3,
        growth(p, byId(p.sid)) * 0.7 + Math.sin(time * 0.001 + i) * 0.4,
        4.3,
      );
      wing.rotation.z = Math.sin(time * 0.045 + i) * 0.8;
      if (i > 5) {
        g.scale.set(0.8, 0.8, 0.8);
        wing.material = material(0xc4a7b9);
      }
    }
  });
  for (let i = falling.length - 1; i >= 0; i--) {
    const f = falling[i];
    f.mesh.position.y -= dt * 0.65;
    f.mesh.position.x += Math.sin(time * 0.002 + i) * dt * 0.15;
    f.mesh.rotation.z += dt;
    if (f.mesh.position.y < 0.05) {
      world.remove(f.mesh);
      falling.splice(i, 1);
    }
  }
  simAccumulator += dt * state.speed;
  while (simAccumulator >= 1) {
    simAccumulator--;
    simulateDay();
    if (state.phase === 5) {
      simAccumulator = 0;
      break;
    }
  }
  uiTimer += dt;
  saveTimer += dt;
  if (uiTimer > 0.15) {
    updateMarkers();
    updateStats();
    uiTimer = 0;
  }
  if (saveTimer > 5) {
    save();
    saveTimer = 0;
  }
  renderer.render(scene, camera);
}
window.addEventListener("pagehide", save);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    state.speed = 0;
    save();
    updateStats();
  }
});
updateUI();
resize();
requestAnimationFrame(animate);
