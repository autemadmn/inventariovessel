// Concurrencia real contra Postgres: dos conexiones independientes compiten
// por las mismas líneas. Solo se ejecuta con TEST_DATABASE_URL.
//
//   TEST_DATABASE_URL=postgres://… npm test
//
// ¡NUNCA apuntes TEST_DATABASE_URL a la base de producción! El test crea un
// esquema temporal (vessel_test_<marca>) y lo borra al terminar, pero usa
// conexiones con permisos de escritura.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pgDb } from '../server/db-pg.js';
import { migrationFiles } from '../server/db-pglite.js';
import * as svc from '../server/services.js';
import * as viaje from '../server/viaje.js';
import * as alm from '../server/almacen.js';

const URL = process.env.TEST_DATABASE_URL;
const NIGHT = new Date('2026-09-26T21:00:00Z');
const later = (min) => new Date(NIGHT.getTime() + min * 60000);

test('concurrencia real en Postgres', { skip: !URL && 'sin TEST_DATABASE_URL' }, async (t) => {
  const schema = `vessel_test_${Date.now()}`;
  const admin = pgDb(URL);
  await admin.exec(`CREATE SCHEMA "${schema}"`);
  const a = pgDb(URL, { schema });
  const b = pgDb(URL, { schema });
  t.after(async () => {
    await a.end();
    await b.end();
    await admin.exec(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });
  for (const f of migrationFiles()) await a.exec(readFileSync(f, 'utf8'));
  const id = async (name) => (await a.get('SELECT id FROM products WHERE name = ?', name)).id;
  const roku = await id('Roku');
  const skyy = await id('SKYY');

  for (let round = 0; round < 20; round++) {
    const now = later(round * 30);
    await a.run('DELETE FROM deliveries');
    await a.run('DELETE FROM request_lines');

    // Dos «Hecho» simultáneos sobre las mismas líneas: uno gana y el otro recibe 409.
    await svc.createRequest(a, { bar_id: 1, items: [{ product_id: roku, qty: 2 }, { product_id: skyy, qty: 3 }] }, { now });
    let lines = (await svc.liveState(a, { now })).lines;
    const items = lines.map((l) => ({ line_id: l.id, qty: l.qty_pending, delivered: l.qty_delivered }));
    let res = await Promise.allSettled([
      svc.completeLines(a, { items }, { now }),
      svc.completeLines(b, { items: [...items].reverse() }, { now }), // orden inverso: sin interbloqueo
    ]);
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1, `ronda ${round}: un solo «Hecho»`);
    assert.equal(res.find((r) => r.status === 'rejected').reason.status, 409);
    const { n } = await a.get('SELECT COALESCE(SUM(qty), 0)::int AS n FROM deliveries');
    assert.equal(n, 5);

    // Dos entregas de las mismas botellas.
    await svc.createRequest(a, { bar_id: 2, items: [{ product_id: roku, qty: 2 }] }, { now });
    lines = (await svc.liveState(a, { now })).lines.filter((l) => l.bar_id === 2 && l.qty_pending);
    res = await Promise.allSettled([
      svc.deliver(a, lines[0].id, { qty: 2 }, { now }),
      svc.deliver(b, lines[0].id, { qty: 2 }, { now }),
    ]);
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(res.find((r) => r.status === 'rejected').reason.status, 409);

    // Dos pedidos simultáneos del mismo producto y barra: una sola línea.
    await Promise.all([
      svc.createRequest(a, { bar_id: 2, items: [{ product_id: skyy, qty: 1 }] }, { now }),
      svc.createRequest(b, { bar_id: 2, items: [{ product_id: skyy, qty: 1 }] }, { now }),
    ]);
    const open = (await svc.liveState(a, { now })).lines.filter((l) => l.bar_id === 2 && l.product_id === skyy && l.qty_pending);
    assert.equal(open.length, 1);
    assert.equal(open[0].qty_pending, 2);
  }

  const [first, second] = await Promise.all([
    viaje.addTripLine(a, { product_id: roku, qty_planned: 2 }, { now: NIGHT }),
    viaje.addTripLine(b, { product_id: skyy, qty_planned: 3 }, { now: NIGHT }),
  ]);
  const openTrip = await viaje.tripView(a);
  assert.equal(openTrip.count, 2);
  assert.equal(first.trip.id, second.trip.id);
  for (const line of openTrip.lines) {
    await viaje.updateTripLine(a, line.id, { checked: 1 }, { now: NIGHT });
  }
  const results = await Promise.allSettled([
    viaje.finishTrip(a, { trip_id: openTrip.trip.id }, { now: NIGHT }),
    viaje.finishTrip(b, { trip_id: openTrip.trip.id }, { now: NIGHT }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.status, 409);
  assert.equal((await a.get('SELECT COUNT(*)::int AS n FROM stock_moves WHERE trip_id = ?', openTrip.trip.id)).n, 2);

  // Dos conexiones cuentan el mismo punto: ambos recuentos quedan guardados;
  // el que obtiene el bloqueo después usa como expected el recuento anterior.
  const countAt = later(1440);
  await alm.saveCounts(a, { store_id: 4, items: [{ product_id: roku, qty: 30 }] }, { now: countAt });
  await Promise.all([
    alm.saveCounts(a, { store_id: 4, items: [{ product_id: roku, qty: 28 }], key: 'pg-count-a' }, { now: later(1441) }),
    alm.saveCounts(b, { store_id: 4, items: [{ product_id: roku, qty: 26 }], key: 'pg-count-b' }, { now: later(1441) }),
  ]);
  const counts = await a.all('SELECT qty, expected FROM stock_counts WHERE store_id = 4 AND product_id = ? ORDER BY id', roku);
  assert.equal(counts.length, 3);
  assert.equal(counts[0].expected, null);
  assert.equal(counts[1].expected, 30);
  assert.equal(counts[2].expected, counts[1].qty);
  assert.deepEqual(counts.slice(1).map((c) => c.qty).sort((x, y) => x - y), [26, 28]);
});
