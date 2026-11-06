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
} from "./ecology.js";
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
  c.strokeStyle = "#9db58a";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(64, 127);
  c.lineTo(64, 13);
  c.stroke();
  if (sp.id === "cinnamon") {
    for (const side of [-1, 1]) {
      c.beginPath();
      c.moveTo(64, 112);
      c.quadraticCurveTo(64 + side * 29, 74, 64 + side * 11, 24);
      c.stroke();
    }
  } else
    for (let j = 0; j < 5; j++) {
      const y = 30 + j * 15;
      c.beginPath();
      c.moveTo(64, y + 13);
      c.lineTo(38, y);
      c.moveTo(64, y + 13);
      c.lineTo(89, y);
      c.stroke();
    }
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
    this.camera = new T.OrthographicCamera(-30, 30, 25, -8, 0.1, 180);
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
    box(this.ground, 0, -60, -1, 180, 120, 6, 0x765034);

    box(this.ground, 0, -0.045, -1, 180, 0.09, 6, 0x5f462c);
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
    this.soilMesh = new T.InstancedMesh(
      boxGeometry,
      new T.MeshBasicMaterial({
        color: 0x5a3d29,
        wireframe: true,
        transparent: true,
        opacity: 0.16,
      }),
      COLS * ROWS,
    );
    this.scene.add(this.soilMesh);
    const dummy = new T.Object3D();
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        dummy.position.set(-HALF + (c + 0.5) * CW, -(r + 0.5) * CH, 3);
        dummy.scale.set(CW * 0.96, CH * 0.96, 0.045);
        dummy.updateMatrix();
        this.soilMesh.setMatrixAt(r * COLS + c, dummy.matrix);
      }
    this.soilMesh.instanceMatrix.needsUpdate = true;
    this.mulchMesh = new T.InstancedMesh(
      boxGeometry,
      material(0xc79c58),
      COLS * 5,
    );
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
    const aspect = this.element.clientWidth / this.element.clientHeight;
    const half = Math.max(13, (aspect < 0.8 ? 15 : 24) / aspect) / this.zoom;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.position.x = this.center.x;
    this.camera.position.y = this.center.y;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
  pan(dx, dy) {
    const scale =
      (this.camera.right - this.camera.left) / this.element.clientWidth;
    this.center.x = clamp(this.center.x - dx * scale, -53, 53);
    this.center.y = clamp(this.center.y + dy * scale, -4, 24);
    this.projection();
  }
  zoomAt(factor, sx, sy) {
    const before = this.worldPoint(sx, sy);
    this.zoom = clamp(this.zoom * factor, 0.6, 3.4);
    this.projection();
    const after = this.worldPoint(sx, sy);
    this.center.x = clamp(this.center.x + before.x - after.x, -53, 53);
    this.center.y = clamp(this.center.y + before.y - after.y, -4, 24);
    this.projection();
  }
  plot() {
    this.center = { x: 0, y: this.state.phase === 0 ? 8 : 4.2 };
    this.zoom = this.state.phase === 0 ? 0.92 : 1.25;
    this.projection();
  }
  worldPoint(x, y) {
    const r = this.element.getBoundingClientRect();
    return new T.Vector3(
      ((x - r.left) / r.width) * 2 - 1,
      (-(y - r.top) / r.height) * 2 + 1,
      0,
    ).unproject(this.camera);
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
      boxGeometry,
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
      data.length,
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
          0.04,
          0.04,
          0.018,
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
    g.scale.set(h, h, 1);
    rec.maturity = p.wild ? 1.5 : 0.12 + 0.88 * Math.sqrt(clamp(h / sp.height));
    rec.winter =
      sp.deciduous &&
      p.age > 1 &&
      Math.floor((this.state.day % 365) / 91.25) === 3;
    this.posePlant(rec, this.time || 0);
    let color = new T.Color(sp.color);
    if (health < 65) color.lerp(new T.Color(0xb8a454), (65 - health) / 65);
    if (sp.deciduous && Math.floor((this.state.day % 365) / 91.25) === 2)
      color.lerp(new T.Color(0xb77c35), 0.7);
    leaves.material.color.copy(color);
    rec.flowers.forEach(
      (f) =>
        (f.visible =
          h > sp.height * 0.2 &&
          health > 55 &&
          (this.state.day % 365 < 145 ||
            (sp.id === "camellia" && this.state.day % 365 > 285))),
    );
    if (!p.wild && p.planted) {
      const left = this.exposure(p.x - 0.5, h * 0.85, p.id).light,
        right = this.exposure(p.x + 0.5, h * 0.85, p.id).light;
      rec.sunLean = (rec.sunLean || 0) * 0.96 + (right - left) * 0.005;
    }
    this.updateRoots(rec);
  }
  posePlant(rec, time) {
    const { p, sp, leaves, wood } = rec,
      pose = poseArchitecture(rec.recipe, rec.maturity, time),
      dummy = new T.Object3D();
    const maxY = Math.max(0.01, ...pose.map((n) => n.b.y)),
      scale = 1 / maxY;
    let woodCount = 0,
      leafCount = 0;
    const drawSegment = (a, b, width) => {
      const dx = (b.x - a.x) * scale,
        dy = (b.y - a.y) * scale;
      if (Math.hypot(dx, dy) < 0.00001) return;
      dummy.position.set(
        (a.x + b.x) * 0.5 * scale,
        (a.y + b.y) * 0.5 * scale,
        0.02,
      );
      dummy.rotation.set(0, 0, -Math.atan2(dx, dy));
      dummy.scale.set(width, Math.hypot(dx, dy), width);
      dummy.updateMatrix();
      wood.setMatrixAt(woodCount++, dummy.matrix);
    };
    pose.forEach((n, i) => drawSegment(n.a, n.b, rec.recipe.nodes[i].width));
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
      drawSegment(attachment.base, attachment.tip, 0.0025);
      const size =
        clamp(0.43 / Math.max(0.1, rec.height), 0.024, 0.24) *
        (sp.leaf === "small" ? 0.72 : 1) *
        l.size *
        clamp((segment.growth - 0.15) / 0.85);
      dummy.position.set(
        attachment.tip.x * scale,
        attachment.tip.y * scale,
        0.02,
      );
      dummy.rotation.set(0, 0, -attachment.angle);
      dummy.scale.set(
        size * (sp.leaf === "long" ? 0.7 : 1),
        size * (sp.leaf === "long" ? 1.5 : 1.1),
        1,
      );
      dummy.updateMatrix();
      leaves.setMatrixAt(leafCount, dummy.matrix);
      // Box proxies are centered halfway along the blade, using the same attachment.
      const bladeHeight = dummy.scale.y;
      dummy.position.x += Math.sin(attachment.angle) * bladeHeight * 0.5;
      dummy.position.y += Math.cos(attachment.angle) * bladeHeight * 0.5;
      dummy.scale.z = 6;
      dummy.updateMatrix();
      rec.proxy.setMatrixAt(leafCount++, dummy.matrix);
    }
    wood.count = woodCount;
    wood.instanceMatrix.needsUpdate = true;
    wood.computeBoundingSphere();
    leaves.count = leafCount;
    leaves.instanceMatrix.needsUpdate = true;
    leaves.computeBoundingSphere();
    rec.proxy.count = leafCount;
    rec.proxy.instanceMatrix.needsUpdate = true;
    rec.proxy.computeBoundingSphere();
    rec.flowers.forEach((f, i) => {
      const branch = pose[Math.max(0, pose.length - 1 - i * 3)];
      f.position.set(branch.b.x * scale, branch.b.y * scale, 0.15);
    });
    rec.poseTime = time;
  }
  updateRoots(rec) {
    const segments = rec.p.roots || [];
    if (rec.rootCount === segments.length) return;
    rec.rootCount = segments.length;
    const positions = [];
    for (const s of segments)
      positions.push(s.a[0], s.a[1], 3.3, s.b[0], s.b[1], 3.3);
    if (rec.rootMesh) {
      this.scene.remove(rec.rootMesh);
      rec.rootMesh.geometry.dispose();
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(positions, 3),
    );
    rec.rootMesh = new T.LineSegments(
      geometry,
      new T.LineBasicMaterial({
        color: rec.sp.type === "weed" ? 0xa4b273 : 0xe0bf83,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.scene.add(rec.rootMesh);
  }
  sync(force = false) {
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
          r.rootMesh.geometry.dispose();
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
      if (force || !p.wild) this.updatePlant(r);
    }
    this.updateSoil();
    this.syncMushrooms();
    this.updateGhosts();
    this.scene.updateMatrixWorld(true);
    this.samples.clear();
    this.rainHits.clear();
  }
  updateSoil() {
    const dummy = new T.Object3D();
    let count = 0;
    for (let c = 0; c < COLS; c++) {
      const x = -HALF + (c + 0.5) * CW,
        top = this.state.soil[c];
      for (let k = 0; k < 5; k++) {
        dummy.position.set(
          x + (random(c * 5 + k) - 0.5) * CW,
          0.03 + random(k) * 0.07,
          3.5,
        );
        dummy.rotation.set(0, 0, random(k + c) * 1.2);
        dummy.scale.set(0.09 * top.mulch, 0.025 * top.mulch, 0.06);
        dummy.updateMatrix();
        this.mulchMesh.setMatrixAt(count++, dummy.matrix);
      }
      const pond = this.state.surface[c];
      dummy.position.set(x, 0.02 + pond * 0.0009, 3.55);
      dummy.rotation.set(0, 0, 0);
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
          0,
          n.b.x * scale,
          n.b.y * scale,
          0,
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
          0.02,
          a.tip.x * scale,
          a.tip.y * scale,
          0.02,
        );
        d.position.set(a.tip.x * scale, a.tip.y * scale, 0.02);
        d.rotation.z = -a.angle;
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
  hit(x, y, tolerance = 3) {
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
      const point = this.project(rec.p.x, Math.min(rec.height * 0.5, 0.6));
      const d = Math.hypot(point.x - x, point.y - y);
      if (d < distance) {
        closest = rec.p;
        distance = d;
      }
    }
    return closest;
  }
  highlight(p) {
    if (this.hover && this.records.has(this.hover.id))
      this.records.get(this.hover.id).leaves.material.emissive.setHex(0);
    this.hover = p;
    if (p && this.records.has(p.id))
      this.records.get(p.id).leaves.material.emissive.setHex(0x4a5021);
  }
  exposure(x, y, self = null) {
    const key =
      (self || "c" + colAt(x)) +
      ":" +
      Math.round(x * 2) +
      ":" +
      Math.round(y * 2);
    if (this.samples.has(key)) return this.samples.get(key);
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
    this.samples.set(key, result);
    return result;
  }
  makeFarmer() {
    this.farmer = new T.Group();
    this.scene.add(this.farmer);
    this.farmer.position.z = 5;
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
      box(g, 0, 0, 0, 0.15, 0.11, 0.12, i < 7 ? 0xe6b44a : 0x9a6b98);
      if (i < 7) box(g, 0.02, 0, 0.07, 0.045, 0.12, 0.02, 0x403d30);
      const wing = box(
        g,
        0,
        0.08,
        0,
        i < 7 ? 0.23 : 0.32,
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
        7,
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
      life: 1.5,
    });
  }
  render(dt, time, tool, pointer, applying) {
    this.time = time;
    this.toolRoot.visible = !!tool;
    this.bag.visible = tool === "mulch";
    this.can.visible = tool === "water";
    if (tool) {
      const p = this.worldPoint(pointer.x, pointer.y);
      this.toolRoot.position.set(
        p.x - (tool === "water" ? 1.25 : 0.15),
        Math.max(0.7, p.y + 0.7),
        8,
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
    for (const r of this.records.values()) {
      r.g.rotation.z =
        -(r.sunLean || 0) + Math.sin(time * 0.8 + r.p.seed) * 0.007;
      if (time - (r.poseTime || 0) > 0.09) this.posePlant(r, time);
      if (!r.p.planted && (r.p.drop || 0) > 0) {
        r.p.drop = Math.max(0, r.p.drop - dt * 8);
        r.group.position.y = r.p.drop;
      }
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
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
          e.life = Math.min(e.life, 0.8);
        } else e.life = 0;
      }
      if (e.life <= 0) {
        this.scene.remove(e.mesh);
        this.effects.splice(i, 1);
      }
    }
    const flowering = [...this.records.values()].filter(
      (r) => !r.p.wild && r.flowers.some((f) => f.visible),
    );
    this.insects.forEach(({ g, wing, i }) => {
      g.visible = flowering.length > 0 && this.state.phase >= 4;
      if (g.visible) {
        const r = flowering[Math.floor(time / 6 + i) % flowering.length];
        g.position.set(
          r.p.x + Math.sin(time + i) * 0.8,
          r.height * 0.65 + Math.cos(time * 1.2 + i) * 0.3,
          5,
        );
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
      for (let i = 0; i < 90; i++) {
        const x = this.center.x + (random(i + 12) - 0.5) * 60,
          y = 30 - ((time * 12 + i * 0.63) % 30);
        let stop = this.rainHits.get(Math.round(x * 2));
        if (stop === undefined) {
          stop = 0;
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
          this.rainHits.set(Math.round(x * 2), stop);
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
  }
}
