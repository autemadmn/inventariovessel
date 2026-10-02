import test from 'node:test';
import assert from 'node:assert/strict';
import { openPglite, applyMigrations } from '../server/db-pglite.js';
import { importBackup } from '../server/import-backup.js';
import { createHandler } from '../server/handler.js';
import { businessDate } from '../server/dates.js';
import * as alm from '../server/almacen.js';
import * as svc from '../server/services.js';

const NOW = new Date('2026-09-26T21:00:00Z');
const later = (m) => new Date(NOW.getTime()+m*60000);
async function setup(t) {
  const db = await openPglite(); t.after(() => db.end());
  const ids = (await db.all('SELECT id FROM products ORDER BY id LIMIT 2')).map(p => p.id);
  return { db, ids };
}
const count = (db,id,store_id,qty,now=NOW) => alm.saveCounts(db,{store_id,items:[{product_id:id,qty}]},{now});
const stock = async (db,id,store) => (await alm.stockRows(db,store,later(60).toISOString())).find(p=>p.product_id===id)?.stock ?? null;
async function deliver(db,id,qty,now=NOW) {
  await svc.createRequest(db,{bar_id:1,items:[{product_id:id,qty}]},{now});
  const line=await db.get('SELECT id FROM request_lines WHERE product_id = ? ORDER BY id DESC LIMIT 1',id);
  await svc.completeLines(db,{items:[{line_id:line.id,qty,delivered:0}]},{now});
}

test('una barra sin recuento recibe la reposición y conserva el total y su consumo',async t=>{
  const {db,ids:[id]}=await setup(t);
  await count(db,id,1,30); await deliver(db,id,4,later(1));
  assert.equal(await stock(db,id,1),26); assert.equal(await stock(db,id,8),4);
  assert.equal((await alm.liveStock(db,{now:later(2)}))[id],30);
  const r=await count(db,id,8,3,later(2));
  assert.equal(r.results[0].expected,4); assert.equal(r.results[0].consumption,1);
});

test('entradas, traslados y roturas simultáneos y reintentados escriben una sola vez',async t=>{
  const {db,ids:[id,other]}=await setup(t);
  await count(db,id,1,30);
  const operations=[
    [alm.addEntries,{key:'entrada',store_id:1,items:[{product_id:id,qty:5},{product_id:other,qty:2}]}],
    [alm.addTransfer,{key:'traslado',product_id:id,from_store_id:1,to_store_id:9,qty:2}],
    [alm.addBreakage,{key:'rotura',product_id:id,store_id:1,qty:1}],
  ];
  for(const [fn,body] of operations) {
    await Promise.all([fn(db,body,{now:later(1)}),fn(db,body,{now:later(1)})]);
    await fn(db,body,{now:later(2)});
    const changed=body.items ? {...body,items:[{product_id:other,qty:3}]} : {...body,qty:3};
    await assert.rejects(fn(db,changed,{now:later(3)}),e=>e.status===409);
  }
  assert.equal(await stock(db,id,1),32); assert.equal(await stock(db,id,9),2);
  assert.equal((await db.get('SELECT COUNT(*)::int n FROM stock_moves')).n,4);
  assert.equal((await db.get("SELECT COUNT(*)::int n FROM audit WHERE action IN ('entrada','traslado_punto','rotura')")).n,4);
  const copy=await svc.exportData(db); const {db:restored}=await setup(t);
  await importBackup(restored,copy);
  await alm.addTransfer(restored,operations[1][1],{now:later(4)});
  assert.equal((await restored.get('SELECT COUNT(*)::int n FROM stock_moves')).n,4);
});

test('un lote de recuentos con clave devuelve los resultados originales al reintentar',async t=>{
  const {db,ids}=await setup(t);
  const body={key:'lote',store_id:1,items:ids.map(product_id=>({product_id,qty:10}))};
  const [a,b]=await Promise.all([alm.saveCounts(db,body,{now:NOW}),alm.saveCounts(db,body,{now:NOW})]);
  assert.deepEqual(a,b);
  await alm.addEntries(db,{store_id:1,items:[{product_id:ids[0],qty:5}]},{now:later(1)});
  assert.deepEqual(await alm.saveCounts(db,{...body,items:[...body.items].reverse()},{now:later(2)}),a);
  assert.equal(await stock(db,ids[0],1),15);
  assert.equal((await db.get('SELECT COUNT(*)::int n FROM stock_counts')).n,2);
  await assert.rejects(alm.saveCounts(db,{...body,items:[body.items[0]]},{now:later(3)}),e=>e.status===409);
});

test('hora igual: entrada, traslado, reposición y rotura respetan el orden de escritura',async t=>{
  const {db,ids:[id]}=await setup(t);
  await count(db,id,1,10); await count(db,id,8,0); await count(db,id,9,0);
  await alm.addEntries(db,{store_id:1,items:[{product_id:id,qty:5}]},{now:NOW});
  assert.equal(await stock(db,id,1),15);
  await count(db,id,1,12); assert.equal(await stock(db,id,1),12);
  await alm.addTransfer(db,{product_id:id,from_store_id:1,to_store_id:9,qty:2},{now:NOW});
  assert.equal(await stock(db,id,1),10); assert.equal(await stock(db,id,9),2);
  await count(db,id,1,10); await count(db,id,9,2);
  assert.equal(await stock(db,id,1),10); assert.equal(await stock(db,id,9),2);
  await deliver(db,id,3); assert.equal(await stock(db,id,1),7); assert.equal(await stock(db,id,8),3);
  await count(db,id,1,7); await count(db,id,8,3);
  assert.equal(await stock(db,id,1),7); assert.equal(await stock(db,id,8),3);
  await alm.addBreakage(db,{product_id:id,store_id:1,qty:1},{now:NOW});
  assert.equal(await stock(db,id,1),6);
  await count(db,id,1,6); assert.equal(await stock(db,id,1),6);
  const copy=await svc.exportData(db); const {db:restored}=await setup(t); await importBackup(restored,copy);
  await applyMigrations(restored);
  await alm.addEntries(restored,{store_id:1,items:[{product_id:id,qty:1}]},{now:NOW});
  assert.equal(await stock(restored,id,1),7);
});

test('la API rechaza cantidades vacías o de otro tipo y acepta el cero explícito',async t=>{
  const {db,ids:[id]}=await setup(t); const handle=createHandler({getDb:async()=>db});
  const send=qty=>handle(new Request('http://local/api/almacen/recuentos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({store_id:1,items:[{product_id:id,qty}]})}));
  for(const qty of [null,'',' ',false,true,[],[1],{},'1x','1.0','0x10']) assert.equal((await send(qty)).status,400,JSON.stringify(qty));
  assert.equal((await db.get('SELECT COUNT(*)::int n FROM stock_counts')).n,0);
  assert.equal((await db.get('SELECT COUNT(*)::int n FROM audit')).n,0);
  assert.equal((await send(0)).status,200); assert.equal((await send('0')).status,200);
  await assert.rejects(svc.createRequest(db,{bar_id:1,items:[{product_id:id,qty:true}]},{now:NOW}),e=>e.status===400);
});

test('reposición antigua exige hora efectiva, no altera recuentos posteriores y audita el registro',async t=>{
  const {db,ids:[id]}=await setup(t);
  await count(db,id,1,20); await count(db,id,8,5);
  const body={date:'2026-09-25',product_id:id,bar_id:1,qty:4,reason:'Olvidada'};
  await assert.rejects(svc.addManualDelivery(db,body,{now:NOW}),e=>e.status===400);
  await assert.rejects(svc.addManualDelivery(db,{...body,delivered_at:NOW.toISOString()},{now:NOW}),e=>e.status===400);
  await svc.addManualDelivery(db,{...body,delivered_at:'2026-09-25T23:30:00Z'},{now:NOW});
  assert.equal(await stock(db,id,1),20); assert.equal(await stock(db,id,8),5);
  assert.equal((await db.get("SELECT at FROM audit WHERE action = 'añadir a posteriori'")).at,NOW.toISOString());
});

test('jornada fija de Madrid, mediodía y cambios de hora; normalización de copias con constancia',async t=>{
  const {db}=await setup(t);
  for(const patch of [{timezone:'UTC'},{cutoff_hour:0},{cutoff_hour:null}]) await assert.rejects(svc.updateSettings(db,patch),e=>e.status===400);
  for(const [iso,date] of [
    ['2026-09-26T22:00:00Z','2026-09-26'],['2026-09-27T09:59:00Z','2026-09-26'],['2026-09-27T10:00:00Z','2026-09-27'],
    ['2026-03-29T00:59:00Z','2026-03-28'],['2026-03-29T01:00:00Z','2026-03-28'],
    ['2026-10-25T00:30:00Z','2026-10-24'],['2026-10-25T01:30:00Z','2026-10-24'],['2026-10-25T11:00:00Z','2026-10-25'],
  ]) assert.equal(businessDate(new Date(iso)),date);
  const backup=await svc.exportData(db);
  backup.tables.settings.find(r=>r.key==='timezone').value='UTC';
  backup.tables.settings.find(r=>r.key==='cutoff_hour').value='0';
  await importBackup(db,backup);
  assert.equal((await svc.getSettings(db)).timezone,'Europe/Madrid');
  assert.equal((await svc.getSettings(db)).cutoff_hour,'12');
  assert.equal((await db.get("SELECT COUNT(*)::int n FROM audit WHERE action = 'normalizar jornada importada'")).n,1);
});

test('exportación usa una instantánea transaccional y se restaura durante actividad intercalada',async t=>{
  const {db,ids:[id]}=await setup(t); let activity;
  const observed={tx:fn=>db.tx(t=>{
    let first=true;
    return fn({...t,run:async(sql,...args)=>{
      if(first) { assert.equal(sql,'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');first=false; }
      return t.run(sql,...args);
    },all:async(sql,...args)=>{
      const rows=await t.all(sql,...args);
      if(sql==='SELECT * FROM sessions ORDER BY id') activity=svc.createRequest(db,{bar_id:1,items:[{product_id:id,qty:2}]},{now:NOW});
      return rows;
    }});
  }),all:()=>{throw new Error('Lectura fuera de la transacción');}};
  const copy=await svc.exportData(observed); await activity;
  assert.equal(copy.tables.sessions.length,0); assert.equal(copy.tables.request_lines.length,0);
  assert.equal((await db.get('SELECT COUNT(*)::int n FROM request_lines')).n,1);
  const {db:restored}=await setup(t); await importBackup(restored,copy);
  assert.equal((await restored.get('SELECT COUNT(*)::int n FROM request_lines')).n,0);
});
