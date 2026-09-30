// Gráfica del detalle de botella: un punto por semana activa, con navegación accesible.
import { state } from '../state.js';
import { raw, $, $$, html, fmt, plural, dateLabel } from '../ui.js';
import { icon } from '../icons.js';

const r1 = (n) => Math.round(n * 10) / 10;
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function niceMax(v) {
  const half = v / 2;
  if (half <= 1) return 2;
  const mag = 10 ** Math.floor(Math.log10(half));
  return [1, 2, 5, 10].find((k) => k * mag >= half) * mag * 2;
}

/** Dibuja una línea con un punto por semana; `weeks` ya excluye las semanas inactivas. */
export function weekChart(weeks, { width = 600, bar = '' } = {}) {
  const bars = bar ? state.bars.filter((b) => String(b.id) === String(bar)) : state.bars;
  const n = weeks.length;
  const W = Math.max(260, Math.floor(width));
  const H = 168;
  const left = 34;
  const right = 14;
  const top = 12;
  const bottom = 29;
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const base = top + plotH;
  const max = niceMax(Math.max(1, ...weeks.map((w) => w.bottles)));
  const step = n > 1 ? plotW / (n - 1) : 0;
  const pos = weeks.map((w, i) => ({
    x: r1(n > 1 ? left + i * step : left + plotW / 2),
    y: r1(base - w.bottles * plotH / max),
  }));
  const grid = [0, max / 2, max].map((v) => {
    const y = r1(base - v * plotH / max);
    return `<line class="gridline${v ? '' : ' base'}" x1="${left}" x2="${W - right}" y1="${y}" y2="${y}"/>`
      + `<text class="ytick" x="${left - 6}" y="${y + 4}">${fmt(v)}</text>`;
  }).join('');
  const every = n <= 6 ? 1 : Math.ceil(n / 6);
  const points = weeks.map((week, i) => {
    const { x, y } = pos[i];
    const tick = i % every === 0 || i === n - 1
      ? `<text class="xtick" x="${x}" y="${base + 18}">${dateLabel(week.week_start, { weekday: false })}</text>` : '';
    const parts = [plural(week.bottles, 'botella', 'botellas')];
    if (bars.length > 1) parts.push(...bars.map((b) => `${b.name} ${fmt(week.byBar?.[b.id] || 0)}`));
    const read = `Semana del ${dateLabel(week.week_start)} al ${dateLabel(week.week_end)} · ${parts.join(' · ')}`;
    const hitWidth = n > 1 ? Math.max(44, step) : plotW;
    return `<g class="chart-week" data-i="${i}" data-read="${escAttr(read)}" aria-hidden="true">`
      + `<rect class="hit" x="${r1(x - hitWidth / 2)}" y="${top}" width="${r1(hitWidth)}" height="${plotH + bottom}"/>`
      + `<circle class="week-point" cx="${x}" cy="${y}" r="5"/></g>${tick}`;
  }).join('');
  const line = n > 1 ? `<polyline class="week-line" points="${pos.map(({ x, y }) => `${x},${y}`).join(' ')}"/>` : '';
  return html`
    <svg class="chart week-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" tabindex="0" aria-label="Botellas por semana. Usa las flechas para recorrerlas">
      ${raw(grid)}${raw(line)}${raw(points)}
    </svg>
    <div class="chart-read"><button type="button" class="icon-btn" data-week-shift="-1" aria-label="Semana anterior">${raw(icon('left', { size: 20 }))}</button>
      <span aria-live="polite"></span>
      <button type="button" class="icon-btn" data-week-shift="1" aria-label="Semana siguiente">${raw(icon('right', { size: 20 }))}</button></div>`;
}

/** Actualiza la lectura accesible y los botones de navegación semanal. */
export function selectWeekPoint(box, i) {
  const svg = $('.week-chart', box);
  if (!svg) return;
  const points = $$('.chart-week', svg);
  const point = points[Math.max(0, Math.min(points.length - 1, i))];
  if (!point) return;
  for (const p of points) p.classList.toggle('on', p === point);
  svg.classList.add('has-sel');
  svg.setAttribute('aria-label', `Botellas por semana. ${point.dataset.read}. Usa las flechas para recorrerlas`);
  const read = $('.chart-read', box);
  read.querySelector('span').textContent = point.dataset.read;
  read.querySelector('[data-week-shift="-1"]').disabled = point === points[0];
  read.querySelector('[data-week-shift="1"]').disabled = point === points.at(-1);
}

/** Permite explorar puntos con ratón, toque, teclado y botones de 44 px. */
export function bindWeekChart(box) {
  const pick = (e) => {
    const point = e.target.closest?.('.chart-week');
    if (point && box.contains(point)) selectWeekPoint(box, Number(point.dataset.i));
  };
  box.addEventListener('pointerover', pick);
  box.addEventListener('focusin', pick);
  box.addEventListener('click', pick);
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
