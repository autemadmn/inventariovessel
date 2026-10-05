// Barra VIP como tercera barra y refrescos que pasan a «Otros» (migración 0011).
import test from 'node:test';
import assert from 'node:assert/strict';
import { openPglite } from '../server/db-pglite.js';
import * as svc from '../server/services.js';

test('Barra VIP: tercera barra enlazada con su punto; se pide y se repone como las demás', async (t) => {
  const db = await openPglite();
  t.after(() => db.end());
  const bars = await db.all('SELECT id, name FROM bars ORDER BY id');
  assert.deepEqual(bars.map((b) => b.name), ['Barra 1', 'Barra 2', 'Barra VIP']);
  const vip = bars[2].id;
  assert.equal((await db.get("SELECT bar_id FROM stores WHERE map_key = 'barra-vip'")).bar_id, vip);

  const p = await db.get("SELECT id FROM products WHERE slug = 'fireball'");
  await svc.createRequest(db, { bar_id: vip, items: [{ product_id: p.id, qty: 2 }], by: 'Ana' });
  const line = (await svc.liveState(db)).lines.find((l) => l.bar_id === vip);
  assert.equal(line.qty_pending, 2);
  await svc.completeLines(db, { items: [{ line_id: line.id, qty: 2, delivered: line.qty_delivered }], by: 'Ana' });
  assert.equal((await svc.liveState(db)).lines.find((l) => l.id === line.id)?.qty_pending ?? 0, 0);
});

test('Schweppes Fresa, Schweppes Tónica Zero y Perrier están en «Otros»', async (t) => {
  const db = await openPglite();
  t.after(() => db.end());
  const rows = await db.all(`SELECT p.slug, g.name, g.section FROM products p JOIN product_groups g ON g.id = p.group_id
    WHERE p.slug IN ('schweppes-fresa', 'schweppes-tonica-zero', 'perrier') ORDER BY p.group_order`);
  assert.deepEqual(rows.map((r) => r.slug), ['schweppes-fresa', 'schweppes-tonica-zero', 'perrier']);
  for (const r of rows) assert.equal(r.section, 'otros', r.slug);
});
