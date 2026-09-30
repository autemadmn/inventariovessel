// Gestión → Selección: qué botellas salen en «Pedir», en qué grupo y en qué orden.
// Todo lo que se hace arrastrando se puede hacer con los botones y el menú (…).
import { mput, mpost, mdel } from '../api.js';
import {
  state, loadBootstrap, subscribe,
} from '../state.js';
import {
  html, raw, mount, thumb, toast, dialog, formDialog, confirmDialog, buzz, norm,
} from '../ui.js';
import { icon } from '../icons.js';

const HOLD_MS = 250;
const EDGE = 96;

let outQ = '';
let unsub = null;

// ------------------------------------------------------------------ modelo

const sortedGroups = () => [...state.groups].sort((a, b) => a.sort - b.sort || a.id - b.id);
const inGroup = (gid) => state.products
  .filter((p) => p.group_id === gid)
  .sort((a, b) => (a.group_order ?? 0) - (b.group_order ?? 0) || a.id - b.id);
const outOfSelection = () => state.products.filter((p) => p.group_id === null || p.group_id === undefined);
const prod = (id) => state.products.find((p) => p.id === Number(id));
const groupOf = (gid) => state.groups.find((g) => g.id === Number(gid));

/** Foto fija de la selección: Map grupo → ids en orden. */
function layoutOf() {
  return new Map(state.groups.map((g) => [g.id, inGroup(g.id).map((p) => p.id)]));
}

function applyLayout(layout) {
  for (const p of state.products) {
    p.group_id = null;
    p.group_order = null;
  }
  for (const [gid, ids] of layout) {
    ids.forEach((id, i) => {
      const p = prod(id);
      if (p) {
        p.group_id = gid;
        p.group_order = i + 1;
      }
    });
  }
}

/** Cambios que hay que enviar para pasar de `from` a `to`: solo los grupos afectados. */
function diffItems(from, to) {
  const affected = [...new Set([...from.keys(), ...to.keys()])]
    .filter((g) => JSON.stringify(from.get(g) ?? []) !== JSON.stringify(to.get(g) ?? []));
  const inTo = new Set([...to.values()].flat());
  const items = [];
  for (const g of affected) {
    (to.get(g) ?? []).forEach((id, i) => items.push({ id, group_id: g, group_order: i + 1 }));
  }
  for (const g of affected) {
    for (const id of from.get(g) ?? []) {
      if (!inTo.has(id)) items.push({ id, group_id: null, group_order: null });
    }
  }
  return items;
}

const cloneLayout = (l) => new Map([...l].map(([g, ids]) => [g, [...ids]]));

// ------------------------------------------------------------------ vista

export async function renderSeleccion(root) {
  unsub?.();
  outQ = '';
  let busy = 0;
  let pendingDraw = false;
  let drag = null;

  const hold = () => { busy += 1; };
  const release = () => {
    busy = Math.max(0, busy - 1);
    if (!busy && pendingDraw) {
      pendingDraw = false;
      draw();
    }
  };

  // Firma de lo que se pinta: si el bootstrap no cambia nada, no se redibuja
  // (así no se pierde el foco del buscador ni parpadea tras cada guardado).
  let drawn = '';
  const signature = () => JSON.stringify([
    state.groups.map((g) => [g.id, g.name, g.sort]),
    state.products.map((p) => [p.id, p.name, p.status, p.out_of_stock, p.group_id, p.group_order, p.slug, p.photo]),
  ]);

  unsub = subscribe((what) => {
    if (what !== 'bootstrap') return;
    if (!root.isConnected) { unsub?.(); return; }
    if (signature() === drawn) return;
    if (busy || document.activeElement?.id === 'out-q') pendingDraw = true;
    else draw();
  });
  root.addEventListener('focusout', (e) => {
    if (e.target.id === 'out-q' && pendingDraw && !busy) {
      pendingDraw = false;
      draw();
    }
  });

  // ---------------------------------------------------------------- pintar

  const rowHtml = (p, gid, i, n) => html`
    <li class="sel-row ${p.out_of_stock ? 'is-out' : ''}" data-id="${p.id}">
      <span class="grip" data-grip aria-hidden="true">${raw(icon('grip-vertical', { size: 20 }))}</span>
      ${thumb(p, 'mini')}
      <div class="sel-name"><b>${p.name}</b>
        ${p.status === 'pendiente' ? html`<small class="muted">Por confirmar</small>` : ''}</div>
      <button type="button" class="icon-btn" data-pmenu="${p.id}" data-pos="${i}/${n}" aria-label="Opciones de ${p.name}">${raw(icon('more'))}</button>
    </li>`;

  const groupHtml = (g, gi, gn) => {
    const items = inGroup(g.id);
    return html`
    <section class="sel-group" data-gid="${g.id}">
      <header class="sel-head">
        <h3>${g.name}</h3><span class="sel-count">${items.length}</span>
        <div class="sel-head-btns">
          <button type="button" class="icon-btn" data-gup="${g.id}" ${gi === 0 ? 'disabled' : ''} aria-label="Subir grupo ${g.name}">${raw(icon('arrow-up'))}</button>
          <button type="button" class="icon-btn" data-gdown="${g.id}" ${gi === gn - 1 ? 'disabled' : ''} aria-label="Bajar grupo ${g.name}">${raw(icon('arrow-down'))}</button>
          <button type="button" class="icon-btn" data-gmenu="${g.id}" aria-label="Más opciones del grupo ${g.name}">${raw(icon('more'))}</button>
        </div>
      </header>
      <ul class="sel-list" data-gid="${g.id}">
        ${items.length
    ? items.map((p, i) => rowHtml(p, g.id, i, items.length))
    : html`<li class="sel-empty">Este grupo está vacío. Arrastra una botella aquí o usa «Añadir a…» en las botellas de abajo.</li>`}
      </ul>
    </section>`;
  };

  const outListHtml = () => {
    const nq = norm(outQ);
    const all = outOfSelection();
    const list = all.filter((p) => !nq || norm(p.name).includes(nq));
    if (!all.length) return html`<li class="sel-empty">Todas las botellas activas están en la selección.</li>`;
    if (!list.length) return html`<li class="sel-empty">Ninguna botella coincide con «${outQ}».</li>`;
    return list.map((p) => html`
      <li class="sel-row out" data-id="${p.id}">
        ${thumb(p, 'mini')}
        <div class="sel-name"><b>${p.name}</b></div>
        <button type="button" class="btn small ghost" data-add="${p.id}">Añadir a…</button>
      </li>`);
  };

  function draw() {
    drawn = signature();
    const groups = sortedGroups();
    mount(root, html`
      <div class="sel">
        <p class="muted small sel-help">Lo que está en un grupo sale en «Pedir», en este orden.
          Arrastra desde el asa ${raw(icon('grip-vertical', { size: 14 }))} o usa el menú ${raw(icon('more', { size: 14 }))} de cada botella.</p>
        <div class="toolbar">
          <button type="button" class="btn primary" data-newgroup>${raw(icon('folder-plus', { size: 18 }))} Nuevo grupo</button>
        </div>
        ${groups.length ? groups.map((g, i) => groupHtml(g, i, groups.length))
    : html`<p class="empty">No hay grupos. Crea uno para empezar a elegir botellas.</p>`}
        <section class="sel-group sel-out" data-gid="">
          <header class="sel-head"><h3>Fuera de la selección</h3><span class="sel-count" id="out-count">${outOfSelection().length}</span></header>
          <p class="muted small sel-out-help">No salen en «Pedir», pero siguen en el catálogo y en el histórico. Suelta aquí una botella para quitarla.</p>
          <div class="sel-search"><input type="search" id="out-q" aria-label="Buscar botella fuera de la selección" placeholder="Buscar botella…" value="${outQ}" autocomplete="off"></div>
          <ul class="sel-list" data-gid="" id="out-list">${outListHtml()}</ul>
        </section>
      </div>`);
  }

  const redrawOut = () => {
    mount(root.querySelector('#out-list'), outListHtml());
    root.querySelector('#out-count').textContent = outOfSelection().length;
  };

  // ---------------------------------------------------------------- guardado optimista

  async function saveLayout(to, { undoable = true } = {}) {
    const from = layoutOf();
    const items = diffItems(from, to);
    if (!items.length) return;
    applyLayout(to);
    draw();
    try {
      await mput('/api/products/order', { items, by: state.who });
    } catch (err) {
      applyLayout(from);
      draw();
      toast(err.message, 'error');
      return;
    }
    if (undoable) {
      toast('Guardado', 'ok', {
        action: { label: 'Deshacer', onClick: async () => { await saveLayout(from, { undoable: false }); toast('Deshecho', 'info'); } },
      });
    }
    loadBootstrap().catch(() => {});
  }

  async function saveGroupOrder(ids, { undoable = true } = {}) {
    const before = state.groups;
    const prev = sortedGroups().map((g) => g.id);
    state.groups = ids.map((id, i) => ({ ...groupOf(id), sort: (i + 1) * 10 }));
    draw();
    try {
      await mput('/api/groups/order', { ids, by: state.who });
    } catch (err) {
      state.groups = before;
      draw();
      toast(err.message, 'error');
      return;
    }
    if (undoable) {
      toast('Guardado', 'ok', {
        action: { label: 'Deshacer', onClick: async () => { await saveGroupOrder(prev, { undoable: false }); toast('Deshecho', 'info'); } },
      });
    }
    loadBootstrap().catch(() => {});
  }

  async function renameGroup(g, name, { undoable = true } = {}) {
    const before = g.name;
    try {
      await mput(`/api/groups/${g.id}`, { name, by: state.who });
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
    if (undoable) {
      toast('Guardado', 'ok', {
        action: { label: 'Deshacer', onClick: async () => { await renameGroup({ id: g.id, name }, before, { undoable: false }); toast('Deshecho', 'info'); } },
      });
    }
    await loadBootstrap().catch(() => {});
  }

  // ---------------------------------------------------------------- hojas de opciones

  async function sheet(title, body) {
    hold();
    try {
      return await dialog({
        title,
        body,
        onMount(dlg, close) {
          dlg.addEventListener('click', (e) => {
            const b = e.target.closest('[data-act]');
            if (b && !b.disabled) close(b.dataset.act);
          });
        },
      });
    } finally {
      release();
    }
  }

  const sheetBtn = (act, label, ic, { disabled = false, danger = false } = {}) => html`
    <button type="button" class="sheet-btn ${danger ? 'danger' : ''}" data-act="${act}" ${disabled ? 'disabled' : ''}>${raw(icon(ic, { size: 20 }))}<span>${label}</span></button>`;

  async function chooseGroup(title, exceptGid) {
    const options = sortedGroups().filter((g) => g.id !== exceptGid);
    if (!options.length) {
      toast('No hay otro grupo. Crea uno con «Nuevo grupo».', 'info');
      return null;
    }
    const v = await sheet(title, html`<div class="sheet-list">${options.map((g) => html`
      <button type="button" class="sheet-btn" data-act="${g.id}"><span>${g.name}</span><small class="muted">${inGroup(g.id).length}</small></button>`)}</div>`);
    return v ? Number(v) : null;
  }

  function moveToGroup(id, gid) {
    const to = cloneLayout(layoutOf());
    for (const ids of to.values()) {
      const k = ids.indexOf(id);
      if (k >= 0) ids.splice(k, 1);
    }
    to.get(gid).push(id);
    return saveLayout(to);
  }

  async function productMenu(id, gid) {
    const p = prod(id);
    const ids = inGroup(gid).map((x) => x.id);
    const k = ids.indexOf(id);
    const act = await sheet(p.name, html`<div class="sheet-list">
      ${sheetBtn('up', 'Subir', 'arrow-up', { disabled: k <= 0 })}
      ${sheetBtn('down', 'Bajar', 'arrow-down', { disabled: k === ids.length - 1 })}
      ${sheetBtn('move', 'Mover a grupo…', 'folder-plus')}
      ${sheetBtn('remove', 'Quitar de la selección', 'trash', { danger: true })}</div>`);
    if (!act) return;
    const to = cloneLayout(layoutOf());
    const list = to.get(gid);
    if (act === 'up' || act === 'down') {
      const j = act === 'up' ? k - 1 : k + 1;
      [list[k], list[j]] = [list[j], list[k]];
      await saveLayout(to);
    } else if (act === 'remove') {
      list.splice(k, 1);
      await saveLayout(to);
    } else if (act === 'move') {
      const dest = await chooseGroup(`Mover «${p.name}» a…`, gid);
      if (dest) await moveToGroup(id, dest);
    }
  }

  async function groupMenu(gid) {
    const g = groupOf(gid);
    const act = await sheet(g.name, html`<div class="sheet-list">
      ${sheetBtn('rename', 'Renombrar', 'pencil')}
      ${sheetBtn('delete', 'Borrar grupo', 'trash', { danger: true })}</div>`);
    if (act === 'rename') {
      hold();
      const data = await formDialog('Renombrar grupo', html`
        <label class="field"><span>Nombre</span><input name="name" value="${g.name}" required maxlength="40" autofocus></label>`);
      release();
      const name = data?.name.trim();
      if (name && name !== g.name) await renameGroup(g, name);
    } else if (act === 'delete') {
      await deleteGroup(g);
    }
  }

  async function deleteGroup(g) {
    const n = inGroup(g.id).length;
    let dest = 'none';
    hold();
    try {
      if (n) {
        const others = sortedGroups().filter((x) => x.id !== g.id);
        const data = await formDialog(`Borrar «${g.name}»`, html`
          <p>Tiene ${n} ${n === 1 ? 'botella' : 'botellas'}. ¿A dónde van?</p>
          <label class="field"><span>Destino</span><select name="dest">
            ${others.map((x) => html`<option value="${x.id}">${x.name} (al final)</option>`)}
            <option value="none">Fuera de la selección</option></select></label>
          <p class="muted small">Esto no se puede deshacer.</p>`, { ok: 'Borrar grupo', kind: 'danger' });
        if (!data) return;
        dest = data.dest;
      } else if (!await confirmDialog(`Borrar «${g.name}»`, 'El grupo está vacío. Esto no se puede deshacer.', { ok: 'Borrar grupo', kind: 'danger' })) {
        return;
      }
    } finally {
      release();
    }
    try {
      await mdel(`/api/groups/${g.id}?move_to=${dest}&by=${encodeURIComponent(state.who)}`);
      toast('Grupo borrado');
      await loadBootstrap();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function newGroup() {
    hold();
    const data = await formDialog('Nuevo grupo', html`
      <label class="field"><span>Nombre</span><input name="name" required maxlength="40" autofocus placeholder="Por ejemplo: Novedades"></label>`, { ok: 'Crear grupo' });
    release();
    const name = data?.name.trim();
    if (!name) return;
    if (state.groups.some((g) => g.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) {
      toast('Ya existe un grupo con ese nombre.', 'error');
      return;
    }
    try {
      await mpost('/api/groups', { name, by: state.who });
      toast('Grupo creado');
      await loadBootstrap();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---------------------------------------------------------------- clics

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    const d = t.dataset;
    try {
      if (d.newgroup !== undefined) await newGroup();
      else if (d.gup || d.gdown) {
        const ids = sortedGroups().map((g) => g.id);
        const gid = Number(d.gup || d.gdown);
        const k = ids.indexOf(gid);
        const j = d.gup ? k - 1 : k + 1;
        if (j < 0 || j >= ids.length) return;
        [ids[k], ids[j]] = [ids[j], ids[k]];
        await saveGroupOrder(ids);
      } else if (d.gmenu) await groupMenu(Number(d.gmenu));
      else if (d.pmenu) await productMenu(Number(d.pmenu), Number(t.closest('.sel-list').dataset.gid));
      else if (d.add) {
        const p = prod(d.add);
        const dest = await chooseGroup(`Añadir «${p.name}» a…`, null);
        if (dest) await moveToGroup(p.id, dest);
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  root.addEventListener('input', (e) => {
    if (e.target.id !== 'out-q') return;
    outQ = e.target.value;
    redrawOut();
  });

  // ---------------------------------------------------------------- arrastrar y soltar

  const cleanup = () => {
    if (!drag) return;
    clearTimeout(drag.timer);
    cancelAnimationFrame(drag.raf);
    drag.ghost?.remove();
    drag.gap?.remove();
    drag.row.classList.remove('dragging');
    root.querySelectorAll('.drop-hover, .has-gap').forEach((el) => el.classList.remove('drop-hover', 'has-gap'));
    document.body.classList.remove('sel-dragging');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey);
    const started = drag.active;
    drag = null;
    if (started) release();
  };

  function updateTarget() {
    const { x, y, ghost } = drag;
    ghost.style.transform = `translate(${x - drag.dx}px, ${y - drag.dy}px)`;
    root.querySelectorAll('.drop-hover').forEach((el) => el.classList.remove('drop-hover'));
    const sec = document.elementFromPoint(x, y)?.closest('.sel-group');
    if (!sec || !root.contains(sec)) {
      drag.gap.remove();
      drag.target = null;
      return;
    }
    sec.classList.add('drop-hover');
    const list = sec.querySelector('.sel-list');
    root.querySelectorAll('.has-gap').forEach((el) => el.classList.remove('has-gap'));
    if (list.dataset.gid === '') {
      drag.gap.remove();
      drag.target = { gid: null, idx: 0 };
      return;
    }
    const rows = [...list.querySelectorAll('.sel-row:not(.dragging)')];
    let idx = rows.findIndex((r) => {
      const b = r.getBoundingClientRect();
      return y < b.top + b.height / 2;
    });
    if (idx < 0) idx = rows.length;
    if (rows[idx]) list.insertBefore(drag.gap, rows[idx]);
    else list.append(drag.gap);
    list.classList.add('has-gap');
    drag.target = { gid: Number(list.dataset.gid), idx };
  }

  function loop() {
    if (!drag?.active) return;
    const h = window.innerHeight;
    let v = 0;
    if (drag.y < EDGE + 56) v = -((EDGE + 56 - drag.y) / (EDGE + 56)) * 22;
    else if (drag.y > h - EDGE) v = ((drag.y - (h - EDGE)) / EDGE) * 22;
    if (v) {
      window.scrollBy(0, v);
      updateTarget();
    }
    drag.raf = requestAnimationFrame(loop);
  }

  function start() {
    const row = drag.row;
    const rect = row.getBoundingClientRect();
    drag.active = true;
    hold();
    buzz(18);
    const ghost = document.createElement('ul');
    ghost.className = 'sel-list drag-ghost';
    ghost.append(row.cloneNode(true));
    ghost.style.width = `${rect.width}px`;
    document.body.append(ghost);
    const gap = document.createElement('li');
    gap.className = 'drop-gap';
    gap.style.height = `${rect.height}px`;
    row.before(gap);
    row.classList.add('dragging');
    document.body.classList.add('sel-dragging');
    Object.assign(drag, {
      ghost, gap, dx: drag.x - rect.left, dy: drag.y - rect.top, target: null,
    });
    try { drag.grip.setPointerCapture(drag.pid); } catch { /* el asa ya no está */ }
    updateTarget();
    drag.raf = requestAnimationFrame(loop);
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.active) {
      const dist = Math.hypot(drag.x - drag.x0, drag.y - drag.y0);
      if (e.pointerType === 'mouse') {
        if (dist > 4) start();
      } else if (dist > 6) {
        // El asa no desplaza la página (touch-action: none): mover el dedo ya es arrastrar.
        clearTimeout(drag.timer);
        start();
      }
      return;
    }
    e.preventDefault();
    updateTarget();
  }

  async function onUp(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    const { active, target, id } = drag;
    cleanup();
    if (!active || !target) return;
    const to = cloneLayout(layoutOf());
    for (const ids of to.values()) {
      const k = ids.indexOf(id);
      if (k >= 0) ids.splice(k, 1);
    }
    if (target.gid !== null) to.get(target.gid).splice(target.idx, 0, id);
    await saveLayout(to);
  }

  const onCancel = () => cleanup();
  const onKey = (e) => {
    if (e.key === 'Escape') cleanup();
  };

  root.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('[data-grip]');
    if (!grip || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const row = grip.closest('.sel-row');
    drag = {
      row, grip, id: Number(row.dataset.id), pid: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false,
    };
    if (e.pointerType !== 'mouse') drag.timer = setTimeout(() => { if (drag && !drag.active) start(); }, HOLD_MS);
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKey);
  });
  root.addEventListener('contextmenu', (e) => {
    if (e.target.closest('[data-grip]')) e.preventDefault();
  });

  draw();
}
