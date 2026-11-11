// js/ui.js — interfaccia (struttura da bozza FreeLLMAPI, riscritta e verificata)
import {
  NUTRIENTS, scale, sumNutrients, getTargets,
  addEntry, updateEntry, deleteEntry, getEntriesByDate, getEntriesRange,
  saveFood, getCustomFoods, deleteFood, getRecentFoods, getFrequentFoods, findFood,
  saveWeight, deleteWeight, getWeights, saveDay, getDay,
  getSetting, setSetting, getSettings, loadBaseFoods,
  searchLocal, lookupBarcode, searchOnline,
  todayISO, addDays, formatDateIT, movingAverage, weeklyRate,
  exportAll, toCSV, importAll, importCrescitaCSV, shareOrDownload, requestPersistence,
  stravaConfigured, stravaStatus, stravaDisconnect, stravaAuthUrl, syncStrava
} from "./data.js";

// Sincronizza Strava in background (al massimo ogni 10 minuti per lo stesso intervallo)
const _syncSeen = {};
async function bgStravaSync(from, to) {
  const k = from + to;
  if (Date.now() - (_syncSeen[k] || 0) < 600000) return;
  if (!(await stravaConfigured())) return;
  _syncSeen[k] = Date.now();
  try {
    const {changed} = await syncStrava(from, to);
    if (changed && ["oggi", "settimana"].includes(state.tab)) render();
  } catch (e) { console.warn("Strava:", e.message); }
}

const MEALS = [["colazione", "Colazione"], ["pranzo", "Pranzo"], ["cena", "Cena"], ["spuntini", "Spuntini"]];
const NUT = Object.fromEntries(NUTRIENTS.map(n => [n.key, n]));
const state = {date: todayISO(), meal: guessMeal(), tab: "oggi", query: ""};

// ---------- helper ----------
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const isNum = v => typeof v === "number" && Number.isFinite(v);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const num = s => { const v = parseFloat(String(s ?? "").replace(",", ".")); return Number.isFinite(v) ? v : NaN; };
const nf = (v, d = 0) => v.toLocaleString("it-IT", {minimumFractionDigits: d, maximumFractionDigits: d});

function fmt(v, unit, key) {
  if (!isNum(v)) return "–";
  const d = key === "omega3" ? 2 : (unit === "kcal" || unit === "mg") ? 0 : 1;
  return `${nf(v, d)} ${unit}`;
}
function guessMeal() {
  const h = new Date().getHours();
  return h < 11 ? "colazione" : h < 16 ? "pranzo" : h < 19 ? "spuntini" : "cena";
}
const mealLabel = k => (MEALS.find(m => m[0] === k) || [, k])[1];
const isToday = d => d === todayISO();

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2500);
}

let sheetOnClose = null;
function openSheet(html, onClose) {
  closeSheet();
  const sheet = $("#sheet");
  $(".sheet-body", sheet).innerHTML = `<div class="sheet-handle"></div>${html}`;
  sheet.classList.remove("hidden");
  sheetOnClose = onClose || null;
  return $(".sheet-body", sheet);
}
function closeSheet() {
  const sheet = $("#sheet");
  if (sheet.classList.contains("hidden")) return;
  sheet.classList.add("hidden");
  $(".sheet-body", sheet).innerHTML = "";
  const cb = sheetOnClose; sheetOnClose = null;
  cb?.();
}

function barRow(key, value, target, unknownCount = 0) {
  const n = NUT[key];
  const has = isNum(target) && target > 0;
  const v = isNum(value) ? value : 0;
  const pct = has ? Math.min(100, v / target * 100) : 0;
  const cls = n.kind === "max" && has && v > target ? " bar-over" : n.kind === "min" && has && v >= target ? " bar-ok" : "";
  const tgt = has ? ` / ${fmt(target, n.unit, key)}` : "";
  const miss = unknownCount > 0 ? `<div class="muted small">⚠ dato mancante per ${unknownCount} aliment${unknownCount === 1 ? "o" : "i"}</div>` : "";
  return `<div class="nrow">
    <div class="row"><span>${esc(n.label)}${n.kind === "max" ? ' <span class="muted small">(max)</span>' : ""}</span><span class="small">${fmt(v, n.unit, key)}${tgt}</span></div>
    ${has ? `<div class="bar"><div class="bar-fill${cls}" style="width:${pct.toFixed(1)}%"></div></div>` : ""}${miss}
  </div>`;
}

async function runExport(kind = "json") {
  try {
    const data = await exportAll();
    if (kind === "json") await shareOrDownload(`nutri-backup-${todayISO()}.json`, JSON.stringify(data), "application/json");
    else await shareOrDownload(`nutri-${todayISO()}.csv`, toCSV(data), "text/csv");
  } catch (e) { toast("Export non riuscito: " + e.message); }
}

// ---------- navigazione ----------
function setTab(tab) {
  state.tab = tab;
  $$("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  render();
}
async function render() {
  const view = $("#view");
  const fn = {oggi: renderOggi, aggiungi: renderAggiungi, peso: renderPeso, settimana: renderSettimana, impostazioni: renderImpostazioni}[state.tab];
  try { await fn(view); } catch (e) { console.error(e); view.innerHTML = `<div class="card warn">Errore: ${esc(e.message)}</div>`; }
  window.scrollTo?.(0, 0);
}

// ---------- OGGI ----------
async function renderOggi(view) {
  const [entries, settings, day] = await Promise.all([getEntriesByDate(state.date), getSettings(), getDay(state.date)]);
  const T = getTargets(settings);
  const scaled = entries.map(e => scale(e.n100, e.grams));
  const tot = sumNutrients(scaled);
  const unk = entries.length ? tot._unknown : {};
  const kcal = tot.kcal || 0;
  const diff = T.kcal - kcal;
  const lastExport = settings.lastExport;
  const daysSince = lastExport ? Math.floor((Date.now() - new Date(lastExport)) / 86400000) : null;

  const mealCards = MEALS.map(([k, label]) => {
    const list = entries.filter(e => e.meal === k).sort((a, b) => a.createdAt - b.createdAt);
    const mk = list.reduce((t, e) => t + (scale(e.n100, e.grams).kcal || 0), 0);
    return `<div class="card">
      <div class="row"><b>${label}</b><span class="muted small">${nf(mk)} kcal</span></div>
      <div class="list">${list.map(e => `<div class="list-item" data-entry="${esc(e.id)}">
        <div><div>${esc(e.name)}</div>${e.brand ? `<div class="muted small">${esc(e.brand)}</div>` : ""}</div>
        <div class="small right">${nf(e.grams)} g<br><span class="muted">${nf(scale(e.n100, e.grams).kcal || 0)} kcal</span></div>
      </div>`).join("")}</div>
      <button class="btn btn-ghost" data-addmeal="${k}">+ Aggiungi</button>
    </div>`;
  }).join("");

  view.innerHTML = `
    <div class="datenav">
      <button class="btn btn-ghost" data-nav="-1">‹</button>
      <button class="btn btn-ghost datelabel" data-nav="0">${isToday(state.date) ? "Oggi" : esc(formatDateIT(state.date))}</button>
      <button class="btn btn-ghost" data-nav="1">›</button>
    </div>
    ${daysSince === null || daysSince > 7 ? `<div class="card warn row"><span>Backup: ${daysSince === null ? "mai esportato" : `ultimo export ${daysSince} giorni fa`}</span><button class="btn btn-primary" data-export>Esporta ora</button></div>` : ""}
    <div class="card">
      <div class="row"><span class="section-title">Calorie</span><span class="muted small">${diff >= 0 ? `Restano ${nf(diff)} kcal` : `Sopra di ${nf(-diff)} kcal`}</span></div>
      <div class="big">${nf(kcal)} <span class="muted small">/ ${nf(T.kcal)} kcal</span></div>
      <div class="bar"><div class="bar-fill${kcal > T.kcal * 1.05 ? " bar-over" : ""}" style="width:${Math.min(100, kcal / T.kcal * 100).toFixed(1)}%"></div></div>
    </div>
    <div class="card">${["prot", "carb", "fat", "fiber", "sat"].map(k => barRow(k, tot[k], T[k], unk[k])).join("")}</div>
    ${mealCards}
    <div class="card"><div class="section-title">Focus testosterone &amp; longevità</div>
      ${NUTRIENTS.filter(n => n.group === "focus").map(n => barRow(n.key, tot[n.key], T[n.key], unk[n.key])).join("")}
    </div>
    <details class="card"><summary class="section-title">Altri micronutrienti</summary>
      ${NUTRIENTS.filter(n => n.group === "micro").map(n => barRow(n.key, tot[n.key], T[n.key], unk[n.key])).join("")}
      <div class="row"><span>Zuccheri</span><span class="small">${fmt(tot.sugar, "g")}</span></div>
    </details>
    <div class="card"><div class="section-title">Allenamento e note</div>
      ${(day?.strava || []).length ? `<div class="list">${day.strava.map(a => `<div class="list-item"><div><div>${esc(a.name)}</div>
        <div class="muted small">${esc(a.type)} · ${a.moving_time_min} min${a.distance_km ? ` · ${nf(a.distance_km, 1)} km` : ""}</div></div>
        <div class="small right">${a.kcal != null ? nf(a.kcal) + " kcal" : "kcal n.d."}</div></div>`).join("")}</div>
        <div class="muted small">Da Strava</div>` : ""}
      <label class="small muted">Kcal allenamento${day?.workoutSource === "strava" ? " (da Strava, modificabile)" : " (Strava/Garmin)"}</label>
      <input class="input" id="wk" type="number" inputmode="numeric" value="${isNum(day?.workoutKcal) ? day.workoutKcal : ""}">
      <label class="small muted">Note</label>
      <textarea class="input" id="note" rows="2">${esc(day?.note || "")}</textarea>
      <div class="muted small">Il target include già l'allenamento (TDEE misurato): questo dato serve solo per l'analisi settimanale.</div>
    </div>`;

  view.onclick = async ev => {
    const t = ev.target.closest("[data-nav],[data-addmeal],[data-entry],[data-export]");
    if (!t) return;
    if (t.dataset.nav !== undefined) {
      const d = Number(t.dataset.nav);
      state.date = d === 0 ? todayISO() : addDays(state.date, d);
      render();
    } else if (t.dataset.addmeal) {
      state.meal = t.dataset.addmeal; setTab("aggiungi");
    } else if (t.dataset.entry) {
      entrySheet(entries.find(e => e.id === t.dataset.entry));
    } else if (t.dataset.export !== undefined) {
      await runExport("json"); render();
    }
  };
  const saveDayField = async ev => {
    const cur = (await getDay(state.date)) || {date: state.date};
    const w = num($("#wk").value);
    const rec = {...cur, date: state.date, workoutKcal: isNum(w) ? w : null, note: $("#note").value.trim()};
    if (ev.target.id === "wk") rec.workoutSource = isNum(w) ? "manuale" : null; // un valore scritto a mano non viene sovrascritto da Strava
    await saveDay(rec);
    toast("Salvato");
  };
  $("#wk").onchange = saveDayField;
  $("#note").onchange = saveDayField;
  bgStravaSync(addDays(state.date, -1), state.date);
}

function entrySheet(entry) {
  if (!entry) return;
  const body = openSheet(`
    <div class="section-title">${esc(entry.name)}</div>
    ${entry.brand ? `<div class="muted small">${esc(entry.brand)}</div>` : ""}
    <label class="small muted">Grammi</label>
    <input class="input" id="eg" type="text" inputmode="decimal" value="${entry.grams}">
    <div class="small muted" id="ep"></div>
    <div class="grid2">
      <button class="btn btn-primary" id="es">Salva</button>
      <button class="btn btn-danger" id="ed">Elimina</button>
    </div>
    ${!isToday(state.date) ? `<button class="btn btn-ghost" id="ec">Copia su oggi</button>` : ""}`);
  const prev = () => {
    const s = scale(entry.n100, num($("#eg", body).value) || 0);
    $("#ep", body).textContent = `${nf(s.kcal || 0)} kcal · P ${fmt(s.prot, "g")} · C ${fmt(s.carb, "g")} · G ${fmt(s.fat, "g")}`;
  };
  prev();
  $("#eg", body).oninput = prev;
  $("#es", body).onclick = async () => {
    const g = num($("#eg", body).value);
    if (!(g > 0)) return toast("Inserisci i grammi");
    await updateEntry({...entry, grams: g}); closeSheet(); toast("Modificato"); render();
  };
  $("#ed", body).onclick = async () => { await deleteEntry(entry.id); closeSheet(); toast("Eliminato"); render(); };
  const c = $("#ec", body);
  if (c) c.onclick = async () => {
    const {id, createdAt, ...rest} = entry;
    await addEntry({...rest, date: todayISO()}); closeSheet(); toast("Copiato su oggi");
  };
}

// ---------- AGGIUNGI ----------
function foodItem(f, extra = "") {
  const sub = [f.brand, f.source === "off" ? "Open Food Facts" : f.source === "custom" ? "personale" : f.cat].filter(Boolean).join(" · ");
  return `<div class="list-item" data-food="${esc(f.id)}" ${extra}>
    <div><div>${esc(f.name)}</div><div class="muted small">${esc(sub)}</div></div>
    <div class="small muted right">${isNum(f.n?.kcal) ? nf(f.n.kcal) : "–"} kcal<br>/100 g</div>
  </div>`;
}
function usageItem(u) {
  return `<div class="list-item" data-usage="${esc(u.foodId)}" data-grams="${u.lastGrams || ""}">
    <div>${esc(u.name)}</div><div class="small muted right">${u.lastGrams ? nf(u.lastGrams) + " g" : ""}</div></div>`;
}

let onlineResults = new Map();
async function renderAggiungi(view) {
  view.innerHTML = `
    <div class="chips">${MEALS.map(([k, l]) => `<button class="chip${state.meal === k ? " chip-active" : ""}" data-meal="${k}">${l}</button>`).join("")}</div>
    <div class="muted small center">${isToday(state.date) ? "Oggi" : esc(formatDateIT(state.date))}</div>
    <input class="input" id="q" type="search" placeholder="Cerca: pasta, petto di pollo, yogurt…" autocomplete="off" value="${esc(state.query)}">
    <div class="grid3">
      <button class="btn btn-primary" id="scan">📷 Scansiona</button>
      <button class="btn" id="online">🌐 Online</button>
      <button class="btn" id="new">✏️ Nuovo</button>
    </div>
    <div id="results"></div>`;

  const results = $("#results", view);
  const showDefault = async () => {
    const [rec, freq] = await Promise.all([getRecentFoods(12), getFrequentFoods(12)]);
    results.innerHTML = (rec.length ? `<div class="section-title">Recenti</div><div class="list">${rec.map(usageItem).join("")}</div>` : "")
      + (freq.length ? `<div class="section-title">Più usati</div><div class="list">${freq.map(usageItem).join("")}</div>` : "")
      + (!rec.length ? `<div class="muted small center spacer">Cerca un alimento o scansiona un codice a barre.</div>` : "");
  };
  const doSearch = async () => {
    const q = $("#q", view).value.trim();
    state.query = q;
    if (!q) return showDefault();
    const list = await searchLocal(q, 40);
    results.innerHTML = list.length
      ? `<div class="list">${list.map(f => foodItem(f)).join("")}</div>`
      : `<div class="muted small center spacer">Nessun risultato nel database locale. Prova "🌐 Online" o crea l'alimento.</div>`;
  };
  let deb;
  $("#q", view).oninput = () => { clearTimeout(deb); deb = setTimeout(doSearch, 200); };
  doSearch();

  view.onclick = async ev => {
    const t = ev.target.closest("[data-meal],[data-food],[data-usage],#scan,#online,#new");
    if (!t) return;
    if (t.dataset.meal) {
      state.meal = t.dataset.meal;
      $$("[data-meal]", view).forEach(b => b.classList.toggle("chip-active", b.dataset.meal === state.meal));
    } else if (t.dataset.food) {
      const f = onlineResults.get(t.dataset.food) || await findFood(t.dataset.food);
      if (f) foodSheet(f);
    } else if (t.dataset.usage) {
      const f = await findFood(t.dataset.usage);
      if (f) foodSheet(f, num(t.dataset.grams));
      else toast("Alimento non più disponibile");
    } else if (t.id === "scan") scannerSheet();
    else if (t.id === "new") customForm();
    else if (t.id === "online") {
      const q = $("#q", view).value.trim();
      if (!q) return toast("Scrivi prima cosa cercare");
      results.innerHTML = `<div class="muted small center spacer">Cerco su Open Food Facts…</div>`;
      try {
        const list = await searchOnline(q);
        onlineResults = new Map(list.map(f => [f.id, f]));
        results.innerHTML = `<div class="section-title">Open Food Facts</div><div class="list">${list.map(f => foodItem(f)).join("")}</div>`;
      } catch (e) { toast(e.message); doSearch(); }
    }
  };
}

function foodSheet(food, grams) {
  const n = food.n || {};
  const g0 = isNum(grams) && grams > 0 ? grams : (food.por?.[0]?.[1] || 100);
  const portions = [...(food.por || []), ["100 g", 100]];
  const body = openSheet(`
    <div class="section-title">${esc(food.name)}</div>
    <div class="muted small">${esc([food.brand, food.source === "off" ? "Open Food Facts" : food.source === "base" ? "USDA" : "personale"].filter(Boolean).join(" · "))}</div>
    <div class="small">Per 100 g: ${fmt(n.kcal, "kcal")} · P ${fmt(n.prot, "g")} · C ${fmt(n.carb, "g")} · G ${fmt(n.fat, "g")}</div>
    <label class="small muted">Grammi</label>
    <input class="input" id="fg" type="text" inputmode="decimal" value="${g0}">
    <div class="chips">${portions.map(([l, g]) => `<button class="chip" data-g="${g}">${esc(l)}${l === "100 g" ? "" : ` (${nf(g)} g)`}</button>`).join("")}</div>
    <div class="card preview" id="fp"></div>
    ${isIncomplete(food) ? `<div class="warn small">Valori incompleti: tocca "Modifica valori" e copiali dall'etichetta.</div>` : ""}
    <button class="btn btn-primary" id="fa">Aggiungi a ${esc(mealLabel(state.meal))}</button>
    ${food.source !== "base" ? `<button class="btn" id="fedit">✏️ Modifica valori</button>` : ""}
    ${food.source === "custom" ? `<button class="btn btn-danger" id="fdel">Elimina alimento</button>` : ""}`);
  const input = $("#fg", body);
  const prev = () => {
    const s = scale(n, num(input.value) || 0);
    $("#fp", body).innerHTML = `<div class="big">${nf(s.kcal || 0)} kcal</div>
      <div class="small">P ${fmt(s.prot, "g")} · C ${fmt(s.carb, "g")} · G ${fmt(s.fat, "g")} · Fibre ${fmt(s.fiber, "g")}</div>`;
  };
  prev();
  input.oninput = prev;
  body.onclick = async ev => {
    const chip = ev.target.closest("[data-g]");
    if (chip) { input.value = chip.dataset.g; prev(); return; }
    if (ev.target.id === "fa") {
      const g = num(input.value);
      if (!(g > 0)) return toast("Inserisci i grammi");
      if (food.source === "off") await saveFood(food);
      await addEntry({date: state.date, meal: state.meal, foodId: food.id, name: food.name, brand: food.brand || "", grams: g, n100: n});
      closeSheet();
      toast(`Aggiunto a ${mealLabel(state.meal)}`);
      state.query = "";
      if (state.tab === "aggiungi") render();
    }
    if (ev.target.id === "fedit") { closeSheet(); customForm("", food); return; }
    if (ev.target.id === "fdel") {
      if (ev.target.dataset.armed) {
        await deleteFood(food.id); closeSheet(); toast("Alimento eliminato"); render();
      } else { ev.target.dataset.armed = "1"; ev.target.textContent = "Tocca di nuovo per confermare"; }
    }
  };
}

function scannerSheet() {
  let sc = null;
  const stop = async () => {
    try { if (sc?.isScanning) await sc.stop(); sc?.clear(); } catch { /* già fermo */ }
    sc = null;
  };
  const body = openSheet(`
    <div class="section-title">Scansiona il codice a barre</div>
    <div id="reader"></div>
    <div id="smsg" class="small muted"></div>
    <div class="row"><input class="input" id="code" type="text" inputmode="numeric" placeholder="o scrivi il codice"><button class="btn" id="cfind">Cerca</button></div>
    <button class="btn btn-ghost" id="sclose">Chiudi</button>`, stop);
  const msg = t => { const m = $("#smsg", body); if (m) m.innerHTML = t; };

  const handle = async code => {
    await stop();
    navigator.vibrate?.(50);
    msg(`Cerco ${esc(code)}…`);
    try {
      const food = await lookupBarcode(code);
      if (food && isIncomplete(food)) {
        closeSheet();
        customForm("", food, "Open Food Facts ha dati incompleti per questo prodotto: completa i valori dall'etichetta (verranno ricordati).");
        return;
      }
      if (food) { closeSheet(); foodSheet(food); return; }
      msg(`Prodotto ${esc(code)} non trovato su Open Food Facts.<br><button class="btn btn-primary" id="mk">Crea alimento con questo codice</button>`);
      $("#mk", body).onclick = () => { closeSheet(); customForm(code); };
    } catch (e) { msg(esc(e.message)); }
  };

  $("#cfind", body).onclick = () => { const c = $("#code", body).value.replace(/\D/g, ""); if (c) handle(c); };
  $("#sclose", body).onclick = closeSheet;

  if (typeof Html5Qrcode === "undefined") { msg("Scanner non disponibile: scrivi il codice."); return; }
  const F = Html5QrcodeSupportedFormats;
  sc = new Html5Qrcode("reader", {formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E], verbose: false});
  let done = false;
  sc.start({facingMode: "environment"}, {fps: 10, qrbox: {width: 260, height: 140}}, code => { if (!done) { done = true; handle(code); } }, () => {})
    .catch(e => msg(`Fotocamera non disponibile (${esc(e?.message || e)}). Scrivi il codice qui sotto.`));
}

const REQUIRED = ["kcal", "prot", "carb", "fat"];
const isIncomplete = f => REQUIRED.some(k => !isNum(f?.n?.[k]));

// Nuovo alimento, oppure modifica/completamento di uno esistente (prodotto scansionato o personale)
function customForm(barcode = "", existing = null, note = "") {
  const fields = [["kcal", "Calorie (kcal) *"], ["prot", "Proteine (g) *"], ["carb", "Carboidrati (g) *"], ["sugar", "di cui zuccheri (g)"],
    ["fat", "Grassi (g) *"], ["sat", "di cui saturi (g)"], ["fiber", "Fibre (g)"], ["salt", "Sale (g)"]];
  const ex = existing?.n || {};
  const val = k => k === "salt" ? (isNum(ex.na) ? Math.round(ex.na / 400 * 100) / 100 : "") : (isNum(ex[k]) ? Math.round(ex[k] * 100) / 100 : "");
  const por0 = existing?.por?.[0];
  const code = existing?.barcode || barcode;
  const body = openSheet(`
    <div class="section-title">${existing ? "Modifica valori" : "Nuovo alimento"}</div>
    ${note ? `<div class="warn small">${esc(note)}</div>` : ""}
    <input class="input" id="cn" placeholder="Nome *" value="${esc(existing?.name || "")}">
    <input class="input" id="cb" placeholder="Marca (facoltativa)" value="${esc(existing?.brand || "")}">
    <input class="input" id="cc" inputmode="numeric" placeholder="Codice a barre (facoltativo)" value="${esc(code || "")}" ${existing ? "disabled" : ""}>
    <div class="section-title small">Valori per 100 g (dall'etichetta)</div>
    <div class="grid2">${fields.map(([k, l]) => `<div><label class="small muted">${l}</label><input class="input" data-f="${k}" inputmode="decimal" value="${val(k)}"></div>`).join("")}</div>
    <div class="section-title small">Porzione (facoltativa)</div>
    <div class="grid2"><input class="input" id="pn" placeholder="es. 1 vasetto" value="${esc(por0?.[0] || "")}"><input class="input" id="pg" inputmode="decimal" placeholder="grammi" value="${por0?.[1] ?? ""}"></div>
    <div id="cmsg" class="small warn-text"></div>
    <button class="btn btn-primary" id="csave">${existing ? "Salva valori" : "Salva e aggiungi"}</button>`);
  $("#csave", body).onclick = async () => {
    const name = $("#cn", body).value.trim();
    const v = Object.fromEntries($$("[data-f]", body).map(i => [i.dataset.f, num(i.value)]));
    if (!name || !["kcal", "prot", "carb", "fat"].every(k => isNum(v[k]))) {
      $("#cmsg", body).textContent = "Compila nome, calorie, proteine, carboidrati e grassi.";
      return;
    }
    // parto dai valori esistenti (micronutrienti di Open Food Facts restano), sovrascrivo quelli del modulo
    const n = {...ex};
    for (const k of ["kcal", "prot", "carb", "sugar", "fat", "sat", "fiber"]) { if (isNum(v[k])) n[k] = v[k]; else delete n[k]; }
    if (isNum(v.salt)) n.na = v.salt * 400; else delete n.na;
    const code = existing ? (existing.barcode || "") : $("#cc", body).value.replace(/\D/g, "");
    const pg = num($("#pg", body).value), pn = $("#pn", body).value.trim();
    const por = pn && pg > 0 ? [[pn, pg], ...(existing?.por || []).slice(1)] : (existing?.por || []).filter(p => p[0] !== por0?.[0]);
    const food = existing
      ? {...existing, name, brand: $("#cb", body).value.trim(), n, por, edited: true, updatedAt: Date.now()}
      : {id: code ? "off:" + code : "custom:" + crypto.randomUUID(), name, brand: $("#cb", body).value.trim(),
         cat: "personale", source: "custom", barcode: code || null, n, por};
    await saveFood(food);
    closeSheet();
    toast("Alimento salvato");
    foodSheet(food);
  };
}

// ---------- PESO ----------
function weightChart(weights) {
  const from = addDays(todayISO(), -60);
  const ma = movingAverage(weights).filter(p => p.date >= from);
  if (ma.length < 2) return `<div class="muted small center">Servono almeno 2 pesate per il grafico.</div>`;
  const W = 340, H = 180, L = 34, R = 8, T = 10, B = 22;
  const t0 = new Date(ma[0].date).getTime(), t1 = new Date(ma[ma.length - 1].date).getTime();
  const vals = ma.flatMap(p => [p.kg, p.avg]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const x = d => L + (W - L - R) * ((new Date(d).getTime() - t0) / Math.max(1, t1 - t0));
  const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const dots = ma.map(p => `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="2.5" fill="var(--muted)"/>`).join("");
  const line = ma.map(p => `${x(p.date).toFixed(1)},${y(p.avg).toFixed(1)}`).join(" ");
  const lab = (tx, ty, s, anchor = "start") => `<text x="${tx}" y="${ty}" font-size="10" fill="var(--muted)" text-anchor="${anchor}">${esc(s)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Andamento del peso">
    <line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" stroke="var(--line)"/>
    <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="var(--line)"/>
    ${lab(2, T + 8, nf(hi, 1))}${lab(2, H - B, nf(lo, 1))}
    ${lab(L, H - 6, formatDateIT(ma[0].date))}${lab(W - R, H - 6, formatDateIT(ma[ma.length - 1].date), "end")}
    ${dots}<polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
  </svg><div class="muted small">Punti: pesate · Linea: media mobile 7 giorni</div>`;
}

async function renderPeso(view) {
  const [weights, baseline] = await Promise.all([getWeights(), getSetting("waistBaseline", null)]);
  const kgs = weights.filter(w => isNum(w.kg));
  const latest = kgs[kgs.length - 1];
  const ma = movingAverage(weights);
  const avg = ma[ma.length - 1]?.avg;
  const rate = weeklyRate(weights);
  const waists = weights.filter(w => isNum(w.waist));
  const lastWaist = waists[waists.length - 1];
  const delta = lastWaist && isNum(baseline) ? lastWaist.waist - baseline : null;
  let rateCls = "muted";
  if (rate) rateCls = rate.pctPerWeek >= 0.25 && rate.pctPerWeek <= 0.5 ? "ok" : (rate.pctPerWeek < 0 || rate.pctPerWeek > 0.6) ? "warn-text" : "muted";
  const sign = v => (v > 0 ? "+" : "") + nf(v, 2);

  view.innerHTML = `
    <div class="card"><div class="section-title">Nuova pesata</div>
      <input class="input" id="wd" type="date" value="${todayISO()}" max="${todayISO()}">
      <div class="grid2">
        <input class="input" id="wkg" inputmode="decimal" placeholder="Peso (kg)">
        <input class="input" id="wwa" inputmode="decimal" placeholder="Girovita (cm)">
      </div>
      <button class="btn btn-primary" id="wsave">Salva</button>
    </div>
    <div class="card">
      <div class="grid2">
        <div><div class="muted small">Ultimo peso</div><div class="big">${latest ? nf(latest.kg, 1) : "–"} <span class="small muted">kg</span></div><div class="muted small">${latest ? esc(formatDateIT(latest.date)) : ""}</div></div>
        <div><div class="muted small">Media 7 giorni</div><div class="big">${isNum(avg) ? nf(avg, 2) : "–"} <span class="small muted">kg</span></div></div>
      </div>
      <div class="${rateCls}">${rate ? `${sign(rate.kgPerWeek)} kg/sett (${sign(rate.pctPerWeek)}%)` : "Ritmo: servono almeno 8 giorni di pesate"}</div>
      <div class="muted small">Lean bulk: +0,25–0,5% a settimana. Se la media si ferma per 2–3 settimane: +150–200 kcal.</div>
    </div>
    <div class="card"><div class="section-title">Girovita</div>
      <label class="small muted">Girovita di riferimento (cm)</label>
      <input class="input" id="wbase" inputmode="decimal" value="${isNum(baseline) ? baseline : ""}" placeholder="misura di partenza">
      <div>${lastWaist ? `Ultimo: ${nf(lastWaist.waist, 1)} cm (${esc(formatDateIT(lastWaist.date))})${delta !== null ? ` · ${delta >= 0 ? "+" : ""}${nf(delta, 1)} cm` : ""}` : `<span class="muted small">Nessuna misura di girovita.</span>`}</div>
      ${delta !== null && delta >= 5 ? `<div class="warn">Guardrail: +5 cm sul riferimento, valuta di chiudere il bulk.</div>` : ""}
    </div>
    <div class="card">${weightChart(weights)}</div>
    <div class="card"><div class="section-title">Storico</div><div class="list">
      ${weights.slice(-60).reverse().map(w => `<div class="list-item" data-w="${w.date}"><span>${esc(formatDateIT(w.date))}</span>
        <span class="small">${isNum(w.kg) ? nf(w.kg, 1) + " kg" : ""}${isNum(w.waist) ? ` · ${nf(w.waist, 1)} cm` : ""}</span></div>`).join("") || `<div class="muted small">Ancora nessuna pesata.</div>`}
    </div></div>`;

  $("#wsave", view).onclick = async () => {
    const date = $("#wd", view).value || todayISO();
    const kg = num($("#wkg", view).value), wa = num($("#wwa", view).value);
    if (!isNum(kg) && !isNum(wa)) return toast("Inserisci peso o girovita");
    if (isNum(kg) && (kg < 30 || kg > 250)) return toast("Peso non plausibile");
    await saveWeight({date, kg: isNum(kg) ? kg : undefined, waist: isNum(wa) ? wa : undefined});
    toast("Salvato"); render();
  };
  $("#wbase", view).onchange = async e => {
    const v = num(e.target.value);
    await setSetting("waistBaseline", isNum(v) ? v : null); toast("Riferimento salvato"); render();
  };
  view.onclick = ev => {
    const t = ev.target.closest("[data-w]");
    if (!t) return;
    const date = t.dataset.w;
    const body = openSheet(`<div class="section-title">${esc(formatDateIT(date))}</div>
      <button class="btn btn-danger" id="wdel">Elimina questa pesata</button>`);
    $("#wdel", body).onclick = async () => { await deleteWeight(date); closeSheet(); toast("Eliminata"); render(); };
  };
}

// ---------- SETTIMANA ----------
async function renderSettimana(view) {
  const from = addDays(state.date, -6);
  const [entries, settings, weights] = await Promise.all([getEntriesRange(from, state.date), getSettings(), getWeights()]);
  const T = getTargets(settings);
  const dates = Array.from({length: 7}, (_, i) => addDays(from, i));
  const perDay = dates.map(d => {
    const es = entries.filter(e => e.date === d);
    return {date: d, n: es.length, tot: sumNutrients(es.map(e => scale(e.n100, e.grams)))};
  });
  const logged = perDay.filter(d => d.n > 0);
  const avg = {};
  for (const {key} of NUTRIENTS) {
    const vals = logged.map(d => d.tot[key]).filter(isNum);
    avg[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / logged.length : null;
  }
  const days = await Promise.all(dates.map(getDay));
  const workout = days.reduce((t, d) => t + (isNum(d?.workoutKcal) ? d.workoutKcal : 0), 0);
  const kgAvg = (a, b) => { const v = weights.filter(w => isNum(w.kg) && w.date >= a && w.date <= b).map(w => w.kg); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
  const wNow = kgAvg(from, state.date), wPrev = kgAvg(addDays(from, -7), addDays(from, -1));
  const c = (v, d = 0) => isNum(v) ? nf(v, d) : "–";

  view.innerHTML = `
    <div class="datenav">
      <button class="btn btn-ghost" data-nav="-7">‹</button>
      <span class="datelabel">${esc(formatDateIT(from))} – ${esc(formatDateIT(state.date))}</span>
      <button class="btn btn-ghost" data-nav="7">›</button>
    </div>
    <div class="card"><div class="scrollx"><table class="table">
      <thead><tr><th>Giorno</th><th>kcal</th><th>P</th><th>C</th><th>G</th><th>Fibre</th></tr></thead>
      <tbody>${perDay.map(d => `<tr class="${d.n ? "" : "muted"}"><td>${esc(formatDateIT(d.date))}</td><td>${d.n ? c(d.tot.kcal) : "–"}</td><td>${d.n ? c(d.tot.prot) : "–"}</td><td>${d.n ? c(d.tot.carb) : "–"}</td><td>${d.n ? c(d.tot.fat) : "–"}</td><td>${d.n ? c(d.tot.fiber) : "–"}</td></tr>`).join("")}
      <tr class="total"><td>Media</td><td>${c(avg.kcal)}</td><td>${c(avg.prot)}</td><td>${c(avg.carb)}</td><td>${c(avg.fat)}</td><td>${c(avg.fiber)}</td></tr></tbody>
    </table></div>
    <div class="muted small">Giorni registrati: ${logged.length}/7 · medie sui soli giorni registrati</div></div>
    <div class="card"><div class="section-title">Peso</div>
      <div>Media settimana: <b>${c(wNow, 2)} kg</b>${isNum(wPrev) ? ` · settimana prima ${c(wPrev, 2)} kg` : ""}${isNum(wNow) && isNum(wPrev) ? ` · <b>${wNow - wPrev >= 0 ? "+" : ""}${nf(wNow - wPrev, 2)} kg</b>` : ""}</div>
      <div class="muted small">Allenamento registrato: ${nf(workout)} kcal</div>
    </div>
    <div class="card"><div class="section-title">Medie vs obiettivi</div>
      ${NUTRIENTS.filter(n => n.key !== "kcal").map(n => barRow(n.key, avg[n.key], T[n.key])).join("")}
    </div>`;
  bgStravaSync(from, state.date);
  view.onclick = ev => {
    const t = ev.target.closest("[data-nav]");
    if (!t) return;
    const next = addDays(state.date, Number(t.dataset.nav));
    state.date = next > todayISO() ? todayISO() : next;
    render();
  };
}

// ---------- IMPOSTAZIONI ----------
async function renderImpostazioni(view) {
  const [settings, custom] = await Promise.all([getSettings(), getCustomFoods()]);
  const T = getTargets(settings);
  const last = settings.lastExport;
  view.innerHTML = `
    <div class="card"><div class="section-title">Backup e analisi</div>
      <div class="muted small">Ultimo export: ${last ? esc(new Date(last).toLocaleString("it-IT", {dateStyle: "medium", timeStyle: "short"})) : "mai"}</div>
      <button class="btn btn-primary" id="xj">Esporta JSON (completo)</button>
      <button class="btn" id="xc">Esporta CSV (per analisi)</button>
      <div class="muted small">I dati restano solo su questo telefono. Esporta una volta a settimana e mandalo al PC (AirDrop o "Salva su File"). Safari può cancellare i dati delle app non usate per settimane: esporta spesso.</div>
    </div>
    <div class="card"><div class="section-title">Strava</div>
      <div id="stst" class="small muted">${settings.stravaUrl ? "Controllo collegamento…" : "Non configurato: apri il link di configurazione che ti ho preparato."}</div>
      ${settings.stravaUrl ? `<div class="grid2"><button class="btn btn-primary" id="stc">Collega Strava</button><button class="btn" id="sts">Sincronizza 30 giorni</button></div>
      <button class="btn btn-ghost small" id="std">Scollega Strava</button>` : ""}
      <div class="muted small">Le kcal di Strava sono solo informative: il target include già l'allenamento.</div>
    </div>
    <div class="card"><div class="section-title">Importa</div>
      <label class="btn">Importa backup JSON<input type="file" id="ij" accept=".json,application/json" hidden></label>
      <label class="btn">Importa storico peso da Crescita (CSV)<input type="file" id="ic" accept=".csv,text/csv" hidden></label>
    </div>
    <div class="card"><div class="section-title">Obiettivi giornalieri</div>
      <div class="grid2">${NUTRIENTS.filter(n => n.target !== null).map(n => `<div><label class="small muted">${esc(n.label)} (${n.unit})${n.kind === "max" ? " max" : ""}</label>
        <input class="input" data-t="${n.key}" inputmode="decimal" value="${T[n.key] ?? ""}"></div>`).join("")}</div>
      <div class="grid2"><button class="btn btn-primary" id="ts">Salva obiettivi</button><button class="btn btn-ghost" id="tr">Ripristina default</button></div>
    </div>
    <div class="card"><div class="section-title">Alimenti personali</div><div class="list">
      ${custom.map(f => `<div class="list-item"><span>${esc(f.name)}${f.brand ? ` <span class="muted small">${esc(f.brand)}</span>` : ""}</span><button class="btn btn-ghost small" data-del="${esc(f.id)}">Elimina</button></div>`).join("") || `<div class="muted small">Nessuno.</div>`}
    </div></div>
    <div class="muted small center spacer">Dati nutrizionali: USDA FoodData Central (SR Legacy) e Open Food Facts (ODbL).</div>`;

  if (settings.stravaUrl) {
    const st = $("#stst", view);
    stravaStatus().then(s => { st.textContent = s.connected ? `Collegato${s.athlete ? " come " + s.athlete : ""}.` : "Non collegato: tocca \"Collega Strava\"."; })
      .catch(e => { st.textContent = e.message; });
    $("#stc", view).onclick = async () => { const u = await stravaAuthUrl(); if (u) window.open(u, "_blank"); };
    $("#sts", view).onclick = async () => {
      st.textContent = "Sincronizzo…";
      try { await syncStrava(addDays(todayISO(), -29), todayISO()); st.textContent = "Sincronizzato."; }
      catch (e) { st.textContent = e.message; }
    };
    $("#std", view).onclick = async ev => {
      if (!ev.target.dataset.armed) { ev.target.dataset.armed = "1"; ev.target.textContent = "Tocca di nuovo per scollegare"; return; }
      try { await stravaDisconnect(); toast("Strava scollegato"); } catch (e) { toast(e.message); }
      render();
    };
  }
  $("#xj", view).onclick = async () => { await runExport("json"); render(); };
  $("#xc", view).onclick = async () => { await runExport("csv"); render(); };
  $("#ij", view).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const r = await importAll(JSON.parse(await f.text())); toast(`Importati: ${r.entries} pasti, ${r.weights} pesate`); render(); }
    catch (err) { toast("Import non riuscito: " + err.message); }
  };
  $("#ic", view).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const r = await importCrescitaCSV(await f.text()); toast(`Importate ${r.weights} pesate e ${r.waists} misure di girovita`); }
    catch (err) { toast("Import non riuscito: " + err.message); }
  };
  $("#ts", view).onclick = async () => {
    const obj = {};
    for (const i of $$("[data-t]", view)) { const v = num(i.value); if (isNum(v)) obj[i.dataset.t] = v; }
    await setSetting("targets", obj); toast("Obiettivi salvati");
  };
  $("#tr", view).onclick = async () => { await setSetting("targets", null); toast("Obiettivi ripristinati"); render(); };
  view.onclick = async ev => {
    const t = ev.target.closest("[data-del]");
    if (!t) return;
    if (!t.dataset.armed) { t.dataset.armed = "1"; t.textContent = "Conferma"; return; }
    await deleteFood(t.dataset.del); toast("Eliminato"); render();
  };
}

// ---------- avvio ----------
export async function init() {
  if (location.hash.startsWith("#setup=")) {
    try {
      const b64 = location.hash.slice(7).replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(escape(atob(b64)));
      const {targets, waistBaseline, stravaUrl, stravaKey} = JSON.parse(json);
      if (targets) await setSetting("targets", targets);
      if (isNum(waistBaseline)) await setSetting("waistBaseline", waistBaseline);
      if (stravaUrl && stravaKey) { await setSetting("stravaUrl", stravaUrl); await setSetting("stravaKey", stravaKey); }
      toast(stravaUrl ? "Configurazione salvata: ora collega Strava dalle impostazioni" : "Configurazione salvata");
    } catch { toast("Link di configurazione non valido"); }
    history.replaceState(null, "", location.pathname + location.search);
  }
  requestPersistence();
  $("#sheet").addEventListener("click", e => { if (e.target.id === "sheet") closeSheet(); });
  $$("#tabs button").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.tab === "oggi" && state.tab === "oggi") state.date = todayISO();
    setTab(b.dataset.tab);
  }));
  // al ritorno in primo piano dopo mezzanotte, torna a oggi
  let lastSeen = todayISO();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && todayISO() !== lastSeen) { lastSeen = todayISO(); state.date = lastSeen; render(); }
  });
  await loadBaseFoods().catch(() => toast("Database alimenti non caricato"));
  setTab("oggi");
}
