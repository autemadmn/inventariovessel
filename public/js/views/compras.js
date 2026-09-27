// Lista de compra: propuesta calculada que el encargado revisa y modifica.
import { mget, mpost, mput, mdel } from '../api.js';
import { state, productById } from '../state.js';
import { computePurchase, casesFor } from '../shared/forecast.js';
import {
  $, html, mount, fmt, dateTimeLabel, toast, confirmDialog, csv, downloadText, copyText,
} from '../ui.js';

export async function renderCompras(root, [id]) {
  if (id) return renderEditor(root, Number(id));
  const lists = await mget('/api/purchases');
  mount(root, html`
    <div class="notice">
      <p><b>Botellas que comprar = necesidad prevista + margen de seguridad − existencias disponibles − entregas previstas.</b>
      Nunca sale negativo y se redondea hacia arriba a botellas enteras.</p>
      <p class="muted small">La forma más rápida de empezar es desde «Previsión» → «Preparar lista de compra».</p>
    </div>
    <div class="row-actions">
      <a class="btn primary" href="#/gestion/prevision">Desde la previsión</a>
      <button type="button" class="btn ghost" data-new>Lista vacía</button>
    </div>
    ${lists.length ? html`<ul class="plain-list">${lists.map((l) => html`
      <li><a href="#/gestion/compras/${l.id}"><b>${l.title}</b>
        <span class="tag ${l.status === 'cerrada' ? 'ok' : ''}">${l.status}</span>
        <small class="muted">actualizada ${dateTimeLabel(l.updated_at)}</small></a></li>`)}</ul>`
    : html`<p class="empty">Todavía no hay listas de compra.</p>`}`);
  root.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-new]')) return;
    const l = await mpost('/api/purchases', { title: 'Lista de compra', params: {}, lines: [], by: state.who });
    location.hash = `#/gestion/compras/${l.id}`;
  });
  return undefined;
}

const LABELS = {
  need: 'Necesidad', safety: 'Margen', stock: 'Existencias', other_out: 'Salidas otros destinos', incoming: 'Entregas previstas',
};

function calc(l) {
  const p = productById(l.product_id);
  const r = computePurchase({
    need: l.need, safety: l.safety, stock: l.stock, otherOut: l.other_out, incoming: l.incoming, perCase: p?.per_case,
  });
  const perCase = p?.per_case || null;
  const unit = l.unit === 'cajas' && perCase ? 'cajas' : 'botellas';
  const hasFinal = l.final !== null && l.final !== '' && l.final !== undefined;
  const finalQty = hasFinal ? Number(l.final) : unit === 'cajas' ? r.casesRoundedUp : r.bottles;
  const finalBottles = unit === 'cajas' ? finalQty * perCase : finalQty;
  return { ...r, perCase, unit, finalQty, finalBottles, edited: hasFinal };
}

function casesText(c) {
  if (!c.perCase) return 'Botellas por caja sin confirmar';
  if (!c.bottles) return '—';
  const parts = [];
  if (c.fullCases) parts.push(`${c.fullCases} ${c.fullCases === 1 ? 'caja' : 'cajas'}`);
  if (c.loose) parts.push(`${c.loose} suelta${c.loose === 1 ? '' : 's'}`);
  let s = `= ${parts.join(' + ')} (cajas de ${c.perCase})`;
  if (c.loose) s += ` · o ${c.casesRoundedUp} cajas: ${c.extraIfCases} botella${c.extraIfCases === 1 ? '' : 's'} de más`;
  return s;
}

function finalText(c) {
  if (c.unit === 'cajas') {
    return `${fmt(c.finalQty)} ${c.finalQty === 1 ? 'caja' : 'cajas'} (${fmt(c.finalBottles)} botellas)`;
  }
  const cs = casesFor(c.finalBottles, c.perCase);
  return `${fmt(c.finalBottles)} botellas${cs.perCase && c.finalBottles >= cs.perCase ? ` (${cs.fullCases} cajas${cs.loose ? ` + ${cs.loose}` : ''})` : ''}`;
}

async function renderEditor(root, id) {
  const list = await mget(`/api/purchases/${id}`);
  let dirty = false;

  const productInfo = (pid) => {
    const p = productById(pid);
    if (!p) return '';
    return [p.capacity_ml ? `${p.capacity_ml / 10} cl` : 'capacidad sin confirmar'].join(' · ');
  };

  const rowHtml = (l, i) => {
    const c = calc(l);
    const p = productById(l.product_id);
    return html`<tr data-row="${i}">
      <td><b>${l.name}</b><small class="muted block">${productInfo(l.product_id)}</small>
        ${p?.out_of_stock ? html`<small class="warn-text block">Ahora agotado en almacén</small>` : ''}</td>
      ${['need', 'safety', 'stock', 'other_out', 'incoming'].map((k) => html`
        <td class="num" data-label="${LABELS[k]}"><input type="number" class="mini" min="0" step="${k === 'need' || k === 'safety' ? '0.1' : '1'}" inputmode="decimal"
          data-i="${i}" data-k="${k}" value="${l[k] === 0 && k !== 'need' && k !== 'safety' ? '' : l[k]}" placeholder="0"></td>`)}
      <td class="num prop" data-label="Propuesta (bot.)"><b data-proposed>${c.bottles}</b><small class="muted block" data-cases>${casesText(c)}</small></td>
      <td class="num final" data-label="Comprar">
        <input type="number" class="mini" min="0" step="1" inputmode="numeric" data-i="${i}" data-k="final" value="${l.final ?? ''}" placeholder="${c.unit === 'cajas' ? c.casesRoundedUp : c.bottles}">
        ${c.perCase ? html`<select class="mini" data-i="${i}" data-k="unit">
          <option value="botellas" ${c.unit === 'botellas' ? 'selected' : ''}>bot.</option>
          <option value="cajas" ${c.unit === 'cajas' ? 'selected' : ''}>cajas</option></select>` : html`<small class="muted">bot.</small>`}
        <small class="block" data-final>${finalText(c)}</small></td>
      <td class="rm"><button type="button" class="icon-btn" data-remove="${i}" aria-label="Quitar">✕</button></td>
    </tr>`;
  };

  const totals = () => {
    const cs = list.lines.map(calc);
    return {
      proposed: cs.reduce((a, c) => a + c.bottles, 0),
      final: cs.reduce((a, c) => a + c.finalBottles, 0),
    };
  };

  const draw = () => {
    const t = totals();
    const missing = state.products.filter((p) => !list.lines.some((l) => l.product_id === p.id));
    mount(root, html`
      <div class="row-actions no-print">
        <a class="btn ghost" href="#/gestion/compras">‹ Listas</a>
        <span class="spacer"></span>
        <span class="muted small" id="dirty">${dirty ? 'Cambios sin guardar' : ''}</span>
        <button type="button" class="btn primary" data-save>Guardar</button>
      </div>
      <div class="form-grid">
        <label class="field"><span>Título</span><input id="pl-title" value="${list.title}" maxlength="120"></label>
        <label class="field"><span>Estado</span><select id="pl-status">
          <option value="borrador" ${list.status === 'borrador' ? 'selected' : ''}>Borrador (propuesta)</option>
          <option value="cerrada" ${list.status === 'cerrada' ? 'selected' : ''}>Cerrada (pedido hecho)</option></select></label>
      </div>
      ${list.params?.description ? html`<p class="muted small">Previsión: ${list.params.description}</p>` : ''}
      <div class="notice small">
        <p><b>Comprar = necesidad + margen − (existencias − salidas a otros destinos) − entregas previstas.</b></p>
        <p>Existencias: botellas utilizables en el almacén. Si el almacén es compartido, anota en «Salidas a otros destinos» lo que irá a la VIP u otros sitios, para no contarlo como disponible. Entregas previstas: pedidos que llegarán antes del periodo.</p>
      </div>
      <div class="table-wrap"><table class="table purchase cards">
        <thead><tr><th>Producto</th><th class="num">Necesidad</th><th class="num">Margen</th><th class="num">Existencias</th>
          <th class="num">Salidas otros destinos</th><th class="num">Entregas previstas</th><th class="num">Propuesta (bot.)</th><th class="num">Comprar</th><th></th></tr></thead>
        <tbody id="pl-rows">${list.lines.map(rowHtml)}</tbody>
        <tfoot><tr><td colspan="6">Total</td><td class="num" data-label="Propuesta:"><b id="t-proposed">${t.proposed}</b></td><td class="num" data-label="Comprar:"><b id="t-final">${t.final}</b> botellas</td><td></td></tr></tfoot>
      </table></div>
      ${!list.lines.length ? html`<p class="empty">Añade productos a la lista.</p>` : ''}
      <div class="row-actions no-print">
        <select id="pl-add"><option value="">Añadir producto…</option>${missing.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select>
        <span class="spacer"></span>
        <button type="button" class="btn ghost" data-copy>Copiar texto</button>
        <button type="button" class="btn ghost" data-csv>CSV</button>
        <button type="button" class="btn ghost" data-print>Imprimir</button>
        <button type="button" class="btn ghost danger" data-delete>Borrar lista</button>
      </div>
      <label class="field no-print"><span>Notas</span><textarea id="pl-notes" rows="2" maxlength="1000">${list.notes || ''}</textarea></label>`);
  };

  const markDirty = () => {
    dirty = true;
    const d = $('#dirty');
    if (d) d.textContent = 'Cambios sin guardar';
  };

  const updateRow = (i) => {
    const c = calc(list.lines[i]);
    const row = root.querySelector(`[data-row="${i}"]`);
    row.querySelector('[data-proposed]').textContent = c.bottles;
    row.querySelector('[data-cases]').textContent = casesText(c);
    row.querySelector('[data-final]').textContent = finalText(c);
    row.querySelector('[data-k="final"]').placeholder = c.unit === 'cajas' ? c.casesRoundedUp : c.bottles;
    const t = totals();
    $('#t-proposed').textContent = t.proposed;
    $('#t-final').textContent = t.final;
  };

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.i !== undefined) {
      const l = list.lines[Number(t.dataset.i)];
      const k = t.dataset.k;
      if (k === 'unit') l.unit = t.value;
      else if (k === 'final') l.final = t.value === '' ? null : Math.max(0, Math.round(Number(t.value) || 0));
      else l[k] = t.value === '' ? 0 : Math.max(0, Number(t.value) || 0);
      if (k === 'unit') l.final = null;
      updateRow(Number(t.dataset.i));
      markDirty();
    } else if (['pl-title', 'pl-notes', 'pl-status'].includes(t.id)) {
      markDirty();
    }
  });
  root.addEventListener('change', (e) => {
    if (e.target.dataset.k === 'unit') draw();
    if (e.target.id === 'pl-status') markDirty();
    if (e.target.id === 'pl-add' && e.target.value) {
      const p = productById(e.target.value);
      list.lines.push({ product_id: p.id, name: p.name, need: 0, safety: 0, stock: 0, other_out: 0, incoming: 0, final: null, unit: 'botellas' });
      dirty = true;
      draw();
    }
  });
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    try {
      if (d.remove !== undefined) {
        list.lines.splice(Number(d.remove), 1);
        dirty = true;
        draw();
      } else if (d.save !== undefined) {
        const saved = await mput(`/api/purchases/${id}`, {
          title: $('#pl-title').value, status: $('#pl-status').value, notes: $('#pl-notes').value,
          params: list.params, lines: list.lines, by: state.who,
        });
        Object.assign(list, saved);
        dirty = false;
        toast('Lista guardada');
        draw();
      } else if (d.copy !== undefined) {
        await copyText(textVersion());
      } else if (d.csv !== undefined) {
        downloadText(`compra-${id}.csv`, csv([
          ['Producto', 'Necesidad', 'Margen', 'Existencias', 'Salidas otros destinos', 'Entregas previstas', 'Propuesta (botellas)', 'Comprar', 'Unidad', 'Comprar (botellas)'],
          ...list.lines.map((l) => {
            const c = calc(l);
            return [l.name, l.need, l.safety, l.stock, l.other_out, l.incoming, c.bottles, c.finalQty, c.unit, c.finalBottles];
          }),
        ]));
      } else if (d.print !== undefined) {
        window.print();
      } else if (d.delete !== undefined) {
        if (!await confirmDialog('Borrar lista', `Se borrará «${list.title}».`, { ok: 'Borrar', kind: 'danger' })) return;
        await mdel(`/api/purchases/${id}`);
        location.hash = '#/gestion/compras';
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const textVersion = () => {
    const lines = list.lines.map((l) => ({ l, c: calc(l) })).filter(({ c }) => c.finalBottles > 0);
    return [`${$('#pl-title').value}`, ...lines.map(({ l, c }) => `- ${l.name}: ${finalText(c)}`),
      `Total: ${totals().final} botellas`].join('\n');
  };

  draw();
  const onLeave = (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', onLeave);
  return () => window.removeEventListener('beforeunload', onLeave);
}
