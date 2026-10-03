// Catálogo: ver las botellas, añadir una nueva y editarla (foto, nombre, grupo,
// botellas por caja, agotado, activo). Los datos de ficha (categoría, estado,
// capacidad, nota) quedan plegados en «Más datos». También se identifican aquí
// las botellas dudosas sin crear duplicados.
import {
  mget, mpost, mput, mdel, post,
} from '../api.js';
import { state, loadBootstrap, inVesselPoints, pointByKey } from '../state.js';
import {
  html, mount, thumb, toast, formDialog, resizeImage, norm,
} from '../ui.js';

let q = '';

export async function renderCatalogo(root) {
  let products = await mget('/api/products');

  const draw = () => {
    const nq = norm(q);
    const match = (p) => !nq || norm(p.name).includes(nq);
    const unidentified = products.filter((p) => p.status === 'sin_identificar');
    const discarded = products.filter((p) => p.status === 'descartado');
    const normal = products.filter((p) => !['sin_identificar', 'descartado'].includes(p.status) && match(p));

    mount(root, html`
      ${unidentified.length ? html`
        <h3 class="section-title">Pendientes de identificar</h3>
        <p class="muted small">No aparecen en «Pedir» hasta que se identifiquen. Si resultan ser un producto que ya existe, márcalo así para no duplicarlo.</p>
        <ul class="cat-list unid">${unidentified.map((p) => html`
          <li>${thumb(p, 'sm')}<div><b>${p.name}</b><small class="muted block">${p.note || ''}</small></div>
            <div class="btns">
              <button type="button" class="btn small" data-new="${p.id}">Producto nuevo</button>
              <button type="button" class="btn small ghost" data-dup="${p.id}">Ya existe</button>
            </div></li>`)}</ul>` : ''}

      <div class="toolbar">
        <input type="search" id="cat-q" placeholder="Buscar…" value="${q}" autocomplete="off">
        <button type="button" class="btn primary" data-add>Añadir producto</button>
      </div>

      ${state.categories.map((c) => {
    const items = normal.filter((p) => p.category === c.id);
    return items.length ? html`
          <h3 class="section-title">${c.name}</h3>
          <ul class="cat-list">${items.map((p) => html`
            <li class="${p.active ? '' : 'inactive'}">
              ${thumb(p, 'sm')}
              <div><b>${p.name}</b>
                ${p.out_of_stock ? html`<span class="tag danger">Agotado</span>` : ''}
                ${!p.active ? html`<span class="tag">Oculto</span>` : ''}
                ${p.status === 'pendiente' ? html`<span class="tag warn">Por confirmar</span>` : ''}
                <small class="muted block">${[p.group_id ? groupName(p.group_id) : 'Fuera de la selección',
    p.per_case ? `${p.per_case} por caja` : ''].filter(Boolean).join(' · ')}</small>
              </div>
              <div class="btns">
                <label class="btn small ${p.photo ? 'ghost' : ''}">${p.photo ? 'Cambiar foto' : 'Foto'}
                  <input type="file" accept="image/*" capture="environment" data-photo="${p.id}" hidden></label>
                <button type="button" class="btn small ghost" data-edit="${p.id}">Editar</button>
              </div>
            </li>`)}</ul>` : '';
  })}

      ${discarded.length ? html`
        <details class="collapse-box"><summary>Resueltos como duplicados (${discarded.length})</summary>
          <ul class="cat-list">${discarded.map((p) => html`<li>${thumb(p, 'xs')}<div>${p.name}<small class="muted block">${p.note || ''}</small></div></li>`)}</ul>
        </details>` : ''}`);
  };

  const reload = async () => {
    products = await mget('/api/products');
    await loadBootstrap();
    draw();
  };

  // Foto directa desde la lista: abre la cámara del móvil y la sube reducida.
  root.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-photo]');
    if (!input?.files[0]) return;
    try {
      const dataUrl = await resizeImage(input.files[0]);
      await mpost(`/api/products/${input.dataset.photo}/photo`, { data: dataUrl, by: state.who });
      toast('Foto guardada');
      await reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  root.addEventListener('input', (e) => {
    if (e.target.id === 'cat-q') {
      q = e.target.value;
      const pos = e.target.selectionStart;
      draw();
      const el = root.querySelector('#cat-q');
      el.focus();
      el.setSelectionRange(pos, pos);
    }
  });

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    const byId = (id) => products.find((p) => p.id === Number(id));
    try {
      if (d.edit) {
        if (await editProduct(byId(d.edit))) await reload();
      } else if (d.add !== undefined) {
        if (await editProduct(null)) await reload();
      } else if (d.new) {
        const p = byId(d.new);
        const data = await formDialog('Identificar como producto nuevo', html`
          <p class="muted small">${p.note || ''}</p>
          <label class="field"><span>Nombre del producto</span><input name="name" value="" required maxlength="80" placeholder="Nombre que aparece en la etiqueta"></label>
          <label class="field"><span>Categoría</span>${categorySelect(p.category)}</label>
          <label class="field"><span>Grupo</span>${groupSelect(defaultGroupId())}</label>`, { ok: 'Añadir al catálogo' });
        if (!data) return;
        await mpost(`/api/products/${p.id}/resolve`, {
          action: 'new', ...data, group_id: data.group_id === '' ? null : Number(data.group_id), by: state.who,
        });
        toast('Producto añadido (queda «por confirmar» hasta revisar capacidad y caja)');
        await reload();
      } else if (d.dup) {
        const p = byId(d.dup);
        const options = products.filter((x) => x.active);
        const data = await formDialog('Es un producto que ya existe', html`
          <p class="muted small">«${p.name}» se marcará como resuelto y no se creará ningún duplicado.</p>
          <label class="field"><span>¿Qué producto es?</span><select name="target_id">${options.map((x) => html`<option value="${x.id}">${x.name}</option>`)}</select></label>`,
        { ok: 'Confirmar' });
        if (!data) return;
        await mpost(`/api/products/${p.id}/resolve`, { action: 'duplicate', target_id: Number(data.target_id), by: state.who });
        toast('Resuelto sin duplicar');
        await reload();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  draw();
}

const groupName = (id) => state.groups.find((g) => g.id === id)?.name ?? 'Grupo';

/** Grupo por defecto al crear: «Resto» si existe; si no, el último. */
function defaultGroupId() {
  const g = state.groups.find((x) => x.name === 'Resto') ?? state.groups[state.groups.length - 1];
  return g?.id ?? null;
}

function groupSelect(selected) {
  return html`<select name="group_id">
    <option value="" ${selected === null || selected === undefined ? 'selected' : ''}>Fuera de la selección</option>
    ${state.groups.map((g) => html`<option value="${g.id}" ${g.id === selected ? 'selected' : ''}>${g.name}</option>`)}</select>`;
}

function categorySelect(selected) {
  return html`<select name="category">${state.categories.map((c) => html`
    <option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.name}</option>`)}</select>`;
}

async function editProduct(p) {
  const isNew = !p;
  let changed = false;
  let mainChanged = false;
  let groupChanged = false;
  const defaultMain = (category) => pointByKey(category === 'vino' ? 'nevera-vino' : ['cerveza','refresco'].includes(category) ? 'alm-cerveza' : 'alm-alcohol')?.id;
  const oldDefault = defaultMain(p?.category ?? 'otros');
  const data = await formDialog(isNew ? 'Añadir producto' : 'Editar producto', html`
    ${!isNew ? html`<div class="photo-edit">
      <span id="ph-preview">${thumb(p, 'lg')}</span>
      <div class="stack">
        <label class="btn small">Hacer o elegir foto<input type="file" accept="image/*" capture="environment" id="ph-file" hidden></label>
        ${p.photo ? html`<button type="button" class="btn small ghost" id="ph-remove">Quitar foto</button>` : ''}
        <small class="muted">Usa una foto real de la botella para reconocerla rápido.</small>
        ${state.products.find((x) => x.id === p.id)?.image ? html`<small class="muted">Con imagen de catálogo, la foto propia solo se usa como respaldo.</small>` : ''}
      </div></div>` : ''}
    <label class="field"><span>Nombre</span><input name="name" value="${p?.name ?? ''}" required maxlength="80"></label>
    <label class="field"><span>Categoría</span>${categorySelect(p?.category ?? 'otros')}</label>
    <label class="field"><span>Grupo</span>${groupSelect(isNew ? defaultGroupId() : p.group_id)}
      <small class="muted">Solo las botellas con grupo salen en «Pedir». Se ordenan en Selección.</small></label>
    <label class="field"><span>Punto principal</span><select name="main_store_id">${inVesselPoints().filter((s) => ['almacen','nevera'].includes(s.point_type)).map((s) => html`<option value="${s.id}" ${s.id === (p?.main_store_id ?? oldDefault) ? 'selected' : ''}>${s.name}</option>`)}</select>
      <small class="muted">Reponer saca de aquí y el viaje deja aquí la mercancía.</small></label>
    <label class="field"><span>Botellas por caja</span><input name="per_case" type="number" min="1" max="10000" inputmode="numeric" value="${p?.per_case ?? ''}" placeholder="Por ejemplo, 6"></label>
    ${!isNew ? html`<label class="check"><input type="checkbox" name="out_of_stock" ${p.out_of_stock ? 'checked' : ''}> Agotado</label>` : ''}
    <label class="check"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}>
      <span>Activo<small class="muted block">Si lo desmarcas, deja de salir en Pedir y en Selección. Sigue en el histórico.</small></span></label>
    <details class="more-data">
      <summary>Más datos</summary>
      <label class="field"><span>Estado</span><select name="status">
        <option value="confirmado" ${p?.status === 'confirmado' ? 'selected' : ''}>Confirmado</option>
        <option value="pendiente" ${!p || p.status === 'pendiente' ? 'selected' : ''}>Por confirmar</option></select></label>
      <label class="field"><span>Capacidad (ml)</span><input name="capacity_ml" type="number" min="1" max="10000" inputmode="numeric" value="${p?.capacity_ml ?? ''}" placeholder="Sin confirmar"></label>
      <label class="field"><span>Nota</span><input name="note" value="${p?.note ?? ''}" maxlength="400"></label>
    </details>`,
  {
    wide: true,
    onMount(dlg) {
      const group = dlg.querySelector('[name="group_id"]');
      const main = dlg.querySelector('[name="main_store_id"]');
      group.addEventListener('change', () => { groupChanged = true; });
      main.addEventListener('change', () => { mainChanged = true; });
      dlg.querySelector('[name="category"]').addEventListener('change', (e) => {
        if (isNew && !groupChanged) group.value = ['cerveza','refresco','vino'].includes(e.target.value) ? '' : String(defaultGroupId() ?? '');
        if (!mainChanged && (isNew || (p.main_store_id ?? oldDefault) === oldDefault)) main.value = String(defaultMain(e.target.value));
      });
      const file = dlg.querySelector('#ph-file');
      file?.addEventListener('change', async () => {
        if (!file.files[0]) return;
        try {
          const dataUrl = await resizeImage(file.files[0]);
          const updated = await mpost(`/api/products/${p.id}/photo`, { data: dataUrl, by: state.who });
          mount(dlg.querySelector('#ph-preview'), thumb(updated, 'lg'));
          changed = true;
          toast('Foto guardada');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      dlg.querySelector('#ph-remove')?.addEventListener('click', async () => {
        try {
          const updated = await mdel(`/api/products/${p.id}/photo?by=${encodeURIComponent(state.who)}`);
          mount(dlg.querySelector('#ph-preview'), thumb(updated, 'lg'));
          changed = true;
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    },
  });
  if (!data) return changed;
  const body = {
    name: data.name,
    category: data.category,
    status: data.status,
    note: data.note,
    capacity_ml: data.capacity_ml === '' ? null : Number(data.capacity_ml),
    per_case: data.per_case === '' ? null : Number(data.per_case),
    active: data.active === 'on',
    by: state.who,
  };
  const groupId = data.group_id === '' ? null : Number(data.group_id);
  if (mainChanged) body.main_store_id = Number(data.main_store_id);
  if (isNew || groupId !== (p.group_id ?? null)) body.group_id = groupId;
  if (isNew) {
    await mpost('/api/products', body);
    toast('Producto añadido');
  } else {
    await mput(`/api/products/${p.id}`, body);
    const out = data.out_of_stock === 'on';
    if (out !== Boolean(p.out_of_stock)) await post(`/api/products/${p.id}/stock`, { out_of_stock: out, by: state.who });
    toast('Guardado');
  }
  return true;
}
