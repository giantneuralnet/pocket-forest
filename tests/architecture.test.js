import test from "node:test";
import assert from "node:assert/strict";
import {
  makeArchitecture,
  poseArchitecture,
  leafAttachment,
} from "../dist/architecture.js";
import {
  getSpecies,
  freshState,
  growRoots,
  COLS,
  ROWS,
} from "../dist/ecology.js";
test("each growing branch stays attached to its parent segment, including in wind", () => {
  const recipe = makeArchitecture(getSpecies("oak"), 42);
  for (const time of [0, 1, 7])
    for (const maturity of [0.24, 0.5, 1.5]) {
      const pose = poseArchitecture(recipe, maturity, time);
      pose.forEach((p, i) => {
        const node = recipe.nodes[i];
        if (node.parent < 0) return;
        const parent = pose[node.parent];
        assert.ok(
          Math.abs(p.a.x - (parent.a.x + (parent.b.x - parent.a.x) * node.at)) <
            1e-12,
        );
        assert.ok(
          Math.abs(p.a.y - (parent.a.y + (parent.b.y - parent.a.y) * node.at)) <
            1e-12,
        );
      });
    }
});
test("every leaf has a petiole anchored to an actual branch", () => {
  const recipe = makeArchitecture(getSpecies("oak"), 42),
    pose = poseArchitecture(recipe, 1.5);
  for (const leaf of recipe.leaves) {
    const a = leafAttachment(leaf, pose),
      p = pose[leaf.branch];
    assert.ok(Math.abs(a.base.x - (p.a.x + (p.b.x - p.a.x) * leaf.at)) < 1e-12);
    assert.ok(
      Math.abs(
        Math.hypot(a.tip.x - a.base.x, a.tip.y - a.base.y) - leaf.petiole,
      ) < 1e-12,
    );
  }
});
test("branching varies by seed and unfolds progressively with growth", () => {
  const a = makeArchitecture(getSpecies("oak"), 42),
    b = makeArchitecture(getSpecies("oak"), 43);
  assert.notDeepEqual(a.nodes, b.nodes);
  const young = poseArchitecture(a, 0.25).filter((n) => n.growth > 0.1).length,
    adult = poseArchitecture(a, 1.5).filter((n) => n.growth > 0.1).length;
  assert.ok(adult > young * 2);
  assert.ok(a.nodes.some((n) => n.depth === 2));
});
test("root tips vary their headings and fork while retaining old segments", () => {
  const s = freshState(),
    p = { x: 0, seed: 42, roots: [], tips: [] };
  for (let day = 0; day < 90; day += 3) {
    s.day = day;
    growRoots(s, p);
  }
  assert.ok(p.tips.length > 2);
  const directions = new Set(
    p.roots.map((r) =>
      Math.round(Math.atan2(r.b[0] - r.a[0], r.a[1] - r.b[1]) * 10),
    ),
  );
  assert.ok(directions.size > 5);
});
test("new root tips favor the wetter neighboring soil", () => {
  const s = freshState();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      s.soil[r * COLS + c].m = c < COLS / 2 ? 5 : 95;
  const p = {
    x: 0,
    seed: 8,
    roots: [],
    tips: [{ x: 0, y: -0.1, angle: 0, dir: 1, age: 0 }],
  };
  growRoots(s, p);
  assert.ok(p.roots[0].b[0] > 0);
});

test('branch extension stays continuous while new branches emerge',()=>{const recipe=makeArchitecture(getSpecies('oak'),42);for(let maturity=.05;maturity<1;maturity+=.013){const a=poseArchitecture(recipe,maturity),b=poseArchitecture(recipe,maturity+.0001);for(let i=0;i<a.length;i++)assert.ok(Math.hypot(a[i].b.x-b[i].b.x,a[i].b.y-b[i].b.y)<.01);}});
