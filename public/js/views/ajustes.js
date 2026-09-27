// Ajustes generales, nombres de las barras y códigos de acceso.
import { auth, mget, mput } from '../api.js';
import { state, loadBootstrap } from '../state.js';
import { html, mount, toast } from '../ui.js';

export async function renderAjustes(root) {
  const s = await mget('/api/settings');
  mount(root, html`
    <form id="settings" class="stack">
      <h3 class="section-title">Barras</h3>
      <div class="form-grid">${s.bars.map((b) => html`
        <label class="field"><span>Nombre de la barra ${b.id}</span><input name="bar_${b.id}" value="${b.name}" maxlength="40" required></label>`)}</div>

      <h3 class="section-title">Noche de trabajo</h3>
      <div class="form-grid">
        <label class="field"><span>Hora de corte</span>
          <input name="cutoff_hour" type="number" min="0" max="23" value="${s.cutoff_hour}" required>
          <small class="muted">Lo que ocurra antes de esta hora cuenta para la noche anterior (por defecto, 12:00).</small></label>
        <label class="field"><span>Zona horaria</span><input name="timezone" value="${s.timezone}" required></label>
        <label class="field"><span>Minutos para deshacer una entrega</span><input name="undo_minutes" type="number" min="0" max="120" value="${s.undo_minutes}"></label>
      </div>

      <h3 class="section-title">Previsión</h3>
      <div class="form-grid">
        <label class="field"><span>Margen de seguridad por defecto (%)</span><input name="safety_pct" type="number" min="0" max="200" value="${s.safety_pct}"></label>
        <label class="field"><span>Noches mínimas para una previsión fiable</span><input name="low_data_nights" type="number" min="1" max="60" value="${s.low_data_nights}"></label>
        <label class="field"><span>Noches de cada día de la semana para distinguirlos</span><input name="min_nights_per_weekday" type="number" min="1" max="20" value="${s.min_nights_per_weekday}"></label>
      </div>

      <h3 class="section-title">Acceso</h3>
      <p class="muted small">La aplicación está en internet: usa un código para el personal y un PIN distinto para el encargado.</p>
      <div class="form-grid">
        <label class="field"><span>Código de acceso del personal</span>
          ${s.staffCodeFromEnv ? html`<small class="muted">Definido en el servidor (STAFF_CODE).</small>`
    : html`<input name="staff_code" type="password" autocomplete="new-password" placeholder="${s.staffCodeSet ? 'Sin cambios' : 'Sin código: acceso libre'}">`}</label>
        <label class="field"><span>PIN del encargado</span>
          ${s.managerPinFromEnv ? html`<small class="muted">Definido en el servidor (MANAGER_PIN).</small>`
    : html`<input name="manager_pin" type="password" autocomplete="new-password" placeholder="${s.managerPinSet ? 'Sin cambios' : 'Sin PIN: gestión abierta'}">`}</label>
      </div>
      <button class="btn primary">Guardar ajustes</button>
    </form>

    <h3 class="section-title">Copia de seguridad</h3>
    <p class="muted small">Descarga una copia completa de los datos (historial, catálogo, listas). Guárdala de vez en cuando fuera del servidor.</p>
    <button type="button" class="btn ghost" id="backup">Descargar copia de seguridad</button>`);

  root.querySelector('#backup').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/backup', { headers: { 'X-Access-Code': auth.code, 'X-Manager-Pin': auth.pin } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo crear la copia.');
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'reposicion.db';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  root.querySelector('#settings').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const body = {
      bars: s.bars.map((b) => ({ id: b.id, name: f[`bar_${b.id}`] })),
      cutoff_hour: f.cutoff_hour,
      timezone: f.timezone,
      undo_minutes: f.undo_minutes,
      safety_pct: f.safety_pct,
      low_data_nights: f.low_data_nights,
      min_nights_per_weekday: f.min_nights_per_weekday,
      by: state.who,
    };
    if (f.staff_code) body.staff_code = f.staff_code;
    if (f.manager_pin) body.manager_pin = f.manager_pin;
    try {
      await mput('/api/settings', body);
      // Mantener la sesión de este dispositivo con los códigos nuevos.
      if (f.staff_code) auth.code = f.staff_code;
      if (f.manager_pin) auth.pin = f.manager_pin;
      await loadBootstrap();
      toast('Ajustes guardados');
      renderAjustes(root);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
