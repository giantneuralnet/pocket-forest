import {
  makeArchitecture,
  poseArchitecture,
  leafAttachment,
} from "./architecture.js";
import * as T from "./vendor/three.module.js";
import { species } from "./species.js";
import {
  HALF,
  MAP_HALF,
  DEPTH,
  soilX,
  COLS,
  ROWS,
  CW,
  CH,
  clamp,
  random,
  getSpecies,
  plantHeight,
  colAt,
  sampleSoil,
  soilColorRGB,
  WORM_LIMIT,
  WORM_STEP_DAYS,
  rootThickness,
} from "./ecology.js?v=17-2";
const taperedGeometry = new T.CylinderGeometry(0.36, 0.5, 1, 6),
  rootGeometry = new T.CylinderGeometry(0.94, 1, 1, 7),
  soilGeometry = new T.PlaneGeometry(1, 1);
const boxGeometry = new T.BoxGeometry(1, 1, 1),
  leafGeometry = new T.PlaneGeometry(1, 1).translate(0, 0.405, 0),
  materialCache = new Map(),
  leafStamps = new Map();
const flowerGeometry = new T.PlaneGeometry(1, 1);
const fruitGeometry = new T.SphereGeometry(0.5, 10, 8);
const flowersBySpecies = new Map();
const fruitStyles = {
  privet: { color: 0x343144, from: 245, to: 355, size: 0.12 },
  ardisia: { color: 0xb42837, from: 245, to: 365, size: 0.10 },
  hackberry: { color: 0x59453e, from: 220, to: 310, size: 0.12 },
};

function blossomMaterial(sp) {
  if (flowersBySpecies.has(sp.id)) return flowersBySpecies.get(sp.id);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 96;
  const ctx = canvas.getContext("2d");
  const petal = "#" + sp.flower.toString(16).padStart(6, "0");
  function flower(x, y, radius, count, long = false) {
    ctx.save();
    ctx.translate(x, y);
    for (let i = 0; i < count; i++) {
      ctx.rotate(Math.PI * 2 / count);
      ctx.fillStyle = petal;
      ctx.beginPath();
      ctx.ellipse(0, -radius * 0.48, radius * (long ? 0.22 : 0.39), radius * 0.51, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = sp.id === "four" ? "#a43964" : "#e5ae41";
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.23, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (sp.id === "privet") {
    [[28, 31], [49, 25], [68, 38], [27, 56], [50, 49], [67, 65], [44, 72]]
      .forEach(([x, y]) => flower(x, y, 15, 4));
  } else if (sp.id === "eurya") {
    [[28, 40], [50, 57], [70, 39]].forEach(([x, y]) => flower(x, y, 18, 5, true));
  } else if (sp.id === "camellia") {
    flower(48, 48, 44, 8);
    ctx.fillStyle = "#f1cc64";
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.arc(48 + Math.cos(i * 2.4) * 11, 48 + Math.sin(i * 2.4) * 11, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else flower(48, 48, 43, 5, sp.id === "ardisia");
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  const blossom = new T.MeshLambertMaterial({ map, side: T.DoubleSide, alphaTest: 0.45 });
  flowersBySpecies.set(sp.id, blossom);
  return blossom;
}

function branchWidth(rec, node) {
  if (rec.sp.type === "weed" || rec.sp.type === "fern") return node.width;
  const heightRatio = clamp(rec.height / rec.sp.height);
  return node.width * (1 + heightRatio * (node.depth === 0 ? 1.25 : 0.55));
}
const material = (color, opacity = 1) => {
  const key = color + ":" + opacity;
  if (!materialCache.has(key))
    materialCache.set(
      key,
      new T.MeshLambertMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity === 1,
      }),
    );
  return materialCache.get(key);
};
const barkStyles = {
  oak: ["#675244", 18, 0],
  cinnamon: ["#79644d", 14, 1],
  hackberry: ["#837d70", 23, 2],
  privet: ["#776758", 13, 2],
  camellia: ["#786d66", 13, 1],
  eurya: ["#665846", 16, 0],
  castanopsis: ["#583f33", 22, 0],
};
const barkMaterials = new Map();
function barkMaterial(sp) {
  if (sp.type === "weed" || sp.type === "fern") return material(0x688348);
  if (barkMaterials.has(sp.id)) return barkMaterials.get(sp.id);
  const [color, marks, pattern] = barkStyles[sp.id] ?? ["#725738", 12, 1];
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 64, 128);
  const seed = [...sp.id].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  for (let i = 0; i < marks; i++) {
    const x = random(seed + i * 7) * 64;
    const y = random(seed + i * 11) * 128;
    ctx.fillStyle = i % 2 ? "#261c1642" : "#f4d8b42e";
    if (pattern === 0) ctx.fillRect(x, y, 1 + random(i) * 3, 18 + random(i + 2) * 58);
    if (pattern === 1) ctx.fillRect(x, y, 5 + random(i) * 10, 1 + random(i + 3) * 3);
    if (pattern === 2) ctx.fillRect(x, y, 3 + random(i) * 7, 3 + random(i + 4) * 12);
  }
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  const bark = new T.MeshLambertMaterial({ map });
  barkMaterials.set(sp.id, bark);
  return bark;
}
function foliageColor(sp) {
  return new T.Color(sp.color).lerp(new T.Color(0x429a37), 0.32).offsetHSL(0, 0.08, 0.055);
}
function box(g, x, y, z, w, h, d, color) {
  const m = new T.Mesh(boxGeometry, material(color));
  m.position.set(x, y, z);
  m.scale.set(w, h, d);
  g.add(m);
  return m;
}
// Each reference leaf is drawn exactly once. Instances reuse its texture and geometry.
function stamp(sp) {
  if (leafStamps.has(sp.id)) return leafStamps.get(sp.id);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, 128, 128);
  c.fillStyle = "#ffffff";
  c.beginPath();
  const shape = sp.leaf;
  if (shape === "grass") {
    c.moveTo(62, 122);
    c.quadraticCurveTo(25, 51, 32, 5);
    c.quadraticCurveTo(69, 63, 69, 122);
  } else if (shape === "fern") {
    c.moveTo(60, 124);
    c.lineTo(37, 88);
    c.lineTo(18, 77);
    c.lineTo(37, 63);
    c.lineTo(22, 40);
    c.lineTo(50, 35);
    c.lineTo(64, 3);
    c.lineTo(88, 30);
    c.lineTo(108, 36);
    c.lineTo(90, 61);
    c.lineTo(110, 79);
    c.lineTo(84, 87);
    c.lineTo(69, 124);
  } else if (sp.id === "hackberry" || sp.id === "oak" || sp.id === "eurya") {
    c.moveTo(64, 123);
    for (let i = 0; i <= 18; i++) {
      const t = i / 18,
        y = 118 - t * 112,
        wide = Math.sin(t * Math.PI) * 43 * (i % 2 ? 0.9 : 1);
      c.lineTo(64 - wide, y);
    }
    for (let i = 18; i >= 0; i--) {
      const t = i / 18,
        y = 118 - t * 112,
        wide =
          Math.sin(t * Math.PI) *
          (sp.id === "hackberry" ? 47 : 40) *
          (i % 2 ? 0.9 : 1);
      c.lineTo(64 + wide, y);
    }
  } else if (shape === "round") {
    c.moveTo(64, 122);
    c.bezierCurveTo(-2, 98, 5, 26, 64, 10);
    c.bezierCurveTo(120, 26, 132, 98, 64, 122);
  } else {
    const wide = sp.leaf === "long" ? 27 : 42;
    c.moveTo(64, 123);
    c.bezierCurveTo(64 - wide, 103, 64 - wide - 18, 40, 64, 4);
    c.bezierCurveTo(64 + wide + 18, 40, 64 + wide, 103, 64, 123);
  }
  c.closePath();
  c.fill();
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.magFilter = T.LinearFilter;
  const result = { texture, alpha: c.getImageData(0, 0, 128, 128).data };
  leafStamps.set(sp.id, result);
  return result;
}
export class ForestView {
  constructor(element, state) {
    this.element = element;
    this.state = state;
    this.scene = new T.Scene();
    this.scene.background = new T.Color("#a9d7f1");
    // Distant round cloud banks share one low-poly sphere geometry.
    const cloudGeometry = new T.SphereGeometry(1, 12, 8);
    const cloudColors = [];
    for (let i = 0; i < cloudGeometry.attributes.position.count; i++) {
      const shade = 0.82 + 0.18 * (cloudGeometry.attributes.normal.getY(i) + 1) / 2;
      cloudColors.push(shade, shade + (1 - shade) * 0.3, 1);
    }
    cloudGeometry.setAttribute("color", new T.Float32BufferAttribute(cloudColors, 3));
    const cloudMaterial = new T.MeshBasicMaterial({ color: 0xf7fbff, vertexColors: true });
    this.clouds = new T.Group();
    this.cloudTravel = 0;
    for (let i = 0; i < 13; i++) {
      const cloud = new T.Group();
      cloud.position.set((i - 6) * 27, 30 + random(i + 78) * 28, -85 - random(i) * 12);
      for (let j = 0; j < 5; j++) {
        const puff = new T.Mesh(cloudGeometry, cloudMaterial);
        const taper = 1 - Math.abs(j - 2) / 3;
        const radius = (2.7 + random(i * 37 + j) * 1.5) * (0.55 + taper * 0.65);
        puff.position.set((j - 2) * 3.4, radius, 0);
        puff.scale.set(radius * 1.2, radius, radius * 0.8);
        cloud.add(puff);
      }
      this.clouds.add(cloud);
    }
    this.scene.add(this.clouds);
    this.camera = new T.PerspectiveCamera(40, 1, 0.1, 240);
    this.camera.position.set(0, 0, 65);
    this.center = { x: 0, y: 8 };
    this.zoom = 1;
    this.renderer = new T.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.setClearColor("#a9d7f1");
    element.append(this.renderer.domElement);
    this.scene.add(new T.HemisphereLight(0xfff7df, 0x78634e, 2.05));
    const sun = new T.DirectionalLight(0xfff5d7, 1.4);
    sun.position.set(-15, 25, 30);
    this.scene.add(sun);
    this.updateQueue = new Set();
    this.poseUpdates = 0;
    this.rootAllocations = 0;
    this.soilCursor = 0;
    this.frameStats = { frames: 0, maxMs: 0, slow: 0 };
    this.records = new Map();
    this.wild = [];
    this.effects = [];
    this.sheddingPlants = new Set();
    this.fallingLeaves = new Map();
    this.landedLeaves = [];
    this.leafTransform = new T.Object3D();
    this.leafMatrix = new T.Matrix4();
    this.leafScale = new T.Vector3();
    this.pendingWater = [];
    this.pendingMulch = [];
    this.pendingCompost = [];
    this.hover = null;
    this.selected = null;
    this.time = 0;
    this.ray = new T.Raycaster();
    this.pickables = [];
    this.canopies = [];
    this.mushrooms = new Map();
    this.alerts = new Map();
    this.samples = new Map();
    this.rainHits = new Map();
    this.ground = new T.Group();
    this.scene.add(this.ground);
    // The soil volume extends behind the cutaway, keeping the face and roots at z = 0.
    const soilDepth = 0.85;
    const cutawayMaterial = new T.MeshBasicMaterial({
      color: new T.Color().setRGB(...soilColorRGB({ m: 75, n: 65 }), T.SRGBColorSpace),
      depthWrite: false,
    });
    this.surfaceMaterial = new T.MeshBasicMaterial({ depthWrite: false });
    const soilBase = new T.Mesh(new T.BoxGeometry(MAP_HALF * 2, DEPTH, soilDepth),
      [cutawayMaterial, cutawayMaterial, this.surfaceMaterial, cutawayMaterial, cutawayMaterial, cutawayMaterial]);
    soilBase.position.set(0, -DEPTH / 2, -soilDepth / 2);
    soilBase.renderOrder = -2;
    this.ground.add(soilBase);
    this.bedrockMaterial = new T.MeshBasicMaterial({ depthWrite: false });
    const bedrock = new T.Mesh(new T.PlaneGeometry(MAP_HALF * 2, 100), this.bedrockMaterial);
    bedrock.position.set(0, -DEPTH - 50, -0.025);
    bedrock.renderOrder = -2;
    this.ground.add(bedrock);
    // The side woodland is entirely foreground and surveyable; no decorative block trees.
    const woodlandX = (start, fraction) => start + (MAP_HALF - 1.1 - start) * fraction;
    const treeCount = 11;
    for (const side of [-1, 1])
      for (let i = 0; i < treeCount; i++) {
        const sp = species[i % 10];
        const p = {
          id: "wild-" + side + "-" + i,
          sid: sp.id,
          x: side * woodlandX(HALF + 3, i / (treeCount - 1)),
          age: 12 + i,
          health: 96,
          seed: i * 3 + (side + 1) * 20,
          wild: true,
          planted: true,
        };
        this.wild.push(p);
      }
    // Small real plants, not anonymous decorative props.
    for (const side of [-1, 1])
      for (let i = 0; i < 14; i++) {
        const sp = species[[7, 9, 5, 8][i % 4]];
        this.wild.push({
          id: "ground-" + side + "-" + i,
          sid: sp.id,
          x: side * woodlandX(HALF + 2.5, i / 13),
          age: 3 + (i % 3),
          health: 95,
          seed: i + 80,
          wild: true,
          planted: true,
        });
      }
    for (const p of this.wild) this.addPlant(p);
    for (const side of [-1, 1]) {
      box(
        this.scene,
        side * (HALF + 0.14),
        0.54,
        0,
        0.35,
        1.08,
        0.8,
        0xa3987c,
      );
      box(this.scene, side * (HALF + 0.14), 1.08, 0, 0.49, 0.12, 0.9, 0xc4b79a);
      for (let j = 1; j <= 4; j++)
        box(
          this.scene,
          side * (HALF + 0.14),
          j * 0.216,
          0.405,
          0.36,
          0.014,
          0.025,
          0x6f6b53,
        );
    }
    this.soilMesh = new T.InstancedMesh(
      soilGeometry,
      new T.MeshBasicMaterial({ color: 0xffffff, depthWrite: false }),
      COLS * ROWS,
    );
    this.soilMesh.renderOrder = -1;
    this.highlightedSoil = -1;
    this.scene.add(this.soilMesh);
    const dummy = new T.Object3D();
    const soilColor = new T.Color();
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const x = soilX(c);
        const y = -(r + 0.5) * CH;
        dummy.position.set(x, y);
        dummy.scale.set(CW, CH, 1);
        dummy.updateMatrix();
        this.soilMesh.setMatrixAt(r * COLS + c, dummy.matrix);
        this.paintSoilTile(r * COLS + c, soilColor);
      }
    this.mulchMesh = new T.InstancedMesh(boxGeometry, material(0x9b743e), COLS);
    this.scene.add(this.mulchMesh);
    this.waterMesh = new T.InstancedMesh(
      boxGeometry,
      new T.MeshBasicMaterial({
        color: 0x67b7de,
        transparent: true,
        opacity: 0.65,
      }),
      COLS,
    );
    this.scene.add(this.waterMesh);
    this.makeFarmer();
    this.makeTools();
    this.makeFauna();
    this.wormPoses = new Map();
    this.wormTransform = new T.Object3D();
    this.wormMesh = new T.InstancedMesh(fruitGeometry, material(0xc47863), WORM_LIMIT * 8);
    this.wormMesh.count = 0;
    this.wormMesh.frustumCulled = false;
    this.scene.add(this.wormMesh);
    this.makeBirds();
    this.rainDrops = new T.InstancedMesh(
      boxGeometry,
      new T.MeshBasicMaterial({
        color: 0x63a5d2,
        transparent: true,
        opacity: 0.48,
      }),
      90,
    );
    this.scene.add(this.rainDrops);
    this.resize();
    this.sync(true);
  }
  resize() {
    const w = this.element.clientWidth,
      h = this.element.clientHeight;
    this.renderer.setSize(w, h);
    this.projection();
  }
  projection() {
    const aspect = this.element.clientWidth / this.element.clientHeight;
    const baseHalf = Math.max(13, (aspect < 0.8 ? 15 : 24) / aspect);
    this.zoom = Math.max(this.zoom, baseHalf * aspect / MAP_HALF);
    const half = baseHalf / this.zoom;
    const panRoom = Math.max(0, MAP_HALF - half * aspect);
    this.center.x = clamp(this.center.x, -panRoom, panRoom);
    if (this.camera.isPerspectiveCamera) {
      this.camera.aspect = aspect;
      const distance = half / Math.tan((this.camera.fov * Math.PI) / 360);
      this.camera.position.set(
        this.center.x,
        this.center.y,
        distance,
      );
      this.camera.lookAt(this.center.x, this.center.y, 1);
    } else {
      this.camera.left = -half * aspect;
      this.camera.right = half * aspect;
      this.camera.top = half;
      this.camera.bottom = -half;
      this.camera.position.set(this.center.x, this.center.y, 65);
    }
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
  pan(dx, dy) {
    this.cameraMove = null;
    const before = this.worldPoint(
        this.element.clientWidth * 0.5,
        this.element.clientHeight * 0.5,
      ),
      after = this.worldPoint(
        this.element.clientWidth * 0.5 + dx,
        this.element.clientHeight * 0.5 + dy,
      );
    this.center.x += before.x - after.x;
    this.center.y = clamp(this.center.y + before.y - after.y, -DEPTH, 32);
    this.projection();
  }
  zoomAt(factor, sx, sy) {
    this.cameraMove = null;
    const before = this.worldPoint(sx, sy);
    this.zoom = clamp(this.zoom * factor, 0.5, 12);
    this.projection();
    const after = this.worldPoint(sx, sy);
    this.center.x += before.x - after.x;
    this.center.y = clamp(this.center.y + before.y - after.y, -DEPTH, 32);
    this.projection();
  }
  plot(animate = false, overview = false) {
    const aspect = this.element.clientWidth / this.element.clientHeight;
    const baseHalf = Math.max(13, (aspect < 0.8 ? 15 : 24) / aspect);
    const halfWidth = HALF + 0.68;
    const tan = Math.tan(this.camera.fov * Math.PI / 360);
    const distance = halfWidth / (aspect * tan);
    const zoom = overview ? 0.92 : baseHalf / (distance * tan);
    const y = overview ? 8 : 0.3;
    if (animate) {
      this.cameraMove = { x: this.center.x, y: this.center.y, zoom: this.zoom, targetY: y, targetZoom: zoom, start: this.time };
    } else {
      this.cameraMove = null;
      this.center = { x: 0, y };
      this.zoom = zoom;
      this.projection();
    }
  }
  animateCamera(time) {
    const move = this.cameraMove;
    if (!move) return;
    const progress = clamp((time - move.start) / 0.62);
    const eased = progress * progress * (3 - 2 * progress);
    this.center.x = move.x * (1 - eased);
    this.center.y = move.y + (move.targetY - move.y) * eased;
    this.zoom = move.zoom + (move.targetZoom - move.zoom) * eased;
    this.projection();
    if (progress === 1) this.cameraMove = null;
  }
  worldPoint(x, y, z = 0) {
    const r = this.element.getBoundingClientRect(),
      caster = new T.Raycaster();
    caster.setFromCamera(
      new T.Vector2(
        ((x - r.left) / r.width) * 2 - 1,
        (-(y - r.top) / r.height) * 2 + 1,
      ),
      this.camera,
    );
    return (
      caster.ray.intersectPlane(
        new T.Plane(new T.Vector3(0, 0, 1), -z),
        new T.Vector3(),
      ) || new T.Vector3()
    );
  }
  inspectSoil(x, y) {
    const point = this.worldPoint(x, y);
    if (point.y >= 0 || point.y <= -DEPTH || Math.abs(point.x) >= MAP_HALF) {
      this.highlightSoil();
      return null;
    }
    const row = Math.floor(-point.y / CH);
    this.highlightSoil(row * COLS + colAt(point.x));
    return { cell: sampleSoil(this.state, point.x, point.y), point };
  }
  highlightSoil(index = -1) {
    if (index === this.highlightedSoil) return;
    const previous = this.highlightedSoil;
    this.highlightedSoil = index;
    const color = new T.Color();
    if (previous >= 0) this.paintSoilTile(previous, color);
    if (index >= 0) this.paintSoilTile(index, color);
    this.soilMesh.instanceColor.needsUpdate = true;
  }
  paintSoilTile(index, color) {
    color.setRGB(...soilColorRGB(this.state.soil[index]), T.SRGBColorSpace);
    if (index === this.highlightedSoil) color.offsetHSL(0, 0, 0.065);
    this.soilMesh.setColorAt(index, color);
  }
  project(x, y, z = 0) {
    const p = new T.Vector3(x, y, z).project(this.camera);
    return {
      x: ((p.x + 1) / 2) * this.element.clientWidth,
      y: ((1 - p.y) / 2) * this.element.clientHeight,
    };
  }
  addPlant(p) {
    const sp = getSpecies(p.sid);
    if (!sp) return;
    const group = new T.Group();
    this.scene.add(group);
    const g = new T.Group();
    group.add(g);
    const record = {
      p,
      sp,
      group,
      g,
      flowers: [],
      fruits: [],
      perch: new T.Vector3(),
      height: 0,
      rootMesh: null,
    };
    record.recipe = makeArchitecture(sp, p.seed);
    const data = record.recipe.leaves;
    record.wood = new T.InstancedMesh(
      taperedGeometry,
      barkMaterial(sp).clone(),
      record.recipe.nodes.length + data.length,
    );
    record.wood.userData.pid = p.id;
    g.add(record.wood);
    this.pickables.push(record.wood);
    const st = stamp(sp),
      leafMat = new T.MeshLambertMaterial({
        color: sp.color,
        map: st.texture,
        alphaTest: 0.45,
        side: T.DoubleSide,
      });
    const leaves = new T.InstancedMesh(leafGeometry, leafMat, data.length);
    leaves.userData.pid = p.id;
    leaves.userData.leaf = true;
    g.add(leaves);
    this.pickables.push(leaves);
    const proxy = new T.InstancedMesh(
      boxGeometry,
      new T.MeshBasicMaterial(),
      record.recipe.nodes.length,
    );
    proxy.visible = false;
    proxy.userData = { pid: p.id, canopy: true };
    g.add(proxy);
    this.canopies.push(proxy);
    record.proxy = proxy;
    record.leaves = leaves;
    record.data = data;
    record.stamp = st;
    const fruit = fruitStyles[sp.id];
    for (let i = 0; i < 7; i++) {
      if (sp.flower) {
        const flower = new T.Mesh(flowerGeometry, blossomMaterial(sp));
        g.add(flower);
        record.flowers.push(flower);
      }
      if (fruit) {
        const berry = new T.Mesh(fruitGeometry, material(fruit.color));
        berry.userData.fruitIndex = i;
        g.add(berry);
        record.fruits.push(berry);
      }
    }
    const pot = new T.Group();
    group.add(pot);
    box(pot, 0, 0.13, 0.2, 0.36, 0.3, 0.3, 0x66503a);
    box(pot, 0, 0.3, 0.2, 0.43, 0.07, 0.34, 0x84684d);
    pot.scale.setScalar(1.3);
    record.pot = pot;
    this.records.set(p.id, record);
    this.updatePlant(record);
    return record;
  }
  updatePlant(rec) {
    const { p, sp, group, g, leaves } = rec;
    const h = plantHeight(p),
      health = p.health ?? 95;
    rec.height = h;
    rec.trunkRadius = h * branchWidth(rec, rec.recipe.nodes[0]) * 0.5;
    group.position.set(p.x, p.planted ? 0 : p.drop || 0, 0);
    rec.pot.visible = !p.planted;
    if (!rec.poseSignature || !p.planted || p.wild) g.scale.setScalar(h);
    g.position.y = p.planted ? 0 : 0.36;
    rec.maturity = p.wild ? 1.5 : 0.12 + 0.88 * Math.sqrt(clamp(h / sp.height));
    const day = this.state.day % 365;
    rec.seasonal = sp.deciduous && p.planted;
    const foliagePhase = rec.seasonal && (day < 52 || (day >= 235 && day <= 280)) ? day : day > 280 && rec.seasonal ? "bare" : "full";
    const signature = [h.toFixed(4), Math.min(25, p.age || 0).toFixed(2), foliagePhase, health < 35, health <= 0].join(":");
    if (rec.poseSignature !== signature) {
      const tween = rec.poseSignature && p.planted && !p.wild && health > 0;
      this.posePlant(rec, this.time, tween);
      if (!tween) {
        rec.growthTween = null;
        g.scale.setScalar(h);
      }
      rec.poseSignature = signature;
    }
    const color = foliageColor(sp);
    if (health < 65) color.lerp(new T.Color(0xb8a454), (65 - health) / 65);
    if (sp.deciduous && Math.floor((this.state.day % 365) / 91.25) === 2)
      color.lerp(new T.Color(0xb77c35), 0.7);
    leaves.material.color.copy(color);
    const windows = {
        camellia: day < 105 || day > 295,
        privet: day > 125 && day < 190,
        eurya: day < 105,
        ardisia: day > 145 && day < 220,
        four: day > 100 && day < 310,
      };
    rec.flowers.forEach((f) => {
      f.visible =
        health > 55 &&
        (p.wild || p.age > 0.25) &&
        h > sp.height * 0.16 &&
        (windows[sp.id] ?? day < 150);
      const diameter = sp.id === "camellia" ? 0.4 : sp.id === "eurya" ? 0.22 : 0.32;
      f.scale.setScalar(clamp(diameter / h, 0.01, 0.25));
    });
    const fruit = fruitStyles[sp.id];
    for (const berry of rec.fruits) {
      berry.visible = health > 50 && p.planted && (p.wild || p.age >= 1.5) &&
        h > sp.height * 0.2 && day >= fruit.from && day < fruit.to &&
        p.fruitEaten?.[berry.userData.fruitIndex] !== Math.floor(this.state.day / 365);
      berry.scale.setScalar(fruit.size / h);
    }
    if (!p.wild && p.planted && this.state.day - (rec.lightAt ?? -100) >= 30) {
      rec.lightAt = this.state.day;
      const left = this.exposure(p.x - 0.5, h * 0.85, p.id).light,
        right = this.exposure(p.x + 0.5, h * 0.85, p.id).light;
      rec.sunLean = (rec.sunLean || 0) * 0.96 + (right - left) * 0.005;
    }
    this.updateRoots(rec);
  }
  posePlant(rec, time, tween = false) {
    const { p, sp, leaves, wood } = rec,
      pose = poseArchitecture(rec.recipe, rec.maturity, 0),
      dummy = new T.Object3D();
    const maxY = Math.max(0.01, ...pose.map((n) => n.b.y)),
      scale = 1 / maxY;
    const canopyClusters = new Map();
    const interpolateLeaves = tween && (!rec.seasonal || this.state.day % 365 < 235);
    const previousWood = tween ? wood.instanceMatrix.array.slice(0, wood.count * 16) : null;
    const previousLeaves = interpolateLeaves ? leaves.instanceMatrix.array.slice(0, leaves.count * 16) : null;
    const woodKeys = [], leafKeys = [];
    let woodCount = 0,
      leafCount = 0;
    const drawSegment = (a, b, width, key) => {
      const dx = (b.x - a.x) * scale,
        dy = (b.y - a.y) * scale,
        dz = ((b.z || 0) - (a.z || 0)) * scale;
      if (Math.hypot(dx, dy, dz) < 0.00001) return;
      dummy.position.set(
        (a.x + b.x) * 0.5 * scale,
        (a.y + b.y) * 0.5 * scale,
        ((a.z || 0) + (b.z || 0)) * 0.5 * scale,
      );
      dummy.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(dx, dy, dz).normalize());
      dummy.scale.set(width, Math.hypot(dx, dy, dz), width);
      dummy.updateMatrix();
      woodKeys.push(key);
      wood.setMatrixAt(woodCount++, dummy.matrix);
    };
    pose.forEach((n, i) => {
      const node = rec.recipe.nodes[i];
      drawSegment(n.a, n.b, branchWidth(rec, node), i);
    });
    const day = this.state.day % 365;
    const previous = rec.foliageDay;
    const season = Math.floor(this.state.day / 365);
    rec.shedding ??= new Map();
    if (day < 235) rec.shedding.clear();
    for (const l of rec.data) {
      const segment = pose[l.branch];
      if (
        segment.growth < 0.18 ||
        rec.maturity < l.birth ||
        p.health <= 0
      )
        continue;
      const attachment = leafAttachment(l, pose, p.health);
      const leafTiming = random(p.seed + l.branch * 23 + l.at * 37);
      const fallDay = 235 + leafTiming * 44;
      let release = rec.shedding.get(l);
      if (rec.seasonal && day >= fallDay) {
        const crossing = previous != null && Math.floor(previous / 365) === season &&
          previous % 365 < fallDay && this.state.day > previous;
        if (!release && crossing) {
          release = { at: this.time + leafTiming * 1.7, duration: 0.36 + leafTiming * 0.32 };
          rec.shedding.set(l, release);
          this.sheddingPlants.add(rec);
        }
        if (!release) continue;
      }
      const leafGrowth = rec.seasonal && day < 52
        ? clamp((day - leafTiming * 22) / (20 + leafTiming * 10)) : 1;
      if (leafGrowth === 0) continue;
      drawSegment(
        attachment.base,
        attachment.tip,
        Math.min(l.stalkWidth, rec.recipe.nodes[l.branch].width * 0.52),
        l,
      );
      const size =
        clamp(
          (0.025 + 1.05 * Math.pow(clamp(rec.height / sp.height), 0.8)) /
            Math.max(0.1, rec.height),
          0.012,
          0.32,
        ) *
        (sp.leaf === "small" ? 0.72 : 1) *
        l.size * 0.82 *
        clamp((segment.growth - 0.15) / 0.85) * leafGrowth;
      dummy.position.set(attachment.tip.x * scale, attachment.tip.y * scale, attachment.tip.z * scale);
      dummy.rotation.set(l.tilt || 0, l.roll || 0, -attachment.angle, "ZYX");
      dummy.scale.set(
        size * (sp.leaf === "long" ? 0.7 : 1),
        size * (sp.leaf === "long" ? 1.5 : 1.1),
        1,
      );
      dummy.updateMatrix();
      leafKeys.push(l);
      leaves.setMatrixAt(leafCount, dummy.matrix);
      leaves.setColorAt(
        leafCount,
        (this.leafTint ??= new T.Color()).setRGB(
          0.83 + random(l.branch + p.seed) * 0.17,
          0.9 + random(l.size * 100 + p.seed) * 0.1,
          0.77 + random(l.at * 100) * 0.21,
        ),
      );
      if (release) {
        release.slot = leafCount;
        (release.matrix ??= new T.Matrix4()).copy(dummy.matrix);
      }
      leafCount++;
      if (rec.preview) continue;
      // One raycast proxy per leafy twig, instead of one per leaf.
      const width = dummy.scale.x,
        height = dummy.scale.y,
        cx = dummy.position.x + Math.sin(attachment.angle) * height * 0.5,
        cy = dummy.position.y + Math.cos(attachment.angle) * height * 0.5,
        reach = Math.max(width, height) * 0.6;
      let bounds = canopyClusters.get(l.branch);
      if (!bounds) {
        bounds = {
          minX: Infinity,
          maxX: -Infinity,
          minY: Infinity,
          maxY: -Infinity,
          minZ: Infinity,
          maxZ: -Infinity,
        };
        canopyClusters.set(l.branch, bounds);
      }
      bounds.minX = Math.min(bounds.minX, cx - reach);
      bounds.maxX = Math.max(bounds.maxX, cx + reach);
      bounds.minY = Math.min(bounds.minY, cy - reach);
      bounds.maxY = Math.max(bounds.maxY, cy + reach);
      bounds.minZ = Math.min(bounds.minZ, dummy.position.z - reach);
      bounds.maxZ = Math.max(bounds.maxZ, dummy.position.z + reach);
    }
    wood.instanceMatrix.clearUpdateRanges();
    leaves.instanceMatrix.clearUpdateRanges();
    wood.count = woodCount;
    wood.instanceMatrix.needsUpdate = true;
    wood.boundingSphere = new T.Sphere(new T.Vector3(0, 0.5, 0), 2.5);
    leaves.count = leafCount;
    rec.foliageDay = this.state.day;
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    leaves.boundingSphere = new T.Sphere(new T.Vector3(0, 0.5, 0), 2.5);
    if (rec.preview) return;
    if (tween) {
      const batches = [this.growthBatch(wood, previousWood, rec.woodKeys, woodKeys)];
      if (interpolateLeaves) batches.push(this.growthBatch(leaves, previousLeaves, rec.leafKeys, leafKeys));
      rec.growthTween = {
        start: time,
        duration: clamp(3 / Math.max(this.state.speed, 1), 0.16, 0.72),
        fromHeight: rec.g.scale.x,
        batches,
      };
      this.interpolateGrowth(rec, time);
    }
    rec.woodKeys = woodKeys;
    rec.leafKeys = leafKeys;
    let proxyCount = 0;
    for (const bounds of canopyClusters.values()) {
      dummy.position.set(
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minY + bounds.maxY) / 2,
        (bounds.minZ + bounds.maxZ) / 2,
      );
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(
        bounds.maxX - bounds.minX,
        bounds.maxY - bounds.minY,
        Math.max(bounds.maxZ - bounds.minZ, 6 / Math.max(0.1, rec.height)),
      );
      dummy.updateMatrix();
      rec.proxy.setMatrixAt(proxyCount++, dummy.matrix);
    }
    rec.proxy.count = proxyCount;
    rec.proxy.instanceMatrix.needsUpdate = true;
    rec.proxy.boundingSphere = new T.Sphere(
      new T.Vector3(0, 0.5, 0),
      Math.max(3, 4 / Math.max(0.1, rec.height)),
    );
    const tips = pose.filter((n, i) => n.growth > 0.4 && rec.recipe.nodes[i].depth > 0);
    const perch = pose[Math.min(3, pose.length - 1)].b;
    rec.perch.set(perch.x * scale, perch.y * scale, perch.z * scale);
    for (const [pieces, isFruit] of [[rec.flowers, false], [rec.fruits, true]]) {
      pieces.forEach((piece, i) => {
        const node = tips.length ? tips[Math.floor(i * tips.length / pieces.length)] : pose[0];
        piece.position.set(node.b.x * scale, node.b.y * scale, node.b.z * scale);
        if (isFruit) piece.position.y -= 0.045 / rec.height;
        else piece.rotation.set((random(p.seed + i * 13) - 0.5) * 0.9,
          (random(p.seed + i * 29) - 0.5) * 0.9, node.angle * 0.4);
      });
    }
    rec.poseTime = time;
    rec.pose = pose;
    rec.poseScale = scale;
    this.poseUpdates++;
  }
  growthBatch(mesh, previous, previousKeys, keys) {
    const target = mesh.instanceMatrix.array.slice(0, mesh.count * 16);
    const from = target.slice();
    const previousSlots = new Map(previousKeys?.map((key, index) => [key, index]));
    keys.forEach((key, index) => {
      const at = index * 16, old = previousSlots.get(key);
      if (old !== undefined) from.set(previous.subarray(old * 16, (old + 1) * 16), at);
      else for (let i = 0; i < 12; i++) from[at + i] *= 0.001;
    });
    return { mesh, from, target };
  }
  interpolateGrowth(rec, time) {
    const tween = rec.growthTween;
    if (!tween) return;
    const progress = clamp((time - tween.start) / tween.duration);
    const weight = 1 - (1 - progress) ** 2;
    rec.g.scale.setScalar(tween.fromHeight + (rec.height - tween.fromHeight) * weight);
    for (const { mesh, from, target } of tween.batches) {
      const attribute = mesh.instanceMatrix;
      for (let i = 0; i < target.length; i++)
        attribute.array[i] = from[i] + (target[i] - from[i]) * weight;
      attribute.clearUpdateRanges();
      if (target.length) attribute.addUpdateRange(0, target.length);
      attribute.needsUpdate = true;
    }
    if (progress === 1) rec.growthTween = null;
  }
  updateRoots(rec) {
    if (rec.p.wild) return;
    const segments = rec.p.roots || [];
    const nominalRadius = rec.sp.type === "weed" ? 0.023 : 0.06;
    const baseRadius = rec.trunkRadius == null ? nominalRadius :
      Math.max(0.0001, Math.round(rec.trunkRadius * 0.84 * 10000) / 10000);
    if (rec.rootCount === segments.length && rec.rootBaseRadius === baseRadius) return;
    if (!rec.rootMesh) {
      rec.rootMesh = new T.InstancedMesh(
        rootGeometry,
        new T.MeshLambertMaterial({
          color: rec.sp.type === "weed" ? 0xb59a77 : 0xc4a17b,

        }),
        1024,
      );
      rec.rootMesh.frustumCulled = false;
      this.scene.add(rec.rootMesh);
      this.rootAllocations++;
    }
    const dummy = new T.Object3D(),
      up = new T.Vector3(0, 1, 0);
    const startCount = Math.min(1024, rec.rootCount || 0);
    const matrices = rec.rootMesh.instanceMatrix;
    const widthChanged = rec.rootBaseRadius != null && rec.rootBaseRadius !== baseRadius;
    if (widthChanged) {
      const ratio = baseRadius / rec.rootBaseRadius;
      for (let i = 0; i < startCount; i++) {
        const offset = i * 16;
        const { a, b } = segments[i];
        const core = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const drawn = Math.hypot(...matrices.array.subarray(offset + 4, offset + 7));
        const stretch = drawn > 0 ? (core + (drawn - core) * ratio) / drawn : 1;
        for (let axis = 0; axis < 3; axis++) {
          matrices.array[offset + axis] *= ratio;
          matrices.array[offset + 4 + axis] *= stretch;
          matrices.array[offset + 8 + axis] *= ratio;
        }
      }
    }
    let count = startCount;
    for (let i = count; i < Math.min(1024, segments.length); i++) {
      const segment = segments[i],
        a = new T.Vector3(segment.a[0], segment.a[1], 0),
        b = new T.Vector3(segment.b[0], segment.b[1], 0),
        delta = b.clone().sub(a),
        radius = baseRadius * clamp(rootThickness({ ...segment, originX: rec.p.x }) / nominalRadius);
      dummy.position.copy(a).add(b).multiplyScalar(0.5);
      dummy.quaternion.setFromUnitVectors(up, delta.clone().normalize());
      dummy.scale.set(radius, delta.length() + radius * 1.6, radius);
      dummy.updateMatrix();
      rec.rootMesh.setMatrixAt(i, dummy.matrix);
      count++;
    }
    rec.rootCount = segments.length;
    rec.rootBaseRadius = baseRadius;
    rec.rootMesh.count = count;
    const firstChanged = widthChanged ? 0 : startCount;
    matrices.addUpdateRange(firstChanged * 16, (count - firstChanged) * 16);
    rec.rootMesh.instanceMatrix.needsUpdate = true;
  }
  sync(force = false) {
    const season = Math.floor(this.state.day / 30),
      refreshWild = this.lastWildSeason !== season;
    this.lastWildSeason = season;
    const ids = new Set(
      [...this.wild, ...this.state.plants, ...this.state.weeds].map(
        (p) => p.id,
      ),
    );
    for (const [id, r] of this.records)
      if (!ids.has(id)) {
        this.scene.remove(r.group);
        if (r.rootMesh) {
          this.scene.remove(r.rootMesh);
          r.rootMesh.dispose();
          r.rootMesh.material.dispose();
        }
        r.wood.dispose();
        r.wood.material.dispose();
        r.leaves.dispose();
        r.leaves.material.dispose();
        r.proxy.dispose();
        r.proxy.material.dispose();
        this.sheddingPlants.delete(r);
        this.records.delete(id);
      }
    this.pickables = this.pickables.filter((m) => ids.has(m.userData.pid));
    this.canopies = this.canopies.filter((m) => ids.has(m.userData.pid));
    for (const p of [...this.wild, ...this.state.plants, ...this.state.weeds]) {
      const r = this.records.get(p.id) || this.addPlant(p);
      if (!p.wild || refreshWild || r.sp.deciduous) this.updateQueue.add(r);
    }
    if (force) this.updateSoil();
    this.syncMushrooms();
    this.updateGhosts();
    this.scene.updateMatrixWorld(true);
  }
  updateSoil() {
    const dummy = new T.Object3D(),
      color = new T.Color();
    for (let index = 0; index < COLS * ROWS; index++) this.paintSoilTile(index, color);
    this.soilMesh.instanceColor.needsUpdate = true;
    color.setRGB(0, 0, 0);
    const tileColor = new T.Color();
    this.surfaceMaterial.color.setRGB(0, 0, 0);
    for (let c = 0; c < COLS; c++) {
      this.soilMesh.getColorAt(c, tileColor);
      this.surfaceMaterial.color.add(tileColor);
      this.soilMesh.getColorAt((ROWS - 1) * COLS + c, tileColor);
      color.add(tileColor);
    }
    this.bedrockMaterial.color.copy(color.multiplyScalar(1 / COLS));
    this.surfaceMaterial.color.multiplyScalar(1 / COLS);
    for (let c = 0; c < COLS; c++) {
      const x = soilX(c),
        top = this.state.soil[c],
        height = top.mulch * (0.08 + random(c) * 0.055);
      dummy.position.set(x, height * 0.5, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(CW * 1.015, height, 0.35);
      dummy.updateMatrix();
      this.mulchMesh.setMatrixAt(c, dummy.matrix);
      const pond = this.state.surface[c];
      dummy.position.set(x, height + 0.02 + pond * 0.0009, 0);
      dummy.scale.set(
        CW * 0.99,
        pond > 0.08 ? 0.018 + pond * 0.0018 : 0,
        0.025,
      );
      dummy.updateMatrix();
      this.waterMesh.setMatrixAt(c, dummy.matrix);
    }
    this.mulchMesh.instanceMatrix.needsUpdate = true;
    this.waterMesh.instanceMatrix.needsUpdate = true;
  }
  drainUpdates(budget = 2) {
    const start = performance.now();
    for (const r of this.updateQueue) {
      this.updateQueue.delete(r);
      if (this.records.has(r.p.id)) this.updatePlant(r);
      if (performance.now() - start > budget) break;
    }
    this.scene.updateMatrixWorld();
  }
  animateWorms(dt, time, simDay) {
    const dummy = this.wormTransform;
    const worms = this.state.worms;
    let count = 0;
    for (const worm of worms) {
      const progress = worm.nextCol == null ? 0 : clamp((simDay - worm.moveStart) / WORM_STEP_DAYS);
      const col = worm.col + ((worm.nextCol ?? worm.col) - worm.col) * progress;
      const row = worm.row + ((worm.nextRow ?? worm.row) - worm.row) * progress;
      const x = soilX(col), y = -(row + 0.5) * CH;
      const tilt = -0.32 * (worm.dy || 0) * (worm.dx || 1);
      let pose = this.wormPoses.get(worm.id);
      if (!pose) {
        pose = { tilt };
        this.wormPoses.set(worm.id, pose);
      }
      pose.tilt += (tilt - pose.tilt) * (1 - Math.exp(-dt * 3));
      const dx = Math.cos(pose.tilt), dy = Math.sin(pose.tilt);
      for (let i = 0; i < 8; i++) {
        const along = (3.5 - i) * 0.064;
        const bend = Math.sin(time * 3.8 - i * 0.5 + worm.id) * 0.022;
        const taper = 1 - Math.abs(i - 3.5) * 0.11;
        dummy.position.set(x + dx * along - dy * bend,
          Math.min(-0.045, y + dy * along + dx * bend), 0);
        dummy.rotation.z = pose.tilt;
        dummy.scale.set(0.11, 0.09 * taper, 0.075 * taper);
        dummy.updateMatrix();
        this.wormMesh.setMatrixAt(count++, dummy.matrix);
      }
    }
    if (!count && !this.wormMesh.count) return;
    this.wormMesh.count = count;
    this.wormMesh.instanceMatrix.needsUpdate = true;
  }
  syncMushrooms() {
    const ids = new Set(this.state.mushrooms.map((m) => m.id));
    for (const [id, g] of this.mushrooms)
      if (!ids.has(id)) {
        this.scene.remove(g);
        this.mushrooms.delete(id);
      }
    for (const m of this.state.mushrooms) {
      let g = this.mushrooms.get(m.id);
      if (!g) {
        g = new T.Group();
        g.position.set(m.x, 0, 0);
        box(g, 0, 0.09, 0, 0.045, 0.18, 0.04, 0xd9c1a0);
        box(g, 0, 0.2, 0, 0.2, 0.06, 0.13, 0xb88f69);
        this.scene.add(g);
        this.mushrooms.set(m.id, g);
      }
      g.scale.setScalar(clamp((this.state.day - m.born) / 8, 0.1, 1));
    }
  }
  updateGhosts() {
    const key =
      this.selected && this.state.phase === 2
        ? this.state.plants.map((p) => p.id).join("|")
        : "";
    if (key && this.ghostGroup && this.ghostKey === key) {
      for (const g of this.ghostGroup.children) {
        const p = this.state.plants.find((p) => p.id === g.userData.pid);
        if (p) g.position.x = p.x;
      }
      return;
    }
    if (this.ghostGroup) {
      this.scene.remove(this.ghostGroup);
      this.ghostGroup.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
        if (o.isLineSegments) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.ghostGroup = null;
    this.ghostKey = key;
    if (!key) return;
    const group = new T.Group();
    this.scene.add(group);
    this.ghostGroup = group;
    for (const p of this.state.plants) {
      const preview = this.maturePreview(getSpecies(p.sid), p.seed, 0.39);
      preview.position.set(p.x, 0, 0);
      preview.userData.pid = p.id;
      group.add(preview);
    }
  }
  maturePreview(sp, seed, opacity = 1) {
    const recipe = makeArchitecture(sp, seed);
    const g = new T.Group();
    g.scale.setScalar(sp.height);
    const woodMaterial = barkMaterial(sp).clone();
    woodMaterial.transparent = opacity < 1;
    woodMaterial.opacity = opacity;
    woodMaterial.depthWrite = opacity === 1;
    const leafMaterial = new T.MeshLambertMaterial({
      map: stamp(sp).texture,
      color: foliageColor(sp),
      side: T.DoubleSide,
      alphaTest: 0.16,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity === 1,
    });
    const wood = new T.InstancedMesh(taperedGeometry, woodMaterial, recipe.nodes.length + recipe.leaves.length);
    const leaves = new T.InstancedMesh(leafGeometry, leafMaterial, recipe.leaves.length);
    g.add(wood, leaves);
    this.posePlant({
      preview: true, p: { seed, health: 100 }, sp, recipe,
      data: recipe.leaves, wood, leaves, maturity: 1.5, height: sp.height,
    }, 0);
    return g;
  }
  plantThumbnail(sp) {
    this.thumbnails ??= new Map();
    if (this.thumbnails.has(sp.id)) return this.thumbnails.get(sp.id);
    if (!this.thumbnailRenderer) {
      this.thumbnailRenderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      this.thumbnailRenderer.setSize(192, 148, false);
    }
    const scene = new T.Scene();
    scene.background = new T.Color(0x233a3d);
    scene.add(new T.HemisphereLight(0xfff7df, 0x78634e, 2.05));
    const sun = new T.DirectionalLight(0xfff5d7, 1.4);
    sun.position.set(-5, 10, 7);
    scene.add(sun);
    const tree = this.maturePreview(sp, 42);
    scene.add(tree);
    const farmer = this.farmer.clone();
    for (const child of farmer.children) child.rotation.x = 0;
    farmer.rotation.set(0, 0, 0);
    const treeLeft = new T.Box3().setFromObject(tree).min.x;
    farmer.position.set(treeLeft - 0.52, 0, 0);
    scene.add(farmer);
    const bounds = new T.Box3().setFromObject(scene);
    const center = bounds.getCenter(new T.Vector3());
    const dimensions = bounds.getSize(new T.Vector3());
    const half = Math.max(dimensions.y, dimensions.x * 148 / 192) * 0.56;
    const wide = half * 192 / 148;
    const camera = new T.OrthographicCamera(-wide, wide, half, -half, 0.1, 100);
    camera.position.set(center.x, center.y, 45);
    camera.lookAt(center.x, center.y, 0);
    this.thumbnailRenderer.render(scene, camera);
    const image = this.thumbnailRenderer.domElement.toDataURL("image/png");
    tree.traverse(mesh => {
      if (mesh.isInstancedMesh) {
        mesh.dispose();
        mesh.material.dispose();
      }
    });
    this.thumbnails.set(sp.id, image);
    return image;
  }
  alphaHit(hit) {
    const rec = this.records.get(hit.object.userData.pid);
    if (!rec || !hit.object.userData.leaf || !hit.uv) return true;
    const x = clamp(Math.floor(hit.uv.x * 127), 0, 127),
      y = clamp(Math.floor((1 - hit.uv.y) * 127), 0, 127);
    return rec.stamp.alpha[(y * 128 + x) * 4 + 3] > 100;
  }
  hit(x, y, tolerance = 12) {
    this.ray.near = 0;
    this.ray.far = 180;
    const r = this.element.getBoundingClientRect();
    this.ray.setFromCamera(
      new T.Vector2(
        ((x - r.left) / r.width) * 2 - 1,
        (-(y - r.top) / r.height) * 2 + 1,
      ),
      this.camera,
    );
    const wp = this.worldPoint(x, y);
    const candidates = this.pickables.filter((m) => {
      const rec = this.records.get(m.userData.pid);
      return (
        rec &&
        Math.abs(rec.p.x - wp.x) < Math.max(0.6, rec.height * 0.4) &&
        wp.y >= -0.1 &&
        wp.y < rec.height + 1
      );
    });
    const hits = this.ray.intersectObjects(candidates, false);
    const hit = hits.find((h) => this.alphaHit(h));
    if (hit) return this.records.get(hit.object.userData.pid)?.p;
    let closest = null,
      distance = tolerance;
    for (const rec of this.records.values()) {
      if (!rec.pose || Math.abs(rec.p.x - wp.x) > rec.height * 0.8 + 2)
        continue;
      for (const n of rec.pose) {
        const a = this.project(
            rec.p.x + n.a.x * rec.poseScale * rec.height,
            n.a.y * rec.poseScale * rec.height,
            n.a.z * rec.poseScale * rec.height,
          ),
          b = this.project(
            rec.p.x + n.b.x * rec.poseScale * rec.height,
            n.b.y * rec.poseScale * rec.height,
            n.b.z * rec.poseScale * rec.height,
          ),
          dx = b.x - a.x,
          dy = b.y - a.y,
          t = clamp(
            ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1),
          ),
          d = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
        if (d < distance) {
          closest = rec.p;
          distance = d;
        }
      }
    }
    return closest;
  }
  highlight(p) {
    if (this.hover === p) return;
    const previous = this.records.get(this.hover?.id);
    if (previous) {
      previous.leaves.material.emissive.setHex(0);
      previous.wood.material.emissive.setHex(0);
    }
    this.hover = p;
    const current = this.records.get(p?.id);
    if (current) {
      current.leaves.material.emissive.setHex(0x4a5021);
      current.wood.material.emissive.setHex(0x5d492e);
    }
  }
  exposure(x, y, self = null) {
    const key =
      (self || "c" + colAt(x)) +
      ":" +
      Math.round(x * 2) +
      ":" +
      Math.round(y * 2);
    const cached = this.samples.get(key);
    if (cached && this.state.day < (cached.until ?? Infinity)) return cached;
    const candidates = this.canopies.filter((m) => {
      const r = this.records.get(m.userData.pid);
      return (
        r.p.id !== self &&
        r.p.planted &&
        r.p.health > 0 &&
        Math.abs(r.p.x - x) < r.height * 0.45 + 2
      );
    });
    const rays = [
      new T.Vector3(-0.28, 1, 0).normalize(),
      new T.Vector3(0.22, 1, 0).normalize(),
      new T.Vector3(0, 1, 0),
    ];
    const coverage = [];
    for (const direction of rays) {
      let blocked = 0;
      for (const z of [0.1, 0.28]) {
        this.ray.set(new T.Vector3(x, y + 0.05, z), direction);
        this.ray.near = 0.02;
        this.ray.far = 35;
        const hits = this.ray
          .intersectObjects(candidates, false)
          .filter((h) => this.alphaHit(h));
        blocked += Math.min(1, hits.length * 0.2);
      }
      coverage.push(blocked / 2);
    }
    const result = {
      light: clamp(1 - (coverage[0] + coverage[1]) * 0.47, 0.08, 1),
      rain: clamp(1 - coverage[2] * 0.72, 0.22, 1),
    };
    this.samples.set(key, {
      ...result,
      until: this.state.day + 14 + Math.floor(random(x * 13 + y) * 18),
    });
    return result;
  }
  makeFarmer() {
    this.farmer = new T.Group();
    this.scene.add(this.farmer);
    this.farmer.position.z = 0;
    this.farmerX = 0;
    this.target = 0;
    const shirt = foliageColor(getSpecies("cinnamon")).getHex();
    const pants = foliageColor(getSpecies("oak")).getHex();
    box(this.farmer, 0, 0.88, 0, 0.44, 0.6, 0.28, shirt);
    const head = new T.Group();
    head.position.y = 1.375;
    this.farmer.add(head);
    box(head, 0, 0, 0, 0.4, 0.4, 0.4, 0xd3ae86);
    const faceTexture = new T.TextureLoader().load(
      window.POCKET_FOREST_FACE ?? "art/farmer-face.png?v=17-2",
      () => this.thumbnails?.clear(),
    );
    faceTexture.colorSpace = T.SRGBColorSpace;
    const face = new T.Mesh(new T.PlaneGeometry(0.4, 0.4),
      new T.MeshBasicMaterial({ map: faceTexture, alphaTest: 0.3 }));
    face.position.z = 0.201;
    head.add(face);
    box(head, 0, 0.146, 0, 0.424, 0.142, 0.424, 0x514034);
    box(head, 0, 0.205, 0, 0.73, 0.09, 0.63, 0xd5ba76);
    box(head, 0, 0.295, 0, 0.37, 0.12, 0.35, 0xbda16c);
    this.legs = [];
    this.arms = [];
    for (const side of [-1, 1]) {
      const leg = new T.Group();
      leg.position.set(side * 0.11, 0.58, 0);
      this.farmer.add(leg);
      box(leg, 0, -0.235, 0, 0.22, 0.47, 0.25, pants);
      box(leg, 0, -0.525, 0.04, 0.24, 0.11, 0.33, 0x554c38);
      this.legs.push(leg);
      const arm = new T.Group();
      arm.position.set(side * 0.32, 1.18, 0);
      this.farmer.add(arm);
      box(arm, 0, -0.325, 0, 0.20, 0.65, 0.24, 0xd3ae86);
      this.arms.push(arm);
    }
    box(this.farmer, 0, 0.884, 0.147, 0.028, 0.28, 0.012, 0xd5e4a2);
    for (const [index, length] of [0.116, 0.086, 0.055].entries()) {
      for (const side of [-1, 1]) {
        const branch = box(this.farmer, side * length * 0.36, 0.842 + index * 0.065, 0.147,
          0.023 - index * 0.004, length, 0.012, 0xd5e4a2);
        branch.rotation.z = -side * 0.92;
      }
    }
  }
  makeTools() {
    this.toolRoot = new T.Group();
    this.scene.add(this.toolRoot);
    this.bag = new T.Group();
    this.can = new T.Group();
    this.shovel = new T.Group();
    this.toolRoot.add(this.bag, this.can, this.shovel);
    box(this.shovel, 0, 0.57, 0, 0.08, 1.05, 0.08, 0xb28859);
    box(this.shovel, 0, 1.05, 0, 0.28, 0.10, 0.1, 0x7d5537);
    box(this.shovel, 0, 0.02, 0, 0.34, 0.35, 0.075, 0xa3b5ba);
    this.shovel.position.y = -0.47;
    box(this.bag, 0, 0, 0, 0.52, 0.66, 0.28, 0xcfab67);
    this.bagLabels = {};
    for (const name of ["compost", "mulch"]) {
      const label = document.createElement("canvas");
      label.width = 128;
      label.height = 48;
      const context = label.getContext("2d");
      context.fillStyle = "#302514";
      context.font = "bold 24px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(name.toUpperCase(), 64, 24);
      const map = new T.CanvasTexture(label);
      map.colorSpace = T.SRGBColorSpace;
      const mesh = new T.Mesh(new T.PlaneGeometry(0.49, 0.184),
        new T.MeshBasicMaterial({ map, alphaTest: 0.5 }));
      mesh.position.z = 0.142;
      this.bag.add(mesh);
      this.bagLabels[name] = mesh;
    }
    const teal = 0x568d86;
    box(this.can, -0.075, 0, 0, 0.43, 0.37, 0.27, teal);
    const spout = box(this.can, 0.24, 0.044, 0, 0.30, 0.085, 0.09, teal);
    spout.rotation.z = 0.24;
    const nozzle = box(this.can, 0.394, 0.082, 0, 0.075, 0.145, 0.13, 0x648e88);
    nozzle.rotation.z = spout.rotation.z;
    box(this.can, -0.31, 0.057, 0, 0.13, 0.06, 0.074, teal);
    box(this.can, -0.372, -0.039, 0, 0.06, 0.24, 0.074, teal);
    box(this.can, -0.31, -0.135, 0, 0.13, 0.06, 0.074, teal);
    this.canOutlet = new T.Object3D();
    this.canOutlet.position.set(0.435, 0.092, 0);
    this.canOutlet.rotation.z = spout.rotation.z;
    this.can.add(this.canOutlet);
    this.bagOutlet = new T.Object3D();
    this.bagOutlet.position.set(0.26, 0.08, 0);
    this.bag.add(this.bagOutlet);
  }
  positionTool(tool, pointer, applying) {
    const p = this.worldPoint(pointer.x, pointer.y);
    this.toolRoot.position.set(p.x, p.y);
    this.toolRoot.rotation.z = tool === "drainage" ? (applying ? -0.65 : -0.28)
      : applying ? -0.74 : 0;
    this.toolRoot.rotation.y = tool !== "drainage" && p.x > HALF - 1.5 ? Math.PI : 0;
    this.toolRoot.rotation.order = "YXZ";
    for (const label of Object.values(this.bagLabels)) {
      label.position.z = this.toolRoot.rotation.y ? -0.142 : 0.142;
      label.rotation.y = this.toolRoot.rotation.y;
    }
  }
  pour(tool, pointer) {
    this.positionTool(tool, pointer, true);
    const water = tool === "water";
    const outlet = water ? this.canOutlet : this.bagOutlet;
    const origin = outlet.getWorldPosition(new T.Vector3());
    const direction = new T.Vector3(1, 0, 0)
      .applyQuaternion(outlet.getWorldQuaternion(new T.Quaternion()));
    const mulch = tool === "mulch";
    const count = water ? 6 : mulch ? 1 : 7;
    const color = water ? 0x197ddd : mulch ? 0xc79a56 : 0x463120;
    for (let i = 0; i < count; i++) {
      const fraction = mulch ? 0.2 : i / (count - 1);
      const size = (water ? 0.067 : mulch ? 0.16 : 0.10) * (0.8 + Math.random() * 0.4);
      const mesh = box(this.scene, origin.x, origin.y, origin.z, size, size, size, color);
      this.effects.push({
        mesh, kind: tool, life: 3,
        vx: direction.x * (0.42 + fraction * (water || mulch ? 3.9 : 6.7) + Math.random() * 0.27),
        vy: direction.y * (0.65 + Math.random() * 0.8) + fraction * 0.24,
      });
    }
  }

  makeFauna() {
    this.insects = [];
    for (let i = 0; i < 10; i++) {
      const g = new T.Group();
      this.scene.add(g);
      const bee = i < 7;
      if (bee) g.scale.setScalar(0.78);
      if (bee) {
        box(g, 0, 0, 0, 0.28, 0.19, 0.19, 0xe6b44a);
        box(g, -0.025, 0, 0, 0.062, 0.197, 0.198, 0x24231f);
        box(g, 0.16, 0, 0, 0.08, 0.115, 0.115, 0x24231f);
      } else {
        box(g, 0, 0, 0, 0.23, 0.082, 0.09, 0x282620);
        for (const side of [-1, 1])
          box(g, -0.026, 0.02, side * 0.044, 0.15, 0.018, 0.012, 0xf2e4ac);
      }
      const wings = [-1, 1].map(side => {
        const hinge = new T.Group();
        hinge.position.set(0, bee ? 0.064 : 0.025, side * (bee ? 0.06 : 0.032));
        if (bee) {
          box(hinge, 0, 0, side * 0.105, 0.16, 0.024, 0.21, 0xf4f2e4);
        } else {
          const shape = new T.Shape();
          shape.moveTo(0.04, 0);
          shape.lineTo(0.19, side * 0.19);
          shape.lineTo(0.09, side * 0.34);
          shape.lineTo(-0.12, side * 0.28);
          shape.lineTo(-0.25, side * 0.26);
          shape.lineTo(-0.18, side * 0.17);
          shape.lineTo(-0.12, 0);
          shape.closePath();
          const wing = new T.Mesh(new T.ShapeGeometry(shape),
            new T.MeshLambertMaterial({ color: 0xf3e4aa, side: T.DoubleSide }));
          wing.rotation.x = Math.PI / 2;
          hinge.add(wing);
          box(hinge, -0.02, 0.002, side * 0.13, 0.19, 0.014, 0.031, 0x353025);
          box(hinge, -0.055, 0.002, side * 0.22, 0.18, 0.014, 0.031, 0x353025);
        }
        g.add(hinge);
        return hinge;
      });
      const name = bee ? "Japanese long-tongued bumblebee" : "Asian swallowtail";
      const species = bee ? "Bombus diversus" : "Papilio xuthus";
      this.insects.push({ g, wings, i, name, species });
    }
  }
  insectAt(x, y) {
    let closest = null;
    let distance = 13;
    for (const insect of this.insects) {
      if (!insect.g.visible) continue;
      const p = insect.g.position;
      const screen = this.project(p.x, p.y, p.z);
      const d = Math.hypot(screen.x - x, screen.y - y);
      if (d < distance) {
        closest = insect;
        distance = d;
      }
    }
    return closest;
  }
  makeBirds() {
    this.birds = [0, 1].map(i => {
      const g = new T.Group();
      const plumage = i ? 0x706962 : 0x99a748;
      const body = new T.Mesh(fruitGeometry, material(plumage));
      body.scale.set(0.4, 0.24, 0.23);
      body.position.y = 0.18;
      g.add(body);
      const head = new T.Group();
      head.position.set(0.13, 0.25, 0);
      const skull = new T.Mesh(fruitGeometry, material(plumage));
      skull.scale.setScalar(0.19);
      head.add(skull);
      box(head, 0.11, -0.025, 0, 0.13, 0.047, 0.05, 0x574836);
      for (const side of [-1, 1]) {
        box(head, 0.019, 0.015, side * 0.085, 0.051, 0.052, 0.015, i ? 0x925c43 : 0xfff3d4);
        box(head, 0.023, 0.019, side * 0.096, 0.024, 0.026, 0.01, 0x292821);
        box(g, 0.03, 0.055, side * 0.055, 0.024, 0.105, 0.023, 0x7e604b);
      }
      g.add(head);
      const tail = box(g, -0.25, 0.17, 0, i ? 0.27 : 0.19, 0.045, 0.115, plumage);
      tail.rotation.z = -0.22;
      const wings = [-1, 1].map(side => {
        const wing = new T.Group();
        wing.position.set(-0.04, 0.2, side * 0.04);
        box(wing, 0, 0, side * 0.14, 0.22, 0.027, 0.31, plumage);
        g.add(wing);
        return wing;
      });
      const side = i ? 1 : -1;
      g.position.set(side * 13, 7 + i * 2, 3);
      g.scale.setScalar(i ? 1.36 : 1.04);
      this.scene.add(g);
      return { g, wings, head, side, i, perch: null, fruit: null, arrived: null,
        target: new T.Vector3(), takeoff: new T.Vector3() };
    });
  }
  animateBirds(dt, time) {
    const trees = [...this.records.values()].filter(r =>
      r.p.planted && r.p.health > 45 && r.height > 2 && (r.p.wild || r.p.age >= 1));
    for (const bird of this.birds) {
      if (!bird.perch || !trees.includes(bird.perch) ||
          (bird.arrived !== null && time - bird.arrived > 4.5 + bird.i)) {
        const planted = trees.filter(r => !r.p.wild && r !== bird.perch);
        const woodland = trees.filter(r => r.p.wild && Math.sign(r.p.x) === bird.side &&
          Math.abs(r.p.x) < 31 && r !== bird.perch);
        const options = planted.length && random(time + bird.i) < 0.65 ? planted : woodland;
        if (!options.length) continue;
        const fruitTrees = options.filter(r => r.fruits.some(fruit => fruit.visible));
        const picks = fruitTrees.length ? fruitTrees : options;
        bird.perch = picks[Math.floor(random(time * 3 + bird.i) * picks.length)];
        bird.fruit = bird.perch.fruits.find(fruit => fruit.visible) ?? null;
        bird.arrived = null;
        bird.departed = time;
        bird.takeoff.copy(bird.g.position);
        bird.flightDuration = null;
      }
      const { g, perch, fruit, wings, head } = bird;
      if (fruit) {
        fruit.getWorldPosition(bird.target);
        bird.target.x -= 0.18 * bird.side;
        bird.target.y -= 0.09;
      } else {
        perch.g.updateWorldMatrix(true, false);
        bird.target.copy(perch.perch).applyMatrix4(perch.g.matrixWorld);
      }
      const moving = bird.arrived === null;
      if (moving) {
        bird.flightDuration ??= Math.max(1.4, bird.takeoff.distanceTo(bird.target) / 3.7);
        const progress = clamp((time - bird.departed) / bird.flightDuration);
        const arc = Math.sin(progress * Math.PI);
        const oldX = g.position.x;
        g.position.lerpVectors(bird.takeoff, bird.target, progress);
        g.position.x -= bird.side * arc * 1.8;
        g.position.y += arc * 0.85;
        g.position.z += arc * 0.65;
        if (Math.abs(g.position.x - oldX) > 0.015)
          g.rotation.y = g.position.x > oldX ? 0 : Math.PI;
        if (progress === 1) bird.arrived = time;
      } else {
        g.position.copy(bird.target);
        if (fruit) g.rotation.y = bird.side > 0 ? 0 : Math.PI;
      }
      const peck = bird.arrived !== null && fruit && fruit.visible && time - bird.arrived > 0.65;
      head.rotation.z = peck ? -Math.abs(Math.sin(time * 14)) * 0.55 : 0;
      if (peck && time - bird.arrived > 1.5) {
        fruit.visible = false;
        perch.p.fruitEaten ??= {};
        perch.p.fruitEaten[fruit.userData.fruitIndex] = Math.floor(this.state.day / 365);
      }
      wings.forEach((wing, index) => {
        wing.rotation.x = (index ? 1 : -1) * (moving ? Math.sin(time * 18 + bird.i) * 0.92 : 1.22);
      });
    }
  }
  digParticles(x, y, count) {
    for (let i = 0; i < count; i++) {
      const jitter = random(this.time + i) - 0.5;
      const width = 0.15 + random(i + 5) * 0.12;
      const mesh = box(this.scene, x + jitter * 0.15, y + random(i) * 0.13,
        0, width, width * 0.74, width * 0.55, 0x786049);
      this.effects.push({ mesh, vx: jitter * 2, vy: 3.4 + random(i) * 1.2, kind: "dig", life: 3 });
    }
  }
  releaseLeaf(rec, release, time) {
    rec.g.updateWorldMatrix(true, false);
    const position = new T.Vector3(), rotation = new T.Quaternion(), size = new T.Vector3();
    this.leafMatrix.multiplyMatrices(rec.g.matrixWorld, release.matrix).decompose(position, rotation, size);
    const tint = new T.Color();
    rec.leaves.getColorAt(release.slot, tint);
    tint.multiply(rec.leaves.material.color);
    let batch = this.fallingLeaves.get(rec.sp.id);
    if (!batch) {
      const material = new T.MeshLambertMaterial({
        map: rec.stamp.texture,
        side: T.DoubleSide,
        alphaTest: 0.45,
      });
      batch = { material, leaves: [], mesh: null };
      this.fallingLeaves.set(rec.sp.id, batch);
    }
    batch.leaves.push({ position, rotation, size, tint, time, landed: null,
      phase: random(position.x * 17 + position.y * 19) * Math.PI * 2 });
  }
  animateLeaves(dt, time) {
    for (const rec of this.sheddingPlants) {
      for (const [leaf, release] of rec.shedding) {
        const progress = clamp((time - release.at) / release.duration);
        if (!progress) continue;
        if (progress === 1) {
          this.releaseLeaf(rec, release, time);
          rec.shedding.delete(leaf);
        }
        this.leafScale.set(1 - progress, 1 - progress, 1);
        this.leafMatrix.copy(release.matrix).scale(this.leafScale);
        rec.leaves.setMatrixAt(release.slot, this.leafMatrix);
        rec.leaves.instanceMatrix.needsUpdate = true;
      }
      if (!rec.shedding.size) this.sheddingPlants.delete(rec);
    }
    for (const batch of this.fallingLeaves.values()) {
      const leaves = batch.leaves;
      const capacity = batch.mesh?.instanceMatrix.count ?? 0;
      if (leaves.length > capacity) {
        if (batch.mesh) {
          this.scene.remove(batch.mesh);
          batch.mesh.dispose();
        }
        batch.mesh = new T.InstancedMesh(leafGeometry, batch.material,
          Math.max(128, capacity * 2, leaves.length));
        batch.mesh.frustumCulled = false;
        batch.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        batch.mesh.count = 0;
        this.scene.add(batch.mesh);
      }
      let count = 0;
      for (const leaf of leaves) {
        const { position, phase, size } = leaf;
        if (leaf.landed === null) {
          const flutter = time * 4.2 + phase;
          position.x += dt * (this.wind * 14 + Math.sin(flutter) * 0.45);
          position.z += dt * Math.cos(flutter * 0.8) * 0.22;
          position.y -= dt * (1.12 + Math.sin(flutter) * 0.29);
          this.leafTransform.quaternion.copy(leaf.rotation);
          this.leafTransform.rotateX(Math.sin(flutter) * 1.4);
          this.leafTransform.rotateZ((time - leaf.time) * 1.6);
          if (position.y <= 0.05) {
            leaf.landed = time;
            position.y = 0.045;
            position.z = clamp(position.z, -3.5, 1.95);
            this.landedLeaves.push({ x: position.x, area: size.x * size.y });
          }
        }
        const rest = leaf.landed === null ? 0 : time - leaf.landed;
        if (rest > 16) continue;
        if (leaf.landed !== null) this.leafTransform.rotation.set(-Math.PI / 2, 0, phase);
        this.leafTransform.position.copy(position);
        this.leafTransform.scale.copy(size).multiplyScalar(1 - clamp((rest - 7) / 9));
        this.leafTransform.updateMatrix();
        batch.mesh.setMatrixAt(count, this.leafTransform.matrix);
        batch.mesh.setColorAt(count, leaf.tint);
        leaves[count++] = leaf;
      }
      leaves.length = count;
      if (!batch.mesh) continue;
      batch.mesh.count = count;
      batch.mesh.instanceMatrix.needsUpdate = true;
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
    }
  }
  uproot(p) {
    const r = this.records.get(p.id);
    if (!r) return;
    if (this.hover === p) this.highlight(null);
    r.g.updateWorldMatrix(true, false);
    const matrix = new T.Matrix4();
    for (const source of [r.wood, r.leaves]) {
      const count = Math.min(source === r.wood ? 9 : 14, source.count);
      if (!count) continue;
      const debris = { material: source.material.clone(), count };
      for (let i = 0; i < count; i++) {
        source.getMatrixAt(Math.floor(i * source.count / count), matrix);
        matrix.premultiply(r.g.matrixWorld);
        const mesh = new T.Mesh(source.geometry, debris.material);
        matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
        mesh.position.z = 0;
        this.scene.add(mesh);
        this.effects.push({
          mesh, debris, kind: "weed",
          vx: (random(p.seed + i) - 0.5) * 1.45,
          vy: 0.75 + random(i + 9) * 0.95,
          life: 42,
        });
      }
    }
  }
  render(dt, time, tool, pointer, applying, simDay) {
    this.time = time;
    this.toolRoot.visible = !!tool;
    this.bag.visible = tool === "mulch" || tool === "compost";
    for (const [name, label] of Object.entries(this.bagLabels)) label.visible = tool === name;
    this.shovel.visible = tool === "drainage";
    const cloudRate = this.state.phase >= 4 ? this.state.speed : 1;
    this.cloudTravel = (this.cloudTravel + dt * 0.24 * cloudRate) % 351;
    this.clouds.children.forEach((cloud, i) => {
      cloud.position.x = (i * 27 + 13.5 - this.cloudTravel + 351) % 351 - 175.5;
    });
    this.can.visible = tool === "water";
    this.animateCamera(time);
    if (tool) this.positionTool(tool, pointer, applying);
    const delta = this.target - this.farmerX;
    const step = Math.sign(delta) * Math.min(Math.abs(delta), dt * 2.8);
    this.farmerX += step;
    const moving = Math.abs(this.target - this.farmerX) > 0.025;
    this.farmer.position.x = this.farmerX;
    const yaw = moving ? Math.sign(delta) * Math.PI / 2 : 0;
    this.farmer.rotation.y += (yaw - this.farmer.rotation.y) * Math.min(1, dt * 11);
    this.legs.forEach((leg, i) => {
      leg.rotation.x = moving ? Math.sin(time * 9 + i * Math.PI) * 0.35 : 0;
    });
    this.arms.forEach((arm, i) => {
      arm.rotation.x = moving ? Math.sin(time * 9 + i * Math.PI) * -0.47 : 0;
    });
    this.drainUpdates();
    this.wind = Math.sin(time * 0.82) * 0.014 + Math.sin(time * 0.29) * 0.007;
    for (const r of this.records.values()) {
      this.interpolateGrowth(r, time);
      r.g.rotation.z =
        -(r.sunLean || 0) +
        this.wind * (0.85 + Math.min(1, r.height / 20) * 0.15);
      if (!r.p.planted && (r.p.drop || 0) > 0) {
        r.p.drop = Math.max(0, r.p.drop - dt * 8);
        r.group.position.y = r.p.drop;
      }
    }
    this.animateLeaves(dt, time);
    this.animateWorms(dt, time, simDay);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      if (e.settled) {
        if (e.life <= 0) {
          this.scene.remove(e.mesh);
          if (e.debris && --e.debris.count === 0) e.debris.material.dispose();
          this.effects.splice(i, 1);
        }
        else {
          e.mesh.scale.copy(e.restScale).multiplyScalar(Math.min(1, e.life / 34));
          e.mesh.position.y = Math.max(0.004, 0.027 * e.life / 42);
        }
        continue;
      }
      e.vy -= dt * (e.kind === "water" ? 5 : 4);
      e.mesh.position.x += e.vx * dt;
      e.mesh.position.y += e.vy * dt;
      if (e.kind === "weed") e.mesh.rotation.z += dt * 2;
      else e.mesh.rotation.z += dt;
      if (e.mesh.position.y <= 0.04) {
        if (e.kind === "water" && Math.abs(e.mesh.position.x) < MAP_HALF)
          this.pendingWater.push(e.mesh.position.x);
        if (e.kind === "mulch" && Math.abs(e.mesh.position.x) < HALF)
          this.pendingMulch.push(e.mesh.position.x);
        if (e.kind === "compost" && Math.abs(e.mesh.position.x) < MAP_HALF)
          this.pendingCompost.push(e.mesh.position.x);
        if (e.kind === "weed" && e.life > 0) {
          e.vy = 0;
          e.vx = 0;
          e.mesh.rotation.set(-Math.PI / 2, 0, random(i + 7) * Math.PI * 2);
          e.restScale = e.mesh.scale.clone();
          e.settled = true;
          e.mesh.position.y = 0.027;
        } else e.life = 0;
      }
      if (e.life <= 0) {
        this.scene.remove(e.mesh);
        this.effects.splice(i, 1);
      }
    }
    const flowering = [...this.records.values()].filter((r) =>
      r.flowers.some((f) => f.visible),
    );
    const habitats = [-1, 1].map(side => flowering.filter(r =>
      r.p.wild && Math.sign(r.p.x) === side));
    const plantedFlowers = flowering.filter(r => !r.p.wild);
    this.insects.forEach(({ g, wings, i }) => {
      const local = habitats[i % 2];
      const anchors = local.length ? local : plantedFlowers;
      g.visible = anchors.length > 0;
      if (!g.visible) return;
      const flight = g.userData;
      if (!flight.target || time >= flight.nextTurn || !anchors.includes(flight.anchor)) {
        flight.anchor = anchors[Math.floor(random(i * 71 + time) * anchors.length)];
        const flowers = flight.anchor.flowers.filter(f => f.visible);
        const flower = flowers[Math.floor(random(time + i * 19) * flowers.length)];
        flight.target ??= new T.Vector3();
        flower.getWorldPosition(flight.target);
        flight.target.y += 0.3;
        flight.nextTurn = time + 4 + random(time + i) * 6;
        if (!flight.arrived) {
          g.position.copy(flight.target);
          flight.arrived = true;
        }
      }
      const heading = flight.heading ??= new T.Vector3();
      heading.copy(flight.target).sub(g.position);
      const distance = heading.length();
      if (distance > 0.001) heading.divideScalar(distance);
      const phase = time * (0.8 + i * 0.029) + i * 2.1;
      const speed = 0.42 + 0.21 * Math.sin(phase * 1.71) + i * 0.018;
      g.position.addScaledVector(heading, Math.min(distance, speed * dt));
      g.position.x += dt * (Math.sin(phase * 2.1) * 0.44 + Math.cos(phase * 0.59) * 0.21);
      g.position.y = Math.max(0.25, g.position.y + dt * (Math.cos(phase * 2.6) * 0.29 + Math.sin(phase * 1.2) * 0.16));
      g.position.z += dt * Math.sin(phase * 1.55) * 0.31;
      wings.forEach((wing, index) => {
        wing.rotation.x = (index ? 1 : -1) * Math.sin(time * (34 + i) + i) * 0.9;
      });
    });
    this.animateBirds(dt, time);
    const wet =
      this.state.phase >= 4 &&
      (Math.floor((this.state.day % 365) / 91.25) === 1
        ? this.state.day % 29 < 4
        : this.state.day % 19 < 5);
    this.rainDrops.visible = wet;
    if (wet) {
      const d = new T.Object3D();
      let rainRayBudget = 3;
      for (let i = 0; i < 90; i++) {
        const x = this.center.x + (random(i + 12) - 0.5) * 60,
          y = 30 - ((time * 12 + i * 0.63) % 30);
        const cached = this.rainHits.get(Math.round(x * 2));
        let stop = cached?.height ?? 0;
        if (
          (!cached || this.state.day >= cached.until) &&
          rainRayBudget-- > 0
        ) {
          const recs = this.canopies.filter((m) => {
            const r = this.records.get(m.userData.pid);
            return Math.abs(r.p.x - x) < r.height * 0.4;
          });
          this.ray.set(new T.Vector3(x, 30, 0.28), new T.Vector3(0, -1, 0));
          this.ray.near = 0;
          this.ray.far = 30;
          const hit = this.ray
            .intersectObjects(recs, false)
            .find((h) => this.alphaHit(h));
          if (hit) stop = hit.point.y;
          this.rainHits.set(Math.round(x * 2), {
            height: stop,
            until: this.state.day + 35 + Math.floor(random(x) * 20),
          });
        }
        d.position.set(x, y, 4);
        d.scale.set(0.018, y > stop ? 0.35 : 0, 0.018);
        d.rotation.z = 0.08;
        d.updateMatrix();
        this.rainDrops.setMatrixAt(i, d.matrix);
      }
      this.rainDrops.instanceMatrix.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
    this.element.dataset.poseUpdates = this.poseUpdates;
    this.element.dataset.rootAllocations = this.rootAllocations;
  }
}
