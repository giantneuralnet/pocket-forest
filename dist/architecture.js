import { clamp, random } from "./ecology.js";
// Seeded, parent-linked skeleton. Every twig and petiole has a physical attachment.
export function makeArchitecture(sp, seed) {
  const nodes = [],
    leaves = [];
  let serial = 0;
  function node(parent, at, length, angle, birth, width, depth) {
    const n = {
      parent,
      at,
      length,
      angle,
      birth,
      duration: 0.13 + random(seed + serial) * 0.14,
      width:
        parent >= 0 && depth > 0
          ? Math.min(width, nodes[parent].width * 0.65)
          : width,
      depth,
      depthAngle: depth ? (random(seed + serial * 43) - 0.5) * 2.4 : (random(seed + serial * 31) - 0.5) * 0.12,
      seed: seed + serial++ * 17,
    };
    nodes.push(n);
    return nodes.length - 1;
  }
  function foliage(index, count = 3) {
    count = Math.ceil(count * 1.25);
    for (let i = 0; i < count; i++) {
      const s = random(seed + index * 11 + i),
        side = i % 2 ? 1 : -1;
      leaves.push({
        branch: index,
        at: 0.3 + ((i + 0.3) / count) * 0.68,
        angle: side * (0.55 + s * 0.65),
        tilt: (random(seed + index * 29 + i * 7) - 0.5) * 1.7,
        roll: (random(seed + index * 13 + i * 23) - 0.5) * 1.3,
        petiole: 0.012 + s * 0.014,
        size: 0.75 + random(index * 7 + i + seed) * 0.5,
        birth: nodes[index].birth + 0.06 + i * 0.015,
      });
    }
  }
  const fern = sp.type === "fern",
    herb = sp.type === "weed" || sp.id === "four" || sp.id === "ardisia";
  if (fern) {
    for (let j = 0; j < 8; j++) {
      let parent = -1;
      const side = j % 2 ? 1 : -1;
      for (let k = 0; k < 4; k++) {
        const index = node(
          parent,
          1,
          0.17 + random(seed + j + k) * 0.05,
          k === 0 ? side * (0.3 + j * 0.09) : side * 0.18,
          k * 0.07,
          0.008,
          1,
        );
        foliage(index, 4);
        parent = index;
      }
    }
  } else {
    const trunk = [];
    for (let j = 0; j < 5; j++)
      trunk.push(
        node(
          j ? trunk[j - 1] : -1,
          1,
          0.19 + random(seed + j) * 0.045,
          (random(seed + j * 3) - 0.5) * 0.2,
          j * 0.025,
          herb ? 0.015 : 0.029 * Math.pow(0.72, j),
          0,
        ),
      );
    const arms = herb ? 5 : sp.layer === 0 ? 8 : 11;
    function fork(parent, depth, birth, length) {
      const parentNode = nodes[parent];
      for (let k = 0; k < (depth === 1 ? 2 : 2); k++) {
        const side = k ? 1 : -1;
        const i = node(
          parent,
          0.48 + random(seed + parent + k) * 0.47,
          length * (0.7 + random(seed + parent * 9 + k) * 0.5),
          side * (0.35 + random(seed + parent * 5 + k) * 0.8),
          birth,
          0.008 / (depth * 0.8),
          depth,
        );
        foliage(i, depth === 2 ? 4 : 3);
        if (depth < 2 && !herb)
          fork(
            i,
            depth + 1,
            birth + 0.13 + random(seed + i) * 0.09,
            length * 0.58,
          );
      }
    }
    for (let j = 0; j < arms; j++) {
      const side = j % 2 ? 1 : -1,
        t = 1 + Math.floor(random(seed + j * 27) * 4),
        birth = 0.08 + (j / arms) * 0.25;
      const i = node(
        trunk[t],
        0.2 + random(seed + j * 19) * 0.72,
        (herb ? 0.22 : sp.layer === 0 ? 0.35 : 0.4) *
          (0.7 + random(seed + j * 31) * 0.6),
        side * (0.65 + random(seed + j * 23) * 0.65),
        birth,
        herb ? 0.009 : 0.014,
        1,
      );
      foliage(i, 4);
      if (!herb) fork(i, 1, birth + 0.09, 0.17 + random(seed + j) * 0.11);
    }
    foliage(trunk[0], 2);
    foliage(trunk[4], 3);
  }
  return { nodes, leaves };
}
export function poseArchitecture(recipe, maturity, time = 0) {
  const pose = [];
  for (const n of recipe.nodes) {
    const parent = n.parent >= 0 ? pose[n.parent] : null;
    const start = parent
      ? {
          x: parent.a.x + (parent.b.x - parent.a.x) * n.at,
          y: parent.a.y + (parent.b.y - parent.a.y) * n.at,
          z: parent.a.z + (parent.b.z - parent.a.z) * n.at,
        }
      : { x: 0, y: 0, z: 0 };
    const growth = clamp((maturity - n.birth) / n.duration);
    const g = growth * (parent ? clamp(parent.growth * 2) : 1);
    const angle =
      (parent?.angle || 0) +
      n.angle +
      Math.sin(time * 0.8 + n.seed) * 0.011 * n.depth;
    const length = n.length * g;
    pose.push({
      a: start,
      b: {
        x: start.x + Math.sin(angle) * length,
        y: start.y + Math.cos(angle) * length,
        z: start.z + Math.sin(n.depthAngle || 0) * length,
      },
      angle,
      growth: g,
    });
  }
  return pose;
}
// Leaf blades start at the end of a petiole rather than floating around a crown.
export function leafAttachment(leaf, pose, health = 100) {
  const branch = pose[leaf.branch],
    base = {
      x: branch.a.x + (branch.b.x - branch.a.x) * leaf.at,
      y: branch.a.y + (branch.b.y - branch.a.y) * leaf.at,
      z: branch.a.z + (branch.b.z - branch.a.z) * leaf.at,
    };
  const angle = branch.angle + leaf.angle + (health < 35 ? 0.35 : 0);
  return {
    base,
    tip: {
      x: base.x + Math.sin(angle) * leaf.petiole,
      y: base.y + Math.cos(angle) * leaf.petiole,
      z: base.z,
    },
    angle,
  };
}
