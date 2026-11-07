import { returnLeafToSoil, returnWeedToSoil, prepareSoilAt } from "./ecology.js";
import { makeArchitecture, poseArchitecture, leafAttachment } from "./architecture.js";
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
  TIME_RATES,
  packState,
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
let framePeak = 0,
  frameCount = 0,
  framesOver16 = 0,
  monitorTime = 0;
let tool = null,
  selected = null,
  highlighted = null,
  pointer = { x: innerWidth / 2, y: innerHeight * 0.6 },
  applying = false,
  lastToolX = null,
  toolAccumulator = 0,
  toolActionUntil = 0,
  simAccumulator = 0,
  lastTime = 0,
  soilTime = 0,
  uiTime = 0,
  saveTime = 0,
  resetting = false,
  toastTimer,
  pendingTreeTap = null;
const pointers = new Map();
let gesture = null;
const phaseNames = [
  "Survey the woodland",
  "Prepare a living soil",
  "Plant shop",
  "Mulch & water",
  "Tend & observe",
  "Your forest review",
  "Watch your forest mature",
];
let savePending = false;
function save(immediate = false) {
  if (resetting || (savePending && immediate !== true)) return;
  const write = () => {
    savePending = false;
    if (resetting) return;
    try {
      const packed = packState(state);
      localStorage.setItem("pocket-forest-v2", packed);
      $("world").dataset.saveStatus = "saved";
      $("world").dataset.saveBytes = packed.length;
    } catch (e) {
      $("world").dataset.saveStatus = "failed";
      console.warn("Forest save failed", e.name);
    }
  };
  if (immediate === true || !window.requestIdleCallback) write();
  else {
    savePending = true;
    requestIdleCallback(write, { timeout: 1200 });
  }
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
  if (state.phase === 0) {
    openPlantNote(p);
    return;
  }
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
  panel(
    entry(byId(p.sid)) +
      `<p>Health <strong>${Math.round(p.health)}%</strong> · age <strong>${formatAge(p.age)}</strong><br>Height ${plantHeight(p).toFixed(1)} m${!p.wild ? ` · light ${Math.round((p.light ?? 1) * 100)}%<br>Root-zone moisture ${Math.round(cellAt(state, p.x, -0.3).m)}%` : ""}</p>` +
      (state.phase === 0 ? '<button id="addNote" class="primary">Add to Notebook</button>' : ""),
  );
  if ($("addNote")) $("addNote").onclick = () => {
    recordSurvey(p);
    $("panel").close();
  };
}
function formatAge(age) {
  return age < 1
    ? `${Math.floor((age || 0) * 365)} days`
    : `${(age || 0).toFixed(1)} years`;
}
function hideTooltip() {
  $("tooltip").style.display = "none";
  view?.highlightSoil();
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
  el.innerHTML = `<strong>${sp.name}</strong><small>${Math.round(p.health ?? 100)}% health · ${formatAge(p.age)}<br>${sp.type === "weed" ? "Tap to pull out" : p.wild ? (state.surveyPlants.includes(p.id) ? "Recorded · tap to inspect" : "Tap to survey") : p.planted ? "Tap to inspect" : "Drag to arrange · tap to plant"}</small>`;
  el.style.display = "block";
  el.style.left = clamp(x + 15, 8, innerWidth - 245) + "px";
  el.style.top = clamp(y + 19, 10, innerHeight - 105) + "px";
}
function showSoilTooltip(sample, x, y) {
  const el = $("tooltip");
  el.innerHTML = `<strong>Soil · ${Math.abs(sample.point.y).toFixed(1)} m deep</strong><small>Moisture <b>${sample.cell.m.toFixed(1)}%</b><br>Nutrients <b>${sample.cell.n.toFixed(1)}%</b><br>Drainage <b>${Math.round(sample.cell.d * 100)}%</b></small>`;
  el.style.display = "block";
  el.style.left = clamp(x + 15, 8, innerWidth - 230) + "px";
  el.style.top = clamp(y + 19, 10, innerHeight - 110) + "px";
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
const thumbnails = new Map();
function plantThumbnail(sp) {
  if (thumbnails.has(sp.id)) return thumbnails.get(sp.id);
  const recipe = makeArchitecture(sp, 42);
  const pose = poseArchitecture(recipe, 1.5);
  const scale = 72 / Math.max(2, sp.height);
  const unit = scale * sp.height / Math.max(...pose.map(n => n.b.y));
  const x = n => (49 + n.x * unit).toFixed(1);
  const y = n => (80 - n.y * unit).toFixed(1);
  const branches = pose.map((n, i) =>
    `<path d="M${x(n.a)} ${y(n.a)}L${x(n.b)} ${y(n.b)}" stroke-width="${Math.max(0.5, recipe.nodes[i].width * unit)}"/>`
  ).join("");
  const leaves = recipe.leaves.map(l => {
    const a = leafAttachment(l, pose);
    return `<ellipse cx="${x(a.tip)}" cy="${y(a.tip)}" rx="2" ry="1.25" transform="rotate(${Math.round(a.angle * 57)} ${x(a.tip)} ${y(a.tip)})"/>`;
  }).join("");
  const svg = `<svg class="shop-thumbnail" viewBox="0 0 104 88" role="img" aria-label="Mature ${sp.name} beside a 1.9 meter farmer">
    <path d="M0 80H104" stroke="#72896b"/>
    <g fill="none" stroke="#9e7956" stroke-linecap="round">${branches}</g>
    <g fill="#${sp.color.toString(16).padStart(6, "0")}">${leaves}</g>
    <g transform="translate(82 80) scale(${scale} -${scale})">
      <path d="M-.2 0h.17v.7h-.17zm.23 0h.17v.7H.03z" fill="#5c6054"/>
      <path d="M-.22 .65h.44v.65h-.44zM-.35 .77h.13v.46h-.13zm.57 0h.13v.46H.22z" fill="#83a16a"/>
      <path d="M-.2 1.3h.4v.44h-.4z" fill="#d3ae86"/>
      <path d="M-.3 1.74h.6v.09h-.6zm.11 .09h.38v.09h-.38z" fill="#dbbd78"/>
    </g></svg>`;
  thumbnails.set(sp.id, svg);
  return svg;
}
function shop() {
  panel(
    `<header class="shop-heading"><h2>Plant shop</h2><strong>¥${state.budget.toLocaleString()}</strong></header>
    ${state.survey.map(byId).filter(s => s && s.type !== "weed").map(s =>
      `<div class="entry shop-entry">${plantThumbnail(s)}<div><h3>${s.name} <strong>${s.height} m</strong></h3><p>${s.native === true ? "Native" : s.native === false ? "Introduced" : "Status unresolved"} · ${layers[s.layer]}</p></div><button data-buy="${s.id}" ${state.budget < s.price ? "disabled" : ""}>¥${s.price} · Buy</button></div>`
    ).join("")}`,
  );
  document.querySelectorAll("[data-buy]").forEach(b => b.onclick = () => buy(b.dataset.buy));
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
    x: clamp(view.center.x + ((state.plants.length % 5) - 2) * 0.65, -9.5, 9.5),
    z: 1,
    age: 0,
    health: 95,
    biomass: 0,
    seed: state.plants.length + 23,
    planted: false,
    drop: 0,
    roots: [],
    tips: [],
  };
  state.plants.push(p);
  selected = p;
  view.selected = p;
  view.target = p.x;
  $("panel").close();
  view.sync();
  highlight(p);
  updateUI();
  save();
}
function positionSeedling(p, x) {
  p.x = clamp(x, -HALF + 0.3, HALF - 0.3);
  p.drop = 0;
  view.target = p.x;
  view.updatePlant(view.records.get(p.id));
  view.updateGhosts();
}
for (const [id, direction] of [["seedLeft", -1], ["seedRight", 1]]) {
  $(id).onclick = () => {
    if (!selected) return;
    positionSeedling(selected, selected.x + direction * 0.45);
    save();
  };
}
function updateSelection() {
  const el = $("selection");
  const arranging = selected && !selected.planted && state.phase === 2;
  $("seedLeft").hidden = $("seedRight").hidden = !arranging;
  if (arranging) {
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
  return b;
}
function updateUI() {
  const p = state.phase;
  const surveyed = state.survey.filter(id => byId(id)?.type !== "weed").length;
  $("phaseTitle").textContent = p === 0 ? `${phaseNames[p]} · ${Math.min(5, surveyed)} out of 5` : phaseNames[p];

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
    n.textContent = "Next · Prepare →";
    n.disabled = surveyed < 5;
  }
  if (p === 1) {
    action(`${state.prep[0] ? "✓ " : ""}Drainage`, () => setTool("drainage"), tool === "drainage" ? "active-tool" : "");
    action(`${state.prep[1] && state.prep[2] ? "✓ " : ""}Compost + organic matter`, () => setTool("compost"), tool === "compost" ? "active-tool" : "");
    n.textContent = "Next · Buy & plant →";
  }
  if (p === 2) {
    action("Open seedling shop", shop, "shop-button");
    n.textContent = "Next · Mulch & water →";
    n.disabled =
      state.plants.filter((p) => p.planted).length < 2 ||
      state.plants.some((p) => !p.planted);
  }
  if (p === 3) {
    action("Mulch bag", () => setTool("mulch"), tool === "mulch" ? "active-tool" : "").id = "mulchBag";
    action("Watering can", () => setTool("water"), tool === "water" ? "active-tool" : "");
    n.textContent = "Begin tending →";
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
  $("steps").hidden = p === 6;
  $("timeline").hidden = ![4, 6].includes(p);
  $("progress").hidden = p !== 4;
  $("remaining").hidden = p !== 4;
  updateSelection();
  updateStats();
}
function updateStats() {
  if ($("mulchBag")) $("mulchBag").textContent = `Mulch bag · ${Math.ceil(state.mulchSupply ?? 100)}%`;
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
    `Year ${Math.floor(state.day / 365) + 1} · ${$("weather").textContent} · Day ${Math.floor(state.day % 365) + 1}`;
  $("remaining").textContent =
    state.phase === 6
      ? "Free growth"
      : `${Math.max(0, 1095 - state.day)} days left`;
  $("progress").value = Math.min(1095, state.day);
  if (!$("timeScale").options.length) {
    $("timeScale").innerHTML = TIME_RATES.map(
      (r) => `<option value="${r.value}">${r.label}</option>`,
    ).join("");
    $("timeScale").onchange = () => {
      state.speed = +$("timeScale").value;
      updateStats();
    };
  }
  $("timeScale").value = state.speed;
  $("speeds").hidden = ![4, 6].includes(state.phase);
}
function advance() {
  if (state.phase === 5) {
    state.phase = 6;
    state.speed = 1;
  } else state.phase++;
  selected = null;
  view.selected = null;
  tool = null;
  view.plot();
  view.sync();
  updateUI();
  if (state.phase === 2) shop();
  if (state.phase === 4) {
    state.speed = 1;
    toast("Watch your plants grow, water them, and pick weeds.");
  }
  save();
}
$("next").onclick = () => {
  if ($("next").disabled) return;
  if (state.phase === 1 && !state.prep.every(Boolean)) {
    const skipped = [!state.prep[0] && "drainage", !(state.prep[1] && state.prep[2]) && "the compost mix"].filter(Boolean);
    panel(`<h2>Skip ${skipped.join(" and ")}?</h2><p>You can plant now or go back to prepare the soil.</p><button id="advanceYes" class="primary">Continue to planting</button><button id="advanceNo">Go back</button>`);
    $("advanceYes").onclick = () => { $("panel").close(); advance(); };
    $("advanceNo").onclick = () => $("panel").close();
  } else advance();
};
function setTool(t) {
  tool = tool === t ? null : t;
  toolActionUntil = 0;
  applying = false;
  lastToolX = null;
  if (tool) view.plot();
  if (tool === "mulch" && state.mulchSupply === 0) state.mulchSupply = 100;
  hideTooltip();
  highlight(null);
  updateUI();
}
function applyAt(x) {
  if (Math.abs(x) > HALF) return;
  if (tool === "drainage" && !state.prep[0]) {
    if (state.budget < 400) { toast("Drainage costs ¥400."); return; }
    state.budget -= 400;
    state.prep[0] = true;
    updateUI();
  }
  if (tool === "compost" && !state.warned.compostSupply) {
    const cost = (state.prep[1] ? 0 : 800) + (state.prep[2] ? 0 : 400);
    if (state.budget < cost) { toast(`The compost mix costs ¥${cost.toLocaleString()}.`); return; }
    state.budget -= cost;
    state.warned.compostSupply = true;
    updateStats();
  }
  toolActionUntil = performance.now() + 260;
  const start = lastToolX ?? x;
  const n = Math.max(1, Math.ceil(Math.abs(x - start) / (CW * 0.7)));
  for (let i = 1; i <= n; i++) {
    const px = start + ((x - start) * i) / n;
    if (tool === "drainage") {
      prepareSoilAt(state, px, tool);
      view.spawn("dig", px, 0.12, 5);
    } else if (tool === "compost") view.spawn("compost", px, 0.85, 6);
    else if (tool === "mulch") {
      state.mulchSupply = Math.max(0, (state.mulchSupply ?? 100) - 1);
      view.spawn("mulch", px, 0.75, 5);
      if (state.mulchSupply === 0) {
        tool = null;
        applying = false;
        toast("Mulch bag empty. Tap the bag button to refill it.");
        updateUI();
        break;
      }
    } else if (tool === "water") view.spawn("water", px, 0.95, 5);
  }
  lastToolX = x;
  view.target = x;
}
function clearWeeds(weeds) {
  if (!weeds.length) return;
  const removed = new Set(weeds);
  for (const weed of weeds) {
    view.uproot(weed);
    returnWeedToSoil(state, weed);
  }
  state.weeds = state.weeds.filter(weed => !removed.has(weed));
  view.sync();
  save();
}
function pluck(w) {
  clearWeeds([w]);
  view.target = w.x;
  highlight(null);
  hideTooltip();
  toast(`${byId(w.sid).name} pulled out and left to decompose.`);
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
    state.speed = 1;
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
    const p = view.project(w.x, plantHeight(w) * 0.72, w.z ?? 2.8);
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
  const hit = tool ? null : view.hit(
      e.clientX,
      e.clientY,
      e.pointerType === "touch" ? 24 : 12,
    ),
    point = view.worldPoint(e.clientX, e.clientY, tool ? 3.05 : 1);
  view.target = point.x;
  if (!tool && point.y < 0) {
    const soil = view.inspectSoil(e.clientX, e.clientY);
    if (soil) showSoilTooltip(soil, e.clientX, e.clientY);
  }
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
  if (tool && Math.abs(point.x) <= HALF) {
    applying = true;
    lastToolX = null;
    applyAt(point.x);
  }
});
world.addEventListener("pointermove", (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  if (!pointers.has(e.pointerId)) {
    if (e.pointerType !== "touch" && !tool) {
      const insect = view.insectAt(e.clientX, e.clientY);
      if (insect) {
        highlight(null);
        hideTooltip();
        const el = $("tooltip");
        el.innerHTML = `<strong>${insect.name}</strong><small><i>${insect.species}</i></small>`;
        el.style.display = "block";
        el.style.left = clamp(e.clientX + 15, 8, innerWidth - 245) + "px";
        el.style.top = clamp(e.clientY + 19, 10, innerHeight - 75) + "px";
        return;
      }
      const soil = view.inspectSoil(e.clientX, e.clientY);
      if (soil) {
        highlight(null);
        showSoilTooltip(soil, e.clientX, e.clientY);
      } else {
        const p = view.hit(e.clientX, e.clientY);
        highlight(p);
        showTooltip(p, e.clientX, e.clientY);
      }
    }
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()],
      cx = (a.x + b.x) / 2,
      cy = (a.y + b.y) / 2,
      distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (gesture?.multi && !tool) {
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
  const point = view.worldPoint(e.clientX, e.clientY, tool ? 3.05 : 1);
  if (gesture.plant) {
    if (gesture.moved) positionSeedling(gesture.plant, point.x);
  } else if (tool && applying) {
    if (tool !== "drainage") applyAt(point.x);
  } else if (gesture.moved && !tool) {
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
  if (gesture && !gesture.moved && !gesture.multi && !tool && state.phase === 2 && selected && !gesture.plant) {
    const point = view.worldPoint(e.clientX, e.clientY);
    if (Math.abs(point.x) <= HALF) positionSeedling(selected, point.x);
  } else if (gesture && !gesture.moved && !gesture.multi && !tool && gesture.hit) {
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
    if (tool) return;
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
    if (!tool && pointers.size < 2)
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
    if (!e.target.closest("dialog, #toolBin, #stageBin")) e.preventDefault();
  },
  { passive: false },
);
let binDrag = null;
const bin = $("toolBin");
bin.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch")
    binDrag = { x: e.clientX, left: bin.scrollLeft, moved: false };
});
bin.addEventListener("pointermove", (e) => {
  if (binDrag) {
    const dx = e.clientX - binDrag.x;
    if (Math.abs(dx) > 7) binDrag.moved = true;
    if (binDrag.moved) {
      bin.scrollLeft = binDrag.left - dx;
      e.preventDefault();
    }
  }
});
bin.addEventListener(
  "click",
  (e) => {
    if (binDrag?.moved) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
    binDrag = null;
  },
  true,
);
bin.addEventListener("pointercancel", () => (binDrag = null));
$("home").onclick = () => view.plot();
window.addEventListener("resize", () => view.resize());
window.addEventListener("keydown", (e) => {
  if ($("panel").open) return;
  if (selected && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
    e.preventDefault();
    $(e.key === "ArrowLeft" ? "seedLeft" : "seedRight").click();
    return;
  }
  if (!tool && e.key.startsWith("Arrow")) {
    e.preventDefault();
    view.pan(
      e.key === "ArrowLeft" ? 70 : e.key === "ArrowRight" ? -70 : 0,
      e.key === "ArrowUp" ? 70 : e.key === "ArrowDown" ? -70 : 0,
    );
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
    `<span class="eyebrow">Pocket Forest · Tokushima</span><h2>Learn by growing.</h2><p>Drag to pan in any direction. Use a pinch or trackpad pinch to zoom; a two-finger trackpad scroll pans. Plot returns to your planting area. Hover plants for names, health and age. During survey, tap a plant to open its field note and choose Add to Notebook. Weeds are pulled on the first tap.</p><p>Nearby plants provide a modest shelter bonus in this educational model. Partial shade can protect young shade-tolerant plants and reduce evaporation; deep shade can still limit growth. The score rewards density and diversity, as well as health and weed control.</p><p>Leaf textures are drawn once per species and reused as instances. Existing root segments remain fixed; only new tips seek moisture. Sunlight and canopy interception of rain use raycasts. Water ponds and infiltrates through the soil grid. Mushrooms have individual lifetimes; they are not proof of nutrient sharing or forest health.</p><p>The front elevation compresses depth and density for interaction. Growth, weather, costs and scores are illustrative. Photo identifications remain tentative. Your supplied photographs retain their own copyright; original game code is MIT licensed.</p>${sources.map(([text, url]) => `<p><a href="${url}" target="_blank" rel="noopener">${text} ↗</a></p>`).join("")}`,
  );
const farmerBubble = $("phaseTitle");
let bubbleWidth = 0;
let bubbleHeight = 0;
new ResizeObserver(([entry]) => {
  const size = entry.borderBoxSize?.[0];
  bubbleWidth = size?.inlineSize ?? farmerBubble.offsetWidth;
  bubbleHeight = size?.blockSize ?? farmerBubble.offsetHeight;
}).observe(farmerBubble);

function placeFarmerBubble() {
  const { x, y } = view.project(view.farmerX, 1.93, view.farmer.position.z);
  const visible = x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight;
  farmerBubble.style.visibility = visible ? "visible" : "hidden";
  if (!visible) return;
  const left = clamp(x - bubbleWidth / 2, 8, innerWidth - bubbleWidth - 8);
  const top = Math.max(64, y - bubbleHeight - 12);
  farmerBubble.style.transform = `translate3d(${left}px,${top}px,0)`;
  farmerBubble.style.setProperty("--bubble-tail", `${clamp(x - left, 14, bubbleWidth - 14)}px`);
}

function frame(ms) {
  const cpuStart = performance.now();
  requestAnimationFrame(frame);
  const dt = Math.min(0.06, (ms - lastTime) / 1000 || 0.016);
  lastTime = ms;
  hydrology(state, dt);
  if (applying && tool) {
    toolAccumulator += dt;
    if (toolAccumulator > 0.1) {
      const p = view.worldPoint(pointer.x, pointer.y, 3.05);
      if (tool !== "drainage") applyAt(p.x);
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
  for (const x of view.pendingCompost.splice(0)) {
    if (state.phase !== 1) continue;
    const first = !state.prep[2];
    prepareSoilAt(state, x, "compost");
    if (first) updateUI();
  }
  if ([4, 6].includes(state.phase)) {
    simAccumulator += dt * state.speed;
    let steps = 0;
    while (simAccumulator >= 1 && steps++ < 2) {
      simAccumulator--;
      const review = stepDay(state, (x, y, id) => view.exposure(x, y, id));
      if (state.day % 365 === 274)
        for (const p of state.plants)
          if (p.planted && byId(p.sid).deciduous)
            view.spawn("leaf", p.x, plantHeight(p) * 0.65, 8);
      if (state.day % 3 === 0) view.sync();
      if (review) {
        state.phase = 5;
        state.speed = 1 / 86400;
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
    soilTime = 0;
  }
  if (uiTime > 0.45) {
    updateStats();
    uiTime = 0;
  }
  if (saveTime > 20) {
    save();
    saveTime = 0;
  }
  const renderStart = performance.now();
  const beforeWalk = view.farmerX;
  view.render(dt, ms / 1000, tool, pointer, applying || ms < toolActionUntil);
  if ([4, 6].includes(state.phase) && beforeWalk !== view.farmerX) {
    const left = Math.min(beforeWalk, view.farmerX) - 0.24;
    const right = Math.max(beforeWalk, view.farmerX) + 0.24;
    clearWeeds(state.weeds.filter(weed => weed.x >= left && weed.x <= right));
  }
  for (const leaf of view.landedLeaves.splice(0)) {
    returnLeafToSoil(state, leaf.x, leaf.area);
  }
  // Camera-relative overlays follow the same animation frame as the scene.
  updateWeedAlerts();
  placeFarmerBubble();
  $("world").dataset.renderMs = (performance.now() - renderStart).toFixed(1);
  const cpu = performance.now() - cpuStart;
  framePeak = Math.max(framePeak, cpu);
  frameCount++;
  if (cpu > 16) framesOver16++;
  monitorTime += dt;
  if (monitorTime > 5) {
    $("world").dataset.worstCpuMs = framePeak.toFixed(1);
    $("world").dataset.framesOver16 = framesOver16;
    $("world").dataset.observedFrames = frameCount;
    framePeak = 0;
    frameCount = 0;
    framesOver16 = 0;
    monitorTime = 0;
  }
}
window.addEventListener("pagehide", () => save(true));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    save();
  }
});
updateUI();
view.plot();
requestAnimationFrame(frame);
