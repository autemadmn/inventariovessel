// Gráfica del detalle de botella: una línea limpia con un punto por semana activa.
// Sin ejes recargados: solo la base, el máximo y la primera y última semana.
// Se recorre tocando, con el ratón, con las flechas o con los botones de 44 px.
import { raw, $, $$, html, fmt, plural, dateLabel } from '../ui.js';
import { icon } from '../icons.js';

const r1 = (n) => Math.round(n * 10) / 10;
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** «Semana del 21 al 27 sep» o «Semana del 29 sep al 5 oct». */
function weekLabel({ week_start: from, week_end: to }) {
  const start = from.slice(0, 7) === to.slice(0, 7) ? String(Number(from.slice(8))) : dateLabel(from, { weekday: false });
  return `Semana del ${start} al ${dateLabel(to, { weekday: false })}`;
}

/** `weeks` ya excluye las semanas en que el local no abrió. */
export function weekChart(weeks, { width = 600 } = {}) {
  const n = weeks.length;
  const W = Math.max(260, Math.floor(width));
  const H = 156;
  const left = 30;
  const right = 12;
  const top = 14;
  const bottom = 26;
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const base = top + plotH;
  const max = Math.max(1, ...weeks.map((w) => w.bottles));
  const step = n > 1 ? plotW / (n - 1) : 0;
  const pos = weeks.map((w, i) => ({
    x: r1(n > 1 ? left + i * step : left + plotW / 2),
    y: r1(base - (w.bottles / max) * plotH),
  }));

  const guides = `<line class="gridline" x1="${left}" x2="${W - right}" y1="${top}" y2="${top}"/>`
    + `<text class="ytick" x="${left - 6}" y="${top + 4}">${fmt(max)}</text>`
    + `<line class="gridline base" x1="${left}" x2="${W - right}" y1="${base}" y2="${base}"/>`
    + `<text class="ytick" x="${left - 6}" y="${base + 4}">0</text>`;
  const ticks = n ? [0, ...(n > 1 ? [n - 1] : [])].map((i) => `<text class="xtick ${i ? 'end' : 'start'}" x="${pos[i].x}" y="${base + 18}">${dateLabel(weeks[i].week_start, { weekday: false })}</text>`).join('') : '';
  const line = n > 1 ? `<path class="week-area" d="M${pos[0].x},${base}L${pos.map(({ x, y }) => `${x},${y}`).join('L')}L${pos.at(-1).x},${base}Z"/>`
    + `<polyline class="week-line" points="${pos.map(({ x, y }) => `${x},${y}`).join(' ')}"/>` : '';
  const points = weeks.map((week, i) => {
    const read = `${weekLabel(week)} · ${plural(week.bottles, 'botella', 'botellas')}`;
    return `<g class="chart-week" data-i="${i}" data-x="${pos[i].x}" data-read="${escAttr(read)}" aria-hidden="true">`
      + `<circle class="week-point" cx="${pos[i].x}" cy="${pos[i].y}" r="${n > 40 ? 2.5 : 3.5}"/></g>`;
  }).join('');

  return html`
    <svg class="chart week-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" tabindex="0" aria-label="Botellas por semana. Usa las flechas para recorrerlas">
      ${raw(guides)}${raw(line)}
      <line class="week-guide" x1="0" x2="0" y1="${top}" y2="${base}" visibility="hidden"/>
      ${raw(points)}${raw(ticks)}
      <rect class="hit" x="${left - 12}" y="0" width="${plotW + 24}" height="${H}"/>
    </svg>
    <div class="chart-read"><button type="button" class="icon-btn" data-week-shift="-1" aria-label="Semana anterior">${raw(icon('left', { size: 20 }))}</button>
      <span aria-live="polite"></span>
      <button type="button" class="icon-btn" data-week-shift="1" aria-label="Semana siguiente">${raw(icon('right', { size: 20 }))}</button></div>`;
}

/** Marca una semana: punto resaltado, línea guía y lectura debajo. */
export function selectWeekPoint(box, i) {
  const svg = $('.week-chart', box);
  if (!svg) return;
  const points = $$('.chart-week', svg);
  const point = points[Math.max(0, Math.min(points.length - 1, i))];
  if (!point) return;
  for (const p of points) p.classList.toggle('on', p === point);
  const guide = $('.week-guide', svg);
  guide.setAttribute('x1', point.dataset.x);
  guide.setAttribute('x2', point.dataset.x);
  guide.setAttribute('visibility', 'visible');
  svg.setAttribute('aria-label', `Botellas por semana. ${point.dataset.read}. Usa las flechas para recorrerlas`);
  const read = $('.chart-read', box);
  read.querySelector('span').textContent = point.dataset.read;
  read.querySelector('[data-week-shift="-1"]').disabled = point === points[0];
  read.querySelector('[data-week-shift="1"]').disabled = point === points.at(-1);
}

/** La semana más cercana al dedo o al puntero, según la posición horizontal. */
function nearest(svg, clientX) {
  const box = svg.getBoundingClientRect();
  const scale = svg.viewBox.baseVal.width / box.width;
  const x = (clientX - box.left) * scale;
  let best = 0;
  let dist = Infinity;
  for (const [i, p] of $$('.chart-week', svg).entries()) {
    const d = Math.abs(Number(p.dataset.x) - x);
    if (d < dist) { dist = d; best = i; }
  }
  return best;
}

export function bindWeekChart(box) {
  const pick = (e) => {
    const svg = e.target.closest?.('.week-chart');
    if (svg && box.contains(svg)) selectWeekPoint(box, nearest(svg, e.clientX));
  };
  box.addEventListener('pointermove', pick);
  box.addEventListener('pointerdown', pick);
  box.addEventListener('click', (e) => {
    const shift = e.target.closest?.('[data-week-shift]');
    if (!shift) return;
    const current = Number($('.chart-week.on', box)?.dataset.i ?? 0);
    selectWeekPoint(box, current + Number(shift.dataset.weekShift));
  });
  box.addEventListener('keydown', (e) => {
    if (!e.target.matches?.('.week-chart')) return;
    const i = Number($('.chart-week.on', box)?.dataset.i ?? 0);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1
      : e.key === 'Home' ? 0 : e.key === 'End' ? $$('.chart-week', box).length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    selectWeekPoint(box, next);
  });
}
