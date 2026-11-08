import { layers } from "./species.js";
import {
  returnLeafToSoil,
  returnWeedToSoil,
  prepareSoilAt,
  HALF,
  PLOT_FIRST,
  PLOT_END,
  COLS,
  clamp,
  random,
  getSpecies,
  colAt,
  freshState,
  loadState,
  plantHeight,
  plantSoilCells,
  hydrology,
  addWater,
  stepDay,
  TIME_RATES,
  packState,
  score,
} from "./ecology.js?v=18-2";
import { ForestView } from "./forest-view.js?v=18-2";
import { ForestAudio } from "./forest-audio.js";
const $ = (id) => document.getElementById(id),
  byId = getSpecies;
let state;
try {
  state = loadState(JSON.parse(localStorage.getItem("pocket-forest-v2")));
} catch {
  state = freshState();
}
let view;
try {
  view = new ForestView($("scene"), state);
} catch (e) {
  $("fatal").hidden = false;
  $("fatal").textContent =
    "This forest needs WebGL. Open it in a browser with hardware acceleration enabled.";
  throw e;
}
const sound = new ForestAudio();
$("sound").onclick = async () => {
  const enabled = !sound.enabled;
  $("sound").disabled = true;
  try {
    await sound.setEnabled(enabled);
  } catch {
    toast("Forest audio could not load.");
  } finally {
    $("sound").disabled = false;
    $("sound").setAttribute("aria-pressed", String(sound.enabled));
    $("sound").textContent = sound.enabled ? "🔊" : "🔇";
    $("sound").title = sound.enabled ? "Turn sound off" : "Turn sound on";
  }
};
let framePeak = 0,
  frameCount = 0,
  framesOver16 = 0,
  monitorTime = 0;
const supplyPrices = { mulch: 15, water: 5, compost: 25 };
const legacySeedPrices = { oak: 450, cinnamon: 380, hackberry: 420, privet: 260, camellia: 300, eurya: 200, castanopsis: 480, ardisia: 160, four: 140, fern: 120 };
let tool = null,
  selectedSpecies = null,
  nextToolAt = 0,
  selected = null,
  highlighted = null,
  pointer = { x: innerWidth / 2, y: innerHeight * 0.6 },
  applying = false,
  toolActionUntil = 0,
  simAccumulator = 0,
  lastTime = 0,
  soilTime = 0,
  waterTime = 0,
  uiTime = 0,
  saveTime = 0,
  resetting = false,
  toastTimer,
  pendingTreeTap = null;
const pointers = new Map();
let gesture = null;
const phaseNames = [
  "Survey the woodland",
  "Prepare the soil for planting",
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
let panelReturn = null;
function panel(html, onClose = null) {
  panelReturn = onClose;
  $("panel").classList.remove("shop-panel");
  $("panelContent").innerHTML = html;
  if (!$("panel").open) $("panel").showModal();
  hideTooltip();
}
$("closePanel").onclick = () => $("panel").close();
$("panel").addEventListener("close", () => {
  const back = panelReturn;
  panelReturn = null;
  back?.();
});
function nativeText(sp) {
  return sp.native === true
    ? "Native"
    : sp.native === false
      ? "Non-native"
      : "Native status unresolved";
}
function entry(sp) {
  return `<h2>${sp.name} <span class="plant-height">· ${sp.height} m</span></h2><i class="plant-latin">${sp.latin}</i><div class="plant-badges"><span class="badge ${sp.native === false ? "exotic" : ""}">${nativeText(sp)}</span><span class="badge">${sp.type === "weed" ? "Herb / weed" : layers[sp.layer]}</span></div>${sp.photo ? `<img class="ref-photo" src="photos/${sp.photo}.jpg" alt="Reference photograph for ${sp.name}">` : ""}<p>${sp.desc}</p>`;
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
    selectedSpecies = p.sid;
    view.selected = p;
    view.updateGhosts();
    updateSelection();
    showTooltip(p, pointer.x, pointer.y, touch);
  } else if (touch) {
    pendingTreeTap = p;
    showTooltip(p, pointer.x, pointer.y, true);
  } else openPlantNote(p);
}
function plantReadings(p) {
  const cells = plantSoilCells(state, p);
  const mean = key => Math.round(cells.reduce((sum, cell) => sum + cell[key], 0) / cells.length);
  return {
    health: Math.round(p.health ?? 100),
    moisture: mean("m"),
    nutrients: mean("n"),
    light: Math.round(100 * (p.light ?? view.exposure(p.x, plantHeight(p) * 0.72, p.id).light)),
  };
}
function openPlantNote(p) {
  const sp = byId(p.sid);
  const recorded = state.surveyPlants.includes(p.id);
  const readings = p.wild ? null : plantReadings(p);
  panel(
    entry(sp) +
      (p.health === 0 ? `<p class="death-note"><strong>Cause of death</strong><br>${p.deathReason || "Unknown. This save predates cause-of-death tracking."}</p>` : "") +
      (readings ? `<p>Health <strong>${readings.health}%</strong> · age <strong>${formatAge(p.age)}</strong><br>Current height ${plantHeight(p).toFixed(1)} m<br>Root-zone moisture ${readings.moisture}% · nutrients ${readings.nutrients}%<br>Light ${readings.light}%</p>` : "") +
      (recorded
        ? `<button class="notebook-added" disabled>${state.phase === 0 ? "✓ Surveyed" : "✓ Added to Notebook"}</button>`
        : state.phase === 0 ? '<button id="addNote" class="primary">Add to Notebook</button>' : ""),
  );
  if ($("addNote")) $("addNote").onclick = () => {
    recordSurvey(p);
    $("panel").close();
    toast(`Added ${sp.name} to notebook.`);
  };
}
function formatAge(age = 0) {
  return age < 1
    ? `${Math.floor(age * 365)} days`
    : `${age.toFixed(1)} years`;
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
  const instruction = state.phase === 0
    ? state.surveyPlants.includes(p.id) ? '<span class="survey-checked">✓ Surveyed</span>' : "Tap to survey"
    : sp.type === "weed" ? "Tap to pull out"
    : p.planted ? "Tap to inspect" : "Drag to arrange · tap to plant";
  if (p.wild) {
    el.innerHTML = `<strong>${sp.name} · ${sp.height} m</strong><small><i>${sp.latin}</i><br>${nativeText(sp)} · ${layers[sp.layer]}<br>${instruction}</small>`;
  } else {
    const { health, moisture, nutrients, light } = plantReadings(p);
    el.innerHTML = `<strong>${sp.name} · ${formatAge(p.age)}</strong><small>Health <b>${health}%</b><br>Moisture <b>${moisture}%</b> · Nutrients <b>${nutrients}%</b><br>Light <b>${light}%</b><br>${instruction}</small>`;
  }
  el.style.display = "block";
  el.style.left = clamp(x + 15, 8, innerWidth - el.offsetWidth - 8) + "px";
  el.style.top = clamp(y + 19, 10, innerHeight - el.offsetHeight - 8) + "px";
}
function showSoilTooltip(sample, x, y) {
  const el = $("tooltip");
  el.innerHTML = `<strong>Soil · ${Math.abs(sample.point.y).toFixed(1)} m deep</strong><small>Moisture <b>${sample.cell.m.toFixed(1)}%</b><br>Nutrients <b>${sample.cell.n.toFixed(1)}%</b><br>Drainage <b>${Math.round(sample.cell.d * 100)}%</b></small>`;
  el.style.display = "block";
  el.style.left = clamp(x + 15, 8, innerWidth - 230) + "px";
  el.style.top = clamp(y + 19, 10, innerHeight - 110) + "px";
}
function openNotebook() {
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
    .forEach(b => b.onclick = () => panel(entry(byId(b.dataset.note)), openNotebook));
}
$("notebook").onclick = openNotebook;
function shop() {
  const plants = state.survey.map(byId).filter(sp => sp && sp.type !== "weed").sort((a, b) => a.height - b.height);
  panel(
    `<header class="shop-heading"><h2>🌱 Plant shop</h2><strong>¥${state.budget.toLocaleString()}</strong></header>
    <div class="shop-list">${plants.map(sp =>
      `<div class="entry shop-entry"><img class="shop-thumbnail" src="${view.plantThumbnail(sp)}" alt="Mature ${sp.name} beside the farmer"><div><h3>${sp.name} <strong>${sp.height} m</strong></h3><p>${sp.native === true ? "Native" : sp.native === false ? "Introduced" : "Status unresolved"} · ${layers[sp.layer]}</p></div><button data-buy="${sp.id}" ${state.budget < sp.price ? "disabled" : ""}>¥${sp.price.toLocaleString()} · Select</button></div>`
    ).join("")}</div>`,
  );
  $("panel").classList.add("shop-panel");
  document.querySelectorAll("[data-buy]").forEach(b => b.onclick = () => selectSpecies(b.dataset.buy));
}
function cancelSeedling() {
  if (selected && !selected.planted) {
    if (selected.paid !== false) state.budget += legacySeedPrices[selected.sid] ?? 0;
    state.plants = state.plants.filter(p => p !== selected);
  }
  selected = null;
  selectedSpecies = null;
  view.selected = null;
  highlight(null);
  view.sync();
  updateUI();
  save();
}
function selectSpecies(id) {
  const sp = byId(id);
  if (state.budget < sp.price) return;
  if (sp.native === false && !state.warned.nonNative) {
    panel(`<h2>A visitor from elsewhere</h2><p>${sp.name} is introduced to Japan. Introduced plants can compete for resources and support different wildlife.</p><button id="buyAnyway" class="primary">Select ${sp.name}</button>`, shop);
    $("buyAnyway").onclick = () => {
      state.warned.nonNative = true;
      selectSpecies(id);
    };
    return;
  }
  if (selected && !selected.planted) cancelSeedling();
  selectedSpecies = id;
  const x = clamp(view.center.x + ((state.plants.length % 5) - 2) * 0.55, -HALF + 0.3, HALF - 0.3);
  startSeedling(x);
  panelReturn = null;
  $("panel").close();
}
function startSeedling(x) {
  const sp = byId(selectedSpecies);
  if (!sp || state.budget < sp.price) {
    toast("There isn’t enough budget for another seedling.");
    return;
  }
  const p = {
    id: "p" + Date.now() + Math.floor(Math.random() * 1000),
    sid: sp.id,
    x: clamp(x, -HALF + 0.3, HALF - 0.3),
    z: 2.45,
    age: 45 / 365,
    health: 95,
    biomass: Math.min(0.22, sp.height * 0.12),
    planted: false,
    paid: false,
    seed: state.plants.length + 23,
    roots: [],
    tips: [],
  };
  state.plants.push(p);
  selected = p;
  view.selected = p;
  view.target = p.x;
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
    el.innerHTML = `${byId(selected.sid).name} · Plant here?<br><button id="plantYes" class="primary">Plant</button> <button id="plantLater">Cancel</button>`;
    $("plantYes").onclick = confirmPlant;
    $("plantLater").onclick = cancelSeedling;
  } else if (selectedSpecies && state.phase === 2) {
    el.style.display = "block";
    const sp = byId(selectedSpecies);
    el.innerHTML = `${sp.name} selected · ¥${sp.price.toLocaleString()}<br><small>Tap the plot to place another seedling.</small><br><button id="plantLater">Cancel</button>`;
    $("plantLater").onclick = cancelSeedling;
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
  if (p.paid === false) {
    if (state.budget < sp.price) {
      toast("There isn’t enough budget for this seedling.");
      return;
    }
    state.budget -= sp.price;
    p.paid = true;
  }
  p.planted = true;
  selectedSpecies = sp.id;
  p.drop = 0;
  selected = null;
  view.selected = null;
  highlight(null);
  view.sync();
  updateUI();
  toast(`${sp.name} planted successfully.`);
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
  $("phaseTitle").textContent = p === 0 && surveyed < 5 ? `${phaseNames[p]} · ${surveyed} out of 5` : phaseNames[p];
  $("back").disabled = p === 0;
  $("actions").innerHTML = "";
  const n = $("next");
  n.hidden = false;
  n.disabled = false;
  if (p === 0) {
    n.title = "Prepare soil";
    n.disabled = surveyed < 5;
  }
  if (p === 1) {
    action(`${state.prep[0] ? "✓ " : ""}Drainage`, () => setTool("drainage"), tool === "drainage" ? "active-tool" : "").title =
      "Dry the surface now and let water drain downward faster.";
    action(`${state.prep[1] && state.prep[2] ? "✓ " : ""}Compost`, () => setTool("compost"), tool === "compost" ? "active-tool" : "");
    n.title = "Next · Buy & plant";
  }
  if (p === 2) {
    action("Seedling shop", shop, "shop-button");
    n.title = "Next · Mulch & water";
    n.disabled =
      state.plants.filter((p) => p.planted).length < 2 ||
      state.plants.some((p) => !p.planted);
  }
  if (p === 3) {
    action("Mulch · ¥15", () => setTool("mulch"), tool === "mulch" ? "active-tool" : "");
    action("Water · ¥5", () => setTool("water"), tool === "water" ? "active-tool" : "");
    n.title = "Begin tending";
  }
  if (p === 4 || p === 6) {
    action(
      "Water · ¥5",
      () => setTool("water"),
      tool === "water" ? "active-tool" : "",
    );
    action("Compost · ¥25", () => setTool("compost"), tool === "compost" ? "active-tool" : "");
    n.hidden = p === 6;
    n.title = "Forest review";
    n.disabled = !state.review;
  }
  if (p === 5) {
    action("View review", showReview);
    n.title = "Continue growing";
  }
  n.setAttribute("aria-label", n.title);
  $("stageBin").hidden = !$("actions").childElementCount;
  $("timeline").hidden = ![4, 6].includes(p);
  $("progress").hidden = p !== 4;
  $("remaining").hidden = p !== 4;
  updateSelection();
  updateStats();
}
function updateStats() {
  $("money").textContent = "¥" + state.budget.toLocaleString();
  if (state.phase === 4 || state.phase === 6) {
    const surface = [0, 1, 2].flatMap(row =>
      state.soil.slice(row * COLS + PLOT_FIRST, row * COLS + PLOT_END));
    const rootZoneMoisture = surface.reduce((sum, cell) => sum + cell.m, 0) / surface.length;
    const rootZoneNutrients = surface.reduce((sum, cell) => sum + cell.n, 0) / surface.length;
    const advice = [];
    if (rootZoneMoisture < 38) advice.push("Water the soil.");
    if (state.weeds.length) advice.push("Pull the weeds.");
    if (rootZoneNutrients < 40) advice.push("Add compost to the soil.");
    $("phaseTitle").textContent = advice.length
      ? advice[Math.floor(performance.now() / 5500) % advice.length]
      : phaseNames[state.phase];
  }
  const season = ["Spring", "Summer", "Autumn", "Winter"][Math.floor((state.day % 365) / 91.25)];
  $("date").textContent =
    `Year ${Math.floor(state.day / 365) + 1} · ${season} · Day ${Math.floor(state.day % 365) + 1}`;
  $("remaining").textContent =
    state.phase === 6
      ? "Free growth"
      : `${Math.max(0, 1095 - state.day)} days left`;
  $("progress").value = Math.min(1095, state.day);
  for (const button of $("speeds").children) {
    button.setAttribute("aria-pressed", String(+button.dataset.rate === state.speed));
  }
}

for (const rate of TIME_RATES) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.rate = rate.value;
  button.setAttribute("aria-label", rate.label);
  button.title = rate.label;
  const shape = rate.icon === "pause"
    ? '<path d="M5 4h3v12H5zm7 0h3v12h-3z"/>'
    : rate.icon === "play"
      ? '<path d="M6 3v14l11-7z"/>'
      : rate.value === 30
        ? '<path d="M1 4v12l6-6zm6 0v12l6-6zm6 0v12l6-6z"/>'
        : '<path d="M2 4v12l8-6zm8 0v12l8-6z"/>';
  const speedTag = rate.value === 7 ? "7×" : rate.value === 30 ? "30×" : "";
  button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${shape}</svg>${speedTag ? `<small>${speedTag}</small>` : ""}`;
  button.onclick = () => {
    state.speed = rate.value;
    updateStats();
    save();
  };
  $("speeds").append(button);
}

function enterPhase(phase) {
  const firstVisit = phase > (state.reachedPhase ?? state.phase);
  state.phase = phase;
  state.reachedPhase = Math.max(phase, state.reachedPhase ?? phase);
  selected = phase === 2 ? state.plants.find(p => !p.planted) ?? null : null;
  selectedSpecies = selected?.sid ?? null;
  view.selected = selected;
  tool = null;
  applying = false;
  view.target = 0;
  if (phase !== 0 && Math.abs(view.farmerX) > HALF - 0.55) {
    view.farmerX = clamp(view.farmerX, -HALF + 0.55, HALF - 0.55);
  }
  view.plot(true, phase === 0);
  view.sync();
  if (firstVisit && (phase === 4 || phase === 6)) state.speed = 1;
  updateUI();
  if (phase === 2 && firstVisit) shop();
  if (phase === 5 && state.review) showReview();
  save();
}
function advance() {
  if (state.phase < 6) enterPhase(state.phase + 1);
}
$("back").onclick = () => {
  if (state.phase > 0) enterPhase(state.phase - 1);
};
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
  nextToolAt = 0;
  applying = false;
  if (tool === "drainage") view.plot(true);
  else view.cameraMove = null;
  hideTooltip();
  highlight(null);
  updateUI();
}
function applyAt(point) {
  const { x, y } = point;
  const now = performance.now();
  if (Math.abs(x) > HALF || now < nextToolAt) return;
  if (tool === "drainage" && (y > 0.62 || y < -0.35 || view.cameraMove)) return;
  if (tool === "drainage" && !state.prep[0]) {
    if (state.budget < 400) { toast("Drainage costs ¥400."); return; }
    state.budget -= 400;
    state.prep[0] = true;
    updateUI();
  }
  if (tool === "compost" && state.phase === 1 && !state.warned.compostSupply) {
    const cost = (state.prep[1] ? 0 : 800) + (state.prep[2] ? 0 : 400);
    if (state.budget < cost) { toast(`The compost mix costs ¥${cost.toLocaleString()}.`); return; }
    state.budget -= cost;
    state.warned.compostSupply = true;
  }
  const price = tool === "compost" && state.phase === 1 ? 0 : (supplyPrices[tool] ?? 0);
  if (state.budget < price) {
    toast(`Each application costs ¥${price}.`);
    applying = false;
    return;
  }
  state.budget -= price;
  nextToolAt = now + (tool === "mulch" ? 320 : tool === "compost" ? 140 : 105);
  toolActionUntil = now + 210;
  if (tool === "drainage") {
    prepareSoilAt(state, x, tool);
    view.digParticles(x, 0.13, 6);
    view.updateSoil();
    const sample = view.inspectSoil(pointer.x, pointer.y);
    if (sample) showSoilTooltip(sample, pointer.x, pointer.y);
  } else {
    view.pour(tool, pointer);
  }
  view.target = x;
  updateStats();
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
function letterGrade(points, maximum = 100) {
  const ratio = points / maximum;
  return ratio >= 0.9 ? "A" : ratio >= 0.8 ? "B" : ratio >= 0.7 ? "C" : ratio >= 0.6 ? "D" : "F";
}
function showReview() {
  const s = state.review || score(state);
  const grade = letterGrade(s.total);
  const labels = {
    health: "Plant health",
    diversity: "Species variety",
    density: "Living planting density",
    layers: "Forest layers",
    native: "Native planting",
    weeds: "Weed control",
  };
  panel(
    `<h2>Three Year End Review</h2><div class="forest-grade grade-${grade}" aria-label="Grade ${grade}">${grade}</div><div class="forest-score">${s.total} / 100</div><p>${s.alive}/${s.planted} plants alive · ${s.variety} species · ${s.layers}/4 layers<br>${s.weeds} weeds remain; ${s.weedLoad} average during establishment.</p>${Object.entries(
      s.points,
    )
      .map(([key, points]) => {
        const maximum = key === "layers" || key === "weeds" ? 10 : key === "native" ? 5 : 25;
        const subgrade = letterGrade(points, maximum);
        return `<div class="score-row"><span>${labels[key]}</span><strong class="grade-${subgrade}">${points.toFixed(1)} / ${maximum} <span class="subgrade" aria-label="Grade ${subgrade}">${subgrade}</span></strong></div>`;
      })
      .join(
        "",
      )}<p>Density reaches its target at 20 surviving seedlings in this compressed planting strip; diversity reaches its target at seven species. A few healthy trees form a healthy start, but cannot earn a dense-forest score.</p><div class="review-actions"><button id="restartReview">Restart</button><button id="continueReview" class="primary">Continue growing →</button></div>`,
  );
  $("restartReview").onclick = () => confirmRestart(showReview);
  $("continueReview").onclick = () => {
    $("panel").close();
    enterPhase(6);
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
    const p = view.project(w.x, plantHeight(w) * 0.72);
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
    point = view.worldPoint(e.clientX, e.clientY);
  if (!tool) view.target = point.x;
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
    selectedSpecies = selected.sid;
    view.selected = selected;
    view.updateGhosts();
    updateSelection();
  }
  if (tool && Math.abs(point.x) <= HALF) {
    applying = true;
    applyAt(point);
  }
});
world.addEventListener("pointermove", (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  if (!pointers.has(e.pointerId)) {
    if (e.pointerType !== "touch") {
      const insect = !tool && view.insectAt(e.clientX, e.clientY);
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
        const p = tool ? null : view.hit(e.clientX, e.clientY);
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
  const point = view.worldPoint(e.clientX, e.clientY);
  if (gesture.plant) {
    if (gesture.moved) positionSeedling(gesture.plant, point.x);
  } else if (tool && applying) {
    if (tool !== "drainage") applyAt(point);
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
  if (gesture && !gesture.moved && !gesture.multi && !tool && state.phase === 2 && selectedSpecies && !gesture.plant) {
    const point = view.worldPoint(e.clientX, e.clientY);
    if (Math.abs(point.x) <= HALF) {
      if (selected) positionSeedling(selected, point.x);
      else startSeedling(point.x);
    }
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
const bin = $("utilityBin");
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
$("home").onclick = () => view.plot(true);
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
function confirmRestart(onCancel = null) {
  panel(
    '<h2>Start a new forest?</h2><p>This replaces this browser’s saved forest.</p><button id="resetYes" class="primary">Start again</button>',
    onCancel,
  );
  $("resetYes").onclick = () => {
    resetting = true;
    localStorage.removeItem("pocket-forest-v2");
    localStorage.removeItem("pocket-forest-v1");
    location.reload();
  };
}
$("restart").onclick = () => confirmRestart();
const farmerBubble = $("phaseTitle");
let bubbleWidth = 0;
let bubbleHeight = 0;
new ResizeObserver(([entry]) => {
  const size = entry.borderBoxSize?.[0];
  bubbleWidth = size?.inlineSize ?? farmerBubble.offsetWidth;
  bubbleHeight = size?.blockSize ?? farmerBubble.offsetHeight;
}).observe(farmerBubble);

function placeFarmerBubble() {
  const { x, y } = view.project(view.farmerX, 1.79, view.farmer.position.z);
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
  waterTime += dt;
  const waterInterval = Math.min(0.075, 0.6 / Math.max(1, state.speed));
  if (waterTime >= waterInterval) {
    hydrology(state, waterTime);
    waterTime = 0;
  }
  if (applying && tool && tool !== "drainage" && ms >= nextToolAt) {
    applyAt(view.worldPoint(pointer.x, pointer.y));
  }
  for (const x of view.pendingWater.splice(0)) addWater(state, x, 2.2);
  for (const x of view.pendingMulch.splice(0)) {
    for (
      let c = Math.max(0, colAt(x) - 1);
      c <= Math.min(COLS - 1, colAt(x) + 1);
      c++
    )
      state.soil[c].mulch = clamp(state.soil[c].mulch + 0.24);
  }
  for (const x of view.pendingCompost.splice(0)) {
    const first = state.phase === 1 && !state.prep[2];
    prepareSoilAt(state, x, "compost");
    if (first) updateUI();
  }
  if (state.phase === 6 || (state.phase === 4 && !state.review)) {
    simAccumulator += dt * state.speed;
    let steps = 0;
    while (simAccumulator >= 1 && steps++ < 2) {
      simAccumulator--;
      const review = stepDay(state, (x, y, id) => view.exposure(x, y, id));
      if (state.day % 3 === 0) view.sync();
      if (review) {
        state.phase = 5;
        state.reachedPhase = Math.max(state.reachedPhase ?? 0, 5);
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
  view.render(dt, ms / 1000, tool, pointer, applying || ms < toolActionUntil, state.day + simAccumulator);
  sound.update(view, state, ms / 1000);
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
if (state.phase === 2) {
  selected = state.plants.find(p => !p.planted) ?? null;
  selectedSpecies = selected?.sid ?? null;
  view.selected = selected;
  view.updateGhosts();
}
updateUI();
view.plot(false, state.phase === 0);
requestAnimationFrame(frame);
