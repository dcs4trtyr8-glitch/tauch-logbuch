'use strict';

/* =========================================================
   Tauch-Logbuch – alle Daten liegen lokal in IndexedDB.
   Kein Server, kein Login. Fotos werden als Blob gespeichert.
   ========================================================= */

const APP_VERSION = '1.0.0';
const DB_ECHT = 'tauch-logbuch';
const DB_TEST = 'tauch-logbuch-testmodus';   // eigene Datenbank → Beispieldaten landen nie in den echten Daten
const STORES = ['dives', 'certs', 'hotlines', 'contacts', 'photos', 'kv'];
const DATA_STORES = ['dives', 'certs', 'hotlines', 'contacts', 'kv'];
const BACKUP_FORMAT = 'tauch-logbuch-backup';
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
};

/* =========================================================
   Datenbank
   ========================================================= */
let db = null;
let testMode = false;
try { testMode = sessionStorage.getItem('tl-testmodus') === '1'; } catch { /* privat-Modus */ }
let persistAsked = false;

function openDB(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
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
function refresh() { keepScrollNext = true; router(); }

const ID = '([\\w-]+)';
const ROUTES = [
  ['logbuch', pageLogbuch],
  ['logbuch/neu', () => pageDiveForm(null)],
  [`logbuch/${ID}/bearbeiten`, id => pageDiveForm(id)],
  [`logbuch/${ID}`, pageDiveDetail],
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
async function pageLogbuch() {
  const dives = sortDives(await dbAll('dives'));
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

  const items = dives.map(d => `<li><a class="dive-item" href="#logbuch/${d.id}">
      <span class="dive-nr">${d.nr != null ? esc(d.nr) : '–'}</span>
      <span class="dive-main">
        <span class="dive-site">${esc(d.site)}</span>
        <span class="dive-date">${fmtDate(d.date)}${d.time ? ` · ${esc(d.time)}` : ''}${d.location ? ` · ${esc(d.location)}` : ''}</span>
      </span>
      <span class="dive-figs">${dispU('depth', d.maxDepth)}<small>${d.duration != null ? `${fmt(d.duration, 0)} min` : '–'}</small></span>
    </a></li>`).join('');

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
      ${dives.length ? `<ul class="list">${items}</ul>`
        : `<div class="empty"><strong>Noch keine Tauchgänge</strong>Trag deinen ersten Tauchgang ein – nur Datum und Tauchplatz sind Pflicht.</div>`}`,
  };
}

async function pageDiveForm(id) {
  const dives = await dbAll('dives');
  let d;
  if (id) {
    d = dives.find(x => x.id === id);
    if (!d) return notFound('logbuch');
  } else {
    // Ausrüstung vom letzten Tauchgang vorschlagen → weniger tippen
    const last = sortDives(dives)[0] || {};
    d = {
      nr: Math.max(0, ...dives.map(x => x.nr || 0)) + 1,
      date: todayISO(), gas: 'luft',
      tankSize: last.tankSize ?? null, suit: last.suit ?? null, weight: last.weight ?? null,
      photos: [],
    };
  }
  const photos = (d.photos || []).map(pid => ({ id: pid }));

  return {
    title: id ? `Tauchgang ${d.nr != null ? '#' + d.nr : ''} bearbeiten` : 'Neuer Tauchgang',
    back: id ? `logbuch/${id}` : 'logbuch',
    html: `<form id="dive-form" novalidate>
      <fieldset class="form-card"><legend>Allgemein</legend>
        <div class="grid2">
          ${field({ label: 'Tauchgang-Nr.', name: 'nr', value: d.nr ?? '', mode: 'numeric' })}
          ${field({ label: 'Einstiegszeit', name: 'time', type: 'time', value: d.time })}
        </div>
        ${field({ label: 'Datum', name: 'date', type: 'date', value: d.date, required: true })}
      </fieldset>
      <fieldset class="form-card"><legend>Ort</legend>
        ${field({ label: 'Tauchplatz / Gewässer', name: 'site', value: d.site, required: true, list: 'dl-site', placeholder: 'z. B. Kreidesee Hemmoor' })}
        ${field({ label: 'Land / Ort', name: 'location', value: d.location, list: 'dl-location', placeholder: 'z. B. Hemmoor, Deutschland' })}
      </fieldset>
      <fieldset class="form-card"><legend>Tauchgang</legend>
        <div class="grid2">
          ${numField('Max. Tiefe', 'maxDepth', 'depth', d.maxDepth)}
          ${field({ label: 'Tauchzeit', name: 'duration', value: d.duration ?? '', mode: 'numeric', unit: 'min' })}
          ${numField('Wassertemp.', 'waterTemp', 'temp', d.waterTemp)}
          ${numField('Sicht', 'visibility', 'depth', d.visibility)}
        </div>
      </fieldset>
      <fieldset class="form-card"><legend>Flasche &amp; Gas</legend>
        ${field({ label: 'Flaschengröße', name: 'tankSize', value: d.tankSize != null ? fmtPlain(d.tankSize) : '', mode: 'decimal', unit: 'l' })}
        <div class="field"><span class="field-label">Gas</span>${segmented('gas', [['luft', 'Luft'], ['nitrox', 'Nitrox']], d.gas || 'luft')}</div>
        <div id="o2-field"${d.gas === 'nitrox' ? '' : ' hidden'}>
          ${field({ label: 'O₂-Anteil', name: 'o2', value: d.o2 != null ? fmtPlain(d.o2) : '', mode: 'decimal', unit: '%', placeholder: '32' })}
        </div>
        <div class="grid2">
          ${numField('Druck Anfang', 'pStart', 'pressure', d.pStart)}
          ${numField('Druck Ende', 'pEnd', 'pressure', d.pEnd)}
        </div>
      </fieldset>
      <fieldset class="form-card"><legend>Ausrüstung &amp; Buddy</legend>
        <div class="field"><span class="field-label">Anzug</span>
          ${segmented('suit', [['nass', 'Nass'], ['halbtrocken', 'Halb&shy;trocken'], ['trocken', 'Trocki']], d.suit, true)}</div>
        ${numField('Blei', 'weight', 'weight', d.weight)}
        ${field({ label: 'Buddy', name: 'buddy', value: d.buddy, list: 'dl-buddy' })}
      </fieldset>
      <fieldset class="form-card"><legend>Notizen</legend>
        ${field({ label: 'Was war los? Tiere, Strömung, Besonderheiten …', name: 'notes', type: 'textarea', value: d.notes })}
      </fieldset>
      <fieldset class="form-card"><legend>Fotos (optional)</legend>
        <div id="photo-edit" class="photo-edit"></div>
        ${photoButtons('dive', true)}
      </fieldset>
      ${saveBar()}
      ${datalist('dl-site', unique(dives.map(x => x.site)))}
      ${datalist('dl-location', unique(dives.map(x => x.location)))}
      ${datalist('dl-buddy', unique(dives.map(x => x.buddy)))}
    </form>`,
    after(view) {
      const form = $('#dive-form', view);
      const grid = $('#photo-edit', view);
      const drawPhotos = () => {
        grid.innerHTML = photos.map((p, i) => `<div class="photo-thumb"><img alt="Foto ${i + 1}" data-zoom>
          <button type="button" class="photo-remove" data-remove="${i}" aria-label="Foto entfernen">×</button></div>`).join('');
        $$('img', grid).forEach((img, i) => setImg(img, photos[i]));
      };
      drawPhotos();

      form.addEventListener('change', async e => {
        if (e.target.name === 'gas') $('#o2-field', form).hidden = form.elements.gas.value !== 'nitrox';
        if (e.target.dataset.photoInput) { photos.push(...await readPhotoInput(e.target)); drawPhotos(); }
      });
      form.addEventListener('click', async e => {
        const rm = e.target.closest('[data-remove]');
        if (rm && await confirmDialog({ title: 'Foto entfernen?', text: 'Das Foto wird beim Speichern gelöscht.', ok: 'Entfernen', danger: true })) {
          photos.splice(Number(rm.dataset.remove), 1);
          drawPhotos();
        }
        if (e.target.closest('[data-cancel]')) goBack(id ? `logbuch/${id}` : 'logbuch');
      });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        clearErrors(form);
        const { text, num, errors } = formReader(form, d);
        const gas = text('gas') || 'luft';
        const rec = {
          ...d,
          id: d.id || uid(),
          nr: num('nr'),
          date: text('date'),
          time: text('time'),
          site: text('site'),
          location: text('location'),
          maxDepth: num('maxDepth', 'depth'),
          duration: num('duration'),
          waterTemp: num('waterTemp', 'temp'),
          visibility: num('visibility', 'depth'),
          tankSize: num('tankSize'),
          gas,
          o2: gas === 'nitrox' ? num('o2') : null,
          pStart: num('pStart', 'pressure'),
          pEnd: num('pEnd', 'pressure'),
          suit: text('suit') || null,
          weight: num('weight', 'weight'),
          buddy: text('buddy'),
          notes: text('notes'),
          photos: photos.map(p => p.id),
          created: d.created || Date.now(),
          updated: Date.now(),
        };
        if (!rec.date) errors.unshift(['date', 'Bitte ein Datum wählen']);
        if (!rec.site) errors.unshift(['site', 'Bitte den Tauchplatz eintragen']);
        if (rec.o2 != null && (rec.o2 < 21 || rec.o2 > 100)) errors.push(['o2', 'O₂-Anteil zwischen 21 und 100 %']);
        if (errors.length) { showErrors(form, errors); return; }
        try {
          await saveWithPhotos('dives', rec, photos, rec.photos, d.photos || []);
        } catch (err) {
          toast('Speichern fehlgeschlagen: ' + err.message, 5000, true);
          return;
        }
        toast(`Tauchgang ${rec.nr != null ? '#' + rec.nr + ' ' : ''}gespeichert`);
        goBack(id ? `logbuch/${id}` : 'logbuch');
      });
    },
  };
}

async function pageDiveDetail(id) {
  const d = await dbGet('dives', id);
  if (!d) return notFound('logbuch');

  const gas = d.gas === 'nitrox' ? `Nitrox${d.o2 != null ? ` ${fmt(d.o2)} % O₂` : ''}` : 'Luft';
  const used = d.pStart != null && d.pEnd != null ? d.pStart - d.pEnd : null;
  let usage = '';
  if (used != null) {
    usage = dispU('pressure', used);
    if (d.tankSize) usage += ` · ca. ${fmt(used * d.tankSize, 0)} l`;
  }
  const pressure = d.pStart != null || d.pEnd != null
    ? `${d.pStart != null ? fmt(unit('pressure').f(d.pStart), 0) : '?'} → ${dispU('pressure', d.pEnd)}` : '';
  const tile = (label, v) => `<div class="stat"><div class="stat-value">${v}</div><div class="stat-label">${label}</div></div>`;

  return {
    title: `Tauchgang ${d.nr != null ? '#' + d.nr : ''}`,
    back: 'logbuch',
    html: `<div class="detail-head"><h2>${esc(d.site)}</h2>
        <p>${fmtDate(d.date)}${d.time ? `, ${esc(d.time)} Uhr` : ''}${d.location ? ` · ${esc(d.location)}` : ''}</p></div>
      <div class="tiles">
        ${tile('Max. Tiefe', dispU('depth', d.maxDepth))}
        ${tile('Tauchzeit', d.duration != null ? `${fmt(d.duration, 0)} min` : '–')}
        ${tile('Wasser', dispU('temp', d.waterTemp))}
        ${tile('Sicht', dispU('depth', d.visibility))}
      </div>
      <div class="card">${kvList([
        ['Flasche', d.tankSize != null ? `${fmt(d.tankSize)} l` : ''],
        ['Gas', gas],
        ['Druck', pressure],
        ['Verbrauch', usage],
        ['Anzug', SUITS[d.suit] || ''],
        ['Blei', d.weight != null ? dispU('weight', d.weight) : ''],
        ['Buddy', d.buddy],
      ]) || '<p class="hint" style="margin:0">Keine weiteren Angaben.</p>'}</div>
      ${d.notes ? `<h2 class="section-title">Notizen</h2><div class="card"><p class="notes">${esc(d.notes)}</p></div>` : ''}
      ${d.photos?.length ? `<h2 class="section-title">Fotos</h2><div class="photo-grid">
        ${d.photos.map((p, i) => `<img data-photo="${esc(p)}" data-zoom alt="Foto ${i + 1}">`).join('')}</div>` : ''}
      <div class="btn-row" style="margin-top:18px">
        <button type="button" class="btn btn-outline-danger" data-delete>${ICON.trash}Löschen</button>
        <a class="btn btn-primary" href="#logbuch/${d.id}/bearbeiten">${ICON.edit}Bearbeiten</a>
      </div>`,
    after(view) {
      $('[data-delete]', view).addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Tauchgang löschen?',
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
      <p class="hint" style="text-align:center;margin-top:20px">Tauch-Logbuch ${APP_VERSION} · alle Daten bleiben auf diesem Gerät</p>`,
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
  ];
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
    t.objectStore('kv').put({ id: 'profile', value: profile });
  });
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
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker nicht registriert:', err));
  }
}

init();
