import {
  makeArchitecture,
  poseArchitecture,
  leafAttachment,
} from "./architecture.js";
import * as T from "./vendor/three.module.js";
import { species } from "./species.js";
import {
  HALF,
  COLS,
  ROWS,
  CW,
  CH,
  DEPTH,
  clamp,
  random,
  getSpecies,
  plantHeight,
  colAt,
  sampleSoil,
  soilColorHSL,
  rootThickness,
} from "./ecology.js";
const taperedGeometry = new T.CylinderGeometry(0.36, 0.5, 1, 6),
  rootGeometry = new T.CylinderGeometry(0.94, 1, 1, 5, 1, true),
  soilGeometry = new T.PlaneGeometry(1, 1);
const boxGeometry = new T.BoxGeometry(1, 1, 1),
  leafGeometry = new T.PlaneGeometry(1, 1).translate(0, 0.5, 0),
  materialCache = new Map(),
  leafStamps = new Map();
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
function box(g, x, y, z, w, h, d, color) {
  const m = new T.Mesh(boxGeometry, material(color));
  m.position.set(x, y, z);
  m.scale.set(w, h, d);
  g.add(m);
  return m;
}
function branch(g, x, y, ex, ey, w, color) {
  const dx = ex - x,
    dy = ey - y,
    m = box(g, (x + ex) / 2, (y + ey) / 2, 0, w, Math.hypot(dx, dy), w, color);
  m.rotation.z = -Math.atan2(dx, dy);
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
    this.pendingWater = [];
    this.pendingMulch = [];
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
    this.baseSoilColor = new T.Color().setHSL(...Object.values(soilColorHSL({m: 50, n: 50})));
    const soilBase = box(this.ground, 0, -60, -1, 180, 120, 6, 0x453021);
    soilBase.material = new T.MeshBasicMaterial({color: this.baseSoilColor});

    const surface = box(this.ground, 0, -0.045, -1, 180, 0.09, 6, 0x39291e);
    surface.material = new T.MeshBasicMaterial({color: this.baseSoilColor});
    // The side woodland is entirely foreground and surveyable; no decorative block trees.
    const offsets = [12, 15.6, 19.5, 23, 27.5, 31, 35, 39, 44, 49, 55];
    for (const side of [-1, 1])
      for (let i = 0; i < offsets.length; i++) {
        const sp = species[i % 10];
        const p = {
          id: "wild-" + side + "-" + i,
          sid: sp.id,
          x: side * offsets[i],
          z: i % 2 ? -1 : 0,
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
          x: side * (11.2 + i * 2.6),
          z: 2,
          age: 3 + (i % 3),
          health: 95,
          seed: i + 80,
          wild: true,
          planted: true,
        });
      }
    for (const p of this.wild) {
      p.roots = [];
      const depth = Math.min(4, getSpecies(p.sid).height * 0.22);
      for (let r = 0; r < 4; r++) {
        let a = [p.x, -0.03];
        for (let j = 0; j < 16; j++) {
          const b = [
            a[0] + (r - 1.5) * 0.06 + (random(p.seed + j + r) - 0.5) * 0.08,
            a[1] - depth / 16,
          ];
          p.roots.push({ a, b, born: -100 });
          a = b;
        }
      }
      this.addPlant(p);
    }
    for (const side of [-1, 1]) {
      const wall = box(
        this.scene,
        side * (HALF + 0.14),
        0.18,
        2,
        0.35,
        0.68,
        0.8,
        0xa3987c,
      );
      box(this.scene, side * (HALF + 0.14), 0.56, 2, 0.49, 0.12, 0.9, 0xc4b79a);
      for (let j = 0; j < 3; j++)
        box(
          this.scene,
          side * (HALF + 0.14),
          j * 0.19,
          2.42,
          0.36,
          0.014,
          0.025,
          0x6f6b53,
        );
    }
    this.soilCols = Math.ceil(140 / CW);
    this.soilRows = Math.ceil(12 / CH);
    this.soilMesh = new T.InstancedMesh(
      soilGeometry,
      new T.MeshBasicMaterial({ color: 0xffffff }),
      this.soilCols * this.soilRows,
    );
    this.scene.add(this.soilMesh);
    const dummy = new T.Object3D();
    for (let r = 0; r < this.soilRows; r++)
      for (let c = 0; c < this.soilCols; c++) {
        const x = -70 + (c + 0.5) * CW,
          y = -(r + 0.5) * CH;
        dummy.position.set(x, y, 3.02);
        dummy.scale.set(CW * 0.998, CH * 0.998, 0.035);
        dummy.updateMatrix();
        this.soilMesh.setMatrixAt(r * this.soilCols + c, dummy.matrix);
        const hsl = soilColorHSL(sampleSoil(this.state, x, y));
        this.soilMesh.setColorAt(
          r * this.soilCols + c,
          Math.abs(x) < HALF ? new T.Color().setHSL(hsl.h, hsl.s, hsl.l) : this.baseSoilColor,
        );
      }
    this.mulchMesh = new T.InstancedMesh(boxGeometry, material(0x9b743e), COLS);
    this.scene.add(this.mulchMesh);
    this.soilOutline = box(this.scene, 0, 0, 3.1, CW, CH, 0.01, 0xffffff);
    this.soilOutline.material = new T.MeshBasicMaterial({
      color: 0xf0dfb5,
      wireframe: true,
      transparent: true,
      opacity: 0.8,
      depthTest: false,
    });
    this.soilOutline.visible = false;
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
    box(this.scene, 0, -DEPTH, 3.25, HALF * 2, 0.035, 0.025, 0x9b8258);
    for (const side of [-1, 1])
      box(
        this.scene,
        side * HALF,
        -DEPTH / 2,
        3.25,
        0.035,
        DEPTH,
        0.025,
        0x9b8258,
      );
    this.makeFarmer();
    this.makeTools();
    this.makeFauna();
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
    const aspect = this.element.clientWidth / this.element.clientHeight,
      half = Math.max(13, (aspect < 0.8 ? 15 : 24) / aspect) / this.zoom;
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
    const before = this.worldPoint(
        this.element.clientWidth * 0.5,
        this.element.clientHeight * 0.5,
      ),
      after = this.worldPoint(
        this.element.clientWidth * 0.5 + dx,
        this.element.clientHeight * 0.5 + dy,
      );
    this.center.x = clamp(this.center.x + before.x - after.x, -65, 65);
    this.center.y = clamp(this.center.y + before.y - after.y, -14, 32);
    this.projection();
  }
  zoomAt(factor, sx, sy) {
    const before = this.worldPoint(sx, sy);
    this.zoom = clamp(this.zoom * factor, 0.5, 12);
    this.projection();
    const after = this.worldPoint(sx, sy);
    this.center.x = clamp(this.center.x + before.x - after.x, -65, 65);
    this.center.y = clamp(this.center.y + before.y - after.y, -14, 32);
    this.projection();
  }
  plot() {
    this.center = { x: 0, y: this.state.phase === 0 ? 8 : 4.2 };
    this.zoom = this.state.phase === 0 ? 0.92 : 1.25;
    this.projection();
  }
  worldPoint(x, y, z = 1) {
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
    const p = this.worldPoint(x, y, 3.05);
    if (p.y >= -0.025) {
      this.soilOutline.visible = false;
      return null;
    }
    const cell = sampleSoil(this.state, p.x, p.y),
      cx = (Math.floor(p.x / CW) + 0.5) * CW,
      cy = -(Math.floor(-p.y / CH) + 0.5) * CH;
    this.soilOutline.position.set(cx, cy, 3.1);
    this.soilOutline.visible = true;
    return { cell, point: p };
  }
  project(x, y, z = 4) {
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
      branches: [],
      flowers: [],
      height: 0,
      rootMesh: null,
    };
    record.recipe = makeArchitecture(sp, p.seed);
    const data = record.recipe.leaves;
    record.wood = new T.InstancedMesh(
      taperedGeometry,
      material(sp.type === "weed" ? 0x688348 : 0x725033),
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
    if (sp.flower)
      for (let i = 0; i < 7; i++) {
        const flower = box(
          g,
          (random(i + p.seed) - 0.5) * 0.5,
          0.6 + random(i + 3) * 0.34,
          0.5,
          1,
          1,
          0.3,
          sp.flower,
        );
        record.flowers.push(flower);
      }
    const pot = new T.Group();
    group.add(pot);
    box(pot, 0, 0.13, 0.2, 0.36, 0.3, 0.3, 0xad6d42);
    box(pot, 0, 0.3, 0.2, 0.43, 0.07, 0.34, 0xcd9160);
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
    group.position.set(p.x, p.planted ? 0 : p.drop || 0, p.z ?? 1);
    rec.pot.visible = !p.planted;
    g.scale.set(h, h, h);
    rec.maturity = p.wild ? 1.5 : 0.12 + 0.88 * Math.sqrt(clamp(h / sp.height));
    rec.winter =
      sp.deciduous &&
      p.age > 1 &&
      Math.floor((this.state.day % 365) / 91.25) === 3;
    const signature = h.toFixed(4) + ":" + Math.min(25, p.age || 0).toFixed(2) + ":" + rec.winter + ":" + (health < 35);
    if (rec.poseSignature !== signature) {
      this.posePlant(rec, 0);
      rec.poseSignature = signature;
    }
    let color = new T.Color(sp.color)
      .lerp(new T.Color(0x429a37), 0.32)
      .offsetHSL(0, 0.08, 0.055);
    if (health < 65) color.lerp(new T.Color(0xb8a454), (65 - health) / 65);
    if (sp.deciduous && Math.floor((this.state.day % 365) / 91.25) === 2)
      color.lerp(new T.Color(0xb77c35), 0.7);
    leaves.material.color.copy(color);
    const day = this.state.day % 365,
      windows = {
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
      f.scale.setScalar(clamp(0.22 / h, 0.025, 0.2));
    });
    if (!p.wild && p.planted && this.state.day - (rec.lightAt ?? -100) >= 30) {
      rec.lightAt = this.state.day;
      const left = this.exposure(p.x - 0.5, h * 0.85, p.id).light,
        right = this.exposure(p.x + 0.5, h * 0.85, p.id).light;
      rec.sunLean = (rec.sunLean || 0) * 0.96 + (right - left) * 0.005;
    }
    this.updateRoots(rec);
  }
  posePlant(rec, time) {
    const { p, sp, leaves, wood } = rec,
      pose = poseArchitecture(rec.recipe, rec.maturity, 0),
      dummy = new T.Object3D();
    const maxY = Math.max(0.01, ...pose.map((n) => n.b.y)),
      scale = 1 / maxY;
    const canopyClusters = new Map();
    let woodCount = 0,
      leafCount = 0;
    const drawSegment = (a, b, width) => {
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
      wood.setMatrixAt(woodCount++, dummy.matrix);
    };
    pose.forEach((n, i) => {
      const node = rec.recipe.nodes[i];
      const thickening = node.depth === 0 && sp.type !== "weed" && sp.type !== "fern"
        ? 1 + 0.75 * (1 - Math.exp(-Math.max(0, p.age || 0) / 9)) : 1;
      drawSegment(n.a, n.b, node.width * thickening);
    });
    for (const l of rec.data) {
      const segment = pose[l.branch];
      if (
        segment.growth < 0.18 ||
        rec.maturity < l.birth ||
        p.health <= 0 ||
        rec.winter
      )
        continue;
      const attachment = leafAttachment(l, pose, p.health);
      drawSegment(
        attachment.base,
        attachment.tip,
        Math.min(0.0025, rec.recipe.nodes[l.branch].width * 0.4),
      );
      const size =
        clamp(
          (0.025 + 1.05 * Math.pow(clamp(rec.height / sp.height), 0.8)) /
            Math.max(0.1, rec.height),
          0.012,
          0.32,
        ) *
        (sp.leaf === "small" ? 0.72 : 1) *
        l.size *
        clamp((segment.growth - 0.15) / 0.85);
      dummy.position.set(attachment.tip.x * scale, attachment.tip.y * scale, attachment.tip.z * scale);
      dummy.rotation.set(l.tilt || 0, l.roll || 0, -attachment.angle, "ZYX");
      dummy.scale.set(
        size * (sp.leaf === "long" ? 0.7 : 1),
        size * (sp.leaf === "long" ? 1.5 : 1.1),
        1,
      );
      dummy.updateMatrix();
      leaves.setMatrixAt(leafCount, dummy.matrix);
      leaves.setColorAt(
        leafCount,
        (this.leafTint ??= new T.Color()).setRGB(
          0.83 + random(l.branch + p.seed) * 0.17,
          0.9 + random(l.size * 100 + p.seed) * 0.1,
          0.77 + random(l.at * 100) * 0.21,
        ),
      );
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
      leafCount++;
    }
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
    wood.count = woodCount;
    this.refreshWoodOutline(rec);
    wood.instanceMatrix.needsUpdate = true;
    wood.boundingSphere = new T.Sphere(new T.Vector3(0, 0.5, 0), 2.5);
    leaves.count = leafCount;
    if (rec.outline) rec.outline.count = leafCount;
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    leaves.boundingSphere = new T.Sphere(new T.Vector3(0, 0.5, 0), 2.5);
    rec.proxy.count = proxyCount;
    rec.proxy.instanceMatrix.needsUpdate = true;
    rec.proxy.boundingSphere = new T.Sphere(
      new T.Vector3(0, 0.5, 0),
      Math.max(3, 4 / Math.max(0.1, rec.height)),
    );
    rec.flowers.forEach((f, i) => {
      const branch = pose[Math.max(0, pose.length - 1 - i * 3)];
      f.position.set(branch.b.x * scale, branch.b.y * scale, branch.b.z * scale);
    });
    rec.poseTime = time;
    rec.pose = pose;
    rec.poseScale = scale;
    this.poseUpdates++;
  }
  updateRoots(rec) {
    if (rec.p.wild) return;
    const segments = rec.p.roots || [];
    if (rec.rootCount === segments.length) return;
    if (!rec.rootMesh) {
      rec.rootMesh = new T.InstancedMesh(
        rootGeometry,
        new T.MeshLambertMaterial({
          color: rec.sp.type === "weed" ? 0xb59a77 : 0xc4a17b,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
        }),
        1024,
      );
      rec.rootMesh.renderOrder = 3;
      rec.rootMesh.frustumCulled = false;
      this.scene.add(rec.rootMesh);
      this.rootAllocations++;
    }
    const dummy = new T.Object3D(),
      up = new T.Vector3(0, 1, 0);
    const startCount = rec.rootCount || 0;
    let count = startCount;
    for (let i = count; i < Math.min(1024, segments.length); i++) {
      const segment = segments[i],
        a = new T.Vector3(segment.a[0], segment.a[1], rec.p.z ?? 1),
        b = new T.Vector3(segment.b[0], segment.b[1], rec.p.z ?? 1),
        delta = b.clone().sub(a),
        radius = rootThickness({ ...segment, originX: rec.p.x }) * 1.85;
      dummy.position.copy(a).add(b).multiplyScalar(0.5);
      dummy.quaternion.setFromUnitVectors(up, delta.clone().normalize());
      dummy.scale.set(radius, delta.length(), radius);
      dummy.updateMatrix();
      rec.rootMesh.setMatrixAt(i, dummy.matrix);
      count++;
    }
    rec.rootCount = segments.length;
    rec.rootMesh.count = count;
    rec.rootMesh.instanceMatrix.addUpdateRange(
      startCount * 16,
      (count - startCount) * 16,
    );
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
        r.leaves.dispose();
        r.leaves.material.dispose();
        r.proxy.dispose();
        r.proxy.material.dispose();
        this.records.delete(id);
      }
    this.pickables = this.pickables.filter((m) => ids.has(m.userData.pid));
    this.canopies = this.canopies.filter((m) => ids.has(m.userData.pid));
    for (const p of [...this.wild, ...this.state.plants, ...this.state.weeds]) {
      const r = this.records.get(p.id) || this.addPlant(p);
      if (!p.wild || refreshWild) this.updateQueue.add(r);
    }
    this.updateSoil();
    this.syncMushrooms();
    this.updateGhosts();
    this.scene.updateMatrixWorld(true);
  }
  updateSoil() {
    const dummy = new T.Object3D(),
      color = new T.Color();
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const x = -HALF + (c + 0.5) * CW,
          y = -(r + 0.5) * CH,
          index = r * this.soilCols + Math.floor((x + 70) / CW),
          hsl = soilColorHSL(this.state.soil[r * COLS + c]);
        this.soilMesh.setColorAt(index, color.setHSL(hsl.h, hsl.s, hsl.l));
      }
    for (const [key, cell] of Object.entries(this.state.extraSoil || {})) {
      const [c, r] = key.split(":").map(Number),
        worldX = (c + 0.5) * CW,
        fieldCol = Math.floor((worldX + 70) / CW);
      if (
        r >= 0 &&
        r < this.soilRows &&
        fieldCol >= 0 &&
        fieldCol < this.soilCols && Math.abs(worldX) < HALF
      ) {
        const hsl = soilColorHSL(cell);
        this.soilMesh.setColorAt(
          r * this.soilCols + fieldCol,
          color.setHSL(hsl.h, hsl.s, hsl.l),
        );
      }
    }
    this.soilMesh.instanceColor.needsUpdate = true;
    for (let c = 0; c < COLS; c++) {
      const x = -HALF + (c + 0.5) * CW,
        top = this.state.soil[c],
        height = top.mulch * (0.08 + random(c) * 0.055);
      dummy.position.set(x, height * 0.5, 2.9);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(CW * 1.015, height, 0.35);
      dummy.updateMatrix();
      this.mulchMesh.setMatrixAt(c, dummy.matrix);
      const pond = this.state.surface[c];
      dummy.position.set(x, height + 0.02 + pond * 0.0009, 3.55);
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
        g.position.set(m.x, 0, 3.6);
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
      const sp = getSpecies(p.sid),
        h = sp.height,
        recipe = makeArchitecture(sp, p.seed),
        pose = poseArchitecture(recipe, 1.5),
        scale = h / Math.max(...pose.map((n) => n.b.y)),
        g = new T.Group();
      g.position.set(p.x, 0, -0.6);
      g.userData.pid = p.id;
      group.add(g);
      const points = [];
      for (const n of pose)
        points.push(
          n.a.x * scale,
          n.a.y * scale,
          n.a.z * scale,
          n.b.x * scale,
          n.b.y * scale,
          n.b.z * scale,
        );
      const leaves = new T.InstancedMesh(
          leafGeometry,
          new T.MeshBasicMaterial({
            color: sp.color,
            map: stamp(sp).texture,
            alphaTest: 0.4,
            transparent: true,
            opacity: 0.16,
            side: T.DoubleSide,
            depthWrite: false,
          }),
          recipe.leaves.length,
        ),
        d = new T.Object3D();
      recipe.leaves.forEach((l, i) => {
        const a = leafAttachment(l, pose);
        points.push(
          a.base.x * scale,
          a.base.y * scale,
          a.base.z * scale,
          a.tip.x * scale,
          a.tip.y * scale,
          a.tip.z * scale,
        );
        d.position.set(a.tip.x * scale, a.tip.y * scale, a.tip.z * scale);
        d.rotation.set(l.tilt || 0, l.roll || 0, -a.angle, "ZYX");
        d.scale.set(0.32 * l.size, 0.45 * l.size, 1);
        d.updateMatrix();
        leaves.setMatrixAt(i, d.matrix);
      });
      const geometry = new T.BufferGeometry();
      geometry.setAttribute(
        "position",
        new T.Float32BufferAttribute(points, 3),
      );
      g.add(
        new T.LineSegments(
          geometry,
          new T.LineBasicMaterial({
            color: 0x456243,
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
          }),
        ),
        leaves,
      );
    }
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
            (rec.p.z ?? 1) + n.a.z * rec.poseScale * rec.height,
          ),
          b = this.project(
            rec.p.x + n.b.x * rec.poseScale * rec.height,
            n.b.y * rec.poseScale * rec.height,
            (rec.p.z ?? 1) + n.b.z * rec.poseScale * rec.height,
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
    if (this.hover && this.records.has(this.hover.id)) {
      const old = this.records.get(this.hover.id);
      if (old.outline) old.outline.visible = false;
      if (old.woodOutline) old.woodOutline.visible = false;
    }
    this.hover = p;
    const rec = p && this.records.get(p.id);
    if (!rec) return;
    if (!rec.outline) {
      const outlineMaterial = new T.ShaderMaterial({
        uniforms: { leafMap: {value: stamp(rec.sp).texture} },
        vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
        fragmentShader: `uniform sampler2D leafMap; varying vec2 vUv;
          void main(){float a=texture2D(leafMap,vUv).a; float edge=0.0;
          for(int i=0;i<8;i++){float angle=float(i)*0.785398;
          edge=max(edge,texture2D(leafMap,vUv+vec2(cos(angle),sin(angle))*0.025).a);}
          if(a>0.5 || edge<0.5) discard; gl_FragColor=vec4(1.0,0.94,0.68,1.0);}`,
        side:T.DoubleSide, transparent:true, depthWrite:false, depthTest:false,
      });
      rec.outline = new T.InstancedMesh(leafGeometry, outlineMaterial, rec.leaves.instanceMatrix.count);
      rec.outline.instanceMatrix = rec.leaves.instanceMatrix;
      rec.outline.renderOrder = 12;
      rec.outline.frustumCulled = false;
      rec.g.add(rec.outline);
    }
    if (!rec.woodOutline) {
      rec.woodOutline = new T.InstancedMesh(taperedGeometry,
        new T.MeshBasicMaterial({color:0xffefad, side:T.BackSide}), rec.wood.instanceMatrix.count);
      rec.woodOutline.frustumCulled = false;
      rec.g.add(rec.woodOutline);
    }
    this.refreshWoodOutline(rec);
    rec.woodOutline.visible = true;
    rec.outline.count = rec.leaves.count;
    rec.outline.visible = true;
  }
  refreshWoodOutline(rec) {
    if (!rec.woodOutline) return;
    const matrix = new T.Matrix4(), pos = new T.Vector3(), rot = new T.Quaternion(), scale = new T.Vector3();
    for (let i=0; i<rec.wood.count; i++) {
      rec.wood.getMatrixAt(i, matrix);
      matrix.decompose(pos,rot,scale);
      scale.x *= 1.3; scale.z *= 1.3; scale.y *= 1.01;
      matrix.compose(pos,rot,scale);
      rec.woodOutline.setMatrixAt(i,matrix);
    }
    rec.woodOutline.count = rec.wood.count;
    rec.woodOutline.instanceMatrix.needsUpdate = true;
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
    this.farmer.position.z = 1.8;
    this.farmerX = 0;
    this.target = 0;
    box(this.farmer, 0, 1.02, 0, 0.44, 0.6, 0.28, 0x618052);
    const head = new T.Group();
    head.position.y = 1.55;
    this.farmer.add(head);
    box(head, 0, 0, 0, 0.4, 0.4, 0.4, 0xd3ae86);
    box(head, -0.085, 0.035, 0.21, 0.045, 0.045, 0.015, 0x3a4031);
    box(head, 0.085, 0.035, 0.21, 0.045, 0.045, 0.015, 0x3a4031);
    box(head, 0, 0.24, 0, 0.58, 0.09, 0.5, 0xd5ba76);
    box(head, 0, 0.33, 0, 0.37, 0.12, 0.35, 0xbda16c);
    this.legs = [];
    this.arms = [];
    for (const side of [-1, 1]) {
      const leg = new T.Group();
      leg.position.set(side * 0.12, 0.72, 0);
      this.farmer.add(leg);
      box(leg, 0, -0.3, 0, 0.18, 0.6, 0.22, 0x40594b);
      box(leg, 0, -0.665, 0.04, 0.2, 0.11, 0.3, 0x554c38);
      this.legs.push(leg);
      const arm = new T.Group();
      arm.position.set(side * 0.3, 1.27, 0);
      this.farmer.add(arm);
      box(arm, 0, -0.26, 0, 0.15, 0.52, 0.2, 0xd3ae86);
      this.arms.push(arm);
    }
    for (let i = 0; i < 8; i++)
      box(
        this.farmer,
        (random(i) - 0.5) * 0.35,
        0.85 + random(i + 1) * 0.4,
        0.148,
        0.06,
        0.06,
        0.01,
        0x7e9867,
      );
  }
  makeTools() {
    this.toolRoot = new T.Group();
    this.scene.add(this.toolRoot);
    this.bag = new T.Group();
    this.can = new T.Group();
    this.toolRoot.add(this.bag, this.can);
    this.toolRoot.scale.setScalar(1.6);
    box(this.bag, 0, 0.25, 0, 0.7, 0.9, 0.35, 0xcfab67);
    box(this.bag, 0, 0.74, 0, 0.6, 0.12, 0.36, 0xa58048);
    box(this.bag, 0, 0.25, 0.19, 0.45, 0.33, 0.02, 0x567246);
    box(this.can, 0, 0.25, 0, 0.65, 0.6, 0.4, 0x568d86);
    const spout = box(this.can, 0.55, 0.15, 0, 0.6, 0.13, 0.15, 0x568d86);
    spout.rotation.z = 0.35;
    box(this.can, 0.85, 0.25, 0, 0.12, 0.24, 0.18, 0x648e88);
    box(this.can, -0.44, 0.45, 0, 0.1, 0.6, 0.1, 0x568d86);
    box(this.can, -0.28, 0.75, 0, 0.38, 0.09, 0.1, 0x568d86);
    this.toolRoot.position.z = 8;
  }
  makeFauna() {
    this.insects = [];
    for (let i = 0; i < 10; i++) {
      const g = new T.Group();
      this.scene.add(g);
      box(g, 0, 0, 0, 0.23, 0.17, 0.18, i < 7 ? 0xe6b44a : 0x9a6b98);
      if (i < 7) box(g, 0.02, 0, 0.07, 0.045, 0.12, 0.02, 0x403d30);
      const wing = box(
        g,
        0,
        0.08,
        0,
        i < 7 ? 0.34 : 0.38,
        0.04,
        0.1,
        i < 7 ? 0xf2efd8 : 0xc9a3cf,
      );
      this.insects.push({ g, wing, i });
    }
  }
  spawn(kind, x, y, count = 5) {
    for (let i = 0; i < count; i++) {
      const mesh = box(
        this.scene,
        x + (random(this.time + i) - 0.5) * 0.25,
        y + random(i) * 0.2,
        3.2,
        kind === "water" ? 0.045 : 0.1,
        kind === "water" ? 0.16 : 0.035,
        0.035,
        kind === "water" ? 0x69bce7 : 0xc79a56,
      );
      this.effects.push({
        mesh,
        vx: (random(i + this.time) - 0.5) * 0.6,
        vy: kind === "water" ? -3 : 1 + random(i),
        kind,
        life: kind === "leaf" ? 15 : 3,
      });
    }
  }
  uproot(p) {
    const r = this.records.get(p.id);
    if (!r) return;
    this.highlight(null);
    const clone = r.group.clone(true);
    clone.position.z = 6;
    this.scene.add(clone);
    const roots = new T.Group();
    clone.add(roots);
    for (let i = 0; i < 3; i++)
      branch(roots, 0, 0, (i - 1) * 0.15, -0.35, 0.018, 0xc0b07e);
    this.effects.push({
      mesh: clone,
      kind: "weed",
      vx: 0.3,
      vy: 2.5,
      life: 45,
      settled: false,
    });
  }
  render(dt, time, tool, pointer, applying) {
    this.time = time;
    this.toolRoot.visible = !!tool;
    this.bag.visible = tool === "mulch";
    this.can.visible = tool === "water";
    if (tool) {
      const p = this.worldPoint(pointer.x, pointer.y, 3.2);
      this.toolRoot.position.set(
        p.x - (tool === "water" ? 1.25 : 0.15),
        Math.max(0.7, p.y + 0.7),
        3.2,
      );
      this.toolRoot.rotation.z = applying
        ? tool === "water"
          ? -0.25
          : 0.6
        : 0;
    }
    const delta = this.target - this.farmerX,
      moving = Math.abs(delta) > 0.04;
    this.farmerX += Math.sign(delta) * Math.min(Math.abs(delta), dt * 2.8);
    this.farmer.position.x = this.farmerX;
    this.legs.forEach(
      (g, i) =>
        (g.rotation.z = moving ? Math.sin(time * 9 + i * Math.PI) * 0.22 : 0),
    );
    this.arms.forEach(
      (g, i) =>
        (g.rotation.z = moving ? Math.sin(time * 9 + i * Math.PI) * -0.35 : 0),
    );
    this.drainUpdates();
    this.wind = Math.sin(time * 0.72) * 0.008 + Math.sin(time * 0.23) * 0.004;
    for (const r of this.records.values()) {
      r.g.rotation.z =
        -(r.sunLean || 0) +
        this.wind * (0.85 + Math.min(1, r.height / 20) * 0.15);
      if (!r.p.planted && (r.p.drop || 0) > 0) {
        r.p.drop = Math.max(0, r.p.drop - dt * 8);
        r.group.position.y = r.p.drop;
      }
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      if (e.settled) {
        if (e.life <= 0) { this.scene.remove(e.mesh); this.effects.splice(i, 1); }
        else e.mesh.scale.setScalar(Math.min(1, e.life / 10));
        continue;
      }
      e.vy -= dt * (e.kind === "water" ? 5 : 4);
      e.mesh.position.x += e.vx * dt;
      e.mesh.position.y += e.vy * dt;
      if (e.kind === "weed") e.mesh.rotation.z += dt * 2;
      else e.mesh.rotation.z += dt;
      if (e.mesh.position.y <= 0.04) {
        if (e.kind === "water" && Math.abs(e.mesh.position.x) < HALF)
          this.pendingWater.push(e.mesh.position.x);
        if (e.kind === "mulch" && Math.abs(e.mesh.position.x) < HALF)
          this.pendingMulch.push(e.mesh.position.x);
        if (e.kind === "weed" && e.life > 0) {
          e.mesh.position.y = 0.04;
          e.vy = 0;
          e.vx = 0;
          e.mesh.rotation.z = 1.45;
          e.settled = true;
          e.mesh.position.y = 0.08;
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
    this.insects.forEach(({ g, wing, i }) => {
      g.visible = flowering.length > 0;
      if (g.visible) {
        const flight = g.userData;
        if (!flight.target || time >= flight.nextTurn) {
          const r = flowering[Math.floor(random(i * 71 + time * 3) * flowering.length)];
          const flowers = r.flowers.filter(f => f.visible);
          const flower = flowers[Math.floor(random(time + i * 19) * flowers.length)];
          flight.target = new T.Vector3();
          flower.getWorldPosition(flight.target);
          // Alternate flower visits with unpredictable nearby exploration.
          if (random(time + i * 43) < 0.65) {
            flight.target.x += (random(time * 7 + i) - 0.5) * 4;
            flight.target.y += random(time * 11 + i) * 2.5;
            flight.target.z += (random(time * 13 + i) - 0.5) * 3;
          }
          flight.nextTurn = time + 0.8 + random(time + i) * 2.8;
        }
        if (!flight.arrived) { g.position.copy(flight.target); flight.arrived = true; }
        const target = flight.target.clone();
        target.x += Math.sin(time * 3.7 + i) * 0.2;
        target.y += 0.2 + Math.sin(time * 4.3 + i * 3) * 0.18;
        g.position.lerp(target, 1 - Math.exp(-dt * 1.6));
        wing.rotation.z = Math.sin(time * 45 + i) * 0.8;
      }
    });
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
