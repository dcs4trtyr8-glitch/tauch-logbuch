'use strict';

/* =========================================================
   Tauch-Logbuch – alle Daten liegen lokal in IndexedDB.
   Kein Server, kein Login. Fotos werden als Blob gespeichert.
   ========================================================= */

const APP_VERSION = '1.5.0';
const DB_VERSION = 2;                        // v2: Buddys
const DB_ECHT = 'tauch-logbuch';
const DB_TEST = 'tauch-logbuch-testmodus';   // eigene Datenbank → Beispieldaten landen nie in den echten Daten
const STORES = ['dives', 'certs', 'hotlines', 'contacts', 'photos', 'kv', 'buddies'];
const DATA_STORES = ['dives', 'certs', 'hotlines', 'contacts', 'kv', 'buddies'];
const BACKUP_FORMAT = 'tauch-logbuch-backup';
const SHARE_RE = /TLB([01]):([A-Za-z0-9_-]+)/;   // Buddy-Code: TLB1 = komprimiert, TLB0 = unkomprimiert
const MAX_MESSAGE = 60000;                         // WhatsApp kürzt Nachrichten über 65.536 Zeichen
const QR_MAX = 2900;                               // QR-Code Version 40, Fehlerkorrektur L: max. 2.953 Byte
const PHOTO_LEVELS = [[560, 0.6], [440, 0.5], [340, 0.45], [260, 0.4], [200, 0.35]];   // [px, JPEG-Qualität]
const DEFAULT_SETTINGS = { depth: 'm', pressure: 'bar', temp: 'C', weight: 'kg' };

const DAN_NUMMER = '+39 06 4211 5685';
const SUITS = { nass: 'Nass', halbtrocken: 'Halbtrocken', trocken: 'Trocki' };
const BLUTGRUPPEN = ['', '0+', '0−', 'A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'unbekannt'];
const ORGANISATIONEN = ['PADI', 'SSI', 'VDST', 'CMAS', 'NAUI', 'SDI', 'TDI', 'GUE', 'IANTD', 'Barakuda', 'DLRG'];
const BEZIEHUNGEN = ['Ehefrau', 'Ehemann', 'Partnerin', 'Partner', 'Mutter', 'Vater', 'Bruder', 'Schwester', 'Tochter', 'Sohn', 'Freund', 'Freundin', 'Nachbar', 'Kollege'];

/* ---------- Hilfsfunktionen ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const parseNum = v => {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};
const fmt = (n, d = 1) => (n == null ? '' : Number(n).toLocaleString('de-DE', { maximumFractionDigits: d }));
const fmtPlain = (n, d = 1) => String(Number(Number(n).toFixed(d))).replace('.', ',');   // für Eingabefelder, ohne Tausenderpunkt
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
const fmtDateTime = iso => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const fmtHours = min => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;
const telHref = n => 'tel:' + String(n).replace(/[^\d+]/g, '');
const sortByOrder = list => [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const sortDives = list => [...list].sort((a, b) =>
  (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || '') || (b.nr ?? 0) - (a.nr ?? 0));
const unique = arr => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));

function age(iso) {
  const b = new Date(iso + 'T12:00');
  if (isNaN(b)) return null;
  const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}

/* ---------- Einheiten (gespeichert wird immer metrisch) ---------- */
const UNITS = {
  depth: { m: { label: 'm', f: v => v, b: v => v, d: 1 }, ft: { label: 'ft', f: v => v * 3.28084, b: v => v / 3.28084, d: 0 } },
  pressure: { bar: { label: 'bar', f: v => v, b: v => v, d: 0 }, psi: { label: 'psi', f: v => v * 14.5038, b: v => v / 14.5038, d: 0 } },
  temp: { C: { label: '°C', f: v => v, b: v => v, d: 1 }, F: { label: '°F', f: v => v * 9 / 5 + 32, b: v => (v - 32) * 5 / 9, d: 0 } },
  weight: { kg: { label: 'kg', f: v => v, b: v => v, d: 1 }, lb: { label: 'lb', f: v => v * 2.20462, b: v => v / 2.20462, d: 0 } },
};
let settings = { ...DEFAULT_SETTINGS };
const unit = kind => UNITS[kind][settings[kind]] || Object.values(UNITS[kind])[0];
const dispU = (kind, v) => (v == null ? '–' : `${fmt(unit(kind).f(v), unit(kind).d)} ${unit(kind).label}`);
const inputVal = (kind, v) => (v == null ? '' : fmtPlain(unit(kind).f(v), unit(kind).d));
const toMetric = (kind, v) => Math.round(unit(kind).b(v) * 100) / 100;

/* ---------- Icons ---------- */
const svg = (p, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"${extra}>${p}</svg>`;
const ICON = {
  phone: svg('<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  up: svg('<path d="M6 15l6-6 6 6"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  card: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16.2a3.4 3.4 0 0 1 6.4 0"/><path d="M14.5 10h3.5M14.5 13.5h3.5"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  upload: svg('<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>'),
  share: svg('<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v8h14v-8"/>'),
  users: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 19a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2A5 5 0 0 1 21 19"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  paste: svg('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>'),
  qr: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>'),
  stamp: svg('<path d="M9.5 3h5l-1 7h3.5a2 2 0 0 1 2 2v3H5v-3a2 2 0 0 1 2-2h3.5z"/><path d="M5 19h14"/>'),
  check: svg('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12.5l3 3 5-6"/>'),
};

/* ---------- Flaschen (ab 1.2 mehrere pro Tauchgang) ---------- */
// Ältere Einträge haben nur eine Flasche in Einzelfeldern → als Liste lesen
function getTanks(d) {
  if (Array.isArray(d.tanks)) return d.tanks;
  if (d.tankSize != null || d.pStart != null || d.pEnd != null || d.gas === 'nitrox') {
    return [{ size: d.tankSize ?? null, gas: d.gas || 'luft', o2: d.o2 ?? null, pStart: d.pStart ?? null, pEnd: d.pEnd ?? null }];
  }
  return [];
}
const gasLabel = t => (t.gas === 'nitrox' ? `Nitrox${t.o2 != null ? ` ${fmt(t.o2, 0)} %` : ''}` : 'Luft');
const modDepth = (o2, ppo2) => (ppo2 / (o2 / 100) - 1) * 10;   // maximale Tiefe in m für O₂-Anteil
const dv = (kind, v) => (v == null ? null : Number(unit(kind).f(v).toFixed(unit(kind).d)));   // metrisch → Anzeige, gerundet
const tankO2 = t => (t.gas === 'nitrox' ? (t.o2 ?? 32) : 21);
const ppO2 = (o2, depth) => (o2 / 100) * (depth / 10 + 1);
const okNum = v => (v == null || Number.isNaN(v) ? null : v);
const fmtPp = v => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------- Tauchgangsplan: Aufstieg, Gaswechsel, Gasbedarf ----------
   Bewusst KEINE Dekompressionsberechnung – Nullzeit und Stopps gehören in den Tauchcomputer. */
const PLAN_DEFAULTS = { sac: 20, rate: 10, stop: true, reserve: 50 };
const DESCENT_RATE = 18;   // m/min, Annahme für den Abstieg
const switchDepth = t => Math.floor(modDepth(tankO2(t), 1.6) / 3) * 3;   // Wechseltiefe bei ppO₂ 1,6, auf 3 m abgerundet

function planDive({ depth, duration, tanks, sac, rate, stop, reserve }) {
  if (!depth || !duration || !tanks.length) return { error: 'Für den Plan bitte Tiefe, Tauchzeit und mindestens eine Flasche angeben.' };
  const amb = d => d / 10 + 1;
  const stopDepth = stop && depth > 6 ? 5 : 0;
  const stopTime = stopDepth ? 3 : 0;
  const tDesc = depth / DESCENT_RATE;
  const tAsc = depth / rate;
  const tBottom = duration - tDesc - tAsc - stopTime;
  // Flasche 1 = Grundgas; weitere Flaschen mit mehr O₂ ab ihrer Wechseltiefe (die sauerstoffreichste erlaubte)
  const gasAt = d => {
    let best = 0;
    tanks.forEach((t, i) => { if (i > 0 && switchDepth(t) >= d && tankO2(t) > tankO2(tanks[best])) best = i; });
    return best;
  };
  const used = tanks.map(() => 0);
  used[0] += sac * amb(depth / 2) * tDesc;
  if (tBottom > 0) used[0] += sac * amb(depth) * tBottom;
  for (let d = depth; d > 0; d -= 1) {
    const step = Math.min(1, d);
    const mid = d - step / 2;
    used[gasAt(mid)] += (sac * amb(mid) * step) / rate;
  }
  if (stopTime) used[gasAt(stopDepth)] += sac * amb(stopDepth) * stopTime;

  const switches = tanks.map((t, i) => ({ i, depth: Math.min(switchDepth(t), depth) }))
    .filter(s => s.i > 0 && used[s.i] > 0)
    .map(s => ({ ...s, pp: ppO2(tankO2(tanks[s.i]), s.depth) }));
  const rows = tanks.map((t, i) => {
    const endP = t.size && t.pStart != null ? t.pStart - used[i] / t.size : null;
    return { i, need: used[i], endP, status: endP == null ? 'unknown' : endP < 0 ? 'bad' : endP < reserve ? 'warn' : 'ok' };
  });
  const o2 = tankO2(tanks[0]);
  return {
    depth, rate, tDesc, tBottom, tAsc, stopDepth, stopTime, switches, rows,
    total: tDesc + Math.max(tBottom, 0) + tAsc + stopTime,
    bottomPp: ppO2(o2, depth),
    ead: o2 > 21 ? ((depth + 10) * (1 - o2 / 100)) / 0.79 - 10 : null,
  };
}

function profileSvg(p, tanks) {
  const W = 320, H = 120, L = 44, R = 10, T = 10, B = 18;
  const total = p.total || 1;
  const x = t => (L + (t / total) * (W - L - R)).toFixed(1);
  const y = d => (T + (d / p.depth) * (H - T - B)).toFixed(1);
  const bottomEnd = p.tDesc + Math.max(p.tBottom, 0);
  const pts = [[0, 0], [p.tDesc, p.depth], [bottomEnd, p.depth]];
  let t = bottomEnd + (p.depth - p.stopDepth) / p.rate;
  pts.push([t, p.stopDepth]);
  if (p.stopTime) { t += p.stopTime; pts.push([t, p.stopDepth]); t += p.stopDepth / p.rate; pts.push([t, 0]); }
  const marks = p.switches.map(s => {
    const ts = bottomEnd + (p.depth - Math.max(s.depth, p.stopDepth)) / p.rate;
    return `<circle cx="${x(ts)}" cy="${y(s.depth)}" r="4.5" class="plan-switch"/>
      <text x="${x(ts)}" y="${Number(y(s.depth)) - 8}" text-anchor="middle">${esc(gasLabel(tanks[s.i]))}</text>`;
  }).join('');
  return `<svg class="plan-profile" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tauchprofil">
    <line x1="${L}" y1="${y(0)}" x2="${W - R}" y2="${y(0)}" class="plan-axis"/>
    <line x1="${L}" y1="${y(0)}" x2="${L}" y2="${y(p.depth)}" class="plan-axis"/>
    <polyline points="${pts.map(([a, b]) => `${x(a)},${y(b)}`).join(' ')}" class="plan-line"/>
    ${marks}
    <text x="${L - 6}" y="${Number(y(0)) + 4}" text-anchor="end">0</text>
    <text x="${L - 6}" y="${Number(y(p.depth)) + 4}" text-anchor="end">${esc(dispU('depth', p.depth))}</text>
    <text x="${W - R}" y="${H - 3}" text-anchor="end">${Math.round(total)} min</text>
  </svg>`;
}

function planHtml(p, tanks) {
  if (p.error) return `<p class="hint" style="margin:8px 0 0">${esc(p.error)}</p>`;
  const warn = [];
  if (p.tBottom < 0) warn.push('Die Tauchzeit reicht nicht für Ab- und Aufstieg – bitte verlängern.');
  if (p.bottomPp > 1.6) warn.push(`ppO₂ von Flasche 1 in ${dispU('depth', p.depth)}: ${fmtPp(p.bottomPp)} – viel zu hoch, Gefahr einer Sauerstoffvergiftung!`);
  else if (p.bottomPp > 1.4) warn.push(`ppO₂ von Flasche 1 in ${dispU('depth', p.depth)}: ${fmtPp(p.bottomPp)} – über 1,4, für den Grundteil nicht empfohlen.`);
  for (const r of p.rows) if (r.status === 'bad') warn.push(`Flasche ${r.i + 1} reicht nicht – Bedarf ca. ${fmt(r.need, 0)} l.`);
  const tile = (label, v) => `<div class="stat"><div class="stat-value">${v}</div><div class="stat-label">${label}</div></div>`;
  const statusTxt = { ok: '✓ reicht', warn: '⚠ Reserve angegriffen', bad: '✗ reicht nicht', unknown: '' };
  const rows = [
    [`ppO₂ Flasche 1 in ${dispU('depth', p.depth)}`, fmtPp(p.bottomPp)],
    ['EAD (äquivalente Lufttiefe)', p.ead != null ? dispU('depth', p.ead) : ''],
    ...p.switches.map(s => [`Wechsel auf Flasche ${s.i + 1} (${gasLabel(tanks[s.i])})`, `ab ${dispU('depth', s.depth)} · ppO₂ ${fmtPp(s.pp)}`]),
    ...p.rows.filter(r => r.need > 0 || tanks[r.i].pStart != null).map(r => [
      `Flasche ${r.i + 1} (${gasLabel(tanks[r.i])})`,
      `Bedarf ca. ${fmt(r.need, 0)} l${r.endP != null ? ` · Ende ca. ${dispU('pressure', Math.max(0, r.endP))}` : ''} ${statusTxt[r.status]}`.trim(),
    ]),
  ];
  return `${warn.map(w => `<div class="notice plan-warn"><p>${esc(w)}</p></div>`).join('')}
    <div class="stats" style="margin-top:12px">
      ${tile('Grundzeit', `${Math.max(0, Math.round(p.tBottom))} min`)}
      ${tile('Aufstieg', `${Math.round(p.tAsc + p.stopTime)} min`)}
      ${tile('Gesamt', `${Math.round(p.total)} min`)}
    </div>
    ${profileSvg(p, tanks)}
    ${kvList(rows)}
    <p class="hint">Näherung: Abstieg ${DESCENT_RATE} m/min, Aufstieg ${dispU('depth', p.rate)}/min${p.stopTime ? `, Sicherheitsstopp 3 min auf ${dispU('depth', p.stopDepth)}` : ''}, Gaswechsel bei ppO₂ 1,6. <strong>Keine Dekompressionsberechnung</strong> – Nullzeit und Deko-Stopps immer mit deinem Tauchcomputer planen.</p>`;
}

// Schieberegler + Zahlenfeld, beide synchron. Leeres Zahlenfeld = keine Angabe.
function rangeField({ label, name = '', value, min, max, step, unit: u, dec = 0, def, attrs = '' }) {
  const has = value != null && value !== '';
  return `<div class="field range-field">
    <div class="range-head">
      <span class="field-label">${esc(label)}</span>
      <span class="field-input has-unit range-num"><input type="text" inputmode="decimal"${name ? ` name="${name}"` : ''} value="${has ? fmtPlain(value, dec) : ''}" data-dec="${dec}" autocomplete="off" aria-label="${esc(label)}" ${attrs}><span class="unit">${esc(u)}</span></span>
    </div>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${has ? value : def}"${has ? '' : ' class="unset"'} aria-label="${esc(label)} (Regler)" ${attrs}>
  </div>`;
}
function syncRange(el) {
  const box = el.closest('.range-field');
  if (!box) return;
  const range = $('input[type=range]', box);
  const text = $('input[type=text]', box);
  if (el === range) {
    text.value = fmtPlain(Number(range.value), Number(text.dataset.dec));
    range.classList.remove('unset');
  } else {
    const v = parseNum(text.value);
    if (v == null) range.classList.add('unset');
    else if (!Number.isNaN(v)) { range.value = v; range.classList.remove('unset'); }
  }
}

const scriptLoads = {};
function loadScript(src) {
  return (scriptLoads[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { delete scriptLoads[src]; reject(new Error(`${src} konnte nicht geladen werden`)); };
    document.head.appendChild(s);
  }));
}

/* =========================================================
   Datenbank
   ========================================================= */
let db = null;
let testMode = false;
try { testMode = sessionStorage.getItem('tl-testmodus') === '1'; } catch { /* privat-Modus */ }
let persistAsked = false;

function openDB(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' });
    };
    r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); resolve(r.result); };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Datenbank ist in einem anderen Tab geöffnet'));
  });
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const dbAll = name => req(db.transaction(name).objectStore(name).getAll());
const dbGet = (name, id) => req(db.transaction(name).objectStore(name).get(id));
const dbCount = name => req(db.transaction(name).objectStore(name).count());

// Schreibzugriffe gelten erst als fertig, wenn die Transaktion abgeschlossen ist.
function dbWrite(names, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, 'readwrite');
    fn(t);
    t.oncomplete = () => {
      if (!persistAsked) { persistAsked = true; navigator.storage?.persist?.().catch(() => {}); }
      resolve();
    };
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Speichern abgebrochen'));
  });
}
const getKV = async id => (await dbGet('kv', id))?.value;
const setKV = (id, value) => dbWrite('kv', t => t.objectStore('kv').put({ id, value }));

async function loadSettings() {
  settings = { ...DEFAULT_SETTINGS, ...((await getKV('settings')) || {}) };
}

/* ---------- Fotos ---------- */
const photoURLs = new Map();
async function photoURL(id) {
  if (!id) return '';
  if (photoURLs.has(id)) return photoURLs.get(id);
  const p = await dbGet('photos', id);
  if (!p) return '';
  const url = URL.createObjectURL(p.blob);
  photoURLs.set(id, url);
  return url;
}
function forgetPhoto(id) {
  const u = photoURLs.get(id);
  if (u) { URL.revokeObjectURL(u); photoURLs.delete(id); }
}
function clearPhotoCache() {
  for (const u of photoURLs.values()) URL.revokeObjectURL(u);
  photoURLs.clear();
}
function hydratePhotos(root) {
  $$('img[data-photo]', root).forEach(async img => { img.src = await photoURL(img.dataset.photo); });
}
// Foto aus dem Formular-Zustand (neu = Blob, vorhanden = id) in ein <img> setzen
async function setImg(img, p) {
  if (p.blob) { p.url ||= URL.createObjectURL(p.blob); img.src = p.url; }
  else img.src = await photoURL(p.id);
}

// Verkleinert auf max. 1600 px (lange Seite) und speichert als JPEG.
async function resizeImage(file, max = 1600, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Das Bild konnte nicht gelesen werden'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Das Bild konnte nicht verkleinert werden'))), 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readPhotoInput(input) {
  const files = [...input.files];
  input.value = '';
  if (!files.length) return [];
  toast(files.length > 1 ? `${files.length} Fotos werden verkleinert …` : 'Foto wird verkleinert …', 15000);
  const out = [];
  for (const f of files) {
    try { out.push({ id: uid(), blob: await resizeImage(f) }); }
    catch (e) { toast(e.message, 4000, true); return out; }
  }
  toast(out.length > 1 ? `${out.length} Fotos hinzugefügt` : 'Foto hinzugefügt');
  return out;
}

// Datensatz + neue Fotos in einer Transaktion speichern, entfernte Fotos löschen.
async function saveWithPhotos(store, rec, photos, newIds, oldIds) {
  const keep = new Set(newIds);
  const removed = oldIds.filter(id => id && !keep.has(id));
  await dbWrite([store, 'photos'], t => {
    t.objectStore(store).put(rec);
    const ps = t.objectStore('photos');
    for (const p of photos) if (p.blob) ps.put({ id: p.id, blob: p.blob });
    for (const id of removed) ps.delete(id);
  });
  removed.forEach(forgetPhoto);
  photos.forEach(p => { if (p.url) URL.revokeObjectURL(p.url); });
}
async function deleteWithPhotos(store, id, photoIds) {
  await dbWrite([store, 'photos'], t => {
    t.objectStore(store).delete(id);
    for (const pid of photoIds) if (pid) t.objectStore('photos').delete(pid);
  });
  photoIds.forEach(forgetPhoto);
}

/* =========================================================
   Oberfläche: Meldungen, Dialoge, Großansicht
   ========================================================= */
let toastTimer;
function toast(msg, ms = 2500, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

let modalClose = null;
function modal({ title, text = '', html = '', buttons }) {
  closeModal();
  return new Promise(resolve => {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <h2 id="modal-title">${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}${html}
      <div class="modal-actions">${buttons.map((b, i) => `<button type="button" class="btn ${b.cls || ''}" data-i="${i}">${b.icon || ''}${esc(b.label)}</button>`).join('')}</div>
    </div></div>`;
    modalClose = v => { root.innerHTML = ''; modalClose = null; resolve(v); };
    root.firstElementChild.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (b) modalClose(buttons[b.dataset.i].value);
      else if (e.target.classList.contains('modal-backdrop')) modalClose(undefined);
    });
    root.querySelector('[data-i="0"]').focus();
  });
}
function closeModal() { if (modalClose) modalClose(undefined); }
const confirmDialog = ({ title, text, ok = 'OK', danger = false }) => modal({
  title, text,
  buttons: [{ label: 'Abbrechen', value: false }, { label: ok, value: true, cls: danger ? 'btn-danger' : 'btn-primary' }],
});

function openLightbox(src) {
  if (!src) return;
  const lb = $('#lightbox');
  lb.querySelector('img').src = src;
  lb.hidden = false;
  history.pushState({ lightbox: true }, '');   // Zurück-Taste schließt die Großansicht
}
function hideLightbox() { $('#lightbox').hidden = true; }

/* ---------- Formular-Bausteine ---------- */
function field({ label, name, value = '', type = 'text', mode = '', unit = '', required = false, list = '', placeholder = '', autocomplete = 'off' }) {
  const v = value ?? '';
  const input = type === 'textarea'
    ? `<textarea name="${name}" rows="4"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}>${esc(v)}</textarea>`
    : `<input type="${type}" name="${name}" value="${esc(v)}"${mode ? ` inputmode="${mode}"` : ''}${list ? ` list="${list}"` : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''} autocomplete="${autocomplete}" enterkeyhint="next"${required ? ' aria-required="true"' : ''}>`;
  return `<label class="field"><span class="field-label">${esc(label)}${required ? ' <span class="req">*</span>' : ''}</span>
    <span class="field-input${unit ? ' has-unit' : ''}">${input}${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</span></label>`;
}
const numField = (label, name, kind, value) => field({ label, name, value: inputVal(kind, value), mode: 'decimal', unit: unit(kind).label });
function selectField(label, name, options, value) {
  return `<label class="field"><span class="field-label">${esc(label)}</span><span class="field-input"><select name="${name}">
    ${options.map(o => `<option value="${esc(o)}"${o === (value || '') ? ' selected' : ''}>${o ? esc(o) : '– keine Angabe –'}</option>`).join('')}
  </select></span></label>`;
}
// Auswahl-Knöpfe; optional = nochmal antippen hebt die Auswahl auf. Labels sind feste Texte (HTML erlaubt).
function segmented(name, options, value, optional = false) {
  return `<div class="seg" role="radiogroup"${optional ? ' data-optional="1"' : ''}>${options.map(([v, l]) =>
    `<label><input type="radio" name="${name}" value="${v}"${v === value ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
}
const datalist = (id, values) => `<datalist id="${id}">${values.map(v => `<option value="${esc(v)}"></option>`).join('')}</datalist>`;
function photoButtons(target, multiple = false) {
  return `<div class="photo-buttons">
    <label class="btn">${ICON.camera}Kamera<input type="file" accept="image/*" capture="environment" data-photo-input="${target}"></label>
    <label class="btn">${ICON.image}Galerie<input type="file" accept="image/*"${multiple ? ' multiple' : ''} data-photo-input="${target}"></label>
  </div>`;
}
const saveBar = () => `<div class="save-bar"><button type="button" class="btn" data-cancel>Abbrechen</button><button type="submit" class="btn btn-primary">Speichern</button></div>`;
const kvList = rows => `<dl class="kv">${rows.filter(r => r[1] != null && r[1] !== '').map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;

function formReader(form, original = {}) {
  const errors = [];
  const fd = new FormData(form);
  const text = n => String(fd.get(n) ?? '').trim();
  // Zahl lesen; unveränderte Felder behalten den Originalwert (keine Rundungsdrift bei ft/psi).
  const num = (n, kind) => {
    const raw = text(n);
    if (!raw) return null;
    if (original.id && form.elements[n] && raw === form.elements[n].defaultValue) return original[n] ?? null;
    const v = parseNum(raw);
    if (Number.isNaN(v)) { errors.push([n, 'Bitte eine Zahl eingeben']); return null; }
    return kind ? toMetric(kind, v) : v;
  };
  return { text, num, errors };
}
function showErrors(form, errors) {
  for (const [name, msg] of errors) {
    const f = form.elements[name]?.closest?.('.field');
    if (f && !f.classList.contains('invalid')) {
      f.classList.add('invalid');
      f.insertAdjacentHTML('beforeend', `<span class="field-error">${esc(msg)}</span>`);
    }
  }
  const first = form.elements[errors[0][0]];
  first?.focus?.();
  first?.scrollIntoView?.({ block: 'center' });
  toast(errors[0][1], 3500, true);
}
function clearErrors(form) {
  $$('.field.invalid', form).forEach(f => f.classList.remove('invalid'));
  $$('.field-error', form).forEach(e => e.remove());
}

/* =========================================================
   Navigation (Hash-Routing, damit die Zurück-Taste funktioniert)
   ========================================================= */
let navStack = [];
let replaceNext = false;
let keepScrollNext = false;
let renderSeq = 0;

function navigate(path, { replace = false } = {}) {
  const hash = '#' + path;
  if (location.hash === hash) { replaceNext = replace; router(); return; }
  replaceNext = replace;
  if (replace) location.replace(hash); else location.hash = hash;
}
function goBack(fallback) {
  if (navStack.length >= 2 && navStack[navStack.length - 2] === fallback) history.back();
  else navigate(fallback, { replace: true });
}
function refresh() { keepScrollNext = true; return router(); }

const ID = '([\\w-]+)';
const ROUTES = [
  ['logbuch', pageLogbuch],
  ['logbuch/neu', () => pageDiveForm(null)],
  ['logbuch/packliste', () => pagePack(false)],
  ['logbuch/packliste/bearbeiten', () => pagePack(true)],
  ['logbuch/plan', () => pageDiveForm(null, { planned: true })],
  [`logbuch/plan/${ID}`, buddyId => pageDiveForm(null, { planned: true, buddyId })],
  [`logbuch/${ID}/bearbeiten`, id => pageDiveForm(id)],
  [`logbuch/${ID}/nachtragen`, id => pageDiveForm(id, { complete: true })],
  [`logbuch/${ID}/teilen`, id => pageDiveShare(id)],
  [`logbuch/${ID}/stempel`, id => pageStampRequest(id)],
  [`logbuch/${ID}`, pageDiveDetail],
  ['buddys', () => pageBuddys()],
  ['buddys/teilen', () => pageMyCard()],
  ['buddys/einfuegen', () => pageImportPaste()],
  ['buddys/scannen', () => pageScan()],
  [`buddys/${ID}`, id => pageBuddyDetail(id)],
  ['import=(.+)', raw => pageImportLink(raw)],
  ['brevets', pageBrevets],
  ['brevets/neu', () => pageCertForm(null)],
  [`brevets/${ID}/bearbeiten`, id => pageCertForm(id)],
  [`brevets/${ID}`, pageCertDetail],
  ['notfall', pageNotfall],
  ['notfall/hotline/neu', () => pageHotlineForm(null)],
  [`notfall/hotline/${ID}`, id => pageHotlineForm(id)],
  ['notfall/kontakt/neu', () => pageContactForm(null)],
  [`notfall/kontakt/${ID}`, id => pageContactForm(id)],
  ['notfall/daten', pageProfileForm],
  ['einstellungen', pageSettings],
].map(([p, fn]) => [new RegExp(`^${p}$`), fn]);

async function router() {
  const path = location.hash.replace(/^#\/?/, '') || 'logbuch';

  if (replaceNext) { navStack[Math.max(0, navStack.length - 1)] = path; }
  else if (navStack[navStack.length - 2] === path) navStack.pop();
  else if (navStack[navStack.length - 1] !== path) navStack.push(path);
  replaceNext = false;
  if (navStack.length > 50) navStack = navStack.slice(-50);

  const route = ROUTES.find(([re]) => re.test(path));
  if (!route) { navigate('logbuch', { replace: true }); return; }

  const seq = ++renderSeq;
  const keepScroll = keepScrollNext;
  keepScrollNext = false;
  let page;
  try {
    page = await route[1](...path.match(route[0]).slice(1));
  } catch (err) {
    console.error(err);
    page = { title: 'Fehler', html: `<div class="card"><p>Da ist etwas schiefgelaufen: ${esc(err.message)}</p></div>` };
  }
  if (seq !== renderSeq) return;   // inzwischen weiternavigiert

  closeModal();
  hideLightbox();
  stopCamera();
  const tab = path.split('/')[0];
  document.body.dataset.tab = tab;
  $$('.tabbar a').forEach(a => {
    a.classList.toggle('active', a.dataset.tab === tab);
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $('#title').textContent = page.title;
  document.title = `${page.title} – Tauch-Logbuch`;
  const back = $('#back');
  back.hidden = !page.back;
  back.dataset.target = page.back || '';

  // Frisches <main> pro Seite, damit keine Event-Listener alter Seiten hängen bleiben
  const old = $('#view');
  const view = old.cloneNode(false);
  view.innerHTML = page.html;
  old.replaceWith(view);
  page.after?.(view);
  hydratePhotos(view);
  if (!keepScroll) window.scrollTo(0, 0);
}

const notFound = parent => ({
  title: 'Nicht gefunden', back: parent,
  html: `<div class="empty"><strong>Eintrag nicht gefunden</strong>Vielleicht wurde er gelöscht.</div>`,
});

/* =========================================================
   1. Logbuch
   ========================================================= */
function diveItem(d) {
  const lead = d.planned
    ? `<span class="dive-nr">${ICON.calendar}</span>`
    : `<span class="dive-nr">${d.nr != null ? esc(d.nr) : '–'}</span>`;
  const figs = d.planned
    ? '<span class="dive-figs"><small>geplant</small></span>'
    : `<span class="dive-figs">${dispU('depth', d.maxDepth)}<small>${d.duration != null ? `${fmt(d.duration, 0)} min` : '–'}</small></span>`;
  const extra = d.planned && d.buddy ? ` · mit ${esc(d.buddy)}` : d.location ? ` · ${esc(d.location)}` : '';
  return `<li><a class="dive-item${d.planned ? ' is-planned' : ''}" href="#logbuch/${d.id}">
      ${lead}
      <span class="dive-main">
        <span class="dive-site">${d.stamps?.length ? '<span class="stamp-mini" title="Vom Buddy gestempelt">✓</span>' : ''}${esc(d.site)}</span>
        <span class="dive-date">${fmtDate(d.date)}${d.time ? ` · ${esc(d.time)}` : ''}${extra}</span>
      </span>
      ${figs}
    </a></li>`;
}

async function pageLogbuch() {
  const all = await dbAll('dives');
  const dives = sortDives(all.filter(d => !d.planned));
  const planned = all.filter(d => d.planned)
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''));
  const packList = activeList(await getPack());
  const pack = { total: packList.items.length, done: packList.items.filter(i => i.checked).length };
  const total = dives.reduce((s, d) => s + (d.duration || 0), 0);
  const deepest = dives.reduce((b, d) => (d.maxDepth != null && (!b || d.maxDepth > b.maxDepth) ? d : b), null);

  let notice = '';
  if (!testMode && dives.length >= 3) {
    const meta = (await getKV('meta')) || {};
    const days = meta.lastBackup ? Math.floor((Date.now() - new Date(meta.lastBackup)) / 864e5) : null;
    if (days == null || days >= 30) {
      notice = `<div class="notice"><p>${days == null ? 'Noch kein Backup gemacht.' : `Letztes Backup vor ${days} Tagen.`}</p>
        <a class="btn btn-small" href="#einstellungen">Sichern</a></div>`;
    }
  }

  const items = dives.map(diveItem).join('');

  return {
    title: 'Logbuch',
    html: `${notice}
      <div class="stats">
        <div class="stat"><div class="stat-value">${dives.length}</div><div class="stat-label">Tauchgänge</div></div>
        <div class="stat"><div class="stat-value">${fmtHours(total)}</div><div class="stat-label">Std. unter Wasser</div></div>
        <div class="stat"><div class="stat-value">${deepest ? dispU('depth', deepest.maxDepth) : '–'}</div>
          <div class="stat-label">Tiefster</div>${deepest ? `<div class="stat-sub">${esc(deepest.site)}</div>` : ''}</div>
      </div>
      <a class="btn btn-primary btn-big btn-block" href="#logbuch/neu">${ICON.plus}Neuer Tauchgang</a>
      <div class="btn-row" style="margin-top:10px">
        <a class="btn" href="#logbuch/plan">${ICON.calendar}Planen</a>
        <a class="btn" href="#logbuch/packliste">${ICON.check}Packliste${pack.total ? ` <small class="pack-badge">${pack.done}/${pack.total}</small>` : ''}</a>
      </div>
      ${planned.length ? `<h2 class="section-title">Geplant</h2><ul class="list" style="margin-top:0">${planned.map(diveItem).join('')}</ul>
        ${dives.length ? '<h2 class="section-title">Logbuch</h2>' : ''}` : ''}
      ${dives.length ? `<ul class="list"${planned.length ? ' style="margin-top:0"' : ''}>${items}</ul>`
        : `<div class="empty"><strong>Noch keine Tauchgänge</strong>Trag deinen ersten Tauchgang ein – nur Datum und Tauchplatz sind Pflicht.</div>`}`,
  };
}

async function pageDiveForm(id, opts = {}) {
  const dives = await dbAll('dives');
  const buddies = await dbAll('buddies');
  const logged = dives.filter(x => !x.planned && x.id !== id);
  const nextNr = Math.max(0, ...logged.map(x => x.nr || 0)) + 1;
  const lastWith = k => sortDives(logged).find(x => x[k] != null)?.[k] ?? null;
  let d;
  if (id) {
    d = dives.find(x => x.id === id);
    if (!d) return notFound('logbuch');
    d = { ...d };
  } else {
    const buddy = opts.buddyId ? buddies.find(b => b.id === opts.buddyId) : null;
    d = { date: todayISO(), gas: 'luft', photos: [], planned: !!opts.planned, buddy: buddy?.name || '', buddyIds: buddy ? [buddy.id] : [] };
  }
  if (opts.complete) d.planned = false;
  if (!d.planned && d.nr == null) {
    // Nummer hochzählen, Ausrüstung vom letzten Tauchgang vorschlagen → weniger tippen
    d.nr = nextNr;
    d.suit ??= lastWith('suit');
    d.weight ??= lastWith('weight');
  }
  const photos = (d.photos || []).map(pid => ({ id: pid }));
  // Flaschen: vorhandene übernehmen, sonst Größen/Gase vom letzten Tauchgang vorschlagen
  let tanks = getTanks(d).map(t => ({ ...t }));
  if (!tanks.length) {
    const lastTanks = sortDives(logged).map(getTanks).find(a => a.length) || [{ size: null, gas: 'luft', o2: null }];
    tanks = lastTanks.map(t => ({ size: t.size ?? null, gas: t.gas || 'luft', o2: t.o2 ?? null, pStart: null, pEnd: null }));
  }
  const plan0 = { ...PLAN_DEFAULTS, ...(settings.plan || {}), ...(d.plan || {}) };

  return {
    title: opts.complete ? 'Tauchgang nachtragen'
      : id ? (d.planned ? 'Planung bearbeiten' : `Tauchgang ${d.nr != null ? '#' + d.nr : ''} bearbeiten`)
        : (d.planned ? 'Tauchgang planen' : 'Neuer Tauchgang'),
    back: id ? `logbuch/${id}` : 'logbuch',
    html: `<form id="dive-form" novalidate>
      <fieldset class="form-card"><legend>Allgemein</legend>
        <div class="field"><span class="field-label">Status</span>
          ${segmented('status', [['done', 'Getaucht'], ['planned', 'Geplant']], d.planned ? 'planned' : 'done')}</div>
        <div class="grid2">
          <div data-only-done>${field({ label: 'Tauchgang-Nr.', name: 'nr', value: d.nr ?? '', mode: 'numeric' })}</div>
          ${field({ label: 'Einstiegszeit', name: 'time', type: 'time', value: d.time })}
        </div>
        ${field({ label: 'Datum', name: 'date', type: 'date', value: d.date, required: true })}
      </fieldset>
      <fieldset class="form-card"><legend>Ort &amp; Buddy</legend>
        ${field({ label: 'Tauchplatz / Gewässer', name: 'site', value: d.site, required: true, list: 'dl-site', placeholder: 'z. B. Kreidesee Hemmoor' })}
        ${field({ label: 'Land / Ort', name: 'location', value: d.location, list: 'dl-location', placeholder: 'z. B. Hemmoor, Deutschland' })}
        ${field({ label: 'Buddy', name: 'buddy', value: d.buddy, list: 'dl-buddy' })}
      </fieldset>
      <fieldset class="form-card"><legend>Tiefe &amp; Zeit</legend>
        ${rangeField({ label: 'Max. Tiefe', name: 'maxDepth', value: dv('depth', d.maxDepth), min: 0, max: settings.depth === 'ft' ? 200 : 60,
          step: settings.depth === 'ft' ? 1 : 0.5, unit: unit('depth').label, dec: unit('depth').d, def: settings.depth === 'ft' ? 60 : 18 })}
        ${rangeField({ label: 'Tauchzeit', name: 'duration', value: d.duration, min: 0, max: 120, step: 1, unit: 'min', dec: 0, def: 45 })}
        <div class="grid2" data-only-done>
          ${numField('Wassertemp.', 'waterTemp', 'temp', d.waterTemp)}
          ${numField('Sicht', 'visibility', 'depth', d.visibility)}
        </div>
      </fieldset>
      <fieldset class="form-card"><legend>Flaschen &amp; Gas</legend>
        <div id="tank-edit"></div>
        <button type="button" class="btn btn-block" data-tank-add style="margin-top:12px">${ICON.plus}Flasche hinzufügen</button>
        <p class="hint" data-gas-total></p>
      </fieldset>
      <fieldset class="form-card" data-only-planned><legend>Tauchgangsplan</legend>
        ${rangeField({ label: 'Atemminutenvolumen (SAC)', name: 'planSac', value: plan0.sac, min: 8, max: 35, step: 1, unit: 'l/min', dec: 0, def: 20 })}
        ${rangeField({ label: 'Aufstiegsgeschwindigkeit', name: 'planRate', value: dv('depth', plan0.rate), min: settings.depth === 'ft' ? 10 : 3,
          max: settings.depth === 'ft' ? 60 : 18, step: 1, unit: `${unit('depth').label}/min`, dec: 0, def: settings.depth === 'ft' ? 33 : 10 })}
        ${rangeField({ label: 'Reserve je Flasche', name: 'planReserve', value: dv('pressure', plan0.reserve), min: 0, max: settings.pressure === 'psi' ? 1500 : 100,
          step: settings.pressure === 'psi' ? 100 : 10, unit: unit('pressure').label, dec: 0, def: settings.pressure === 'psi' ? 700 : 50 })}
        ${check('planStop', 'Sicherheitsstopp', `3 Minuten auf ${dispU('depth', 5)}`, plan0.stop)}
        <div data-plan-out></div>
      </fieldset>
      <fieldset class="form-card" data-only-done><legend>Ausrüstung</legend>
        <div class="field"><span class="field-label">Anzug</span>
          ${segmented('suit', [['nass', 'Nass'], ['halbtrocken', 'Halb&shy;trocken'], ['trocken', 'Trocki']], d.suit, true)}</div>
        ${numField('Blei', 'weight', 'weight', d.weight)}
      </fieldset>
      <fieldset class="form-card"><legend>Notizen</legend>
        ${field({ label: 'Was war los? Tiere, Strömung, Besonderheiten …', name: 'notes', type: 'textarea', value: d.notes })}
      </fieldset>
      <fieldset class="form-card" data-only-done><legend>Fotos (optional)</legend>
        <div id="photo-edit" class="photo-edit"></div>
        ${photoButtons('dive', true)}
      </fieldset>
      ${saveBar()}
      ${datalist('dl-site', unique(dives.map(x => x.site)))}
      ${datalist('dl-location', unique(dives.map(x => x.location)))}
      ${datalist('dl-buddy', unique([...dives.map(x => x.buddy), ...buddies.map(b => b.name)]))}
    </form>`,
    after(view) {
      const form = $('#dive-form', view);
      const grid = $('#photo-edit', view);
      const tankBox = $('#tank-edit', form);
      const P = settings.pressure === 'psi' ? { max: 4500, step: 50, def: 3000 } : { max: 300, step: 5, def: 200 };
      const plannedNow = () => form.elements.status.value === 'planned';
      const curDepth = () => { const v = okNum(parseNum(form.elements.maxDepth.value)); return v ? toMetric('depth', v) : null; };
      const readPlan = () => {
        const fd = new FormData(form);
        const n = k => okNum(parseNum(fd.get(k)));
        return {
          sac: n('planSac') || PLAN_DEFAULTS.sac,
          rate: n('planRate') ? toMetric('depth', n('planRate')) : PLAN_DEFAULTS.rate,
          reserve: n('planReserve') != null ? toMetric('pressure', n('planReserve')) : PLAN_DEFAULTS.reserve,
          stop: fd.has('planStop'),
        };
      };
      // MOD für jede Flasche (auch Luft), dazu ppO₂ in der eingestellten Tiefe
      const updateHints = () => {
        const depth = curDepth();
        tanks.forEach((t, i) => {
          const h = $(`[data-mod="${i}"]`, form);
          if (!h) return;
          const o2 = tankO2(t);
          const pp = depth ? ppO2(o2, depth) : 0;
          h.textContent = `${t.gas === 'nitrox' ? '' : 'Luft 21 % · '}MOD ${dispU('depth', modDepth(o2, 1.4))} bei ppO₂ 1,4 · ${dispU('depth', modDepth(o2, 1.6))} bei 1,6`
            + (depth ? ` · ppO₂ in ${dispU('depth', depth)}: ${fmtPp(pp)}` : '')
            + (i > 0 && o2 > tankO2(tanks[0]) ? ` · Wechsel ab ${dispU('depth', switchDepth(t))}` : '');
          // Grundgas (Flasche 1) warnen; Deko-Flaschen sind in der Maximaltiefe absichtlich zu sauerstoffreich
          h.classList.toggle('pp-warn', i === 0 && pp > 1.4 && pp <= 1.6);
          h.classList.toggle('pp-bad', i === 0 && pp > 1.6);
        });
      };
      const updatePlan = () => {
        if (!plannedNow()) return;
        const fd = new FormData(form);
        const plan = planDive({ depth: curDepth(), duration: okNum(parseNum(fd.get('duration'))), tanks, ...readPlan() });
        $('[data-plan-out]', form).innerHTML = planHtml(plan, tanks);
      };
      const gasTotal = () => {
        let have = 0;
        let used = 0;
        for (const t of tanks) {
          if (t.size && t.pStart != null) have += t.size * t.pStart;
          if (!plannedNow() && t.size && t.pStart != null && t.pEnd != null) used += t.size * (t.pStart - t.pEnd);
        }
        $('[data-gas-total]', form).textContent = have ? `Gasvorrat ca. ${fmt(have, 0)} l${used ? ` · verbraucht ca. ${fmt(used, 0)} l` : ''}` : '';
      };
      const drawTanks = () => {
        const isPlanned = plannedNow();
        tankBox.innerHTML = tanks.map((t, i) => `<div class="tank-card">
          <div class="tank-head"><strong>Flasche ${i + 1}</strong>${tanks.length > 1
            ? `<button type="button" class="icon-btn" data-tank-remove="${i}" aria-label="Flasche ${i + 1} entfernen">${ICON.trash}</button>` : ''}</div>
          ${rangeField({ label: 'Größe', value: t.size, min: 1, max: 30, step: 0.5, unit: 'l', dec: 1, def: 12, attrs: `data-i="${i}" data-key="size"` })}
          <div class="field"><span class="field-label">Gas</span>${segmented(`t${i}_gas`, [['luft', 'Luft'], ['nitrox', 'Nitrox']], t.gas || 'luft')}</div>
          ${t.gas === 'nitrox' ? rangeField({ label: 'O₂-Anteil', value: t.o2, min: 22, max: 100, step: 1, unit: '%', dec: 0, def: 32, attrs: `data-i="${i}" data-key="o2"` }) : ''}
          <p class="hint mod-hint" data-mod="${i}"></p>
          ${rangeField({ label: isPlanned ? 'Fülldruck' : 'Druck Anfang', value: dv('pressure', t.pStart), min: 0, max: P.max, step: P.step,
            unit: unit('pressure').label, dec: 0, def: P.def, attrs: `data-i="${i}" data-key="pStart"` })}
          ${isPlanned ? '' : rangeField({ label: 'Druck Ende', value: dv('pressure', t.pEnd), min: 0, max: P.max, step: P.step,
            unit: unit('pressure').label, dec: 0, def: P.def / 4, attrs: `data-i="${i}" data-key="pEnd"` })}
        </div>`).join('');
        gasTotal();
        updateHints();
        updatePlan();
      };
      const applyStatus = () => {
        const isPlanned = plannedNow();
        $$('[data-only-done]', form).forEach(el => { el.hidden = isPlanned; });
        $$('[data-only-planned]', form).forEach(el => { el.hidden = !isPlanned; });
        if (!isPlanned && !form.elements.nr.value) form.elements.nr.value = nextNr;
        drawTanks();
      };
      applyStatus();

      form.addEventListener('input', e => {
        const el = e.target;
        if (!el.closest('.range-field')) return;
        syncRange(el);
        const key = el.dataset.key;
        if (key) {
          const i = Number(el.dataset.i);
          const v = parseNum($('input[type=text]', el.closest('.range-field')).value);
          if (v == null) tanks[i][key] = null;
          else if (!Number.isNaN(v)) tanks[i][key] = key.startsWith('p') ? toMetric('pressure', v) : v;
        }
        gasTotal();
        updateHints();
        updatePlan();
      });
      const drawPhotos = () => {
        grid.innerHTML = photos.map((p, i) => `<div class="photo-thumb"><img alt="Foto ${i + 1}" data-zoom>
          <button type="button" class="photo-remove" data-remove="${i}" aria-label="Foto entfernen">×</button></div>`).join('');
        $$('img', grid).forEach((img, i) => setImg(img, photos[i]));
      };
      drawPhotos();

      form.addEventListener('change', async e => {
        const gasSel = e.target.name?.match(/^t(\d+)_gas$/);
        if (gasSel) {
          const t = tanks[Number(gasSel[1])];
          t.gas = e.target.value;
          if (t.gas === 'nitrox' && t.o2 == null) t.o2 = 32;
          drawTanks();
        }
        if (e.target.name === 'status') applyStatus();
        if (e.target.name === 'planStop') updatePlan();
        if (e.target.dataset.photoInput) { photos.push(...await readPhotoInput(e.target)); drawPhotos(); }
      });
      form.addEventListener('click', async e => {
        const rm = e.target.closest('[data-remove]');
        if (rm && await confirmDialog({ title: 'Foto entfernen?', text: 'Das Foto wird beim Speichern gelöscht.', ok: 'Entfernen', danger: true })) {
          photos.splice(Number(rm.dataset.remove), 1);
          drawPhotos();
        }
        if (e.target.closest('[data-cancel]')) goBack(id ? `logbuch/${id}` : 'logbuch');
        if (e.target.closest('[data-tank-add]')) {
          tanks.push({ size: null, gas: 'luft', o2: null, pStart: null, pEnd: null });
          drawTanks();
        }
        const tankRm = e.target.closest('[data-tank-remove]');
        if (tankRm && await confirmDialog({ title: `Flasche ${Number(tankRm.dataset.tankRemove) + 1} entfernen?`, ok: 'Entfernen', danger: true })) {
          tanks.splice(Number(tankRm.dataset.tankRemove), 1);
          drawTanks();
        }
      });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        clearErrors(form);
        const { text, num, errors } = formReader(form, d);
        const isPlanned = text('status') === 'planned';
        const buddyText = text('buddy');
        const badTank = $$('input[type=text]', tankBox).find(x => x.value.trim() && Number.isNaN(parseNum(x.value)));
        if (badTank) {
          badTank.closest('.field').classList.add('invalid');
          badTank.focus();
          toast('Bitte bei der Flasche eine Zahl eingeben', 3500, true);
          return;
        }
        const cleanTanks = tanks
          .filter(t => t.size != null || t.pStart != null || t.pEnd != null || t.gas === 'nitrox')
          .map(t => ({
            size: t.size ?? null, gas: t.gas || 'luft',
            o2: t.gas === 'nitrox' ? Math.min(100, Math.max(21, t.o2 ?? 32)) : null,
            pStart: t.pStart ?? null, pEnd: isPlanned ? null : t.pEnd ?? null,
          }));
        const t0 = cleanTanks[0] || {};
        const rec = {
          ...d,
          id: d.id || uid(),
          planned: isPlanned,
          nr: isPlanned ? null : num('nr'),
          date: text('date'),
          time: text('time'),
          site: text('site'),
          location: text('location'),
          maxDepth: num('maxDepth', 'depth'),
          duration: num('duration'),
          waterTemp: num('waterTemp', 'temp'),
          visibility: num('visibility', 'depth'),
          tanks: cleanTanks,
          plan: isPlanned ? readPlan() : d.plan,
          // erste Flasche zusätzlich in den alten Einzelfeldern (für ältere Versionen/Backups)
          tankSize: t0.size ?? null,
          gas: t0.gas || 'luft',
          o2: t0.o2 ?? null,
          pStart: t0.pStart ?? null,
          pEnd: t0.pEnd ?? null,
          suit: text('suit') || null,
          weight: num('weight', 'weight'),
          buddy: buddyText,
          // Verknüpfung zu Buddys behalten bzw. über den Namen neu finden
          buddyIds: buddyText === (d.buddy || '') && d.buddyIds?.length
            ? d.buddyIds : buddies.filter(b => nameMatch(buddyText, b.name)).map(b => b.id),
          notes: text('notes'),
          photos: photos.map(p => p.id),
          created: d.created || Date.now(),
          updated: Date.now(),
        };
        if (!rec.date) errors.unshift(['date', 'Bitte ein Datum wählen']);
        if (!rec.site) errors.unshift(['site', 'Bitte den Tauchplatz eintragen']);
        if (errors.length) { showErrors(form, errors); return; }
        try {
          await saveWithPhotos('dives', rec, photos, rec.photos, d.photos || []);
        } catch (err) {
          toast('Speichern fehlgeschlagen: ' + err.message, 5000, true);
          return;
        }
        if (rec.planned) { settings.plan = rec.plan; await setKV('settings', settings); }   // als Vorgabe für die nächste Planung merken
        toast(rec.planned ? 'Tauchgang geplant' : `Tauchgang ${rec.nr != null ? '#' + rec.nr + ' ' : ''}gespeichert`);
        goBack(id ? `logbuch/${id}` : 'logbuch');
      });
    },
  };
}

async function pageDiveDetail(id) {
  const d = await dbGet('dives', id);
  if (!d) return notFound('logbuch');

  const tanks = getTanks(d);
  const tankRows = tanks.map((t, i) => {
    const parts = [t.size != null ? `${fmt(t.size)} l` : '', gasLabel(t)];
    if (d.planned) { if (t.pStart != null) parts.push(dispU('pressure', t.pStart)); }
    else if (t.pStart != null || t.pEnd != null) {
      parts.push(`${t.pStart != null ? fmt(unit('pressure').f(t.pStart), 0) : '?'} → ${dispU('pressure', t.pEnd)}`);
    }
    if (!d.planned && t.size && t.pStart != null && t.pEnd != null) parts.push(`ca. ${fmt((t.pStart - t.pEnd) * t.size, 0)} l`);
    return [tanks.length > 1 ? `Flasche ${i + 1}` : 'Flasche', parts.filter(Boolean).join(' · ')];
  });
  const tile = (label, v) => `<div class="stat"><div class="stat-value">${v}</div><div class="stat-label">${label}</div></div>`;

  return {
    title: d.planned ? 'Geplanter Tauchgang' : `Tauchgang ${d.nr != null ? '#' + d.nr : ''}`,
    back: 'logbuch',
    html: `<div class="detail-head"><h2>${esc(d.site)}</h2>
        <p>${fmtDate(d.date)}${d.time ? `, ${esc(d.time)} Uhr` : ''}${d.location ? ` · ${esc(d.location)}` : ''}</p></div>
      ${d.planned ? `<p class="planned-badge">${ICON.calendar}Geplant${d.buddy ? ` mit ${esc(d.buddy)}` : ''}</p>` : `<div class="tiles">
        ${tile('Max. Tiefe', dispU('depth', d.maxDepth))}
        ${tile('Tauchzeit', d.duration != null ? `${fmt(d.duration, 0)} min` : '–')}
        ${tile('Wasser', dispU('temp', d.waterTemp))}
        ${tile('Sicht', dispU('depth', d.visibility))}
      </div>`}
      <div class="card">${kvList([
        ...(d.planned ? [
          ['Geplante Tiefe', d.maxDepth != null ? dispU('depth', d.maxDepth) : ''],
          ['Geplante Dauer', d.duration != null ? `${fmt(d.duration, 0)} min` : ''],
        ] : []),
        ...tankRows,
        ['Anzug', SUITS[d.suit] || ''],
        ['Blei', d.weight != null ? dispU('weight', d.weight) : ''],
        ['Buddy', d.buddy],
      ]) || '<p class="hint" style="margin:0">Keine weiteren Angaben.</p>'}</div>
      ${d.planned && tanks.length ? `<h2 class="section-title">Tauchgangsplan</h2><div class="card">${planHtml(planDive({
        depth: d.maxDepth, duration: d.duration, tanks, ...PLAN_DEFAULTS, ...(settings.plan || {}), ...(d.plan || {}),
      }), tanks)}</div>` : ''}
      ${d.notes ? `<h2 class="section-title">Notizen</h2><div class="card"><p class="notes">${esc(d.notes)}</p></div>` : ''}
      ${d.photos?.length ? `<h2 class="section-title">Fotos</h2><div class="photo-grid">
        ${d.photos.map((p, i) => `<img data-photo="${esc(p)}" data-zoom alt="Foto ${i + 1}">`).join('')}</div>` : ''}
      ${d.planned ? '' : `<h2 class="section-title">Buddy-Stempel</h2>
        ${(d.stamps || []).map((s, i) => `<div class="card stamp-card">
            <div class="stamp" data-stamp="${i}"><span class="stamp-top">Buddy-Stempel</span><strong>${esc(s.signerName)}</strong><span>${esc(new Date(s.at).toLocaleDateString('de-DE'))}</span></div>
            <p class="stamp-status" data-stamp-status="${i}">Wird geprüft …</p>
          </div>`).join('')}
        <a class="btn btn-primary btn-block" href="#logbuch/${d.id}/stempel">${ICON.stamp}${d.stamps?.length ? 'Weiteren Stempel anfordern' : 'Buddy-Stempel anfordern'}</a>`}
      ${d.planned ? `<a class="btn btn-block" href="#logbuch/packliste" style="margin-top:18px">${ICON.check}Packliste öffnen</a>
        <a class="btn btn-primary btn-big btn-block" href="#logbuch/${d.id}/nachtragen" style="margin-top:10px">${ICON.edit}Tauchgang nachtragen</a>` : ''}
      <a class="btn btn-block" href="#logbuch/${d.id}/teilen" style="margin-top:${d.planned ? 10 : 18}px">${ICON.share}Mit Buddy teilen</a>
      <div class="btn-row" style="margin-top:10px">
        <button type="button" class="btn btn-outline-danger" data-delete>${ICON.trash}Löschen</button>
        <a class="btn${d.planned ? '' : ' btn-primary'}" href="#logbuch/${d.id}/bearbeiten">${ICON.edit}Bearbeiten</a>
      </div>`,
    after(view) {
      (d.stamps || []).forEach(async (s, i) => {
        const st = await stampStatus(d, s);
        const el = $(`[data-stamp-status="${i}"]`, view);
        if (!el) return;
        el.textContent = st.text;
        el.classList.add(`stamp-${st.level}`);
        $(`[data-stamp="${i}"]`, view).classList.add(`stamp-${st.level}`);
      });
      $('[data-delete]', view).addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: d.planned ? 'Planung löschen?' : 'Tauchgang löschen?',
          text: `${d.nr != null ? '#' + d.nr + ' · ' : ''}${d.site} vom ${fmtDate(d.date)} wird endgültig gelöscht${d.photos?.length ? ', inklusive Fotos' : ''}.`,
          ok: 'Löschen', danger: true,
        });
        if (!ok) return;
        await deleteWithPhotos('dives', d.id, d.photos || []);
        toast('Tauchgang gelöscht');
        goBack('logbuch');
      });
    },
  };
}

/* ---------- Packliste (abhaken, zurücksetzen, selbst einstellen) ---------- */
const DEFAULT_PACK = ['Maske', 'Schnorchel', 'Flossen', 'Anzug', 'Füßlinge', 'Handschuhe', 'Kopfhaube', 'Jacket (BCD)',
  'Atemregler + Oktopus', 'Tauchcomputer', 'Flasche(n)', 'Blei', 'Lampe', 'Boje (SMB)', 'Messer', 'Brevet & Logbuch',
  'Handtuch & Wechselkleidung', 'Wasser & Snack'];

async function getPack() {
  let p = await getKV('packlists');
  if (!p?.lists?.length) {
    const id = uid();
    p = { active: id, lists: [{ id, name: 'Tauchtasche', items: DEFAULT_PACK.map(text => ({ id: uid(), text, checked: false })) }] };
    await setKV('packlists', p);
  }
  if (!p.lists.some(l => l.id === p.active)) p.active = p.lists[0].id;
  return p;
}
const activeList = p => p.lists.find(l => l.id === p.active);

async function pagePack(edit) {
  const p = await getPack();
  const list = activeList(p);
  const total = list.items.length;
  const done = list.items.filter(i => i.checked).length;
  const chips = p.lists.length > 1 || edit ? `<div class="chips">
      ${p.lists.map(l => `<button type="button" class="chip${l.id === p.active ? ' active' : ''}" data-list="${l.id}">${esc(l.name)}</button>`).join('')}
      ${edit ? `<button type="button" class="chip" data-list-add>${ICON.plus}Neue Liste</button>` : ''}
    </div>` : '';

  const viewHtml = `${chips}
    <div class="card pack-progress">
      <div><strong>${done} von ${total}</strong> eingepackt</div>
      <div class="bar"><span style="width:${total ? Math.round((done / total) * 100) : 0}%"></span></div>
    </div>
    ${total && done === total ? '<div class="notice ok-notice"><p>✓ Alles eingepackt – viel Spaß beim Tauchen!</p></div>' : ''}
    ${total ? `<ul class="pack-list">${list.items.map(i => `<li>
        <button type="button" class="pack-item${i.checked ? ' checked' : ''}" role="checkbox" aria-checked="${i.checked}" data-toggle="${i.id}">
          <span class="pack-box">${i.checked ? '✓' : ''}</span><span class="pack-text">${esc(i.text)}</span>
        </button></li>`).join('')}</ul>`
      : '<div class="empty"><strong>Die Liste ist leer</strong>Tippe auf „Bearbeiten“ und füge deine Ausrüstung hinzu.</div>'}
    <div class="btn-row" style="margin-top:16px">
      <button type="button" class="btn" data-reset${done ? '' : ' disabled'}>Zurücksetzen</button>
      <a class="btn" href="#logbuch/packliste/bearbeiten">${ICON.edit}Bearbeiten</a>
    </div>`;

  const editHtml = `${chips}
    <div class="card">
      ${field({ label: 'Name der Liste', name: 'listName', value: list.name })}
      <ul class="pack-edit">${list.items.map((i, idx) => `<li class="pack-edit-row">
          <input type="text" value="${esc(i.text)}" data-item-text="${i.id}" aria-label="Gegenstand ${idx + 1}" enterkeyhint="done">
          <button type="button" class="icon-btn" data-item-move="${i.id}" data-dir="-1" aria-label="Nach oben"${idx === 0 ? ' disabled' : ''}>${ICON.up}</button>
          <button type="button" class="icon-btn" data-item-move="${i.id}" data-dir="1" aria-label="Nach unten"${idx === total - 1 ? ' disabled' : ''}>${ICON.down}</button>
          <button type="button" class="icon-btn" data-item-del="${i.id}" aria-label="${esc(i.text)} löschen">${ICON.trash}</button>
        </li>`).join('')}</ul>
      <form class="pack-add" data-add novalidate>
        <input type="text" name="newItem" placeholder="z. B. Ersatz-O-Ringe" enterkeyhint="done" aria-label="Neuer Gegenstand">
        <button type="submit" class="btn btn-primary">${ICON.plus}Dazu</button>
      </form>
    </div>
    ${p.lists.length > 1 ? `<button type="button" class="btn btn-outline-danger btn-block" data-list-del>${ICON.trash}Liste „${esc(list.name)}“ löschen</button>` : ''}
    <button type="button" class="btn btn-primary btn-big btn-block" data-done style="margin-top:12px">Fertig</button>`;

  return {
    title: edit ? 'Packliste bearbeiten' : 'Packliste',
    back: edit ? 'logbuch/packliste' : 'logbuch',
    html: edit ? editHtml : viewHtml,
    after(view) {
      const save = async () => { await setKV('packlists', p); };
      const item = id => list.items.find(i => i.id === id);

      view.addEventListener('click', async e => {
        const t = e.target;
        const chip = t.closest('[data-list]');
        if (chip) { p.active = chip.dataset.list; await save(); refresh(); return; }

        const tog = t.closest('[data-toggle]');
        if (tog) {
          const it = item(tog.dataset.toggle);
          it.checked = !it.checked;
          await save();
          navigator.vibrate?.(15);
          if (list.items.every(i => i.checked)) toast('Alles eingepackt ✓');
          refresh();
          return;
        }
        if (t.closest('[data-reset]')) {
          if (!await confirmDialog({ title: 'Packliste zurücksetzen?', text: 'Alle Haken werden entfernt.', ok: 'Zurücksetzen' })) return;
          list.items.forEach(i => { i.checked = false; });
          await save();
          toast('Liste zurückgesetzt');
          refresh();
          return;
        }

        const mv = t.closest('[data-item-move]');
        if (mv) {
          const i = list.items.findIndex(x => x.id === mv.dataset.itemMove);
          const j = i + Number(mv.dataset.dir);
          if (j < 0 || j >= list.items.length) return;
          [list.items[i], list.items[j]] = [list.items[j], list.items[i]];
          await save();
          refresh();
          return;
        }
        const del = t.closest('[data-item-del]');
        if (del) {
          list.items = list.items.filter(x => x.id !== del.dataset.itemDel);
          await save();
          refresh();
          return;
        }
        if (t.closest('[data-list-add]')) {
          // Neue Liste als Kopie der aktuellen – dann nur noch anpassen
          const id = uid();
          p.lists.push({ id, name: `${list.name} (Kopie)`, items: list.items.map(i => ({ id: uid(), text: i.text, checked: false })) });
          p.active = id;
          await save();
          toast('Neue Liste angelegt – Name oben ändern');
          refresh();
          return;
        }
        if (t.closest('[data-list-del]')) {
          if (!await confirmDialog({ title: `„${list.name}“ löschen?`, text: 'Die Liste wird endgültig gelöscht.', ok: 'Löschen', danger: true })) return;
          p.lists = p.lists.filter(l => l.id !== list.id);
          p.active = p.lists[0].id;
          await save();
          refresh();
          return;
        }
        if (t.closest('[data-done]')) goBack('logbuch/packliste');
      });

      // Umbenennen beim Verlassen des Felds
      view.addEventListener('change', async e => {
        const t = e.target;
        if (t.dataset.itemText) {
          const it = item(t.dataset.itemText);
          if (t.value.trim()) it.text = t.value.trim(); else t.value = it.text;
          await save();
        }
        if (t.name === 'listName') {
          if (t.value.trim()) { list.name = t.value.trim(); await save(); refresh(); } else t.value = list.name;
        }
      });

      $('[data-add]', view)?.addEventListener('submit', async e => {
        e.preventDefault();
        const input = e.currentTarget.elements.newItem;
        const text = input.value.trim();
        if (!text) { input.focus(); return; }
        list.items.push({ id: uid(), text, checked: false });
        await save();
        await refresh();
        $('#view [name="newItem"]')?.focus();   // gleich den nächsten eintippen
      });
    },
  };
}

/* =========================================================
   2. Brevets
   ========================================================= */
async function pageBrevets() {
  const certs = (await dbAll('certs')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return {
    title: 'Brevets',
    html: `<a class="btn btn-primary btn-big btn-block" href="#brevets/neu">${ICON.plus}Neues Brevet</a>
      ${certs.length ? `<div class="cert-grid">${certs.map(c => `<a class="cert-card" href="#brevets/${c.id}">
          ${c.front ? `<img data-photo="${esc(c.front)}" alt="">` : `<div class="cert-noimg">${ICON.card}</div>`}
          <div class="cert-info">
            <div class="cert-org">${esc(c.org) || 'Brevet'}</div>
            <div class="cert-level">${esc(c.level)}</div>
            ${c.date ? `<div class="cert-date">ausgestellt ${fmtDate(c.date)}</div>` : ''}
          </div></a>`).join('')}</div>`
        : `<div class="empty"><strong>Noch keine Brevets</strong>Fotografiere deine Tauchscheine – dann hast du sie an jeder Tauchbasis dabei.</div>`}`,
  };
}

async function pageCertForm(id) {
  let c = { front: null, back: null };
  if (id) {
    c = await dbGet('certs', id);
    if (!c) return notFound('brevets');
  }
  const slots = { front: c.front ? { id: c.front } : null, back: c.back ? { id: c.back } : null };

  return {
    title: id ? 'Brevet bearbeiten' : 'Neues Brevet',
    back: id ? `brevets/${id}` : 'brevets',
    html: `<form id="cert-form" novalidate>
      <fieldset class="form-card"><legend>Brevet</legend>
        ${field({ label: 'Organisation', name: 'org', value: c.org, list: 'dl-org', placeholder: 'z. B. PADI, SSI, VDST, CMAS' })}
        ${field({ label: 'Stufe / Kurs', name: 'level', value: c.level, required: true, placeholder: 'z. B. Advanced Open Water' })}
        ${field({ label: 'Ausstellungsdatum', name: 'date', type: 'date', value: c.date })}
        ${field({ label: 'Brevet-Nummer', name: 'number', value: c.number })}
        ${field({ label: 'Tauchlehrer', name: 'instructor', value: c.instructor })}
      </fieldset>
      <fieldset class="form-card"><legend>Fotos</legend>
        <div class="photo-slot"><div class="photo-slot-title">Vorderseite</div><div data-slot="front"></div>${photoButtons('front')}</div>
        <div class="photo-slot"><div class="photo-slot-title">Rückseite</div><div data-slot="back"></div>${photoButtons('back')}</div>
      </fieldset>
      ${saveBar()}
      ${datalist('dl-org', ORGANISATIONEN)}
    </form>`,
    after(view) {
      const form = $('#cert-form', view);
      const drawSlot = key => {
        const el = $(`[data-slot="${key}"]`, form);
        const p = slots[key];
        el.innerHTML = p
          ? `<div class="photo-thumb"><img alt="" data-zoom><button type="button" class="photo-remove" data-remove="${key}" aria-label="Foto entfernen">×</button></div>`
          : '<div class="photo-placeholder">Noch kein Foto</div>';
        if (p) setImg($('img', el), p);
      };
      drawSlot('front');
      drawSlot('back');

      form.addEventListener('change', async e => {
        const key = e.target.dataset.photoInput;
        if (!key) return;
        const [p] = await readPhotoInput(e.target);
        if (p) { slots[key] = p; drawSlot(key); }
      });
      form.addEventListener('click', async e => {
        const rm = e.target.closest('[data-remove]');
        if (rm && await confirmDialog({ title: 'Foto entfernen?', text: 'Das Foto wird beim Speichern gelöscht.', ok: 'Entfernen', danger: true })) {
          slots[rm.dataset.remove] = null;
          drawSlot(rm.dataset.remove);
        }
        if (e.target.closest('[data-cancel]')) goBack(id ? `brevets/${id}` : 'brevets');
      });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        clearErrors(form);
        const { text, errors } = formReader(form, c);
        const rec = {
          ...c,
          id: c.id || uid(),
          org: text('org'),
          level: text('level'),
          date: text('date'),
          number: text('number'),
          instructor: text('instructor'),
          front: slots.front?.id || null,
          back: slots.back?.id || null,
          created: c.created || Date.now(),
          updated: Date.now(),
        };
        if (!rec.level) errors.push(['level', 'Bitte Stufe oder Kurs eintragen']);
        if (errors.length) { showErrors(form, errors); return; }
        try {
          await saveWithPhotos('certs', rec, [slots.front, slots.back].filter(Boolean), [rec.front, rec.back], [c.front, c.back]);
        } catch (err) {
          toast('Speichern fehlgeschlagen: ' + err.message, 5000, true);
          return;
        }
        toast('Brevet gespeichert');
        goBack(id ? `brevets/${id}` : 'brevets');
      });
    },
  };
}

async function pageCertDetail(id) {
  const c = await dbGet('certs', id);
  if (!c) return notFound('brevets');
  const fig = (pid, label) => (pid
    ? `<figure class="cert-photo" style="margin:0 0 12px"><img data-photo="${esc(pid)}" data-zoom alt="${label}"><figcaption>${label} – antippen für Vollbild</figcaption></figure>`
    : '');
  return {
    title: c.org || 'Brevet',
    back: 'brevets',
    html: `<div class="detail-head"><h2>${esc(c.level)}</h2>${c.org ? `<p>${esc(c.org)}</p>` : ''}</div>
      ${fig(c.front, 'Vorderseite')}${fig(c.back, 'Rückseite')}
      <div class="card">${kvList([
        ['Organisation', c.org],
        ['Stufe / Kurs', c.level],
        ['Ausgestellt', fmtDate(c.date)],
        ['Brevet-Nr.', c.number],
        ['Tauchlehrer', c.instructor],
      ])}</div>
      <div class="btn-row" style="margin-top:18px">
        <button type="button" class="btn btn-outline-danger" data-delete>${ICON.trash}Löschen</button>
        <a class="btn btn-primary" href="#brevets/${c.id}/bearbeiten">${ICON.edit}Bearbeiten</a>
      </div>`,
    after(view) {
      $('[data-delete]', view).addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Brevet löschen?',
          text: `${[c.org, c.level].filter(Boolean).join(' ')} wird endgültig gelöscht, inklusive Fotos.`,
          ok: 'Löschen', danger: true,
        });
        if (!ok) return;
        await deleteWithPhotos('certs', c.id, [c.front, c.back]);
        toast('Brevet gelöscht');
        goBack('brevets');
      });
    },
  };
}

/* =========================================================
   3. Notfall
   ========================================================= */
function callCard({ name, number, meta = '', primary = false, badge = '', tools = '' }) {
  const callable = /\d/.test(number || '');
  return `<div class="call-card${primary ? ' primary' : ''}">
    <div class="call-text">
      <div class="call-name">${badge}${esc(name)}</div>
      ${meta ? `<div class="call-meta">${esc(meta)}</div>` : ''}
      <span class="call-number">${esc(number)}</span>
      ${tools}
    </div>
    ${callable ? `<a class="call-btn" href="${telHref(number)}" aria-label="${esc(name)} anrufen: ${esc(number)}">${ICON.phone}<span>Anrufen</span></a>` : ''}
  </div>`;
}
function orderTools(store, path, item, index, count) {
  return `<div class="call-tools">
    <button type="button" class="icon-btn" data-move="${store}" data-id="${item.id}" data-dir="-1" aria-label="Nach oben"${index === 0 ? ' disabled' : ''}>${ICON.up}</button>
    <button type="button" class="icon-btn" data-move="${store}" data-id="${item.id}" data-dir="1" aria-label="Nach unten"${index === count - 1 ? ' disabled' : ''}>${ICON.down}</button>
    <a class="icon-btn" href="#notfall/${path}/${item.id}" aria-label="Bearbeiten">${ICON.edit}</a>
  </div>`;
}

async function pageNotfall() {
  const hotlines = sortByOrder(await dbAll('hotlines'));
  const contacts = sortByOrder(await dbAll('contacts'));
  const p = (await getKV('profile')) || {};
  const a = p.birth ? age(p.birth) : null;
  const profileRows = [
    ['Name', p.name],
    ['Geburtsdatum', p.birth ? `${fmtDate(p.birth)}${a != null ? ` (${a} J.)` : ''}` : ''],
    ['Blutgruppe', p.blood],
    ['Allergien', p.allergies],
    ['Medikamente', p.meds],
    ['Vorerkrankungen', p.conditions],
    ['Versicherung', p.insurance],
  ].filter(r => r[1]);

  return {
    title: 'Notfall',
    html: `
      ${callCard({ name: 'Notruf Europa', number: '112', primary: true })}
      ${callCard({ name: 'DAN Europe Notfall-Hotline', number: DAN_NUMMER, primary: true })}
      <p class="call-hint">Schwere Symptome: zuerst 112, dann DAN. Leichte Symptome: DAN anrufen, Erste Hilfe und Sauerstoff geben.</p>

      <h2 class="section-title">Meine Hotlines</h2>
      ${hotlines.map((h, i) => callCard({
        name: h.name, number: h.number,
        meta: h.policy ? `Police / Mitglieds-Nr.: ${h.policy}` : '',
        tools: orderTools('hotlines', 'hotline', h, i, hotlines.length),
      })).join('') || '<p class="hint" style="margin:0 4px 12px">Zum Beispiel die Notfallnummer deiner Tauchversicherung.</p>'}
      <a class="btn btn-block" href="#notfall/hotline/neu">${ICON.plus}Hotline hinzufügen</a>

      <h2 class="section-title">Notfallkontakte</h2>
      ${contacts.map((c, i) => callCard({
        name: c.name, number: c.number,
        badge: `<span class="order-badge">${i + 1}</span>`,
        meta: [c.relation, c.note].filter(Boolean).join(' · '),
        tools: orderTools('contacts', 'kontakt', c, i, contacts.length),
      })).join('') || '<p class="hint" style="margin:0 4px 12px">Familie oder Freunde, die im Notfall Bescheid wissen müssen. Die Reihenfolge = wer zuerst angerufen wird.</p>'}
      <a class="btn btn-block" href="#notfall/kontakt/neu">${ICON.plus}Kontakt hinzufügen</a>

      <h2 class="section-title">Meine Notfalldaten</h2>
      <div class="card">${profileRows.length ? kvList(profileRows) : '<p class="hint" style="margin:0">Optional: Angaben für Helfer, z. B. Blutgruppe, Allergien und Medikamente.</p>'}</div>
      <a class="btn btn-block" href="#notfall/daten">${ICON.edit}Notfalldaten bearbeiten</a>`,
    after(view) {
      view.addEventListener('click', async e => {
        const b = e.target.closest('[data-move]');
        if (!b || b.disabled) return;
        const store = b.dataset.move;
        const items = sortByOrder(await dbAll(store));
        const i = items.findIndex(x => x.id === b.dataset.id);
        const j = i + Number(b.dataset.dir);
        if (i < 0 || j < 0 || j >= items.length) return;
        [items[i], items[j]] = [items[j], items[i]];
        await dbWrite(store, t => items.forEach((x, k) => { x.order = k; t.objectStore(store).put(x); }));
        refresh();
      });
    },
  };
}

// Gemeinsames Formular für Hotlines und Kontakte
async function phoneEntryForm({ store, id, title, fields, toRecord, label }) {
  let item = {};
  if (id) {
    item = await dbGet(store, id);
    if (!item) return notFound('notfall');
  }
  return {
    title: id ? `${title} bearbeiten` : `Neue${title === 'Hotline' ? '' : 'r'} ${title}`,
    back: 'notfall',
    html: `<form id="phone-form" novalidate>
      <fieldset class="form-card"><legend>${title}</legend>${fields(item)}</fieldset>
      ${saveBar()}
      ${id ? `<button type="button" class="btn btn-outline-danger btn-block" data-delete style="margin-top:14px">${ICON.trash}${title} löschen</button>` : ''}
    </form>`,
    after(view) {
      const form = $('#phone-form', view);
      form.addEventListener('click', async e => {
        if (e.target.closest('[data-cancel]')) goBack('notfall');
        if (e.target.closest('[data-delete]')) {
          const ok = await confirmDialog({ title: `${title} löschen?`, text: `„${label(item)}“ wird gelöscht.`, ok: 'Löschen', danger: true });
          if (!ok) return;
          await dbWrite(store, t => t.objectStore(store).delete(item.id));
          toast(`${title} gelöscht`);
          goBack('notfall');
        }
      });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        clearErrors(form);
        const r = formReader(form, item);
        const fieldsRec = toRecord(r);
        if (!fieldsRec.name) r.errors.push(['name', 'Bitte einen Namen eintragen']);
        if (!/\d/.test(fieldsRec.number)) r.errors.push(['number', 'Bitte eine Telefonnummer eintragen']);
        if (r.errors.length) { showErrors(form, r.errors); return; }
        let order = item.order;
        if (order == null) order = (await dbAll(store)).reduce((m, x) => Math.max(m, (x.order ?? 0) + 1), 0);
        const rec = { ...item, ...fieldsRec, id: item.id || uid(), order };
        await dbWrite(store, t => t.objectStore(store).put(rec));
        toast(`${title} gespeichert`);
        goBack('notfall');
      });
    },
  };
}

const pageHotlineForm = id => phoneEntryForm({
  store: 'hotlines', id, title: 'Hotline',
  label: h => h.name,
  fields: h => `
    ${field({ label: 'Name', name: 'name', value: h.name, required: true, placeholder: 'z. B. Tauchversicherung Notfall' })}
    ${field({ label: 'Telefonnummer', name: 'number', type: 'tel', value: h.number, required: true, placeholder: '+49 …' })}
    ${field({ label: 'Policen- / Mitgliedsnummer', name: 'policy', value: h.policy })}`,
  toRecord: ({ text }) => ({ name: text('name'), number: text('number'), policy: text('policy') }),
});

const pageContactForm = id => phoneEntryForm({
  store: 'contacts', id, title: 'Kontakt',
  label: c => c.name,
  fields: c => `
    ${field({ label: 'Name', name: 'name', value: c.name, required: true })}
    ${field({ label: 'Beziehung', name: 'relation', value: c.relation, list: 'dl-rel', placeholder: 'z. B. Ehefrau, Bruder, Freund' })}
    ${field({ label: 'Telefonnummer', name: 'number', type: 'tel', value: c.number, required: true, placeholder: '+49 …' })}
    ${field({ label: 'Notiz', name: 'note', type: 'textarea', value: c.note, placeholder: 'z. B. hat Zweitschlüssel, kennt Versicherung' })}
    ${datalist('dl-rel', BEZIEHUNGEN)}`,
  toRecord: ({ text }) => ({ name: text('name'), relation: text('relation'), number: text('number'), note: text('note') }),
});

async function pageProfileForm() {
  const p = (await getKV('profile')) || {};
  return {
    title: 'Meine Notfalldaten',
    back: 'notfall',
    html: `<form id="profile-form" novalidate>
      <fieldset class="form-card"><legend>Für Helfer (alles optional)</legend>
        ${field({ label: 'Name', name: 'name', value: p.name, autocomplete: 'name' })}
        ${field({ label: 'Geburtsdatum', name: 'birth', type: 'date', value: p.birth })}
        ${selectField('Blutgruppe', 'blood', BLUTGRUPPEN, p.blood)}
        ${field({ label: 'Allergien', name: 'allergies', type: 'textarea', value: p.allergies })}
        ${field({ label: 'Medikamente', name: 'meds', type: 'textarea', value: p.meds })}
        ${field({ label: 'Vorerkrankungen', name: 'conditions', type: 'textarea', value: p.conditions })}
        ${field({ label: 'Versicherung', name: 'insurance', value: p.insurance, placeholder: 'z. B. Krankenkasse, Tauchversicherung' })}
      </fieldset>
      ${saveBar()}
    </form>`,
    after(view) {
      const form = $('#profile-form', view);
      form.addEventListener('click', e => { if (e.target.closest('[data-cancel]')) goBack('notfall'); });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const { text } = formReader(form);
        await setKV('profile', Object.fromEntries(['name', 'birth', 'blood', 'allergies', 'meds', 'conditions', 'insurance'].map(k => [k, text(k)])));
        toast('Notfalldaten gespeichert');
        goBack('notfall');
      });
    },
  };
}

/* =========================================================
   4. Einstellungen
   ========================================================= */
async function pageSettings() {
  const meta = (await getKV('meta')) || {};
  const [nDives, nCerts, nPhotos] = await Promise.all([dbCount('dives'), dbCount('certs'), dbCount('photos')]);
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => null);
  const unitRow = (kind, label, opts) => `<div class="setting-row"><div class="setting-label">${label}</div>
    ${segmented('unit-' + kind, opts, settings[kind])}</div>`;

  return {
    title: 'Einstellungen',
    html: `
      <h2 class="section-title">Datensicherung</h2>
      <div class="card">
        <p class="meta-line">Letztes Backup: <strong>${meta.lastBackup ? fmtDateTime(meta.lastBackup) : 'noch keins'}</strong></p>
        <p class="meta-line">Auf diesem Gerät: <strong>${nDives} Tauchgänge · ${nCerts} Brevets · ${nPhotos} Fotos</strong>${est?.usage ? ` (${fmt(est.usage / 1048576)} MB)` : ''}</p>
        <div class="stack">
          <button type="button" class="btn btn-primary btn-block" data-act="export">${ICON.download}Backup exportieren</button>
          <label class="btn btn-block">${ICON.upload}Backup importieren<input type="file" accept="application/json,.json" class="visually-hidden" data-act="import"></label>
        </div>
        <p class="hint">Eine JSON-Datei mit allen Daten inklusive Fotos. Speichere sie in der Cloud oder auf dem PC – ohne Backup sind die Daten beim Handywechsel oder nach dem Löschen des Browser-Speichers weg.</p>
        ${persisted === false ? '<p class="hint">Tipp: Installiere die App über „Zum Home-Bildschirm“ – dann räumt der Browser den Speicher nicht so leicht auf.</p>' : ''}
      </div>

      <h2 class="section-title">Einheiten</h2>
      <div class="card">
        ${unitRow('depth', 'Tiefe &amp; Sicht', [['m', 'Meter'], ['ft', 'Fuß']])}
        ${unitRow('pressure', 'Druck', [['bar', 'bar'], ['psi', 'psi']])}
        ${unitRow('temp', 'Temperatur', [['C', '°C'], ['F', '°F']])}
        ${unitRow('weight', 'Blei', [['kg', 'kg'], ['lb', 'lb']])}
      </div>

      <h2 class="section-title">Testmodus</h2>
      <div class="card">
        <p class="meta-line">Zeigt Beispieldaten in einer <strong>eigenen, getrennten Datenbank</strong>. Deine echten Daten werden dabei weder angezeigt noch verändert. Der Testmodus endet automatisch, wenn du die App schließt.</p>
        ${testMode
          ? `<div class="stack"><button type="button" class="btn btn-primary btn-block" data-act="test-off">Testmodus beenden</button>
             <button type="button" class="btn btn-block" data-act="test-reset">Beispieldaten neu laden</button></div>`
          : `<button type="button" class="btn btn-block" data-act="test-on">Testmodus starten</button>`}
      </div>

      <h2 class="section-title">Alle Daten löschen</h2>
      <div class="card">
        <p class="meta-line">${testMode ? 'Im Testmodus werden nur die Beispieldaten gelöscht.' : 'Löscht alle Tauchgänge, Brevets, Fotos, Kontakte und Notfalldaten auf diesem Gerät.'}</p>
        <button type="button" class="btn btn-outline-danger btn-block" data-act="wipe">${ICON.trash}Alle Daten löschen</button>
      </div>
      <h2 class="section-title">App-Version</h2>
      <div class="card">
        <p class="meta-line">Installiert: <strong>Tauch-Logbuch ${APP_VERSION}</strong></p>
        <button type="button" class="btn btn-block" data-act="update">Nach Update suchen</button>
      </div>
      <p class="hint" style="text-align:center;margin-top:20px">Alle Daten bleiben auf diesem Gerät.</p>`,
    after(view) {
      view.addEventListener('change', async e => {
        const t = e.target;
        if (t.name?.startsWith('unit-')) {
          settings[t.name.slice(5)] = t.value;
          await setKV('settings', settings);
          toast('Einheit gespeichert');
        }
        if (t.dataset.act === 'import' && t.files[0]) {
          const file = t.files[0];
          t.value = '';
          importBackup(file);
        }
      });
      view.addEventListener('click', e => {
        const act = e.target.closest('button[data-act]')?.dataset.act;
        if (act === 'export') exportBackup();
        if (act === 'wipe') wipeAll();
        if (act === 'test-on') setTestMode(true);
        if (act === 'test-off') setTestMode(false);
        if (act === 'test-reset') resetDemo();
        if (act === 'update') checkForUpdate();
      });
    },
  };
}

/* ---------- Backup ---------- */
const blobToDataURL = b => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(b);
});
function dataURLToBlob(u) {
  const [head, b64] = String(u).split(',');
  const type = (head.match(/^data:([^;,]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function exportBackup() {
  toast('Backup wird erstellt …', 30000);
  let file;
  try {
    const data = { format: BACKUP_FORMAT, version: 1, app: APP_VERSION, exportedAt: new Date().toISOString(), testmodus: testMode, stores: {}, photos: [] };
    for (const s of DATA_STORES) data.stores[s] = await dbAll(s);
    data.stores.kv = data.stores.kv.filter(r => r.id !== 'signKey');   // privater Stempel-Schlüssel bleibt auf dem Gerät
    for (const p of await dbAll('photos')) data.photos.push({ id: p.id, data: await blobToDataURL(p.blob) });
    file = new File([JSON.stringify(data)], `tauch-logbuch-backup-${todayISO()}${testMode ? '-TESTMODUS' : ''}.json`, { type: 'application/json' });
  } catch (err) {
    toast('Backup fehlgeschlagen: ' + err.message, 5000, true);
    return;
  }
  toast('Backup bereit', 1500);

  // Teilen/Speichern erst nach einem neuen Antippen – sonst blockieren manche Browser den Dialog.
  const canShare = navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches;
  const choice = await modal({
    title: 'Backup ist bereit',
    text: `${file.name} (${fmt(file.size / 1048576)} MB). ${canShare ? '„Teilen“ speichert z. B. in Dateien, Drive oder per Mail. ' : ''}Bewahre die Datei außerhalb des Handys auf.`,
    buttons: canShare
      ? [{ label: 'Herunterladen', value: 'download' }, { label: 'Teilen', value: 'share', cls: 'btn-primary', icon: ICON.share }]
      : [{ label: 'Abbrechen', value: null }, { label: 'Herunterladen', value: 'download', cls: 'btn-primary', icon: ICON.download }],
  });
  if (!choice) return;
  if (choice === 'share') {
    try { await navigator.share({ files: [file], title: 'Tauch-Logbuch Backup' }); }
    catch (err) {
      if (err.name === 'AbortError') return;
      downloadFile(file);
    }
  } else {
    downloadFile(file);
  }
  const meta = (await getKV('meta')) || {};
  meta.lastBackup = new Date().toISOString();
  await setKV('meta', meta);
  toast('Backup gespeichert');
  if (location.hash === '#einstellungen') refresh();
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { toast('Die Datei ist kein gültiges Backup.', 4000, true); return; }
  if (data?.format !== BACKUP_FORMAT || typeof data.stores !== 'object') {
    toast('Das ist keine Tauch-Logbuch-Sicherung.', 4000, true);
    return;
  }
  const s = data.stores;
  const n = k => (Array.isArray(s[k]) ? s[k].length : 0);
  const ok = await confirmDialog({
    title: 'Backup importieren?',
    text: `Sicherung vom ${fmtDateTime(data.exportedAt)}: ${n('dives')} Tauchgänge, ${n('certs')} Brevets, ${data.photos?.length || 0} Fotos, ${n('contacts')} Kontakte. Alle aktuellen Daten ${testMode ? 'im Testmodus' : 'auf diesem Gerät'} werden dadurch ersetzt.`,
    ok: 'Ersetzen', danger: true,
  });
  if (!ok) return;
  if (data.testmodus && !testMode) {
    const really = await confirmDialog({
      title: 'Das sind Beispieldaten',
      text: 'Diese Sicherung stammt aus dem Testmodus. Trotzdem in deine echten Daten übernehmen?',
      ok: 'Trotzdem', danger: true,
    });
    if (!really) return;
  }
  toast('Importiere …', 30000);
  try {
    const photos = [];
    for (const p of data.photos || []) {
      try { if (p?.id && p.data) photos.push({ id: p.id, blob: dataURLToBlob(p.data) }); }
      catch { /* defektes Foto überspringen */ }
    }
    await dbWrite(STORES, t => {
      for (const name of STORES) t.objectStore(name).clear();
      for (const name of DATA_STORES) for (const r of (Array.isArray(s[name]) ? s[name] : [])) if (r && r.id != null) t.objectStore(name).put(r);
      for (const p of photos) t.objectStore('photos').put(p);
    });
  } catch (err) {
    toast('Import fehlgeschlagen: ' + err.message, 5000, true);
    return;
  }
  clearPhotoCache();
  await loadSettings();
  toast('Backup importiert');
  navStack = [];
  navigate('logbuch', { replace: true });
}

async function wipeAll() {
  const what = testMode ? 'alle Testdaten' : 'alle Tauchgänge, Brevets, Fotos, Kontakte und Notfalldaten';
  if (!await confirmDialog({ title: 'Wirklich alle Daten löschen?', text: `Das löscht ${what}.`, ok: 'Weiter', danger: true })) return;
  if (!await confirmDialog({
    title: 'Letzte Sicherheitsabfrage',
    text: testMode ? 'Testdaten endgültig löschen?' : 'Das kann nicht rückgängig gemacht werden. Hast du ein Backup? Jetzt endgültig alles löschen?',
    ok: 'Endgültig löschen', danger: true,
  })) return;
  await dbWrite(STORES, t => STORES.forEach(n => t.objectStore(n).clear()));
  clearPhotoCache();
  settings = { ...DEFAULT_SETTINGS };
  toast('Alle Daten gelöscht');
  navStack = [];
  navigate('logbuch', { replace: true });
}

/* =========================================================
   Testmodus mit Beispieldaten (eigene Datenbank)
   ========================================================= */
function updateBanner() { $('#testbanner').hidden = !testMode; }

async function setTestMode(on) {
  if (on) toast('Beispieldaten werden vorbereitet …', 10000);
  testMode = on;
  try { if (on) sessionStorage.setItem('tl-testmodus', '1'); else sessionStorage.removeItem('tl-testmodus'); } catch { /* egal */ }
  db.close();
  db = await openDB(on ? DB_TEST : DB_ECHT);
  clearPhotoCache();
  if (on && (await dbCount('dives')) === 0) await seedDemo();
  await loadSettings();
  updateBanner();
  toast(on ? 'Testmodus aktiv – Beispieldaten' : 'Zurück bei deinen echten Daten');
  navStack = [];
  navigate('logbuch', { replace: true });
}

async function resetDemo() {
  if (!testMode) return;
  await dbWrite(STORES, t => STORES.forEach(n => t.objectStore(n).clear()));
  clearPhotoCache();
  await seedDemo();
  await loadSettings();
  toast('Beispieldaten neu geladen');
  navStack = [];
  navigate('logbuch', { replace: true });
}

function demoCardImage(org, level, color, back = false) {
  const c = document.createElement('canvas');
  c.width = 1000; c.height = 630;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1000, 630);
  g.addColorStop(0, color);
  g.addColorStop(1, '#0a1726');
  x.fillStyle = g;
  x.fillRect(0, 0, 1000, 630);
  x.fillStyle = 'rgba(255,255,255,.08)';
  for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(820, 120, 80 + i * 70, 0, Math.PI * 2); x.fill(); }
  x.fillStyle = '#fff';
  x.font = 'bold 72px system-ui, sans-serif';
  x.fillText(org, 60, 130);
  x.font = '600 50px system-ui, sans-serif';
  x.fillText(back ? 'Rückseite' : level, 60, 330);
  x.font = '34px system-ui, sans-serif';
  x.fillText(back ? 'Nr. BSP-000000 · Max Mustertaucher' : 'Max Mustertaucher', 60, 400);
  x.font = 'bold 44px system-ui, sans-serif';
  x.fillStyle = 'rgba(255,255,255,.55)';
  x.fillText('BEISPIEL', 60, 560);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
}

async function seedDemo() {
  const now = Date.now();
  const base = { tankSize: 12, gas: 'luft', o2: null, pStart: 200, pEnd: 60, suit: 'trocken', weight: 10, buddy: 'Jonas', notes: '', photos: [], created: now, updated: now };
  const dive = (nr, date, time, site, location, maxDepth, duration, waterTemp, visibility, extra = {}) =>
    ({ ...base, id: uid(), nr, date, time, site, location, maxDepth, duration, waterTemp, visibility, ...extra });
  const dives = [
    dive(1, '2026-05-16', '10:30', 'Fühlinger See', 'Köln, Deutschland', 12.4, 42, 14, 5, { suit: 'halbtrocken', weight: 8, notes: 'Erster Tauchgang der Saison. Viele Barsche am Steg.' }),
    dive(2, '2026-05-16', '14:15', 'Fühlinger See', 'Köln, Deutschland', 9.8, 48, 15, 5, { suit: 'halbtrocken', weight: 8, pStart: 190, pEnd: 70 }),
    dive(3, '2026-06-20', '11:00', 'Kreidesee Hemmoor', 'Hemmoor, Deutschland', 24.6, 38, 9, 8, { pStart: 220, pEnd: 50, notes: 'Sprungschanze und Wrack, Sprungschicht bei 12 m.' }),
    dive(4, '2026-08-09', '09:15', 'Ras Mohammed – Shark Reef', 'Sharm el-Sheikh, Ägypten', 27.3, 52, 27, 30, { gas: 'nitrox', o2: 32, suit: 'nass', weight: 4, buddy: 'Guide Ahmed', notes: 'Strömung von Nord, großer Napoleon an der Kante.' }),
    dive(5, '2026-08-10', '08:45', 'SS Thistlegorm', 'Rotes Meer, Ägypten', 30.1, 46, 26, 20, { tankSize: 15, gas: 'nitrox', o2: 28, suit: 'nass', weight: 4, pStart: 210, pEnd: 70, buddy: 'Guide Ahmed' }),
    dive(6, '2026-09-26', '13:20', 'Zeelandbrug – Oosterschelde', 'Zierikzee, Niederlande', 14.2, 61, 16, 3, { notes: 'Bei Stillwasser. Sepien und Seenelken.' }),
    dive(null, '2026-11-07', '10:00', 'Kreidesee Hemmoor', 'Hemmoor, Deutschland', null, null, null, null,
      { planned: true, maxDepth: 30, duration: 45, pStart: null, pEnd: null, buddyIds: ['demo-buddy-jonas'], notes: 'Treffpunkt 9:30 an der Basis.',
        tanks: [{ size: 12, gas: 'nitrox', o2: 32, pStart: 200, pEnd: null }, { size: 7, gas: 'nitrox', o2: 50, pStart: 200, pEnd: null }] }),
  ];
  const buddies = [{
    id: 'demo-buddy-jonas', name: 'Jonas',
    certs: [
      { org: 'PADI', level: 'Rescue Diver', date: '2024-09-14', number: 'BSP-222222', img: '' },
      { org: 'PADI', level: 'Enriched Air Diver', date: '2024-05-02', number: '', img: '' },
    ],
    stats: { count: 87, totalMin: 4380, deepest: 38.5, last: { date: '2026-10-11', site: 'Fühlinger See' } },
    sharedAt: '2026-10-12T18:00:00.000Z', receivedAt: new Date().toISOString(), created: now,
  }];
  const photos = [
    { id: uid(), blob: await demoCardImage('PADI', 'Open Water Diver', '#1565c0') },
    { id: uid(), blob: await demoCardImage('PADI', 'Open Water Diver', '#1565c0', true) },
    { id: uid(), blob: await demoCardImage('SSI', 'Advanced Adventurer', '#00897b') },
  ];
  const certs = [
    { id: uid(), org: 'PADI', level: 'Open Water Diver', date: '2025-07-12', number: 'BSP-000000', instructor: 'Lisa Beispiel', front: photos[0].id, back: photos[1].id, created: now },
    { id: uid(), org: 'SSI', level: 'Advanced Adventurer', date: '2026-04-05', number: 'BSP-111111', instructor: 'Kai Beispiel', front: photos[2].id, back: null, created: now },
  ];
  const hotlines = [{ id: uid(), name: 'Tauchversicherung (Beispiel)', number: '+49 000 0000000', policy: 'BSP-123456', order: 0 }];
  const contacts = [
    { id: uid(), name: 'Anna Beispiel', relation: 'Partnerin', number: '+49 000 1111111', note: 'Weiß, wo die Versicherungsunterlagen liegen.', order: 0 },
    { id: uid(), name: 'Tom Beispiel', relation: 'Bruder', number: '+49 000 2222222', note: '', order: 1 },
  ];
  const profile = { name: 'Max Mustertaucher', birth: '1985-03-12', blood: 'A+', allergies: 'keine bekannt', meds: 'keine', conditions: '', insurance: 'Beispiel-Tauchversicherung, Nr. BSP-123456' };

  await dbWrite(STORES, t => {
    dives.forEach(d => t.objectStore('dives').put(d));
    certs.forEach(c => t.objectStore('certs').put(c));
    hotlines.forEach(h => t.objectStore('hotlines').put(h));
    contacts.forEach(c => t.objectStore('contacts').put(c));
    photos.forEach(p => t.objectStore('photos').put(p));
    buddies.forEach(b => t.objectStore('buddies').put(b));
    t.objectStore('kv').put({ id: 'profile', value: profile });
  });
}

/* =========================================================
   5. Buddys – Austausch per Code/Link, ganz ohne Server
   ========================================================= */
const norm = s => String(s || '').toLowerCase().trim();
const nameMatch = (text, name) => !!norm(name) && norm(text).includes(norm(name));
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const cleanStr = (v, max = 200) => (v == null ? '' : String(v).slice(0, max));
const cleanId = v => (/^[\w-]{1,64}$/.test(String(v ?? '')) ? String(v) : null);
const cleanNum = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const check = (name, label, hint, checked) => `<label class="check"><input type="checkbox" name="${name}"${checked ? ' checked' : ''}>
  <span><strong>${esc(label)}</strong>${hint ? `<small>${esc(hint)}</small>` : ''}</span></label>`;

// Eigene, zufällige Kennung – damit der Buddy Aktualisierungen derselben Person zuordnen kann
async function getMe() {
  let me = await getKV('me');
  if (!me?.id) { me = { id: uid(), name: '' }; await setKV('me', me); }
  return me;
}

/* ---------- Code: JSON → komprimiert → Base64 (URL-tauglich) ---------- */
function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
const pipeBytes = (bytes, stream) =>
  new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer().then(b => new Uint8Array(b));

async function encodeShare(obj) {
  const json = new TextEncoder().encode(JSON.stringify({ app: 'tlb', v: 1, ...obj }));
  if (typeof CompressionStream === 'function') return 'TLB1:' + b64url(await pipeBytes(json, new CompressionStream('deflate-raw')));
  return 'TLB0:' + b64url(json);
}
async function unpackShare(kind, data) {
  let bytes = fromB64url(data);
  if (kind === '1') bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
  const obj = JSON.parse(new TextDecoder().decode(bytes));
  if (obj?.app !== 'tlb' || !['buddy', 'dive', 'stampreq', 'stamp'].includes(obj.t)) throw new Error('kein Tauch-Logbuch-Code');
  return obj;
}
async function decodeShare(text) {
  // Zeilenumbrüche und (auch doppelt) URL-kodierte Doppelpunkte entfernen, z. B. aus Safari-Adressen
  const clean = String(text || '').replace(/\s+/g, '').replace(/%25/gi, '%').replace(/%3A/gi, ':');
  const m = clean.match(SHARE_RE);
  if (m) {
    try { return await unpackShare(m[1], m[2]); }
    catch { throw new Error('Der Code ist unvollständig oder beschädigt. Bitte die ganze Nachricht kopieren – bei langen Nachrichten teilt WhatsApp sie manchmal in zwei Teile.'); }
  }
  // Kennung "TLB1:" fehlt – den längsten Code-Block trotzdem versuchen
  const runs = (clean.match(/[A-Za-z0-9_-]{40,}/g) || []).sort((a, b) => b.length - a.length);
  for (const run of runs.slice(0, 3)) {
    for (const kind of ['1', '0']) {
      try { return await unpackShare(kind, run); } catch { /* nächste Variante */ }
    }
  }
  if (runs.length) {
    throw new Error('Hier fehlt der Anfang des Codes (er beginnt mit „TLB1:“). WhatsApp hat die Nachricht wohl in zwei Teile geteilt – bitte die erste Nachricht kopieren oder ohne Fotos neu senden.');
  }
  throw new Error('Kein Tauch-Logbuch-Code gefunden.');
}
const shareLink = code => `${location.origin}${location.pathname}#import=${code}`;

async function shareText(text, title) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title, text }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  await copyText(text);
}
async function copyText(text, msg = 'Kopiert – jetzt z. B. in WhatsApp einfügen') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(msg);
}

// Teilen-Kasten: Code bei jeder Änderung neu bauen, damit "Teilen" sofort (mit Antipp-Berechtigung) geht
const shareBox = () => `<div class="card">
    <p class="meta-line" data-code-info>Code wird erstellt …</p>
    <div class="stack">
      <button type="button" class="btn btn-primary btn-big btn-block" data-share disabled>${ICON.share}Teilen</button>
      <button type="button" class="btn btn-block" data-qr disabled>${ICON.qr}QR-Code zeigen</button>
      <button type="button" class="btn btn-block" data-copy disabled>${ICON.copy}Nachricht kopieren</button>
    </div>
    <p class="hint">Am Tauchplatz am einfachsten: <strong>QR-Code zeigen</strong>, dein Buddy scannt ihn in seiner App unter Buddys → „QR-Code scannen“. Kein Telefonnummern-Tausch nötig.</p>
  </div>`;

async function qrDataURL(text) {
  await loadScript('lib/qrcode.js');
  for (const level of ['M', 'L']) {
    try {
      const qr = qrcode(0, level);
      qr.addData(text, 'Byte');
      qr.make();
      return qr.createDataURL(Math.max(2, Math.floor(640 / qr.getModuleCount())), 4);
    } catch { /* nächste Fehlerkorrektur-Stufe */ }
  }
  throw new Error('Zu viele Daten für einen QR-Code');
}
// hint ist HTML – Aufrufer escapen selbst
async function showQR(text, { title = 'QR-Code für deinen Buddy', hint = 'Dein Buddy öffnet in seiner App <strong>Buddys → QR-Code scannen</strong>.', message = '' } = {}) {
  const src = await qrDataURL(text);
  const choice = await modal({
    title,
    html: `<div class="qr-box"><img src="${src}" alt="QR-Code"></div><p>${hint} Tipp: Bildschirm hell stellen.</p>`,
    buttons: [...(message ? [{ label: 'Als Nachricht', value: 'message' }] : []), { label: 'Fertig', value: true, cls: 'btn-primary' }],
  });
  if (choice === 'message') await shareText(message, title);
}
function bindShareBox(view, form, build, title) {
  const info = $('[data-code-info]', view);
  const bShare = $('[data-share]', view);
  const bCopy = $('[data-copy]', view);
  const bQr = $('[data-qr]', view);
  let message = '';
  let qrText = '';
  let seq = 0;
  let timer;
  const rebuild = async () => {
    const mine = ++seq;
    message = '';
    bShare.disabled = bCopy.disabled = bQr.disabled = true;
    info.textContent = 'Code wird erstellt …';
    try {
      const r = await build(new FormData(form));
      if (mine !== seq) return;
      message = typeof r === 'string' ? r : r.message;
      // Für den QR-Code nur der Link (ohne Fotos) – passt so in einen Code und öffnet notfalls auch über die normale Kamera
      qrText = r.qr || message.match(/https?:\/\/\S+/)?.[0] || '';
      const qrNote = qrText.length > QR_MAX ? ' Für einen QR-Code ist es zu viel – bitte über „Teilen“ schicken.' : '';
      info.textContent = `Fertig – Nachricht mit ${fmt(message.length / 1024)} KB Text.${r.note ? ' ' + r.note : ''}${qrNote}`;
      bShare.disabled = bCopy.disabled = false;
      bQr.disabled = !qrText || qrText.length > QR_MAX;
    } catch (e) {
      if (mine === seq) info.textContent = e.message;
    }
  };
  form.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(rebuild, 400); });
  form.addEventListener('change', () => { clearTimeout(timer); rebuild(); });
  form.addEventListener('submit', e => e.preventDefault());
  bShare.addEventListener('click', () => shareText(message, title));
  bCopy.addEventListener('click', () => copyText(message));
  bQr.addEventListener('click', () => showQR(qrText).catch(e => toast(e.message, 4000, true)));
  rebuild();
}
async function myName(fd) {
  const name = String(fd.get('name') || '').trim();
  if (!name) throw new Error('Bitte oben deinen Namen eintragen.');
  const me = await getMe();
  if (me.name !== name) await setKV('me', { ...me, name });
  return { ...me, name };
}
async function defaultName() {
  return (await getMe()).name || ((await getKV('profile')) || {}).name || '';
}

/* ---------- Buddy-Liste ---------- */
function buddyItem(b) {
  const s = b.stats;
  const top = b.certs?.[0];
  return `<li><a class="dive-item" href="#buddys/${esc(b.id)}">
      <span class="avatar">${esc(initials(b.name))}</span>
      <span class="dive-main">
        <span class="dive-site">${esc(b.name)}</span>
        <span class="dive-date">${top ? esc([top.org, top.level].filter(Boolean).join(' ')) : 'keine Brevets geteilt'}</span>
      </span>
      <span class="dive-figs">${s ? `${esc(s.count)} TG<small>${s.last ? 'zuletzt ' + fmtDate(s.last.date) : '–'}</small>` : '<small>keine Statistik</small>'}</span>
    </a></li>`;
}

async function pageBuddys() {
  const buddies = (await dbAll('buddies')).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return {
    title: 'Buddys',
    html: `<div class="stack">
        <a class="btn btn-primary btn-big btn-block" href="#buddys/teilen">${ICON.share}Meine Buddy-Karte teilen</a>
        <a class="btn btn-primary btn-big btn-block" href="#buddys/scannen">${ICON.qr}QR-Code scannen</a>
        <a class="btn btn-block" href="#buddys/einfuegen">${ICON.paste}Code aus Nachricht einfügen</a>
      </div>
      ${buddies.length ? `<ul class="list">${buddies.map(buddyItem).join('')}</ul>`
        : `<div class="empty"><strong>Noch keine Buddys</strong>Schick deinem Tauchpartner deine Buddy-Karte und lass dir seine schicken.</div>`}
      <p class="hint">So funktioniert's: Ihr tauscht Codes, z. B. per WhatsApp – ganz ohne Server. Die Daten deines Buddys sind so aktuell wie der letzte Code, den er dir geschickt hat.</p>`,
  };
}

async function pageBuddyDetail(id) {
  const b = await dbGet('buddies', id);
  if (!b) return notFound('buddys');
  const s = b.stats;
  const shared = (await dbAll('dives')).filter(d => d.buddyIds?.includes(b.id) || nameMatch(d.buddy, b.name))
    .sort((x, y) => (y.date || '').localeCompare(x.date || ''));
  const tile = (label, v) => `<div class="stat"><div class="stat-value">${v}</div><div class="stat-label">${label}</div></div>`;
  return {
    title: b.name,
    back: 'buddys',
    html: `<div class="detail-head"><h2>${esc(b.name)}</h2>
        <p>${b.sharedAt ? `Stand: ${esc(fmtDateTime(b.sharedAt))}` : 'Noch keine Buddy-Karte erhalten'}</p>
        ${b.key ? '<p data-fp></p>' : ''}</div>
      ${s ? `<div class="tiles">
          ${tile('Tauchgänge', esc(s.count))}
          ${tile('Letzter Tauchgang', s.last ? fmtDate(s.last.date) : '–')}
          ${tile('Std. unter Wasser', fmtHours(s.totalMin || 0))}
          ${tile('Tiefster', s.deepest != null ? dispU('depth', s.deepest) : '–')}
        </div>${s.last?.site ? `<p class="hint" style="margin:-4px 4px 14px">Zuletzt: ${esc(s.last.site)}</p>` : ''}` : ''}
      <h2 class="section-title">Brevets</h2>
      ${b.certs?.length ? b.certs.map(c => `<div class="card cert-shared">
          ${c.img ? `<img src="${esc(c.img)}" data-zoom alt="Brevet ${esc(c.level)}">` : ''}
          <div class="cert-org">${esc(c.org) || 'Brevet'}</div>
          <div class="cert-level">${esc(c.level)}</div>
          <div class="cert-date">${[c.date ? 'ausgestellt ' + fmtDate(c.date) : '', c.number ? 'Nr. ' + c.number : ''].filter(Boolean).map(esc).join(' · ')}</div>
        </div>`).join('') : '<p class="hint" style="margin:0 4px 12px">Keine Brevets freigegeben.</p>'}
      <h2 class="section-title">Gemeinsame Tauchgänge</h2>
      ${shared.length ? `<ul class="list" style="margin-top:0">${shared.map(diveItem).join('')}</ul>`
        : '<p class="hint" style="margin:0 4px 12px">Noch keine. Trag den Namen im Feld „Buddy“ ein oder teilt Tauchgänge miteinander.</p>'}
      <a class="btn btn-primary btn-block" href="#logbuch/plan/${esc(b.id)}" style="margin-top:18px">${ICON.calendar}Tauchgang mit ${esc(b.name)} planen</a>
      <button type="button" class="btn btn-outline-danger btn-block" data-delete style="margin-top:10px">${ICON.trash}Buddy entfernen</button>`,
    after(view) {
      const fpEl = $('[data-fp]', view);
      if (fpEl) keyFp(b.key).then(fp => { fpEl.textContent = `Stempel-Schlüssel: ${fp}`; });
      $('[data-delete]', view).addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Buddy entfernen?', text: `${b.name} und die geteilten Daten werden von diesem Handy gelöscht. Deine Tauchgänge bleiben.`, ok: 'Entfernen', danger: true });
        if (!ok) return;
        await dbWrite('buddies', t => t.objectStore('buddies').delete(b.id));
        toast('Buddy entfernt');
        goBack('buddys');
      });
    },
  };
}

/* ---------- Meine Buddy-Karte ---------- */
// Brevet-Fotos einmal auf die größte Teilen-Stufe verkleinern; kleinere Stufen entstehen daraus schnell
const cardPhotoCache = new Map();
async function cardPhoto(id) {
  if (!cardPhotoCache.has(id)) {
    const p = await dbGet('photos', id);
    cardPhotoCache.set(id, p ? await resizeImage(p.blob, PHOTO_LEVELS[0][0], 0.9) : null);
  }
  return cardPhotoCache.get(id);
}

async function buildMyCard(me, prefs, photoLevel = PHOTO_LEVELS[0]) {
  const card = { t: 'buddy', id: me.id, name: me.name, key: (await getSigner()).publicJwk, at: new Date().toISOString() };
  if (prefs.stats) {
    const dives = (await dbAll('dives')).filter(d => !d.planned);
    const last = sortDives(dives)[0];
    card.stats = {
      count: Math.max(dives.length, ...dives.map(d => d.nr || 0)),
      totalMin: dives.reduce((sum, d) => sum + (d.duration || 0), 0),
      deepest: dives.reduce((m, d) => Math.max(m, d.maxDepth || 0), 0) || null,
      last: last ? { date: last.date, site: last.site } : null,
    };
  }
  if (prefs.certs) {
    const certs = (await dbAll('certs')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    card.certs = [];
    for (const c of certs) {
      const x = { org: c.org, level: c.level, date: c.date, number: c.number };
      if (prefs.photos && c.front) {
        const small = await cardPhoto(c.front);
        if (small) x.img = await blobToDataURL(await resizeImage(small, ...photoLevel));
      }
      card.certs.push(x);
    }
  }
  return card;
}

async function pageMyCard() {
  const prefs = { stats: true, certs: true, photos: false, ...((await getKV('sharePrefs')) || {}) };
  const nCerts = await dbCount('certs');
  return {
    title: 'Meine Buddy-Karte',
    back: 'buddys',
    html: `<form id="card-form" novalidate>
        <fieldset class="form-card"><legend>Das sieht dein Buddy</legend>
          ${field({ label: 'Dein Name', name: 'name', value: await defaultName(), required: true, placeholder: 'z. B. Mike' })}
          ${check('stats', 'Tauchstatistik', 'Anzahl Tauchgänge, letzter Tauchgang, Gesamtzeit, tiefster', prefs.stats)}
          ${check('certs', `Brevets (${nCerts})`, 'Organisation, Stufe, Datum, Brevet-Nummer', prefs.certs)}
          ${check('photos', 'Brevet-Fotos mitschicken', 'Vorderseite als kleines Bild – die Nachricht wird deutlich länger', prefs.photos)}
          <p class="hint">Nie geteilt: Notfalldaten, Notfallkontakte, Notizen und Tauchgang-Fotos.</p>
          <p class="hint" data-fp></p>
        </fieldset>
      </form>
      ${shareBox()}`,
    after(view) {
      const form = $('#card-form', view);
      getSigner().then(s => keyFp(s.publicJwk)).then(fp => { $('[data-fp]', view).textContent = `Dein Stempel-Schlüssel: ${fp} – daran erkennt dein Buddy deine Stempel.`; });
      bindShareBox(view, form, async fd => {
        const p = { stats: fd.has('stats'), certs: fd.has('certs'), photos: fd.has('photos') };
        await setKV('sharePrefs', p);
        const me = await myName(fd);
        const make = async (photos, level) => {
          const link = shareLink(await encodeShare(await buildMyCard(me, { ...p, photos }, level)));
          return { link, message: `🤿 Buddy-Karte von ${me.name} für das Tauch-Logbuch.\nIn der App unter Buddys → „Code einfügen“ einfügen:\n\n${link}` };
        };
        const plain = await make(false);   // ohne Fotos – immer für den QR-Code
        // Fotos schrittweise verkleinern, bis die Nachricht vollständig in WhatsApp passt
        if (p.photos && p.certs) {
          for (const level of PHOTO_LEVELS) {
            const r = await make(true, level);
            if (r.message.length <= MAX_MESSAGE) {
              const note = level === PHOTO_LEVELS[0] ? '' : 'Fotos wurden stärker verkleinert, damit alles in eine Nachricht passt.';
              return { message: r.message, qr: plain.link, note: `${note} Im QR-Code sind keine Fotos.`.trim() };
            }
          }
          return { message: plain.message, qr: plain.link, note: 'Die Fotos sind zu groß für eine Nachricht und wurden weggelassen.' };
        }
        return { message: plain.message, qr: plain.link };
      }, 'Buddy-Karte');
    },
  };
}

/* ---------- Tauchgang teilen ---------- */
async function pageDiveShare(id) {
  const d = await dbGet('dives', id);
  if (!d) return notFound('logbuch');
  return {
    title: 'Tauchgang teilen',
    back: `logbuch/${id}`,
    html: `<form id="dive-share-form" novalidate>
        <fieldset class="form-card"><legend>${d.planned ? 'Geplanter Tauchgang' : 'Tauchgang'}</legend>
          <p class="cert-level" style="margin-top:8px">${esc(d.site)}</p>
          <p class="meta-line">${fmtDate(d.date)}${d.time ? `, ${esc(d.time)} Uhr` : ''}${d.location ? ` · ${esc(d.location)}` : ''}</p>
          ${field({ label: 'Dein Name', name: 'name', value: await defaultName(), required: true })}
          ${d.notes ? check('notes', 'Notizen mitschicken', d.notes.slice(0, 80) + (d.notes.length > 80 ? ' …' : ''), d.planned) : ''}
          <p class="hint">Geteilt werden Datum, Uhrzeit, Tauchplatz, Ort, Tiefe und Dauer${d.planned ? ' sowie die geplanten Flaschen' : ', Wassertemperatur und Sicht'}. Dein Buddy übernimmt den Tauchgang mit einem Tipp in sein Logbuch.</p>
        </fieldset>
      </form>
      ${shareBox()}`,
    after(view) {
      bindShareBox(view, $('#dive-share-form', view), async fd => {
        const me = await myName(fd);
        const dive = { sid: d.shareId || d.id, planned: !!d.planned, date: d.date, time: d.time, site: d.site, location: d.location,
          maxDepth: d.maxDepth, duration: d.duration };
        if (d.planned) dive.tanks = getTanks(d).map(t => ({ size: t.size, gas: t.gas, o2: t.o2, pStart: t.pStart }));
        else Object.assign(dive, { waterTemp: d.waterTemp, visibility: d.visibility });
        if (fd.has('notes') && d.notes) dive.notes = d.notes;
        const code = await encodeShare({ t: 'dive', from: { id: me.id, name: me.name }, dive, at: new Date().toISOString() });
        return `🤿 ${d.planned ? 'Geplanter Tauchgang' : 'Tauchgang'}: ${d.site}, ${fmtDate(d.date)}${d.time ? ` um ${d.time} Uhr` : ''} – von ${me.name}.\nIn der App unter Buddys → „Code einfügen“ einfügen:\n\n${shareLink(code)}`;
      }, 'Tauchgang');
    },
  };
}

/* ---------- Code empfangen ---------- */
async function importPreview(obj) {
  if (obj.t === 'stampreq') {
    const d = obj.dive || {};
    return `<div class="card"><div class="cert-org">Stempel-Anfrage von ${esc(obj.from?.name)}</div>
      <div class="cert-level">${esc(d.site)}</div>
      <p class="meta-line">${fmtDate(cleanStr(d.date, 10))}${d.time ? `, ${esc(d.time)} Uhr` : ''} · ${dispU('depth', cleanNum(d.maxDepth))} · ${cleanNum(d.duration) != null ? `${fmt(cleanNum(d.duration), 0)} min` : '–'}</p>
      <p class="hint" style="margin:0 0 12px">Nur abstempeln, wenn du bei diesem Tauchgang wirklich dabei warst. Dein Handy unterschreibt die Angaben digital.</p>
      <button type="button" class="btn btn-primary btn-big btn-block" data-apply>${ICON.stamp}Abstempeln</button></div>`;
  }
  if (obj.t === 'stamp') {
    const ok = await verifyStamp(obj);
    return `<div class="card"><div class="cert-org">Buddy-Stempel von ${esc(obj.signerName)}</div>
      <div class="cert-level">${esc(obj.site)}</div>
      <p class="meta-line">${fmtDate(cleanStr(obj.date, 10))} · ${ok ? '✓ Unterschrift gültig' : '✗ Unterschrift ungültig'}</p>
      ${ok ? `<button type="button" class="btn btn-primary btn-big btn-block" data-apply>${ICON.stamp}Stempel übernehmen</button>` : ''}</div>`;
  }
  if (obj.t === 'buddy') {
    const existing = cleanId(obj.id) ? await dbGet('buddies', obj.id) : null;
    const s = obj.stats;
    const facts = [s ? `${cleanNum(s.count) ?? 0} Tauchgänge` : '', s?.last?.date ? `zuletzt ${fmtDate(cleanStr(s.last.date))}` : '',
      Array.isArray(obj.certs) ? `${obj.certs.length} Brevets` : ''].filter(Boolean).join(' · ');
    return `<div class="card"><div class="cert-org">Buddy-Karte</div><div class="cert-level">${esc(obj.name)}</div>
      <p class="meta-line">${esc(facts) || 'nur der Name'}</p>
      <button type="button" class="btn btn-primary btn-big btn-block" data-apply>${existing ? 'Daten aktualisieren' : 'Als Buddy hinzufügen'}</button></div>`;
  }
  const d = obj.dive || {};
  const existing = (await dbAll('dives')).find(x => x.shareId === d.sid || x.id === d.sid);
  return `<div class="card"><div class="cert-org">${d.planned ? 'Geplanter Tauchgang' : 'Tauchgang'} von ${esc(obj.from?.name)}</div>
    <div class="cert-level">${esc(d.site)}</div>
    <p class="meta-line">${fmtDate(cleanStr(d.date, 10))}${d.time ? `, ${esc(d.time)} Uhr` : ''}${d.location ? ` · ${esc(d.location)}` : ''}</p>
    ${Array.isArray(d.tanks) && d.tanks.length ? `<p class="meta-line">Flaschen: ${d.tanks.slice(0, 8).map(t =>
      esc([cleanNum(t.size) != null ? `${fmt(cleanNum(t.size))} l` : '', gasLabel({ gas: t.gas, o2: cleanNum(t.o2) })].filter(Boolean).join(' '))).join(' · ')}</p>` : ''}
    ${d.notes ? `<p class="notes" style="margin-bottom:12px">${esc(cleanStr(d.notes, 2000))}</p>` : ''}
    <button type="button" class="btn btn-primary btn-big btn-block" data-apply>${existing ? 'Tauchgang aktualisieren' : 'In mein Logbuch übernehmen'}</button></div>`;
}
function bindImport(root, obj) {
  $('[data-apply]', root)?.addEventListener('click', async () => {
    try {
      const path = await applyShare(obj);
      if (path) navigate(path, { replace: true });
    } catch (e) {
      toast(e.message, 4500, true);
    }
  });
}

async function applyShare(obj) {
  const me = await getMe();
  if (obj.t === 'stampreq') return giveStamp(obj, me);
  if (obj.t === 'stamp') return acceptStamp(obj, me);
  if (obj.t === 'buddy') {
    const id = cleanId(obj.id);
    if (!id) throw new Error('Der Code ist ungültig.');
    if (id === me.id) throw new Error('Das ist deine eigene Buddy-Karte.');
    const old = await dbGet('buddies', id);
    const s = obj.stats;
    const rec = {
      id,
      name: cleanStr(obj.name, 80) || 'Buddy',
      key: validJwk(obj.key) || old?.key || null,   // öffentlicher Stempel-Schlüssel
      // Was der Buddy nicht mehr freigibt, wird hier auch entfernt
      certs: Array.isArray(obj.certs) ? obj.certs.slice(0, 50).map(c => ({
        org: cleanStr(c.org), level: cleanStr(c.level), date: cleanStr(c.date, 10), number: cleanStr(c.number, 60),
        img: /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(c.img || '') ? c.img : '',
      })) : [],
      stats: s ? {
        count: cleanNum(s.count) ?? 0, totalMin: cleanNum(s.totalMin) ?? 0, deepest: cleanNum(s.deepest),
        last: s.last ? { date: cleanStr(s.last.date, 10), site: cleanStr(s.last.site) } : null,
      } : null,
      sharedAt: cleanStr(obj.at, 40),
      receivedAt: new Date().toISOString(),
      created: old?.created || Date.now(),
    };
    await dbWrite('buddies', t => t.objectStore('buddies').put(rec));
    toast(old ? `${rec.name}: Daten aktualisiert` : `${rec.name} ist jetzt dein Buddy`);
    return `buddys/${id}`;
  }

  const src = obj.dive || {};
  const fromId = cleanId(obj.from?.id);
  const fromName = cleanStr(obj.from?.name, 80) || 'Buddy';
  const sid = cleanId(src.sid);
  const shared = {
    date: cleanStr(src.date, 10), time: cleanStr(src.time, 5), site: cleanStr(src.site), location: cleanStr(src.location),
    maxDepth: cleanNum(src.maxDepth), duration: cleanNum(src.duration), waterTemp: cleanNum(src.waterTemp), visibility: cleanNum(src.visibility),
  };
  if (!sid || !/^\d{4}-\d{2}-\d{2}$/.test(shared.date) || !shared.site) throw new Error('Der Code ist ungültig.');
  if (fromId && fromId === me.id) throw new Error('Das ist dein eigener Tauchgang.');

  const dives = await dbAll('dives');
  const existing = dives.find(d => d.shareId === sid || d.id === sid);
  let rec;
  if (existing) {
    // Vorhandenen Eintrag nur ergänzen – eigene Werte werden nie überschrieben
    rec = { ...existing, updated: Date.now() };
    if (existing.planned) Object.assign(rec, { date: shared.date, time: shared.time, site: shared.site, location: shared.location });
    for (const k of ['maxDepth', 'duration', 'waterTemp', 'visibility']) if (rec[k] == null) rec[k] = shared[k];
    if (!rec.notes && src.notes) rec.notes = cleanStr(src.notes, 2000);
  } else {
    const planned = !!src.planned;
    const logged = dives.filter(d => !d.planned);
    rec = {
      id: uid(), shareId: sid, ...shared, planned,
      nr: planned ? null : Math.max(0, ...logged.map(d => d.nr || 0)) + 1,
      gas: 'luft', photos: [], notes: cleanStr(src.notes, 2000), buddy: fromName, buddyIds: [],
      created: Date.now(), updated: Date.now(),
    };
    // Geplante Flaschen übernehmen (lassen sich danach anpassen)
    if (planned && Array.isArray(src.tanks)) {
      rec.tanks = src.tanks.slice(0, 8).map(t => ({
        size: cleanNum(t.size), gas: t.gas === 'nitrox' ? 'nitrox' : 'luft',
        o2: t.gas === 'nitrox' ? cleanNum(t.o2) : null, pStart: cleanNum(t.pStart), pEnd: null,
      }));
    }
  }
  if (fromId && !rec.buddyIds?.includes(fromId)) {
    rec.buddyIds = [...(rec.buddyIds || []), fromId];
    if (!nameMatch(rec.buddy, fromName)) rec.buddy = [rec.buddy, fromName].filter(Boolean).join(', ');
  }
  const knownBuddy = fromId ? await dbGet('buddies', fromId) : true;
  await dbWrite(['dives', 'buddies'], t => {
    t.objectStore('dives').put(rec);
    // Absender automatisch als Buddy anlegen (Daten kommen mit seiner Buddy-Karte)
    if (!knownBuddy) t.objectStore('buddies').put({ id: fromId, name: fromName, certs: [], stats: null, sharedAt: '', receivedAt: new Date().toISOString(), created: Date.now() });
  });
  toast(existing ? 'Tauchgang aktualisiert' : rec.planned ? 'Geplanter Tauchgang übernommen' : `Tauchgang #${rec.nr} übernommen`);
  return `logbuch/${rec.id}`;
}

async function pageImportPaste() {
  return {
    title: 'Code einfügen',
    back: 'buddys',
    html: `<div class="card">
        <p class="meta-line">Halte die Nachricht deines Buddys lange gedrückt → <strong>Kopieren</strong>. Dann hier einfügen.</p>
        <button type="button" class="btn btn-primary btn-big btn-block" data-paste>${ICON.paste}Aus Zwischenablage einfügen</button>
        <label class="field"><span class="field-label">oder selbst ins Feld einfügen</span>
          <span class="field-input"><textarea id="code-input" rows="4" placeholder="Nachricht oder Code (TLB1:…)"></textarea></span></label>
      </div>
      <div id="import-preview"></div>`,
    after(view) {
      const ta = $('#code-input', view);
      const out = $('#import-preview', view);
      const verify = async () => {
        if (!ta.value.trim()) { out.innerHTML = ''; return; }
        try {
          const obj = await decodeShare(ta.value);
          out.innerHTML = await importPreview(obj);
          bindImport(out, obj);
        } catch (e) {
          out.innerHTML = `<div class="notice"><p>${esc(e.message)}</p></div>`;
        }
      };
      ta.addEventListener('input', verify);
      $('[data-paste]', view).addEventListener('click', async () => {
        try {
          ta.value = await navigator.clipboard.readText();
          verify();
        } catch {
          ta.focus();
          toast('Bitte lange ins Feld tippen und „Einsetzen“ wählen', 4000);
        }
      });
    },
  };
}

/* ---------- QR-Code scannen (Kamera + jsQR, funktioniert offline) ---------- */
let camStream = null;
function stopCamera() {
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
}

// Kamera starten und QR-Codes lesen, bis ein gültiger Tauch-Logbuch-Code erkannt wird.
// Erwartet in view: .scan-box mit <video> und [data-scan-info].
async function startScanner(view, onCode) {
  const box = $('.scan-box', view);
  const video = $('video', box);
  const info = $('[data-scan-info]', view);
  box.hidden = false;
  info.textContent = 'Kamera wird gestartet …';
  try {
    await loadScript('lib/jsQR.js');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Dieser Browser erlaubt keinen Kamerazugriff.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (!view.isConnected) { stream.getTracks().forEach(t => t.stop()); return; }   // inzwischen weiternavigiert
    stopCamera();
    camStream = stream;
  } catch (e) {
    box.hidden = true;
    info.textContent = e.name === 'NotAllowedError'
      ? 'Kein Zugriff auf die Kamera. Bitte erlauben (iPhone: Einstellungen → Apps → Safari → Kamera) und erneut versuchen.'
      : `Kamera nicht verfügbar: ${e.message}`;
    return;
  }
  video.srcObject = camStream;
  await video.play().catch(() => {});
  info.textContent = 'Halte die Kamera auf den QR-Code deines Buddys.';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let busy = false;
  const tick = async () => {
    if (!camStream || !view.isConnected) return;
    if (!busy && video.readyState >= 2 && video.videoWidth) {
      const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const hit = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
      if (hit?.data) {
        busy = true;
        try {
          const obj = await decodeShare(hit.data);
          stopCamera();
          navigator.vibrate?.(80);
          box.hidden = true;
          info.textContent = 'QR-Code erkannt:';
          await onCode(obj);
          return;
        } catch (e) {
          info.textContent = `${e.message} – weiter scannen …`;
        }
        busy = false;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function pageScan() {
  return {
    title: 'QR-Code scannen',
    back: 'buddys',
    html: `<div class="scan-box" hidden><video playsinline muted></video><div class="scan-frame"></div></div>
      <p class="meta-line" data-scan-info style="margin-top:12px"></p>
      <div id="import-preview"></div>`,
    after(view) {
      const out = $('#import-preview', view);
      startScanner(view, async obj => {
        out.innerHTML = await importPreview(obj);
        bindImport(out, obj);
      });
    },
  };
}

/* ---------- Digitaler Buddy-Stempel ----------
   Jedes Handy hat ein eigenes Schlüsselpaar (ECDSA P-256). Der private Schlüssel verlässt das Gerät nie
   (auch nicht im Backup); der öffentliche reist mit der Buddy-Karte und mit jedem Stempel. */
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
const STAMP_FIELDS = ['date', 'time', 'site', 'maxDepth', 'duration'];
const STAMP_LABELS = { date: 'Datum', time: 'Uhrzeit', site: 'Tauchplatz', maxDepth: 'Tiefe', duration: 'Tauchzeit' };
const validJwk = k => (k?.kty === 'EC' && k.crv === 'P-256' && /^[\w-]{40,50}$/.test(k.x || '') && /^[\w-]{40,50}$/.test(k.y || '')
  ? { kty: 'EC', crv: 'P-256', x: k.x, y: k.y } : null);
const sameKey = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;

async function getSigner() {
  const saved = await getKV('signKey');
  if (saved?.publicJwk && (saved.privateKey || saved.privateJwk)) return saved;
  const pair = await crypto.subtle.generateKey(ECDSA, false, ['sign', 'verify']);
  const publicJwk = validJwk(await crypto.subtle.exportKey('jwk', pair.publicKey));
  let signer = { privateKey: pair.privateKey, publicJwk };
  try {
    await setKV('signKey', signer);
  } catch {
    // Falls der Browser Schlüssel-Objekte nicht speichern kann: als JWK ablegen
    const pair2 = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
    signer = { privateJwk: await crypto.subtle.exportKey('jwk', pair2.privateKey), publicJwk: validJwk(await crypto.subtle.exportKey('jwk', pair2.publicKey)) };
    await setKV('signKey', signer);
  }
  return signer;
}
async function keyFp(jwk) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${jwk.x}.${jwk.y}`)));
  const hex = [...hash.slice(0, 4)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${hex.slice(0, 4)} ${hex.slice(4)}`;
}
const stampMessage = s => new TextEncoder().encode(['TLBSTAMP', 1, s.diver, s.sid, s.date, s.time, s.site, s.maxDepth, s.duration,
  s.signerId, s.signerName, s.at, s.nonce].map(v => String(v ?? '')).join('|'));
async function verifyStamp(s) {
  try {
    const jwk = validJwk(s.key);
    if (!jwk || !s.sig) return false;
    const key = await crypto.subtle.importKey('jwk', { ...jwk, ext: true }, ECDSA, false, ['verify']);
    return await crypto.subtle.verify(SIGN, key, fromB64url(s.sig), stampMessage(s));
  } catch {
    return false;
  }
}

// Buddy-Seite: Anfrage abstempeln und Stempel-QR zeigen
async function giveStamp(req, me) {
  if (!me.name) throw new Error('Bitte zuerst unter Buddys → „Meine Buddy-Karte“ deinen Namen eintragen.');
  const diver = cleanId(req.from?.id);
  const sid = cleanId(req.dive?.sid);
  if (!diver || !sid) throw new Error('Die Stempel-Anfrage ist ungültig.');
  if (diver === me.id) throw new Error('Das ist dein eigener Tauchgang – den muss dein Buddy abstempeln.');
  const d = req.dive;
  const signer = await getSigner();
  const stamp = {
    t: 'stamp', diver, sid,
    date: cleanStr(d.date, 10), time: cleanStr(d.time, 5), site: cleanStr(d.site), maxDepth: cleanNum(d.maxDepth), duration: cleanNum(d.duration),
    signerId: me.id, signerName: me.name, key: signer.publicJwk, at: new Date().toISOString(), nonce: cleanStr(req.nonce, 40),
  };
  const sigKey = signer.privateKey || await crypto.subtle.importKey('jwk', signer.privateJwk, ECDSA, false, ['sign']);
  stamp.sig = b64url(new Uint8Array(await crypto.subtle.sign(SIGN, sigKey, stampMessage(stamp))));
  const link = shareLink(await encodeShare(stamp));
  const diverName = cleanStr(req.from?.name, 80) || 'deinen Buddy';
  await showQR(link, {
    title: `Dein Stempel für ${diverName}`,
    hint: `${esc(diverName)} scannt diesen Code auf der Stempel-Seite seines Tauchgangs.`,
    message: `🤿 Buddy-Stempel von ${me.name} für ${stamp.site}, ${fmtDate(stamp.date)}.\nIn der App unter Buddys → „Code einfügen“ einfügen:\n\n${link}`,
  });
  return null;
}

// Taucher-Seite: Stempel prüfen und am Tauchgang speichern
async function acceptStamp(obj, me) {
  if (cleanId(obj.diver) !== me.id) throw new Error('Dieser Stempel gehört zu einem anderen Taucher.');
  const dive = (await dbAll('dives')).find(d => d.id === obj.sid || d.shareId === obj.sid);
  if (!dive) throw new Error('Den gestempelten Tauchgang gibt es auf diesem Handy nicht.');
  const signerId = cleanId(obj.signerId);
  if (!signerId || !(await verifyStamp(obj))) throw new Error('Stempel ungültig – die digitale Unterschrift passt nicht.');
  const stamp = { key: validJwk(obj.key), sig: String(obj.sig) };
  for (const k of ['diver', 'sid', ...STAMP_FIELDS, 'signerId', 'signerName', 'at', 'nonce']) stamp[k] = obj[k] ?? null;
  const buddy = await dbGet('buddies', signerId);
  const rec = { ...dive, stamps: [...(dive.stamps || []).filter(s => s.signerId !== signerId), stamp], updated: Date.now() };
  await dbWrite(['dives', 'buddies'], t => {
    t.objectStore('dives').put(rec);
    // Unbekannter Stempelgeber wird Buddy; fehlt der Schlüssel noch, wird er jetzt gemerkt
    if (!buddy) t.objectStore('buddies').put({ id: signerId, name: cleanStr(obj.signerName, 80), key: stamp.key, certs: [], stats: null, sharedAt: '', receivedAt: new Date().toISOString(), created: Date.now() });
    else if (!buddy.key) t.objectStore('buddies').put({ ...buddy, key: stamp.key });
  });
  toast(`Gestempelt von ${stamp.signerName} ✓`);
  return `logbuch/${dive.id}`;
}

async function stampStatus(d, s) {
  if (!(await verifyStamp(s))) return { level: 'bad', text: '✗ Ungültig – die Unterschrift passt nicht.' };
  const changed = STAMP_FIELDS.filter(k => String(s[k] ?? '') !== String(d[k] ?? ''));
  if (changed.length) return { level: 'warn', text: `⚠ Der Tauchgang wurde nach dem Stempel geändert (${changed.map(k => STAMP_LABELS[k]).join(', ')}).` };
  const fp = await keyFp(s.key);
  const buddy = await dbGet('buddies', s.signerId);
  if (buddy?.key && !sameKey(buddy.key, s.key)) return { level: 'warn', text: `⚠ Unterschrift gültig, aber der Schlüssel (${fp}) passt nicht zur Buddy-Karte von ${buddy.name}.` };
  return { level: 'ok', text: `✓ Echt – Unterschrift geprüft · ${fmtDateTime(s.at)} · Schlüssel ${fp}` };
}

async function pageStampRequest(id) {
  const d = await dbGet('dives', id);
  if (!d) return notFound('logbuch');
  const name = await defaultName();
  return {
    title: 'Buddy-Stempel',
    back: `logbuch/${id}`,
    html: name ? `<div class="card"><div class="cert-org">Schritt 1 · Dein Buddy scannt</div>
        <p class="meta-line" style="margin-top:6px">${esc(d.site)} · ${fmtDate(d.date)} · ${dispU('depth', d.maxDepth)} · ${d.duration != null ? `${fmt(d.duration, 0)} min` : '–'}</p>
        <div class="qr-box"><img data-req-qr alt="QR-Code Stempel-Anfrage"></div>
        <p class="hint" style="margin:0">Dein Buddy öffnet <strong>Buddys → QR-Code scannen</strong> und tippt auf „Abstempeln“.</p>
        <button type="button" class="btn btn-block" data-req-share style="margin-top:12px">${ICON.share}Anfrage als Nachricht schicken</button>
      </div>
      <div class="card"><div class="cert-org">Schritt 2 · Stempel scannen</div>
        <p class="meta-line" style="margin-top:6px">Sein Handy zeigt dann den Stempel als QR-Code. Scanne ihn hier.</p>
        <button type="button" class="btn btn-primary btn-big btn-block" data-scan-stamp>${ICON.qr}Stempel scannen</button>
        <div class="scan-box" hidden style="margin-top:12px"><video playsinline muted></video><div class="scan-frame"></div></div>
        <p class="meta-line" data-scan-info style="margin:10px 0 0"></p>
        <div id="import-preview"></div>
      </div>`
      : `<div class="notice"><p>Trag zuerst unter Buddys → „Meine Buddy-Karte“ deinen Namen ein.</p><a class="btn btn-small" href="#buddys/teilen">Öffnen</a></div>`,
    async after(view) {
      if (!name) return;
      const me = await getMe();
      if (!me.name) await setKV('me', { ...me, name });
      const req = {
        t: 'stampreq', from: { id: me.id, name },
        dive: { sid: d.shareId || d.id, date: d.date, time: d.time, site: d.site, location: d.location, maxDepth: d.maxDepth, duration: d.duration },
        nonce: b64url(crypto.getRandomValues(new Uint8Array(9))),
      };
      const link = shareLink(await encodeShare(req));
      $('[data-req-qr]', view).src = await qrDataURL(link);
      $('[data-req-share]', view).addEventListener('click', () => shareText(
        `🤿 ${name} bittet um deinen Buddy-Stempel für ${d.site}, ${fmtDate(d.date)}.\nIn der App unter Buddys → „Code einfügen“ einfügen:\n\n${link}`, 'Stempel-Anfrage'));
      const scanBtn = $('[data-scan-stamp]', view);
      scanBtn.addEventListener('click', () => {
        scanBtn.hidden = true;
        const info = $('[data-scan-info]', view);
        const out = $('#import-preview', view);
        startScanner(view, async obj => {
          if (obj.t !== 'stamp') { out.innerHTML = await importPreview(obj); bindImport(out, obj); return; }
          try {
            navigate(await acceptStamp(obj, await getMe()), { replace: true });
          } catch (e) {
            info.textContent = e.message;
            scanBtn.hidden = false;
          }
        });
      });
    },
  };
}

// Aufruf über einen geteilten Link (#import=TLB1:…)
async function pageImportLink(raw) {
  const code = raw.replace(/%3A/gi, ':');
  let obj = null;
  let error = '';
  try { obj = await decodeShare(code); } catch (e) { error = e.message; }
  // iPhone-Safari statt installierter App: dort landen die Daten im falschen Speicher
  const iosBrowser = navigator.standalone === false;
  return {
    title: 'Code empfangen',
    back: 'buddys',
    html: `${error ? `<div class="notice"><p>${esc(error)}</p></div>` : ''}
      ${iosBrowser && obj ? `<div class="notice"><p><strong>Du bist in Safari, nicht in der App.</strong> Auf dem iPhone hat die App vom Home-Bildschirm einen eigenen Speicher. Tippe auf „Code kopieren“, öffne die Tauch-Logbuch-App und füge ihn unter Buddys → „Code einfügen“ ein.</p></div>
        <button type="button" class="btn btn-primary btn-big btn-block" data-copy-code style="margin-bottom:14px">${ICON.copy}Code kopieren</button>` : ''}
      <div id="import-preview">${obj ? await importPreview(obj) : ''}</div>`,
    after(view) {
      const out = $('#import-preview', view);
      if (iosBrowser) $('[data-apply]', out)?.remove();
      else if (obj) bindImport(out, obj);
      $('[data-copy-code]', view)?.addEventListener('click', () => copyText(code.match(SHARE_RE)[0], 'Code kopiert – jetzt in der App einfügen'));
    },
  };
}

/* =========================================================
   Globale Ereignisse & Start
   ========================================================= */
// Auswahl-Knöpfe mit data-optional: erneutes Antippen hebt die Auswahl auf
document.addEventListener('pointerdown', e => {
  const input = e.target.closest('.seg[data-optional] label')?.querySelector('input');
  if (input) input.dataset.was = input.checked ? '1' : '';
}, true);
document.addEventListener('click', e => {
  const input = e.target.closest('.seg[data-optional] input');
  if (input && input.dataset.was === '1') {
    input.checked = false;
    input.dataset.was = '';
  }
});

// Fotos antippen → Großansicht
document.addEventListener('click', e => {
  const img = e.target.closest('img[data-zoom]');
  if (img?.src) openLightbox(img.src);
});
$('#lightbox').addEventListener('click', () => history.back());
window.addEventListener('popstate', () => { if (!$('#lightbox').hidden) hideLightbox(); });

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#lightbox').hidden) history.back();
  else closeModal();
});

$('#back').addEventListener('click', e => goBack(e.currentTarget.dataset.target));
$('#testbanner-exit').addEventListener('click', () => setTestMode(false));

let updateReloading = false;
async function checkForUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) { toast('Offline-Speicher nicht aktiv – bitte die App mit Internet öffnen.', 4000); return; }
  toast('Suche nach Update …', 8000);
  try { await reg.update(); } catch { toast('Keine Verbindung – später noch einmal versuchen.', 4000, true); return; }
  if (reg.installing || reg.waiting) toast('Update gefunden – wird geladen …', 8000);   // danach lädt die App automatisch neu
  else toast(`Du hast die neueste Version (${APP_VERSION}).`, 3500);
}

async function init() {
  try {
    db = await openDB(testMode ? DB_TEST : DB_ECHT);
    await loadSettings();
  } catch (err) {
    $('#view').innerHTML = `<div class="card"><p><strong>Der Speicher ist nicht verfügbar.</strong></p>
      <p>${esc(err.message)}. In manchen privaten Browserfenstern funktioniert das Logbuch nicht.</p></div>`;
    return;
  }
  updateBanner();
  window.addEventListener('hashchange', () => router());
  router();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      // Apps vom Home-Bildschirm werden oft nur fortgesetzt statt neu geladen → beim Zurückkehren nach Updates suchen
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(err => console.warn('Service Worker nicht registriert:', err));
    // Neue Version aktiv → neu laden (nicht mitten in einem Formular, sonst gingen Eingaben verloren)
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || updateReloading) return;
      updateReloading = true;
      if ($('#view form')) toast('Neue Version geladen – bitte die App einmal neu öffnen', 6000);
      else location.reload();
    });
  }
}

init();
