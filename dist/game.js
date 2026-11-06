import { species, layers, sources } from "./species.js";
import {
  HALF,
  COLS,
  ROWS,
  CW,
  clamp,
  random,
  getSpecies,
  cellAt,
  colAt,
  freshState,
  migrate,
  plantHeight,
  hydrology,
  addWater,
  stepDay,
  score,
} from "./ecology.js";
import { ForestView } from "./forest-view.js";
const $ = (id) => document.getElementById(id),
  byId = getSpecies;
let state = freshState();
try {
  const raw = localStorage.getItem("pocket-forest-v2");
  if (raw) state = migrate(JSON.parse(raw));
  else {
    const old = JSON.parse(localStorage.getItem("pocket-forest-v1"));
    if (old?.state) state = migrate(old.state);
  }
} catch {}
state.watered ??= Array(COLS).fill(state.phase >= 4);
let view;
try {
  view = new ForestView($("scene"), state);
} catch (e) {
  $("fatal").hidden = false;
  $("fatal").textContent =
    "This forest needs WebGL. Open it in a browser with hardware acceleration enabled.";
  throw e;
}
let tool = null,
  selected = null,
  highlighted = null,
  pointer = { x: innerWidth / 2, y: innerHeight * 0.6 },
  applying = false,
  lastToolX = null,
  toolAccumulator = 0,
  simAccumulator = 0,
  lastTime = 0,
  soilTime = 0,
  uiTime = 0,
  saveTime = 0,
  dirty = true,
  resetting = false,
  toastTimer,
  pendingTreeTap = null;
const pointers = new Map();
let gesture = null;
const phaseNames = [
  "Survey the woodland",
  "Prepare a living soil",
  "Design your forest",
  "Mulch & water",
  "Tend & observe",
  "Your forest review",
  "Watch your forest mature",
];
const instructions = [
  "Drag in any direction. Pinch to zoom. Tap any plant to add it to your notebook.",
  "Improve drainage, mix organic matter, and add living compost.",
  "Open the shop, buy seedlings, then drag and plant them. Select a pot to preview the mature forest.",
  "Spread mulch across the bed, then water it. Water pools before soaking into the soil.",
  "Watch your plants grow, water them, and pick weeds.",
  "Review the health, variety, density and care of your forest.",
  "Watch your plants grow, water them, and pick weeds.",
];
function save() {
  if (resetting) return;
  try {
    localStorage.setItem("pocket-forest-v2", JSON.stringify(state));
  } catch {}
}
function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 5000);
}
function panel(html) {
  $("panelContent").innerHTML = html;
  if (!$("panel").open) $("panel").showModal();
  hideTooltip();
}
$("closePanel").onclick = () => $("panel").close();
function nativeText(sp) {
  return sp.native === true
    ? "Native to the region"
    : sp.native === false
      ? "Introduced to Japan"
      : "Native status unresolved";
}
function entry(sp) {
  return `<span class="eyebrow">Field notebook · ${sp.jp}</span><h2>${sp.name}</h2><i>${sp.latin}</i><div><span class="badge ${sp.native === false ? "exotic" : ""}">${nativeText(sp)}</span><span class="badge">${sp.type === "weed" ? "Herb / weed" : layers[sp.layer]} · ${sp.height} m mature reference</span></div>${sp.photo ? `<img class="ref-photo" src="photos/${sp.photo}.jpg" alt="Reference photograph for ${sp.name}">` : ""}<p>${sp.desc}</p><p><strong>Identification:</strong> ${sp.confidence}</p>`;
}
function recordSurvey(p) {
  const sp = byId(p.sid);
  if (!state.survey.includes(sp.id)) state.survey.push(sp.id);
  if (!state.surveyPlants.includes(p.id)) state.surveyPlants.push(p.id);
  updateUI();
  save();
}
function inspect(p, touch = false) {
  view.target = p.x;
  highlight(p);
  if (p.sid === "grass" || p.sid === "forb") {
    recordSurvey(p);
    if (!p.wild) pluck(p);
    return;
  }
  if (p.wild) {
    recordSurvey(p);
    if (touch) {
      pendingTreeTap = p;
      showTooltip(p, pointer.x, pointer.y, true);
    } else openPlantNote(p);
  } else if (!p.planted) {
    selected = p;
    view.selected = p;
    view.updateGhosts();
    updateSelection();
    showTooltip(p, pointer.x, pointer.y, touch);
  } else if (touch) {
    pendingTreeTap = p;
    showTooltip(p, pointer.x, pointer.y, true);
  } else openPlantNote(p);
}
function openPlantNote(p) {
  recordSurvey(p);
  panel(
    entry(byId(p.sid)) +
      `<p>Health <strong>${Math.round(p.health)}%</strong> · age <strong>${formatAge(p.age)}</strong><br>Height ${plantHeight(p).toFixed(1)} m${!p.wild ? ` · light ${Math.round((p.light ?? 1) * 100)}%<br>Root-zone moisture ${Math.round(cellAt(state, p.x, -0.3).m)}%` : ""}</p>`,
  );
}
function formatAge(age) {
  return age < 1
    ? `${Math.floor((age || 0) * 365)} days`
    : `${(age || 0).toFixed(1)} years`;
}
function hideTooltip() {
  $("tooltip").style.display = "none";
}
function highlight(p) {
  highlighted = p;
  view.highlight(p);
}
function showTooltip(p, x, y, touch = false) {
  if (!p || $("panel").open) {
    hideTooltip();
    return;
  }
  const sp = byId(p.sid),
    el = $("tooltip");
  el.innerHTML = `<strong>${sp.name}</strong><small>${Math.round(p.health ?? 100)}% health · ${formatAge(p.age)}<br>${sp.type === "weed" ? "Tap to pull out" : p.wild ? (state.survey.includes(sp.id) ? "Recorded · tap to inspect" : "Tap to survey") : p.planted ? "Tap to inspect" : "Drag to arrange · tap to plant"}</small>`;
  el.style.display = "block";
  el.style.left = clamp(x + 15, 8, innerWidth - 245) + "px";
  el.style.top = clamp(y + 19, 10, innerHeight - 105) + "px";
}
$("notebook").onclick = () => {
  panel(
    `<span class="eyebrow">${state.surveyPlants.length} individual plants surveyed</span><h2>Field notebook</h2><p>${state.survey.length} species and references. Every visible tree, shrub and herb can be surveyed. Weed entries are additional named references, not photo identifications.</p>${
      state.survey
        .map((id) => {
          const s = byId(id);
          if (!s) return "";
          return `<div class="entry"><div><h3>${s.name}</h3><small>${s.latin}</small><p>${nativeText(s)} · ${s.type === "weed" ? "Weed" : layers[s.layer]}</p></div><button data-note="${id}">Read note</button></div>`;
        })
        .join("") || "<p>Tap a plant to begin.</p>"
    }`,
  );
  document
    .querySelectorAll("[data-note]")
    .forEach((b) => (b.onclick = () => panel(entry(byId(b.dataset.note)))));
};
function shop() {
  panel(
    `<span class="eyebrow">Nursery · ¥${state.budget.toLocaleString()} remaining</span><h2>Plant a little more possibility.</h2><p>Your surveyed species are available here. Variety and a dense planting both matter in the final score. Mulch is included in the preparation supplies.</p>${state.survey
      .map((id) => byId(id))
      .filter((s) => s && s.type !== "weed")
      .map(
        (s) =>
          `<div class="entry"><div><h3>${s.name}</h3><small>${s.latin}</small><p>${nativeText(s)} · ${layers[s.layer]} · ${s.height} m</p></div><button data-buy="${s.id}" ${state.budget < s.price ? "disabled" : ""}>¥${s.price} · Buy</button></div>`,
      )
      .join("")}`,
  );
  document
    .querySelectorAll("[data-buy]")
    .forEach((b) => (b.onclick = () => buy(b.dataset.buy)));
}
function buy(id) {
  const sp = byId(id);
  if (state.budget < sp.price) return;
  if (sp.native === false && !state.warned.nonNative) {
    state.warned.nonNative = true;
    panel(
      `<h2>A visitor from elsewhere</h2><p>${sp.name} is introduced to Japan. Non-native species can compete for resources and support different wildlife. Non-native does not automatically mean invasive; locally appropriate natives are the starting point for restoration.</p><button id="buyAnyway" class="primary">Buy anyway · ¥${sp.price}</button>`,
    );
    $("buyAnyway").onclick = () => buy(id);
    return;
  }
  state.budget -= sp.price;
  const p = {
    id: "p" + Date.now() + Math.floor(Math.random() * 1000),
    sid: id,
    x: clamp(-8.5 + state.plants.length * 0.72, -9.5, 9.5),
    z: 1,
    age: 0,
    health: 95,
    biomass: 0,
    seed: state.plants.length + 23,
    planted: false,
    drop: 8,
    roots: [],
    tips: [],
  };
  state.plants.push(p);
  selected = p;
  view.selected = p;
  view.target = p.x;
  $("panel").close();
  view.plot();
  view.sync();
  highlight(p);
  updateUI();
  toast(
    "Drag the pot into place. The pale silhouettes show the mature forest.",
  );
  save();
}
function updateSelection() {
  const el = $("selection");
  if (selected && !selected.planted && state.phase === 2) {
    el.style.display = "block";
    el.innerHTML = `${byId(selected.sid).name} · Plant here?<br><button id="plantYes" class="primary">Yes, plant here</button> <button id="plantLater">Keep arranging</button>`;
    $("plantYes").onclick = confirmPlant;
    $("plantLater").onclick = () => {
      selected = null;
      view.selected = null;
      view.updateGhosts();
      updateSelection();
    };
  } else el.style.display = "none";
}
function confirmPlant() {
  if (!selected) return;
  const p = selected;
  if (
    state.plants.some((o) => o !== p && o.planted && Math.abs(o.x - p.x) < 0.18)
  ) {
    toast("Move this pot slightly to give the stems room.");
    return;
  }
  const sp = byId(p.sid);
  if (
    state.plants.some(
      (o) =>
        o !== p &&
        o.planted &&
        Math.abs(o.x - p.x) < 1.25 &&
        byId(o.sid).layer === sp.layer,
    ) &&
    !state.warned.crowd
  ) {
    state.warned.crowd = true;
    toast(
      "Similar-height neighbors can compete later. Nearby mixed layers also shelter seedlings and help retain moisture.",
    );
  }
  p.planted = true;
  p.drop = 0;
  selected = null;
  view.selected = null;
  highlight(null);
  view.sync();
  updateUI();
  save();
}
function action(text, fn, cls = "") {
  const b = document.createElement("button");
  b.textContent = text;
  b.className = cls;
  b.onclick = fn;
  $("actions").appendChild(b);
}
function updateUI() {
  const p = state.phase;
  $("phaseTitle").textContent = phaseNames[p];
  $("instruction").textContent = instructions[p];
  $("steps").innerHTML = phaseNames
    .slice(0, 6)
    .map(
      (_, i) =>
        `<span class="${i < p ? "done" : i === p ? "active" : ""}"></span>`,
    )
    .join("");
  $("actions").innerHTML = "";
  const n = $("next");
  n.hidden = false;
  n.disabled = false;
  if (p === 0) {
    n.textContent =
      state.survey.filter((id) => byId(id)?.type !== "weed").length < 5
        ? `${state.survey.filter((id) => byId(id)?.type !== "weed").length}/5 surveyed`
        : "Next · Prepare →";
    n.disabled =
      state.survey.filter((id) => byId(id)?.type !== "weed").length < 5;
  }
  if (p === 1) {
    [
      "1 · Drainage · ¥400",
      "2 · Organic matter + mulch · ¥800",
      "3 · Compost · ¥400",
    ].forEach((text, i) =>
      action(state.prep[i] ? "✓ " + text.split(" · ¥")[0] : text, () =>
        prepare(i),
      ),
    );
    n.textContent = "Next · Buy & plant →";
    n.disabled = !state.prep.every(Boolean);
  }
  if (p === 2) {
    action("Open seedling shop", shop, "shop-button");
    n.textContent = "Next · Mulch & water →";
    n.disabled =
      state.plants.filter((p) => p.planted).length < 2 ||
      state.plants.some((p) => !p.planted);
  }
  if (p === 3) {
    const covered = state.soil
      .slice(0, COLS)
      .filter((c) => c.mulch > 0.7).length;
    action(
      covered === COLS
        ? "✓ Mulch complete"
        : `Mulch bag · ${Math.round((covered / COLS) * 100)}%`,
      () => setTool("mulch"),
      tool === "mulch" ? "active-tool" : "",
    );
    action(
      `Watering can · ${Math.round((state.watered.filter(Boolean).length / COLS) * 100)}%`,
      () => setTool("water"),
      tool === "water" ? "active-tool" : "",
    );
    n.textContent = "Begin tending →";
    n.disabled = covered < COLS || state.watered.some((v) => !v);
  }
  if (p === 4 || p === 6) {
    action(
      "Watering can",
      () => setTool("water"),
      tool === "water" ? "active-tool" : "",
    );
    if (tool)
      action("Put away", () => {
        tool = null;
        updateUI();
      });
    n.hidden = true;
  }
  if (p === 5) {
    action("View review", showReview);
    n.textContent = "Continue growing →";
  }
  $("timeline").hidden = ![4, 6].includes(p);
  updateSelection();
  updateStats();
}
function updateStats() {
  $("money").textContent = "¥" + state.budget.toLocaleString();
  $("count").textContent = state.survey.length;
  const avg = (key) =>
    Math.round(state.soil.reduce((a, c) => a + c[key], 0) / state.soil.length);
  $("moisture").textContent = avg("m") + "%";
  $("nutrients").textContent = avg("n") + "%";
  $("moistureMeter").value = avg("m");
  $("nutrientMeter").value = avg("n");
  $("weather").textContent = ["Spring", "Summer", "Autumn", "Winter"][
    Math.floor((state.day % 365) / 91.25)
  ];
  $("date").textContent =
    `Year ${Math.floor(state.day / 365) + 1} · day ${Math.floor(state.day % 365) + 1}`;
  $("remaining").textContent =
    state.phase === 6
      ? "Free growth"
      : `${Math.max(0, 1095 - state.day)} days left`;
  $("progress").value = Math.min(1095, state.day);
  if (!$("speeds").children.length) {
    $("speeds").innerHTML = [
      ["Pause", 0],
      ["1×", 3],
      ["4×", 12],
      ["12×", 36],
    ]
      .map(([text, speed]) => `<button data-speed="${speed}">${text}</button>`)
      .join("");
    document.querySelectorAll("[data-speed]").forEach(
      (b) =>
        (b.onclick = () => {
          state.speed = +b.dataset.speed;
          updateStats();
        }),
    );
  }
  document
    .querySelectorAll("[data-speed]")
    .forEach((b) =>
      b.classList.toggle("chosen", +b.dataset.speed === state.speed),
    );
}
function prepare(i) {
  if (state.prep[i]) return;
  if (i && !state.prep[i - 1]) {
    toast("Begin with drainage, then mix organic matter and add compost.");
    return;
  }
  const cost = [400, 800, 400][i];
  if (state.budget < cost) return;
  state.budget -= cost;
  state.prep[i] = true;
  if (i === 1) state.warned.mulchPaid = true;
  for (const c of state.soil) {
    if (i === 0) c.d = 0.85;
    if (i === 1) {
      c.o = 1;
      c.n += 12;
    }
    if (i === 2) {
      c.c = 0.8;
      c.n += 15;
    }
  }
  view.target = 0;
  view.updateSoil();
  toast(
    [
      "Loose soil allows air and water to move around young roots.",
      "Organic matter holds water. Your mulch supply is ready for after planting.",
      "Compost brings decomposers that release nutrients from organic matter.",
    ][i],
  );
  updateUI();
  save();
}
function advance() {
  if (state.phase === 5) {
    state.phase = 6;
    state.speed = 3;
  } else state.phase++;
  selected = null;
  view.selected = null;
  tool = null;
  view.plot();
  view.sync();
  updateUI();
  if (state.phase === 2) shop();
  if (state.phase === 4) {
    state.speed = 3;
    toast("Watch your plants grow, water them, and pick weeds.");
  }
  save();
}
$("next").onclick = () => {
  if ($("next").disabled) return;
  if (state.budget > 0 && state.phase >= 1 && state.phase <= 3) {
    panel(
      `<h2>Leave ¥${state.budget.toLocaleString()} unspent?</h2><p>${state.phase === 1 ? "Your remaining budget will carry into the seedling shop." : state.phase === 2 ? "You can still buy more species or plant more densely. Moving on closes the seedling shop for this forest." : "You have funds left from planting. You can continue tending with the supplied tools."}</p><button id="advanceYes" class="primary">Okay, continue</button><button id="advanceNo">Go back</button>`,
    );
    $("advanceYes").onclick = () => {
      $("panel").close();
      advance();
    };
    $("advanceNo").onclick = () => $("panel").close();
  } else advance();
};
function setTool(t) {
  if (t === "mulch" && state.soil.slice(0, COLS).every((c) => c.mulch > 0.7)) {
    toast("The bed is mulched. Pick up the watering can.");
    return;
  }
  tool = tool === t ? null : t;
  applying = false;
  lastToolX = null;
  hideTooltip();
  highlight(null);
  updateUI();
}
function applyAt(x) {
  if (Math.abs(x) > HALF) return;
  if (tool === "mulch" && !state.warned.mulchPaid) {
    if (state.budget < 300) {
      toast("There is not enough budget for more mulch.");
      tool = null;
      return;
    }
    state.budget -= 300;
    state.warned.mulchPaid = true;
  }
  const start = lastToolX ?? x;
  const distance = Math.abs(x - start);
  const n = Math.max(1, Math.ceil(distance / (CW * 0.7)));
  for (let i = 1; i <= n; i++) {
    const px = start + ((x - start) * i) / n;
    if (tool === "mulch") {
      if (cellAt(state, px).mulch < 0.8) view.spawn("mulch", px, 0.75, 5);
    } else if (tool === "water") view.spawn("water", px, 0.95, 5);
  }
  lastToolX = x;
  view.target = x;
}
function pluck(w) {
  view.uproot(w);
  state.weeds = state.weeds.filter((p) => p !== w);
  cellAt(state, w.x).litter += 0.7;
  view.target = w.x;
  view.sync();
  highlight(null);
  hideTooltip();
  toast(`${byId(w.sid).name} pulled out and left to decompose.`);
  save();
}
function showReview() {
  const s = state.review || score(state);
  const labels = {
    health: "Plant health",
    diversity: "Species variety",
    density: "Living planting density",
    layers: "Forest layers",
    native: "Native planting",
    weeds: "Weed control",
  };
  panel(
    `<span class="eyebrow">Three-year forest review</span><h2>Your forest at three years.</h2><div class="score">${s.total}<small> / 100</small></div><p>${s.alive}/${s.planted} plants alive · ${s.variety} species · ${s.layers}/4 layers<br>${s.weeds} weeds remain; ${s.weedLoad} average during establishment.</p>${Object.entries(
      s.points,
    )
      .map(
        ([k, v]) =>
          `<div class="score-row"><span>${labels[k]}</span><strong>${v.toFixed(1)} / ${k === "layers" || k === "weeds" ? 10 : k === "native" ? 5 : 25}</strong></div>`,
      )
      .join(
        "",
      )}<p>Density reaches its target at 20 surviving seedlings in this compressed planting strip; diversity reaches its target at seven species. A few healthy trees form a healthy start, but cannot earn a dense-forest score.</p><button id="continueReview" class="primary">Continue growing →</button>`,
  );
  $("continueReview").onclick = () => {
    $("panel").close();
    state.phase = 6;
    state.speed = 3;
    updateUI();
    save();
  };
}
function updateWeedAlerts() {
  const keep = new Set();
  for (const w of state.weeds) {
    keep.add(w.id);
    let el = view.alerts.get(w.id);
    if (!el) {
      el = document.createElement("button");
      el.className = "weed-alert";
      el.textContent = "!";
      el.setAttribute("aria-label", `Pull ${byId(w.sid).name}`);
      el.onclick = (e) => {
        e.stopPropagation();
        recordSurvey(w);
        pluck(w);
      };
      el.onpointerenter = (e) => {
        highlight(w);
        showTooltip(w, e.clientX, e.clientY);
      };
      $("weedAlerts").appendChild(el);
      view.alerts.set(w.id, el);
    }
    const p = view.project(w.x, plantHeight(w) + 0.35 + (w.seed % 2) * 0.65);
    el.style.left = p.x + "px";
    el.style.top = p.y + "px";
    el.hidden =
      p.x < 0 || p.x > innerWidth || p.y < 150 || p.y > innerHeight - 130;
  }
  for (const [id, el] of view.alerts)
    if (!keep.has(id)) {
      el.remove();
      view.alerts.delete(id);
    }
}
// Pointer capture handles one-finger panning/placing and a two-finger pan + pinch.
const world = $("world");
world.addEventListener("pointerdown", (e) => {
  if (e.target.closest("button")) return;
  e.preventDefault();
  pointer = { x: e.clientX, y: e.clientY };
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  world.setPointerCapture(e.pointerId);
  if (pointers.size === 2) {
    applying = false;
    lastToolX = null;
    const [a, b] = [...pointers.values()];
    gesture = {
      multi: true,
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      moved: true,
    };
    return;
  }
  const hit = view.hit(e.clientX, e.clientY, e.pointerType === "touch" ? 16 : 3),
    point = view.worldPoint(e.clientX, e.clientY);
  view.target = point.x;
  gesture = {
    x: e.clientX,
    y: e.clientY,
    lastX: e.clientX,
    lastY: e.clientY,
    moved: false,
    hit,
    touch: e.pointerType === "touch",
    plant: hit && !hit.planted && state.phase === 2 ? hit : null,
  };
  if (gesture.plant) {
    selected = gesture.plant;
    view.selected = selected;
    view.updateGhosts();
    updateSelection();
  }
  if (tool && Math.abs(point.x) <= HALF && point.y < 2 && point.y > -0.9) {
    applying = true;
    lastToolX = null;
    applyAt(point.x);
  }
});
world.addEventListener("pointermove", (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  if (!pointers.has(e.pointerId)) {
    if (e.pointerType !== "touch" && !tool) {
      const p = view.hit(e.clientX, e.clientY);
      highlight(p);
      showTooltip(p, e.clientX, e.clientY);
    }
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()],
      cx = (a.x + b.x) / 2,
      cy = (a.y + b.y) / 2,
      distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (gesture?.multi) {
      view.pan(cx - gesture.cx, cy - gesture.cy);
      view.zoomAt(distance / Math.max(1, gesture.distance), cx, cy);
    }
    gesture = { multi: true, distance, cx, cy, moved: true };
    hideTooltip();
    return;
  }
  if (!gesture || gesture.multi) return;
  const dx = e.clientX - gesture.lastX,
    dy = e.clientY - gesture.lastY;
  if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 6)
    gesture.moved = true;
  const point = view.worldPoint(e.clientX, e.clientY);
  if (gesture.plant) {
    gesture.plant.x = clamp(point.x, -HALF + 0.3, HALF - 0.3);
    view.updatePlant(view.records.get(gesture.plant.id));
    view.updateGhosts();
  } else if (tool && applying) {
    if (point.y < 2 && point.y > -0.9) applyAt(point.x);
  } else if (gesture.moved) {
    view.pan(dx, dy);
    hideTooltip();
  }
  gesture.lastX = e.clientX;
  gesture.lastY = e.clientY;
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size) {
    gesture = { multi: true, moved: true };
    return;
  }
  applying = false;
  lastToolX = null;
  if (gesture && !gesture.moved && !gesture.multi && !tool && gesture.hit) {
    if (gesture.touch && pendingTreeTap?.id === gesture.hit.id) {
      openPlantNote(gesture.hit);
      pendingTreeTap = null;
    } else inspect(gesture.hit, gesture.touch);
  }
  gesture = null;
  save();
}
world.addEventListener("pointerup", endPointer);
world.addEventListener("pointercancel", (e) => {
  pointers.delete(e.pointerId);
  gesture = null;
  applying = false;
});
world.addEventListener("pointerleave", () => {
  if (!pointers.size) {
    hideTooltip();
    highlight(null);
  }
});
world.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey)
      view.zoomAt(Math.exp(-e.deltaY * 0.008), e.clientX, e.clientY);
    else view.pan(-e.deltaX, -e.deltaY);
    hideTooltip();
  },
  { passive: false },
);
let safariScale = 1;
document.addEventListener(
  "gesturestart",
  (e) => {
    e.preventDefault();
    safariScale = 1;
  },
  { passive: false },
);
document.addEventListener(
  "gesturechange",
  (e) => {
    e.preventDefault();
    if (pointers.size < 2)
      view.zoomAt(
        e.scale / safariScale,
        e.clientX || innerWidth / 2,
        e.clientY || innerHeight / 2,
      );
    safariScale = e.scale;
  },
  { passive: false },
);
document.addEventListener(
  "touchmove",
  (e) => {
    if (!e.target.closest("dialog")) e.preventDefault();
  },
  { passive: false },
);
$("home").onclick = () => view.plot();
window.addEventListener("resize", () => view.resize());
window.addEventListener("keydown", (e) => {
  if ($("panel").open) return;
  if (e.key.startsWith("Arrow")) {
    e.preventDefault();
    view.pan(
      e.key === "ArrowLeft" ? 70 : e.key === "ArrowRight" ? -70 : 0,
      e.key === "ArrowUp" ? 70 : e.key === "ArrowDown" ? -70 : 0,
    );
  }
  if (e.code === "Space" && [4, 6].includes(state.phase)) {
    e.preventDefault();
    state.speed = state.speed ? 0 : 3;
    updateStats();
  }
});
$("restart").onclick = () => {
  panel(
    '<h2>Start a new forest?</h2><p>This replaces this browser’s saved forest.</p><button id="resetYes" class="primary">Start again</button>',
  );
  $("resetYes").onclick = () => {
    resetting = true;
    localStorage.removeItem("pocket-forest-v2");
    localStorage.removeItem("pocket-forest-v1");
    location.reload();
  };
};
$("about").onclick = () =>
  panel(
    `<span class="eyebrow">Pocket Forest · Tokushima</span><h2>Learn by growing.</h2><p>Drag to pan in any direction. Use a pinch or trackpad pinch to zoom; a two-finger trackpad scroll pans. Plot returns to your planting area. Hover plants for names, health and age. On touch, one tap highlights and records a plant; a second opens its note. Weeds are pulled on the first tap.</p><p>Nearby plants provide a modest shelter bonus in this educational model. Partial shade can protect young shade-tolerant plants and reduce evaporation; deep shade can still limit growth. The score rewards density and diversity, as well as health and weed control.</p><p>Leaf textures are drawn once per species and reused as instances. Existing root segments remain fixed; only new tips seek moisture. Sunlight and canopy interception of rain use raycasts. Water ponds and infiltrates through the soil grid. Mushrooms have individual lifetimes; they are not proof of nutrient sharing or forest health.</p><p>The front elevation compresses depth and density for interaction. Growth, weather, costs and scores are illustrative. Photo identifications remain tentative. Your supplied photographs retain their own copyright; original game code is MIT licensed.</p>${sources.map(([text, url]) => `<p><a href="${url}" target="_blank" rel="noopener">${text} ↗</a></p>`).join("")}`,
  );
function frame(ms) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.06, (ms - lastTime) / 1000 || 0.016);
  lastTime = ms;
  hydrology(state, dt);
  if (applying && tool) {
    toolAccumulator += dt;
    if (toolAccumulator > 0.1) {
      const p = view.worldPoint(pointer.x, pointer.y);
      if (p.y < 2 && p.y > -0.9) applyAt(p.x);
      toolAccumulator = 0;
    }
  }
  for (const x of view.pendingWater.splice(0)) {
    addWater(state, x, 1.6);
    for (
      let c = Math.max(0, colAt(x) - 1);
      c <= Math.min(COLS - 1, colAt(x) + 1);
      c++
    ) {
      state.watered[c] = true;
      if (c !== colAt(x)) addWater(state, -HALF + (c + 0.5) * CW, 0.5);
    }
  }
  for (const x of view.pendingMulch.splice(0)) {
    for (
      let c = Math.max(0, colAt(x) - 1);
      c <= Math.min(COLS - 1, colAt(x) + 1);
      c++
    )
      state.soil[c].mulch = clamp(state.soil[c].mulch + 0.12);
  }
  if (
    tool === "mulch" &&
    state.soil.slice(0, COLS).every((c) => c.mulch > 0.7)
  ) {
    tool = null;
    applying = false;
    updateUI();
    toast("Mulching complete. The bag is put away.");
  }
  if ([4, 6].includes(state.phase)) {
    simAccumulator += dt * state.speed;
    while (simAccumulator >= 1) {
      simAccumulator--;
      const review = stepDay(state, (x, y, id) => view.exposure(x, y, id));
      if (state.day % 365 === 274)
        for (const p of state.plants)
          if (p.planted && byId(p.sid).deciduous)
            view.spawn("leaf", p.x, plantHeight(p) * 0.65, 8);
      if (state.day % 9 === 0) view.sync();
      if (review) {
        state.phase = 5;
        state.speed = 0;
        state.review = score(state);
        view.sync();
        updateUI();
        showReview();
        save();
        simAccumulator = 0;
        break;
      }
    }
  }
  soilTime += dt;
  uiTime += dt;
  saveTime += dt;
  if (soilTime > 0.15) {
    view.updateSoil();
    updateWeedAlerts();
    soilTime = 0;
  }
  if (uiTime > 0.45) {
    updateStats();
    if (state.phase === 3) updateUI();
    uiTime = 0;
  }
  if (saveTime > 5) {
    save();
    saveTime = 0;
  }
  view.render(dt, ms / 1000, tool, pointer, applying);
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
view.plot();
requestAnimationFrame(frame);
