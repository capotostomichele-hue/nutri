// js/data.js — data layer (bozza FreeLLMAPI gpt-oss-120b, corretta e verificata a mano)

// ---------- 1. Nutrienti ----------
export const NUTRIENTS = [
  {key:"kcal",label:"Calorie",unit:"kcal",target:3650,kind:"info",group:"macro"},
  {key:"prot",label:"Proteine",unit:"g",target:190,kind:"min",group:"macro"},
  {key:"carb",label:"Carboidrati",unit:"g",target:440,kind:"info",group:"macro"},
  {key:"fat",label:"Grassi",unit:"g",target:125,kind:"info",group:"macro"},
  {key:"fiber",label:"Fibre",unit:"g",target:45,kind:"min",group:"macro"},
  {key:"sugar",label:"Zuccheri",unit:"g",target:null,kind:"info",group:"macro"},
  {key:"sat",label:"Grassi saturi",unit:"g",target:40,kind:"max",group:"macro"},
  {key:"zn",label:"Zinco",unit:"mg",target:11,kind:"min",group:"focus"},
  {key:"vitd",label:"Vitamina D",unit:"µg",target:15,kind:"min",group:"focus"},
  {key:"mg",label:"Magnesio",unit:"mg",target:420,kind:"min",group:"focus"},
  {key:"se",label:"Selenio",unit:"µg",target:55,kind:"min",group:"focus"},
  {key:"omega3",label:"Omega-3 EPA+DHA",unit:"g",target:0.5,kind:"min",group:"focus"},
  {key:"k",label:"Potassio",unit:"mg",target:3400,kind:"min",group:"focus"},
  {key:"na",label:"Sodio",unit:"mg",target:2300,kind:"max",group:"focus"},
  {key:"b12",label:"Vitamina B12",unit:"µg",target:2.4,kind:"min",group:"micro"},
  {key:"folate",label:"Folati",unit:"µg",target:400,kind:"min",group:"micro"},
  {key:"fe",label:"Ferro",unit:"mg",target:8,kind:"min",group:"micro"},
  {key:"ca",label:"Calcio",unit:"mg",target:1000,kind:"min",group:"micro"},
  {key:"vita",label:"Vitamina A",unit:"µg",target:900,kind:"min",group:"micro"},
  {key:"vitc",label:"Vitamina C",unit:"mg",target:90,kind:"min",group:"micro"},
  {key:"vite",label:"Vitamina E",unit:"mg",target:15,kind:"min",group:"micro"},
  {key:"vitk",label:"Vitamina K",unit:"µg",target:120,kind:"min",group:"micro"},
  {key:"b6",label:"Vitamina B6",unit:"mg",target:1.3,kind:"min",group:"micro"},
  {key:"choline",label:"Colina",unit:"mg",target:550,kind:"min",group:"micro"},
  {key:"p",label:"Fosforo",unit:"mg",target:700,kind:"min",group:"micro"},
  {key:"cu",label:"Rame",unit:"mg",target:0.9,kind:"min",group:"micro"},
  {key:"ala",label:"Omega-3 ALA",unit:"g",target:1.6,kind:"min",group:"micro"},
  {key:"chol",label:"Colesterolo",unit:"mg",target:null,kind:"info",group:"micro"},
  {key:"trans",label:"Grassi trans",unit:"g",target:2,kind:"max",group:"micro"}
];

const isNum = v => typeof v === "number" && Number.isFinite(v);

// ---------- 2. Calcoli ----------
export function scale(n100, grams) {
  const f = (Number(grams) || 0) / 100;
  const out = {};
  if (!n100) return out;
  for (const {key} of NUTRIENTS) {
    if (key === "omega3") continue;
    if (isNum(n100[key])) out[key] = n100[key] * f;
  }
  if (isNum(n100.epa) || isNum(n100.dha)) out.omega3 = ((n100.epa || 0) + (n100.dha || 0)) * f;
  return out;
}

export function sumNutrients(list) {
  const sum = {};
  const unknown = {};
  for (const obj of list) {
    for (const {key} of NUTRIENTS) {
      if (isNum(obj[key])) sum[key] = (sum[key] || 0) + obj[key];
      else unknown[key] = (unknown[key] || 0) + 1;
    }
  }
  sum._unknown = unknown;
  return sum;
}

export function getTargets(settings = {}) {
  const map = {};
  for (const {key, target} of NUTRIENTS) map[key] = target;
  const t = settings.targets;
  if (t && typeof t === "object") for (const [k, v] of Object.entries(t)) if (isNum(v)) map[k] = v;
  return map;
}

// ---------- 3. IndexedDB ----------
const STORES = ["entries", "foods", "weights", "days", "settings", "usage"];
let _dbPromise = null;

export function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open("nutri", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("entries")) db.createObjectStore("entries", {keyPath: "id"}).createIndex("date", "date");
      if (!db.objectStoreNames.contains("foods")) db.createObjectStore("foods", {keyPath: "id"});
      if (!db.objectStoreNames.contains("weights")) db.createObjectStore("weights", {keyPath: "date"});
      if (!db.objectStoreNames.contains("days")) db.createObjectStore("days", {keyPath: "date"});
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", {keyPath: "key"});
      if (!db.objectStoreNames.contains("usage")) db.createObjectStore("usage", {keyPath: "foodId"});
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

const reqP = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

// Esegue fn(stores) in una transazione e risolve quando la transazione è completata.
async function tx(names, mode, fn) {
  const db = await openDB();
  const t = db.transaction(names, mode);
  const list = Array.isArray(names) ? names : [names];
  const stores = Object.fromEntries(list.map(n => [n, t.objectStore(n)]));
  let result;
  const done = new Promise((res, rej) => {
    t.oncomplete = () => res(result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
  result = await fn(stores);
  return done;
}

const getAll = name => tx(name, "readonly", s => reqP(s[name].getAll()));
const getOne = (name, key) => tx(name, "readonly", s => reqP(s[name].get(key)));
const putOne = (name, rec) => tx(name, "readwrite", s => { s[name].put(rec); return rec; });
const delOne = (name, key) => tx(name, "readwrite", s => { s[name].delete(key); });

export async function addEntry(entry) {
  const rec = {...entry, id: crypto.randomUUID(), createdAt: Date.now()};
  await tx(["entries", "usage"], "readwrite", async s => {
    s.entries.put(rec);
    const u = await reqP(s.usage.get(rec.foodId));
    s.usage.put({
      foodId: rec.foodId,
      count: (u?.count || 0) + 1,
      lastUsed: Date.now(),
      lastGrams: rec.grams,
      name: rec.name
    });
  });
  return rec;
}
export const updateEntry = e => putOne("entries", e);
export const deleteEntry = id => delOne("entries", id);
export const getEntriesByDate = date => tx("entries", "readonly", s => reqP(s.entries.index("date").getAll(IDBKeyRange.only(date))));
export const getEntriesRange = (from, to) => tx("entries", "readonly", s => reqP(s.entries.index("date").getAll(IDBKeyRange.bound(from, to))));

export const saveFood = f => putOne("foods", {...f, updatedAt: f.updatedAt || Date.now()});
export const getFood = id => getOne("foods", id);
export const getCustomFoods = async () => (await getAll("foods")).filter(f => f.source === "custom");
export const deleteFood = id => delOne("foods", id);

export async function getRecentFoods(limit = 15) {
  return (await getAll("usage")).sort((a, b) => b.lastUsed - a.lastUsed).slice(0, limit);
}
export async function getFrequentFoods(limit = 15) {
  return (await getAll("usage")).sort((a, b) => b.count - a.count).slice(0, limit);
}

export async function saveWeight({date, kg, waist}) {
  return tx("weights", "readwrite", async s => {
    const old = (await reqP(s.weights.get(date))) || {date, kg: null, waist: null};
    const rec = {
      date,
      kg: kg === undefined ? old.kg : kg,
      waist: waist === undefined ? old.waist : waist
    };
    if (rec.kg == null && rec.waist == null) s.weights.delete(date);
    else s.weights.put(rec);
    return rec;
  });
}
export const deleteWeight = date => delOne("weights", date);
export const getWeights = async () => (await getAll("weights")).sort((a, b) => a.date.localeCompare(b.date));

export const saveDay = rec => putOne("days", rec);
export const getDay = date => getOne("days", date);

export async function getSetting(key, fallback) {
  const r = await getOne("settings", key);
  return r ? r.value : fallback;
}
export const setSetting = (key, value) => putOne("settings", {key, value});
export async function getSettings() {
  const obj = {};
  for (const {key, value} of await getAll("settings")) obj[key] = value;
  return obj;
}

// ---------- 4. Database base ----------
let _baseFoods = null;
export async function loadBaseFoods() {
  if (_baseFoods) return _baseFoods;
  const resp = await fetch("./foods.json");
  _baseFoods = (await resp.json()).map(f => ({...f, source: "base"}));
  return _baseFoods;
}
export async function findFood(id) {
  const bf = (await loadBaseFoods()).find(f => f.id === id);
  if (bf) return bf;
  return (await getFood(id)) || null;
}

// ---------- 5. Ricerca ----------
export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, " ")
    .replace(/[^a-z0-9%\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchLocal(query, limit = 30) {
  const q = normalize(query);
  const words = q.split(" ").filter(Boolean);
  if (!words.length) return [];
  const [base, dbFoods, usage] = await Promise.all([loadBaseFoods(), getAll("foods"), getAll("usage")]);
  const usageMap = Object.fromEntries(usage.map(u => [u.foodId, u.count]));
  const results = [];
  for (const food of [...base, ...dbFoods]) {
    const nameTok = normalize(food.name).split(" ");
    const allTok = normalize([food.name, ...(food.alias || []), food.brand || ""].join(" ")).split(" ");
    if (!words.every(w => allTok.some(t => t.startsWith(w)))) continue;
    let score = 1;
    if (normalize(food.name).startsWith(q)) score = 3;
    else if (words.every(w => nameTok.some(t => t.startsWith(w)))) score = 2;
    results.push({food, score, usage: usageMap[food.id] || 0});
  }
  results.sort((a, b) => b.score - a.score || b.usage - a.usage || a.food.name.length - b.food.name.length);
  return results.slice(0, limit).map(r => r.food);
}

// ---------- 6. Open Food Facts ----------
const OFF_FIELDS = "code,product_name,product_name_it,brands,nutriments,serving_quantity,serving_size";

async function fetchTimeout(url, ms = 8000, opts = {}) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, {...opts, signal: ctrl.signal}); }
  finally { clearTimeout(id); }
}

export async function lookupBarcode(code) {
  code = String(code).replace(/\D/g, "");
  if (!code) return null;
  const cached = await getFood("off:" + code);
  if (cached) return cached;
  let data;
  try {
    const resp = await fetchTimeout(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`);
    if (!resp.ok) return null;
    data = await resp.json();
  } catch { throw new Error("Open Food Facts non raggiungibile. Controlla la connessione."); }
  if (data.status !== 1 || !data.product) return null;
  const food = mapOFF({...data.product, code: data.product.code || code});
  await saveFood(food);
  return food;
}

export function mapOFF(p) {
  const nutr = p.nutriments || {};
  const get = (k, factor = 1) => {
    const v = nutr[`${k}_100g`];
    if (v === undefined || v === null || v === "") return undefined;
    const num = Number(v);
    return Number.isFinite(num) ? num * factor : undefined;
  };
  const n = {};
  const set = (key, v) => { if (v !== undefined) n[key] = Math.round(v * 1000) / 1000; };

  let kcal = get("energy-kcal");
  if (kcal === undefined) { const kj = get("energy-kj") ?? get("energy"); if (kj !== undefined) kcal = kj / 4.184; }
  set("kcal", kcal);

  const grams = {prot:"proteins", carb:"carbohydrates", sugar:"sugars", fat:"fat", sat:"saturated-fat", fiber:"fiber", trans:"trans-fat",
    dha:"docosahexaenoic-acid", epa:"eicosapentaenoic-acid", ala:"alpha-linolenic-acid"};
  for (const [key, off] of Object.entries(grams)) set(key, get(off));

  const na = get("sodium", 1000);
  if (na !== undefined) set("na", na);
  else { const salt = get("salt"); if (salt !== undefined) set("na", salt * 400); }

  const toMg = {k:"potassium", ca:"calcium", fe:"iron", mg:"magnesium", zn:"zinc", p:"phosphorus", cu:"copper",
    chol:"cholesterol", vitc:"vitamin-c", vite:"vitamin-e", b6:"vitamin-b6"};
  for (const [key, off] of Object.entries(toMg)) set(key, get(off, 1000));

  const toUg = {vitd:"vitamin-d", b12:"vitamin-b12", se:"selenium", vita:"vitamin-a", vitk:"vitamin-k"};
  for (const [key, off] of Object.entries(toUg)) set(key, get(off, 1e6));
  set("folate", get("folates", 1e6) ?? get("vitamin-b9", 1e6));

  const qty = Number(p.serving_quantity);
  const por = qty > 0 ? [[`1 porzione${p.serving_size ? " (" + p.serving_size + ")" : ""}`, qty]] : [];
  return {
    id: "off:" + p.code,
    barcode: String(p.code),
    name: (p.product_name_it || p.product_name || `Prodotto ${p.code}`).trim(),
    brand: (p.brands || "").split(",")[0].trim(),
    cat: "prodotto",
    source: "off",
    n,
    por,
    updatedAt: Date.now()
  };
}

export async function searchOnline(query) {
  const enc = encodeURIComponent(query);
  const sources = [
    [`https://search.openfoodfacts.org/search?q=${enc}&page_size=25&langs=it&fields=${OFF_FIELDS}`, d => d.hits],
    [`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${enc}&search_simple=1&action=process&json=1&page_size=25&fields=${OFF_FIELDS}`, d => d.products]
  ];
  for (const [url, pick] of sources) {
    try {
      const resp = await fetchTimeout(url);
      if (!resp.ok) continue;
      const list = (pick(await resp.json()) || []).filter(p => p && p.code);
      const mapped = list.map(mapOFF).filter(f => isNum(f.n.kcal));
      if (mapped.length) return mapped;
    } catch { /* prova la fonte successiva */ }
  }
  throw new Error("Ricerca online non disponibile al momento. Usa il database locale o scansiona il codice a barre.");
}

// ---------- 7. Date (ora locale, mai UTC) ----------
const pad = n => String(n).padStart(2, "0");
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };

export const todayISO = () => isoOf(new Date());
export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoOf(new Date(y, m - 1, d + n));
}
const _fmt = new Intl.DateTimeFormat("it-IT", {weekday: "short", day: "numeric", month: "short"});
export const formatDateIT = iso => _fmt.format(parseISO(iso));

// ---------- 8. Peso ----------
export function movingAverage(weights, days = 7) {
  const s = weights.filter(w => isNum(w.kg)).sort((a, b) => a.date.localeCompare(b.date));
  return s.map(cur => {
    const start = addDays(cur.date, -(days - 1));
    const win = s.filter(w => w.date >= start && w.date <= cur.date);
    return {date: cur.date, kg: cur.kg, avg: win.reduce((t, w) => t + w.kg, 0) / win.length};
  });
}

export function weeklyRate(weights) {
  const ma = movingAverage(weights);
  if (ma.length < 2) return null;
  const latest = ma[ma.length - 1];
  const limit = addDays(latest.date, -7);
  const past = ma.filter(r => r.date <= limit);
  if (!past.length) return null;
  const prev = past[past.length - 1];
  const daysBetween = (parseISO(latest.date) - parseISO(prev.date)) / 86400000;
  const diff = (latest.avg - prev.avg) * 7 / daysBetween;
  return {kgPerWeek: diff, pctPerWeek: diff / prev.avg * 100};
}

// ---------- 9. Export / import ----------
export async function exportAll() {
  const [entries, foods, weights, days, usage, settings] = await Promise.all(
    ["entries", "foods", "weights", "days", "usage"].map(getAll).concat(getSettings())
  );
  const exportedAt = new Date().toISOString();
  await setSetting("lastExport", exportedAt);
  settings.lastExport = exportedAt;
  return {app: "nutri", version: 1, exportedAt, settings, entries, foods, weights, days, usage};
}

const csvEsc = v => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const r1 = v => isNum(v) ? Math.round(v * 10) / 10 : "";
const r2 = v => isNum(v) ? Math.round(v * 100) / 100 : "";

export function toCSV(data) {
  const header = ["tipo","data","pasto","alimento","marca","grammi","kcal","prot","carb","fat","fiber","sugar","sat","na","k","mg","zn","se","vitd","omega3","peso_kg","girovita_cm","allenamento_kcal","nota","attivita_strava"];
  const rows = [];
  const empty = () => Array(header.length).fill("");
  for (const e of data.entries || []) {
    const s = scale(e.n100, e.grams);
    const r = empty();
    r.splice(0, 20, "pasto", e.date, e.meal, e.name, e.brand || "", e.grams,
      r1(s.kcal), r1(s.prot), r1(s.carb), r1(s.fat), r1(s.fiber), r1(s.sugar), r1(s.sat),
      r1(s.na), r1(s.k), r1(s.mg), r1(s.zn), r1(s.se), r1(s.vitd), r2(s.omega3));
    rows.push(r);
  }
  for (const w of data.weights || []) {
    const r = empty();
    r[0] = "peso"; r[1] = w.date; r[20] = r2(w.kg); r[21] = r1(w.waist);
    rows.push(r);
  }
  for (const d of data.days || []) {
    if (!d.workoutKcal && !d.note && !(d.strava || []).length) continue;
    const r = empty();
    r[0] = "giorno"; r[1] = d.date; r[22] = d.workoutKcal ?? ""; r[23] = d.note ?? "";
    r[24] = (d.strava || []).map(a => `${a.type} ${a.name} ${a.moving_time_min}min${a.kcal != null ? " " + a.kcal + "kcal" : ""}`).join("; ");
    rows.push(r);
  }
  rows.sort((a, b) => a[1].localeCompare(b[1]));
  return [header, ...rows].map(r => r.map(csvEsc).join(",")).join("\r\n");
}

export async function importAll(data, {replace = false} = {}) {
  if (!data || data.app !== "nutri") throw new Error("File non riconosciuto: serve un export di questa app.");
  const settingsRecs = Object.entries(data.settings || {}).map(([key, value]) => ({key, value}));
  const payload = {
    entries: data.entries || [], foods: data.foods || [], weights: data.weights || [],
    days: data.days || [], usage: data.usage || [], settings: settingsRecs
  };
  await tx(STORES, "readwrite", s => {
    for (const name of STORES) {
      if (replace) s[name].clear();
      for (const rec of payload[name]) s[name].put(rec); // put con id originale: niente duplicati
    }
  });
  return Object.fromEntries(STORES.map(n => [n, payload[n].length]));
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ""));
}

export async function importCrescitaCSV(text) {
  const rows = parseCSV(text);
  const header = (rows.shift() || []).map(h => h.trim().toLowerCase());
  const it = header.indexOf("type"), id = header.indexOf("date"), i1 = header.indexOf("f1");
  if (it < 0 || id < 0 || i1 < 0) throw new Error("CSV non riconosciuto: mancano le colonne type, date, f1.");
  const map = {};
  for (const r of rows) {
    const date = (r[id] || "").trim();
    const raw = (r[i1] || "").trim().replace(",", ".");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || raw === "") continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (r[it] === "entry") (map[date] ||= {}).kg = v;
    else if (r[it] === "waist") (map[date] ||= {}).waist = v;
  }
  const res = {weights: 0, waists: 0};
  for (const [date, o] of Object.entries(map)) {
    await saveWeight({date, kg: o.kg, waist: o.waist});
    if (o.kg !== undefined) res.weights++;
    if (o.waist !== undefined) res.waists++;
  }
  return res;
}

export async function shareOrDownload(filename, content, mime) {
  const file = new File([content], filename, {type: mime});
  if (navigator.canShare?.({files: [file]})) {
    try { await navigator.share({files: [file], title: filename}); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function requestPersistence() {
  try { return !!(await navigator.storage?.persist?.()); } catch { return false; }
}

// ---------- 10. Strava (tramite Worker personale) ----------
async function stravaCfg() {
  const s = await getSettings();
  return s.stravaUrl && s.stravaKey ? {url: s.stravaUrl.replace(/\/+$/, ""), key: s.stravaKey} : null;
}
export const stravaConfigured = async () => !!(await stravaCfg());

async function stravaFetch(path, opts = {}) {
  const cfg = await stravaCfg();
  if (!cfg) throw new Error("Strava non configurato");
  let res;
  try { res = await fetchTimeout(cfg.url + path, 20000, {...opts, headers: {"X-App-Key": cfg.key, ...(opts.headers || {})}}); }
  catch { throw new Error("Server Strava non raggiungibile"); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 409) throw new Error("Strava non collegato: tocca \"Collega Strava\" nelle impostazioni");
  if (res.status === 401) throw new Error("Chiave Strava non valida");
  if (res.status === 429) throw new Error("Limite richieste Strava raggiunto, riprova tra 15 minuti");
  if (!res.ok) throw new Error("Errore Strava (" + (data.error || res.status) + ")");
  return data;
}
export const stravaStatus = () => stravaFetch("/status");
export const stravaDisconnect = () => stravaFetch("/disconnect", {method: "POST"});
export async function stravaAuthUrl() {
  const cfg = await stravaCfg();
  return cfg ? `${cfg.url}/auth?key=${encodeURIComponent(cfg.key)}` : null;
}

// Scarica le attività e aggiorna i giorni: Strava prevale sul dato manuale quando ci sono attività.
export async function syncStrava(from, to) {
  const data = await stravaFetch(`/days?from=${from}&to=${to}`);
  const byDate = Object.fromEntries((data.days || []).map(d => [d.date, d]));
  let changed = false;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const old = (await getDay(d)) || {date: d};
    const s = byDate[d];
    let rec;
    if (s && old.workoutSource === "manuale") rec = {...old, strava: s.activities}; // il valore scritto a mano resta
    else if (s) rec = {...old, workoutKcal: s.kcal, workoutSource: "strava", strava: s.activities};
    else if (old.workoutSource === "strava") rec = {...old, workoutKcal: null, workoutSource: null, strava: []};
    else continue;
    if (JSON.stringify(rec) !== JSON.stringify(old)) { await saveDay(rec); changed = true; }
  }
  await setSetting("stravaLastSync", Date.now());
  return {changed, athlete: data.athlete};
}
