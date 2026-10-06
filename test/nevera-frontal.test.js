import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openPglite } from '../server/db-pglite.js';
// Importar sin document ni localStorage forma parte del contrato.
import { zonasDelPlano, zonaHtml, renderNevera } from '../public/js/views/nevera.js';

const DIR = join(import.meta.dirname, '../public/img/nevera/frontal');
const plano = JSON.parse(readFileSync(join(DIR, 'nevera.v5.json'), 'utf8'));
const chupiteria = readFileSync(join(DIR, '../nevera.v2.json'));

function webpSize(file) {
  const b = readFileSync(join(DIR, file));
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WEBP');
  for (let i = 12; i < b.length;) {
    const type = b.toString('ascii', i, i + 4);
    const n = b.readUInt32LE(i + 4), p = i + 8;
    if (type === 'VP8X') return [b.readUIntLE(p + 4, 3) + 1, b.readUIntLE(p + 7, 3) + 1];
    if (type === 'VP8 ') return [b.readUInt16LE(p + 6) & 0x3fff, b.readUInt16LE(p + 8) & 0x3fff];
    if (type === 'VP8L') {
      const bits = b.readUInt32LE(p + 1);
      return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
    i = p + n + (n % 2);
  }
  assert.fail(`Sin dimensiones: ${file}`);
}

test('Nevera frontal: plano, dimensiones, recursos versionados y límites de peso', () => {
  assert.equal(plano.version, 5);
  assert.equal(plano.seccion, 'nevera');
  assert.equal(plano.marcar, 'producto');
  assert.equal(plano.base, 'img/nevera/frontal/');
  assert.deepEqual(webpSize(plano.fondo.imagen), [plano.fondo.w, plano.fondo.h]);
  assert.equal(plano.fondo.w / plano.fondo.h, 1080 / 1440);
  assert.equal(plano.zonas.length, 5);
  assert.equal(new Set(plano.zonas.map((z) => z.slug)).size, 5);
  const files = [[plano.fondo.imagen, 150_000]];
  for (const z of plano.zonas) {
    if (!z.imagen) {
      assert.ok(['chapas', 'latas'].includes(z.silueta));
      assert.equal(z.seleccion, undefined);
      continue;
    }
    files.push([z.imagen, 80_000], [z.seleccion, 30_000]);
    assert.deepEqual(webpSize(z.imagen), [z.rect.w, z.rect.h], z.slug);
    assert.deepEqual(webpSize(z.seleccion), webpSize(z.imagen), z.slug);
  }
  let total = 0;
  for (const [file, max] of files) {
    assert.match(file, /\.v\d+\.webp$/);
    const size = statSync(join(DIR, file)).size;
    assert.ok(size <= max, `${file}: ${size} > ${max}`);
    total += size;
  }
  assert.ok(total <= 1_500_000);
});

test('Nevera frontal: zonas de toque amplias, dentro del plano y sin solapamiento', () => {
  for (const { hit: r, rect } of plano.zonas) {
    assert.ok(r.w >= 200 && r.h >= 200);
    assert.ok(r.w / plano.fondo.w * 243 >= 44 && r.h / plano.fondo.w * 243 >= 44);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= plano.fondo.w && r.y + r.h <= plano.fondo.h);
    // El dibujo y el área táctil son independientes: el hit puede crecer hasta la balda.
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= plano.fondo.w && rect.y + rect.h <= plano.fondo.h);
    assert.ok(rect.x < r.x + r.w && rect.x + rect.w > r.x && rect.y < r.y + r.h && rect.y + rect.h > r.y);
  }
  for (let i = 0; i < plano.zonas.length; i++) {
    for (const { hit: b } of plano.zonas.slice(i + 1)) {
      const a = plano.zonas[i].hit;
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
    }
  }
  assert.ok(plano.zonas.find((z) => z.slug === 'heineken').hit.h / plano.fondo.w * 227 >= 56);
});

test('Nevera frontal: Heineken y Lanjarón conservan imagen y máscara v3', () => {
  for (const slug of ['heineken', 'agua-cabreiroa-33-cl']) {
    const zona = plano.zonas.find((z) => z.slug === slug);
    const s = String(zonaHtml({ id: 1, slug, name: slug }, [zona], plano, { n: 1 }));
    assert.match(zona.imagen, /grupo\.v3\.webp$/);
    assert.match(zona.seleccion, /seleccion\.v3\.webp$/);
    assert.equal(zona.silueta, undefined);
    assert.match(s, /<img class="nev-img"/);
    assert.match(s, /<img class="nev-sel"/);
    assert.match(s, /aria-pressed="true"/);
    assert.doesNotMatch(s, /nev-placeholder|undefined|Heinekeri/);
  }
});

test('Nevera frontal: cinco productos existentes en Nevera con los pasos acordados', async (t) => {
  const db = await openPglite();
  t.after(() => db.end());
  for (const z of plano.zonas) {
    const p = await db.get(`SELECT p.active, p.order_unit, p.per_case, pg.section FROM products p
      JOIN product_groups pg ON pg.id = p.group_id WHERE p.slug = ?`, z.slug);
    assert.ok(p, z.slug);
    assert.equal(p.active, 1);
    assert.equal(p.section, 'nevera');
    assert.equal(p.order_unit, z.slug === 'heineken' ? 'botella' : 'caja');
    if (z.slug !== 'heineken') assert.equal(p.per_case, z.slug === 'agua-cabreiroa-33-cl' ? 35 : 24);
  }
});

test('Nevera frontal: enlace puro por slug, selección completa, cantidad y datos accesibles', () => {
  const p = { id: 42, slug: 'red-bull', name: 'Red Bull <Especial>' };
  const result = zonasDelPlano(plano, [p, { id: 43, slug: 'nuevo' }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].p, p);
  assert.deepEqual(zonasDelPlano(plano, []), []);
  const empty = String(zonaHtml(p, [result[0].zona], plano));
  assert.match(empty, /aria-pressed="false"/);
  assert.doesNotMatch(empty, /class="count"|nev-name|nev-caption/);
  // Dos Red Bull y dos Sugarfree, cada uno con su zona.
  assert.match(plano.zonas.find((z) => z.slug === 'red-bull-sugarfree').imagen, /grupo\.v3\.webp$/);
  assert.equal(result[0].zona.hit.w, 290);
  assert.match(result[0].zona.imagen, /grupo\.v2\.webp$/);
  const s = String(zonaHtml(p, [result[0].zona], plano, {
    n: 48, shown: 2, pend: 24, out: true, qty: '2 cajas', pending: '1 caja', what: 'una caja',
  }));
  assert.match(s, /data-card="42"/);
  assert.match(s, /data-add="42"/);
  assert.match(s, /data-minus="42"/);
  assert.match(s, /aria-pressed="true"/);
  assert.match(s, /class="nev-p sel"/);
  assert.match(s, /Red Bull &lt;Especial&gt;/);
  assert.match(s, /1 caja pend\./);
  assert.match(s, /agotado en almacén/);
  assert.match(s, /class="count"[^>]*>2<\/span>/);
  const el = { innerHTML: '' };
  renderNevera(el, plano, []);
  assert.match(el.innerHTML, /bandeja.v1.webp/);
  assert.doesNotMatch(el.innerHTML, /data-add=/);
});

test('Chupitería: mismo plano aprobado y las mismas 37 piezas', () => {
  // Sin depender de los saltos de línea de la copia (CRLF en Windows, LF en el repositorio).
  const lf = chupiteria.toString('utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(lf).digest('hex'), '4e92cf90dc99e061a3e20d5b9a488cb1562870163be9bf09c3c49681c32b8ef6');
  const layout = JSON.parse(chupiteria);
  assert.equal(layout.grupos.reduce((n, g) => n + g.piezas.length, 0), 37);
  const el = { innerHTML: '' };
  renderNevera(el, layout, layout.grupos.map((g, id) => ({ id: id + 1, slug: g.slug })));
  assert.equal((el.innerHTML.match(/class="nev-img"/g) || []).length, 37);
  assert.doesNotMatch(el.innerHTML, /nevera-frontal/);
});
