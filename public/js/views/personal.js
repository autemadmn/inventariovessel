// Gestión → Personal: nombres que se eligen al abrir la app. No son cuentas.
import { mget, mpost, mput } from '../api.js';
import { state, loadBootstrap } from '../state.js';
import {
  html, raw, mount, toast, formDialog, confirmDialog,
} from '../ui.js';
import { icon } from '../icons.js';

const validName = (s) => typeof s === 'string' && s.trim().length >= 1 && s.trim().length <= 40;
const same = (a, b) => a.trim().toLocaleLowerCase('es') === b.trim().toLocaleLowerCase('es');

export async function renderPersonal(root) {
  let people = await mget('/api/staff');
  let error = '';

  const active = () => people.filter((p) => p.active).sort((a, b) => a.sort - b.sort || a.id - b.id);
  const retired = () => people.filter((p) => !p.active);

  const draw = () => {
    const list = active();
    const gone = retired();
    mount(root, html`
      <div class="staff">
        <p class="muted small">Estos nombres aparecen al abrir la app para elegir quién la usa.</p>
        <form class="staff-add" id="staff-form" novalidate>
          <label class="field"><span>Añadir persona</span>
            <div class="staff-add-row">
              <input name="name" id="staff-name" maxlength="40" autocomplete="off" placeholder="Nombre (1 a 40 caracteres)" aria-describedby="staff-err">
              <button type="submit" class="btn primary">${raw(icon('user-plus', { size: 18 }))} Añadir</button>
            </div></label>
          <p class="error small" id="staff-err" role="alert">${error}</p>
        </form>

        ${list.length ? html`<ul class="staff-list">${list.map((p, i) => html`
          <li>
            <span class="staff-name">${p.name}</span>
            <div class="staff-btns">
              <button type="button" class="icon-btn" data-up="${p.id}" ${i === 0 ? 'disabled' : ''} aria-label="Subir a ${p.name}">${raw(icon('arrow-up'))}</button>
              <button type="button" class="icon-btn" data-down="${p.id}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Bajar a ${p.name}">${raw(icon('arrow-down'))}</button>
              <button type="button" class="icon-btn" data-rename="${p.id}" aria-label="Renombrar a ${p.name}" title="Renombrar">${raw(icon('pencil'))}</button>
              <button type="button" class="icon-btn danger" data-remove="${p.id}" aria-label="Quitar a ${p.name}" title="Quitar">${raw(icon('trash'))}</button>
            </div>
          </li>`)}</ul>`
    : html`<p class="empty">No hay nadie en la lista. Al abrir la app se pedirá escribir el nombre a mano.</p>`}

        ${gone.length ? html`
          <details class="collapse-box">
            <summary>Retirados (${gone.length})</summary>
            <p class="muted small">Siguen apareciendo en el histórico con su nombre.</p>
            <ul class="staff-list retired">${gone.map((p) => html`
              <li><span class="staff-name">${p.name}</span>
                <button type="button" class="btn small ghost" data-restore="${p.id}">Volver a activar</button></li>`)}</ul>
          </details>` : ''}
      </div>`);
  };

  const refresh = async () => {
    error = '';
    people = await mget('/api/staff');
    draw();
    loadBootstrap().catch(() => {});
  };

  async function saveOrder(ids, { undoable = true } = {}) {
    error = '';
    const before = people;
    const prev = active().map((p) => p.id);
    people = people.map((p) => (ids.includes(p.id) ? { ...p, sort: (ids.indexOf(p.id) + 1) * 10 } : p));
    draw();
    try {
      await mput('/api/staff/order', { ids, by: state.who });
    } catch (err) {
      people = before;
      draw();
      toast(err.message, 'error');
      return;
    }
    if (undoable) {
      toast('Guardado', 'ok', {
        action: { label: 'Deshacer', onClick: async () => { await saveOrder(prev, { undoable: false }); toast('Deshecho', 'info'); } },
      });
    }
    loadBootstrap().catch(() => {});
  }

  async function rename(p, name, { undoable = true } = {}) {
    error = '';
    const old = p.name;
    try {
      await mput(`/api/staff/${p.id}`, { name, by: state.who });
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
    if (undoable) {
      toast('Guardado', 'ok', {
        action: { label: 'Deshacer', onClick: async () => { await rename({ id: p.id, name }, old, { undoable: false }); toast('Deshecho', 'info'); } },
      });
    }
    await refresh();
  }

  root.addEventListener('submit', async (e) => {
    if (e.target.id !== 'staff-form') return;
    e.preventDefault();
    const name = new FormData(e.target).get('name') ?? '';
    error = '';
    if (!validName(name)) error = 'El nombre debe tener entre 1 y 40 caracteres.';
    else if (active().some((p) => same(p.name, name))) error = 'Ya hay una persona con ese nombre.';
    if (error) {
      draw();
      root.querySelector('#staff-name').value = name;
      root.querySelector('#staff-name').focus();
      return;
    }
    try {
      const retiredMatch = retired().find((p) => same(p.name, name));
      await mpost('/api/staff', { name: name.trim(), by: state.who });
      toast(retiredMatch ? `${retiredMatch.name} vuelve a estar activo` : 'Persona añadida');
      await refresh();
      root.querySelector('#staff-name')?.focus();
    } catch (err) {
      error = err.message;
      draw();
      root.querySelector('#staff-name').value = name;
    }
  });

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    const d = t.dataset;
    try {
      if (d.up || d.down) {
        const ids = active().map((p) => p.id);
        const k = ids.indexOf(Number(d.up || d.down));
        const j = d.up ? k - 1 : k + 1;
        if (j < 0 || j >= ids.length) return;
        [ids[k], ids[j]] = [ids[j], ids[k]];
        await saveOrder(ids);
      } else if (d.rename) {
        const p = people.find((x) => x.id === Number(d.rename));
        const data = await formDialog('Renombrar', html`
          <label class="field"><span>Nombre</span><input name="name" value="${p.name}" maxlength="40" required autofocus></label>`);
        const name = data?.name.trim();
        if (!name || name === p.name) return;
        if (!validName(name)) toast('El nombre debe tener entre 1 y 40 caracteres.', 'error');
        else if (people.some((x) => x.id !== p.id && x.active && same(x.name, name))) toast('Ya hay una persona con ese nombre.', 'error');
        else await rename(p, name);
      } else if (d.remove) {
        const p = people.find((x) => x.id === Number(d.remove));
        if (!await confirmDialog(`Quitar a ${p.name}`,
          'Dejará de salir al elegir quién eres. Su nombre sigue en el histórico y se puede volver a activar.',
        { ok: 'Quitar', kind: 'danger' })) return;
        await mput(`/api/staff/${p.id}`, { active: false, by: state.who });
        toast(`${p.name} retirado`);
        await refresh();
      } else if (d.restore) {
        await mput(`/api/staff/${d.restore}`, { active: true, by: state.who });
        toast('Vuelve a estar activo (al final de la lista)');
        await refresh();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  draw();
}
