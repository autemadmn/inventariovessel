// La nevera de Chupitería: el plano apunta a imágenes que existen, pesan poco y son de
// productos del catálogo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { openPglite } from '../server/db-pglite.js';

const DIR = join(import.meta.dirname, '..', 'public', 'img', 'nevera');
const layout = JSON.parse(readFileSync(join(DIR, 'nevera.v2.json'), 'utf8'));

test('nevera: imágenes versionadas, existentes y ligeras', () => {
  const files = [layout.fondo.img, ...layout.grupos.flatMap((g) => g.piezas.flatMap((p) => [p.img, p.sel]))];
  let total = 0;
  for (const f of files) {
    assert.match(f, /\.v\d+\.webp$/, `${f} lleva versión en el nombre`);
    assert.ok(existsSync(join(DIR, f)), f);
    const size = statSync(join(DIR, f)).size;
    assert.ok(size <= 30 * 1024, `${f} pesa ${size} bytes`);
    total += size;
  }
  assert.ok(total <= 1.5 * 1024 * 1024, `total ${total} bytes`);
  assert.equal(layout.grupos.filter((g) => g.tipo === 'chapas').length, 5);
  assert.equal(layout.grupos.filter((g) => g.tipo === 'botellas').length, 4);
  for (const g of layout.grupos) {
    for (const v of [g.x, g.y, g.w, g.h]) assert.ok(v >= 0 && v <= 100);
    assert.equal(g.piezas.length, g.tipo === 'chapas' ? 5 : 3);
  }
});

test('nevera: cada hueco es un producto activo de Chupitería', async (t) => {
  const db = await openPglite();
  t.after(() => db.end());
  for (const g of layout.grupos) {
    const p = await db.get(`SELECT p.active, pg.section FROM products p
      JOIN product_groups pg ON pg.id = p.group_id WHERE p.slug = ?`, g.slug);
    assert.ok(p, `${g.slug} existe y está en la selección`);
    assert.equal(p.active, 1, g.slug);
    assert.equal(p.section, 'chupiteria', g.slug);
  }
});
