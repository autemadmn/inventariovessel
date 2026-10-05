import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { openPglite } from '../server/db-pglite.js';

const root = join(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'public/img/botellas/manifest.json'), 'utf8'));

test('catálogo: PNG existentes, transparentes, 512×683 y menores de 150.000 bytes', () => {
  for (const [slug, entry] of Object.entries(manifest)) {
    const file = join(root, 'public/img/botellas', entry.file);
    const b = readFileSync(file);
    assert.equal(b.toString('hex', 0, 8), '89504e470d0a1a0a', slug);
    assert.equal(b.readUInt32BE(16), 512, slug);
    assert.equal(b.readUInt32BE(20), 683, slug);
    assert.ok(statSync(file).size < 150_000, slug);
    assert.ok([4, 6].includes(b[25]) || (b[25] === 3 && b.includes(Buffer.from('tRNS'))), `${slug}: alfa`);
    for (const key of ['file', 'model', 'refs', 'confidence', 'generated_at']) assert.ok(entry[key], `${slug}: ${key}`);
  }
});

test('catálogo: las cajas vienen del manifest y corresponden a unidades de pedido caja', async (t) => {
  const db = await openPglite();
  t.after(() => db.end());
  const pending = JSON.parse(readFileSync(join(root, 'docs/catalogo/imagenes-pendientes.json'), 'utf8'));
  for (const p of await db.all('SELECT slug, order_unit FROM products WHERE active = 1')) {
    assert.ok(manifest[p.slug] || pending[p.slug]?.motivo, `${p.slug}: falta imagen o justificación`);
  }
  for (const [slug, entry] of Object.entries(manifest)) {
    if (entry.forma !== 'caja') continue;
    const p = await db.get('SELECT order_unit FROM products WHERE slug = ?', slug);
    assert.equal(p?.order_unit, 'caja', slug);
  }
  const ui = readFileSync(join(root, 'public/js/ui.js'), 'utf8');
  assert.match(ui, /manifest\[x\.slug\]\?\.forma === 'caja'/);
  for (const [slug, e] of Object.entries(manifest)) {
    if (e.forma === 'caja') assert.ok(!ui.includes(`'${slug}'`) && !ui.includes(`"${slug}"`), slug);
  }
});
