// Noches de trabajo: cada noche agrupa las reposiciones aunque sigan después de
// medianoche. Aquí se indica si las barras terminaron con el mismo nivel.
import { mget, mput } from '../api.js';
import { state } from '../state.js';
import { html, mount, fmt, dateLabel, addDays, toast } from '../ui.js';

let days = 60;

export async function renderNoches(root) {
  const draw = async () => {
    const list = await mget(`/api/sessions?from=${addDays(state.date, -days)}&to=${state.date}`);
    mount(root, html`
      <div class="notice">
        <p>Una noche de trabajo incluye todo lo que ocurre hasta las ${state.settings.cutoff_hour}:00 del día siguiente.</p>
        <p><b>¿Mismo nivel al empezar y al terminar?</b> Si las barras acaban la noche con las mismas existencias con las que empezaron, lo repuesto equivale aproximadamente a lo consumido. Si no se indica, los informes hablan de «botellas repuestas».</p>
      </div>
      ${list.length ? html`<ul class="nights">${list.map((s) => html`
        <li data-id="${s.id}">
          <div class="night-head">
            <b>${dateLabel(s.business_date)}</b>
            ${s.business_date === state.date ? html`<span class="tag info">En curso</span>` : ''}
            <span class="muted">${fmt(s.delivered)} repuestas${s.unserved ? ` · ${s.unserved} sin entregar` : ''}</span>
          </div>
          <div class="night-fields">
            <label class="field inline"><span>Mismo nivel al empezar y terminar</span>
              <select data-level="${s.id}">
                <option value="" ${s.same_level === null ? 'selected' : ''}>Sin indicar</option>
                <option value="1" ${s.same_level === 1 ? 'selected' : ''}>Sí</option>
                <option value="0" ${s.same_level === 0 ? 'selected' : ''}>No</option>
              </select></label>
            <label class="field"><span>Notas (evento, incidencias…)</span>
              <input data-notes="${s.id}" value="${s.notes || ''}" maxlength="500" placeholder="Opcional"></label>
          </div>
        </li>`)}</ul>` : html`<p class="empty">Todavía no hay noches registradas.</p>`}
      ${list.length >= 1 ? html`<button type="button" class="btn ghost" data-more>Ver noches más antiguas</button>` : ''}`);
  };

  root.addEventListener('change', async (e) => {
    const t = e.target;
    try {
      if (t.dataset.level) {
        await mput(`/api/sessions/${t.dataset.level}`, { same_level: t.value === '' ? null : t.value === '1', by: state.who });
        toast('Guardado');
      } else if (t.dataset.notes) {
        await mput(`/api/sessions/${t.dataset.notes}`, { notes: t.value, by: state.who });
        toast('Notas guardadas');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-more]')) {
      days += 90;
      await draw();
    }
  });
  await draw();
}
