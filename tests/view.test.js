import test from "node:test";
import assert from "node:assert/strict";
import * as T from "../dist/vendor/three.module.js";
import { ForestView } from "../dist/forest-view.js";
function cameraView() {
  const v = Object.create(ForestView.prototype);
  v.element = {
    clientWidth: 1000,
    clientHeight: 700,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 700,
    }),
  };
  v.camera = new T.OrthographicCamera(-30, 30, 20, -10, 0.1, 180);
  v.camera.position.set(0, 0, 65);
  v.center = { x: 0, y: 6 };
  v.zoom = 1;
  v.state = { day: 0 };
  v.projection();
  return v;
}
test("pinch zoom anchors the world point under the gesture center", () => {
  const v = cameraView(),
    before = v.worldPoint(650, 400);
  v.zoomAt(1.7, 650, 400);
  const after = v.worldPoint(650, 400);
  assert.ok(Math.abs(before.x - after.x) < 1e-6);
  assert.ok(Math.abs(before.y - after.y) < 1e-6);
});
test("two-axis panning moves the view horizontally and vertically", () => {
  const v = cameraView();
  v.pan(80, 100);
  assert.ok(v.center.x < 0);
  assert.ok(v.center.y > 6);
});
test("rain and sun raycasts detect an overstory canopy", () => {
  const v = cameraView();
  v.samples = new Map();
  const canopy = new T.Mesh(
    new T.BoxGeometry(3, 0.4, 6),
    new T.MeshBasicMaterial(),
  );
  canopy.position.set(0, 4, 0);
  canopy.userData = { pid: "tree", canopy: true };
  canopy.updateMatrixWorld(true);
  v.canopies = [canopy];
  v.records = new Map([
    [
      "tree",
      { p: { id: "tree", x: 0, planted: true, health: 100 }, height: 6 },
    ],
  ]);
  v.ray = new T.Raycaster();
  const shaded = v.exposure(0, 0, null),
    open = v.exposure(8, 0, null);
  assert.ok(shaded.light < open.light);
  assert.ok(shaded.rain < open.rain);
});

test("perspective zoom keeps the gesture anchor aligned with the planting plane", () => {
  const v = cameraView();
  v.camera = new T.PerspectiveCamera(40, 1000 / 700, 0.1, 240);
  v.projection();
  const before = v.worldPoint(650, 400);
  v.zoomAt(2.3, 650, 400);
  const after = v.worldPoint(650, 400);
  assert.ok(Math.abs(before.x - after.x) < 1e-6);
  assert.ok(Math.abs(before.y - after.y) < 1e-6);
  assert.ok(v.camera.isPerspectiveCamera);
});

test("new root growth reuses its GPU buffer and preserves old instance matrices", () => {
  const v = Object.create(ForestView.prototype);
  v.scene = new T.Scene();
  v.rootAllocations = 0;
  const rec = {
    p: { x: 0, z: 1, roots: [{ a: [0, 0], b: [0.1, -0.2], radiusA: 0.06 }] },
    sp: { type: "tree" },
  };
  v.updateRoots(rec);
  const mesh = rec.rootMesh,
    first = new T.Matrix4();
  mesh.getMatrixAt(0, first);
  rec.p.roots.push({ a: [0.1, -0.2], b: [0.12, -0.3], radiusA: 0.04 });
  v.updateRoots(rec);
  const after = new T.Matrix4();
  mesh.getMatrixAt(0, after);
  assert.equal(rec.rootMesh, mesh);
  assert.equal(v.rootAllocations, 1);
  assert.deepEqual(first.elements, after.elements);
  assert.equal(mesh.count, 2);
  assert.ok(
    mesh.geometry.parameters.radiusTop < mesh.geometry.parameters.radiusBottom,
  );
});


test("existing roots widen with the trunk without moving their centers", () => {
  const v = Object.create(ForestView.prototype);
  v.scene = new T.Scene();
  v.rootAllocations = 0;
  const rec = {
    p: { x: 0, roots: [{ a: [0, 0], b: [0.1, -0.2], radiusA: 0.06 }] },
    sp: { type: "tree" },
    trunkRadius: 0.05,
  };
  v.updateRoots(rec);
  const mesh = rec.rootMesh;
  const matrix = new T.Matrix4();
  mesh.getMatrixAt(0, matrix);
  const center = new T.Vector3().setFromMatrixPosition(matrix);
  const original = new T.Vector3().setFromMatrixScale(matrix);
  assert.ok(original.x < rec.trunkRadius);
  rec.trunkRadius *= 2;
  v.updateRoots(rec);
  mesh.getMatrixAt(0, matrix);
  const wider = new T.Vector3().setFromMatrixScale(matrix);
  assert.equal(rec.rootMesh, mesh);
  assert.deepEqual(new T.Vector3().setFromMatrixPosition(matrix), center);
  assert.ok(Math.abs(wider.x / original.x - 2) < 1e-6);
  assert.ok(original.y > Math.hypot(0.1, 0.2));
  assert.ok(wider.y > original.y);
});

test("a falling leaf keeps its blade dimensions and deposits litter only on impact", async () => {
  const { freshState, returnLeafToSoil, cellAt } = await import("../dist/ecology.js");
  const v = Object.create(ForestView.prototype);
  v.scene = new T.Scene();
  v.wind = 0;
  v.sheddingPlants = new Set();
  v.landedLeaves = [];
  v.leafTransform = new T.Object3D();
  const blade = {
    position: new T.Vector3(2.1, 0.4, 1),
    rotation: new T.Quaternion(),
    size: new T.Vector3(0.24, 0.31, 1),
    tint: new T.Color(0xbb7946),
    time: 0, landed: null, phase: 0,
  };
  const batch = { material: new T.MeshLambertMaterial(), leaves: [blade], mesh: null };
  v.fallingLeaves = new Map([["hackberry", batch]]);
  v.animateLeaves(0.05, 0.05);
  assert.equal(v.landedLeaves.length, 0);
  const matrix = new T.Matrix4();
  batch.mesh.getMatrixAt(0, matrix);
  const size = new T.Vector3().setFromMatrixScale(matrix);
  assert.ok(Math.abs(size.x - blade.size.x) < 1e-6 && Math.abs(size.y - blade.size.y) < 1e-6);
  for (let i = 2; i <= 18; i++) v.animateLeaves(0.05, i * 0.05);
  assert.equal(v.landedLeaves.length, 1);
  const s = freshState();
  const { x, area } = v.landedLeaves[0];
  const before = cellAt(s, x).n;
  returnLeafToSoil(s, x, area);
  assert.ok(cellAt(s, x).litter > 0 && cellAt(s, x).n > before);
  assert.equal(cellAt(s, 0).litter, 0);
});
