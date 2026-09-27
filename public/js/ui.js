// Utilidades de interfaz: plantillas con escape, diálogos, avisos y formatos.

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function val(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  return esc(v);
}

/** Plantilla HTML: todo lo interpolado se escapa salvo lo envuelto en raw(). */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += val(values[i]);
  });
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function mount(el, content) {
  el.innerHTML = String(content);
}

/** Texto sin tildes ni apóstrofos, para buscar "ciroc" o "hendricks". */
export function norm(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'`´.]/g, '').toLowerCase();
}

// ------------------------------------------------------------------ formatos

export const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
export const fmt = (n) => nf1.format(Number(n) || 0);
export const plural = (n, one, many) => `${fmt(n)} ${Number(n) === 1 ? one : many}`;
export const bottles = (n) => plural(n, 'botella', 'botellas');

const WD = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const WEEKDAYS_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const WEEKDAYS_SHORT = WD;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function dateLabel(ymd, { weekday = true } = {}) {
  const d = new Date(`${ymd}T00:00:00Z`);
  const s = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return weekday ? `${WD[d.getUTCDay()]} ${s}` : s;
}

export function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export function dateTimeLabel(iso) {
  return new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function ago(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return `hace ${h} h ${min % 60 ? `${min % 60} min` : ''}`.trim();
}

export function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ productos

const STOP = new Set(['the', 'de', 'la', 'el', 'j&b']);

function initials(name) {
  if (/^j&b/i.test(name)) return 'J&B';
  const words = name.replace(/[’']s\b/g, '').split(/[\s/]+/).filter((w) => w && !STOP.has(w.toLowerCase()));
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

/** Foto del producto o, si aún no hay, un distintivo claramente no fotográfico. */
export function thumb(p, size = '') {
  if (p.photo) {
    return html`<span class="thumb ${size}"><img src="${p.photo}" alt="" loading="lazy" decoding="async"></span>`;
  }
  return html`<span class="thumb ${size} ph cat-${p.category}" aria-hidden="true"><b>${initials(p.product_name || p.name)}</b><small>sin foto</small></span>`;
}

// ------------------------------------------------------------------ avisos

let toastTimer;
export function toast(msg, kind = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 5000 : 2600);
}

export function buzz(ms = 12) {
  try { navigator.vibrate?.(ms); } catch { /* sin vibración */ }
}

// ------------------------------------------------------------------ diálogos

/**
 * Abre un diálogo modal. `render(close)` devuelve el contenido; `onMount(el,
 * close)` engancha los eventos. Devuelve una promesa con el valor de close().
 */
export function dialog({ title, body, actions = [], wide = false, onMount }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = `dlg ${wide ? 'wide' : ''}`;
    dlg.innerHTML = String(html`
      <form method="dialog" class="dlg-inner">
        <header class="dlg-head"><h2>${title}</h2>
          <button type="button" class="icon-btn" data-close aria-label="Cerrar">✕</button></header>
        <div class="dlg-body">${body}</div>
        ${actions.length ? html`<footer class="dlg-foot">${actions.map((a) => html`
          <button type="${a.submit ? 'submit' : 'button'}" class="btn ${a.kind || ''}" data-value="${a.value ?? ''}">${a.label}</button>`)}
        </footer>` : ''}
      </form>`);
    document.body.append(dlg);
    let result;
    const close = (v) => {
      result = v;
      dlg.close();
    };
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) close(undefined);
      const btn = e.target.closest('.dlg-foot button');
      if (btn && btn.type === 'button') close(btn.dataset.value || undefined);
    });
    const form = dlg.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      close(data);
    });
    dlg.showModal();
    onMount?.(dlg, close);
  });
}

export async function confirmDialog(title, text, { ok = 'Aceptar', kind = 'primary' } = {}) {
  const v = await dialog({
    title,
    body: html`<p>${text}</p>`,
    actions: [{ label: 'Cancelar', value: '' }, { label: ok, value: 'ok', kind }],
  });
  return v === 'ok';
}

/** Formulario en diálogo. `fields` es HTML con inputs con name. */
export function formDialog(title, fields, { ok = 'Guardar', kind = 'primary', wide = false, onMount } = {}) {
  return dialog({
    title,
    body: fields,
    wide,
    onMount,
    actions: [{ label: 'Cancelar', value: '' }, { label: ok, submit: true, kind }],
  }).then((v) => (v && typeof v === 'object' ? v : null));
}

// ------------------------------------------------------------------ fotos

/** Reduce una foto de la cámara a un JPEG ligero antes de subirla. */
export function resizeImage(file, max = 640, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿', text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function csv(rows) {
  return rows.map((r) => r.map((c) => {
    const s = c === null || c === undefined ? '' : String(c);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\n');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado');
  } catch {
    await dialog({ title: 'Copiar', body: html`<textarea class="copy-area" readonly>${text}</textarea>` });
  }
}
