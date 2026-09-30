import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document = { addEventListener: () => {} };
const { state } = await import('../public/js/state.js');
const { weekChart } = await import('../public/js/views/weekly-chart.js');

test('gráfica de botella: un punto por semana activa y controles semanales accesibles', () => {
  state.bars = [{ id: 1, name: 'Barra 1' }, { id: 2, name: 'Barra 2' }];
  const markup = String(weekChart([
    { week_start: '2026-09-07', week_end: '2026-09-13', bottles: 3, byBar: { 1: 3 } },
    { week_start: '2026-09-14', week_end: '2026-09-20', bottles: 0, byBar: {} },
    { week_start: '2026-09-28', week_end: '2026-10-04', bottles: 5, byBar: { 2: 5 } },
  ]));
  assert.equal((markup.match(/class="chart-week"/g) || []).length, 3);
  assert.match(markup, /class="week-line"/);
  assert.match(markup, /Semana del lun 14 sep al dom 20 sep · 0 botellas/);
  assert.match(markup, /aria-label="Semana anterior"/);
  assert.match(markup, /aria-label="Semana siguiente"/);
  assert.doesNotMatch(markup, /Noche anterior|Noche siguiente|data-night=/);
});
