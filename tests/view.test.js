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
