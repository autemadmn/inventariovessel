// QA de la app real (servidor Node local), sin enviar solicitudes a producción.
const { chromium } = require(process.env.NEVERA_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const url = process.env.NEVERA_URL || 'http://127.0.0.1:3137';
const captures = path.join(__dirname, '_build/capturas');

(async () => {
  await fs.mkdir(captures, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    ...(process.env.NEVERA_CHROMIUM ? { executablePath: process.env.NEVERA_CHROMIUM } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 360, height: 640 } });
    await context.addInitScript(() => localStorage.setItem('whoAsked', 'true'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${url}/#/pedir/nevera`);
    await page.locator('.nev-zone').first().waitFor();
    const products = await page.evaluate(async () => {
      const { state } = await import('/js/state.js');
      return Object.fromEntries(state.products.map((p) => [p.slug, p]));
    });
    const zone = (slug) => page.locator(`.nev-zone[data-card="${products[slug].id}"]`);
    assert.equal(await page.locator('.nev-zone').count(), 5);
    assert.equal(await page.locator('.filters').count(), 0);
    assert.equal(await page.locator('.bar-btn').count(), 3);
    await zone('red-bull').locator('.nev-hit').click();
    assert.equal(await zone('red-bull').locator('.count').count(), 0);
    assert.match(await page.locator('.toast').textContent(), /Primero elige la barra/);
    await page.locator('[data-bar="3"]').click();
    for (const slug of ['agua-cabreiroa-33-cl', 'red-bull', 'red-bull-sugarfree', 'heineken', 'estrella-galicia']) {
      await zone(slug).locator('.nev-hit').click();
      assert.equal(await zone(slug).locator('.count').textContent(), '1');
      assert.equal(await zone(slug).locator('.nev-hit').getAttribute('aria-pressed'), 'true');
      const qty = await page.evaluate(async (id) => (await import('/js/state.js')).cart()[id], products[slug].id);
      assert.equal(qty, slug === 'heineken' ? 1 : products[slug].per_case);
    }
    await zone('red-bull').locator('.nev-hit').click();
    assert.equal(await zone('red-bull').locator('.count').textContent(), '2');
    await zone('red-bull').locator('.card-minus').click();
    assert.equal(await zone('red-bull').locator('.count').textContent(), '1');
    await zone('red-bull').locator('.card-minus').click();
    assert.equal(await zone('red-bull').locator('.nev-hit').getAttribute('aria-pressed'), 'false');
    assert.equal(await zone('red-bull').locator('.nev-p.sel').count(), 0);
    await zone('red-bull').locator('.nev-hit').focus();
    await page.keyboard.press('Enter');
    assert.equal(await zone('red-bull').locator('.count').textContent(), '1');
    await zone('red-bull').locator('.nev-hit').focus();
    await page.keyboard.press('Space');
    assert.equal(await zone('red-bull').locator('.count').textContent(), '2');
    await zone('red-bull').locator('.card-minus').click();
    await zone('red-bull').locator('.card-minus').click();
    await page.locator('[data-bar="1"]').click();
    assert.equal(await page.locator('.nev-zone .count').count(), 0);
    await page.locator('[data-bar="3"]').click();
    assert.equal(await zone('heineken').locator('.count').textContent(), '1');
    // El mismo diálogo de pedido de la app, con cantidades por caja.
    await page.locator('[data-open-cart]').click();
    assert.match(await page.locator('dialog[open]').textContent(), /Solicitud para Barra VIP/);
    assert.match(await page.locator('dialog[open]').textContent(), /1 caja/);
    await page.getByRole('button', { name: 'Seguir añadiendo', exact: true }).click();
    // Cantidades parciales y agotados/pending del sondeo: el dibujo se actualiza.
    await page.evaluate(async (p) => {
      const { state, notify, cart } = await import('/js/state.js');
      cart()[p.id] = 25;
      state.live.lines = [{ product_id: p.id, bar_id: 3, qty_pending: 24 }];
      state.products.find((x) => x.id === p.id).out_of_stock = 1;
      notify('live');
    }, products['red-bull']);
    assert.equal(await zone('red-bull').locator('.count').textContent(), '1 caja + 1');
    assert.match(await zone('red-bull').locator('.nev-hit').getAttribute('aria-label'), /1 caja pend\./);
    assert.match(await zone('red-bull').getAttribute('class'), /out/);
    await page.locator('.toast.show').waitFor({ state: 'hidden' });
    for (const [width, height] of [[360,640], [390,844], [768,1024], [1024,768]]) {
      await page.setViewportSize({ width, height });
      await page.locator('.nev-img').evaluateAll((imgs) => Promise.all(imgs.map((i) => i.decode())));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const tray = await page.locator('.nevera-frontal').boundingBox();
      const cartbar = await page.locator('.cartbar.show').boundingBox();
      assert.ok(tray.y + tray.height <= cartbar.y + 1, JSON.stringify({ width, height, tray, cartbar }));
      for (const hit of await page.locator('.nev-zone .nev-hit').all()) {
        const b = await hit.boundingBox();
        assert.ok(b.width >= 44 && b.height >= 44, JSON.stringify(b));
      }
      assert.ok((await zone('heineken').locator('.nev-hit').boundingBox()).height >= 56);
      for (const slug of ['heineken', 'red-bull-sugarfree']) {
        assert.equal(await zone(slug).locator('.nev-placeholder').count(), 0);
        assert.equal(await zone(slug).locator('img').count(), 2);
      }
      const selected = zone('heineken').locator('.nev-hit');
      assert.notEqual(await selected.evaluate((el) => getComputedStyle(el).boxShadow), 'none');
      for (const caption of await page.locator('.nev-caption').all()) {
        assert.ok(await caption.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
      }
      await page.screenshot({ path: path.join(captures, `nevera-${width}x${height}.png`) });
      console.log(`${width}x${height}: ${tray.width.toFixed(1)}x${tray.height.toFixed(1)}, hit >=44 px, sin overflow`);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.nev-sel').first().evaluate((el) => getComputedStyle(el).transitionDuration), '0s');
    // Quitados de selección desaparecen; altas nuevas salen en tarjetas.
    await page.evaluate(async (p) => {
      const { state, notify } = await import('/js/state.js');
      state.products = state.products.filter((x) => x.id !== p.id);
      state.products.push({ ...p, id: 9999, slug: 'alta-nueva', name: 'Alta nueva' });
      notify('bootstrap');
    }, products['red-bull-sugarfree']);
    assert.equal(await page.locator('.nev-zone').count(), 4);
    assert.equal(await page.locator('.grid .card[data-card="9999"]').count(), 1);
    assert.match(await page.locator('#grid').textContent(), /Más de la nevera/);
    await page.evaluate(async () => {
      const { state, notify } = await import('/js/state.js');
      const ids = new Set(state.groups.filter((g) => g.section === 'nevera').map((g) => g.id));
      state.products = state.products.filter((p) => !ids.has(p.group_id));
      notify('bootstrap');
    });
    assert.equal(await page.locator('.nev-zone').count(), 0);
    assert.equal(await page.locator('.nev-bg').count(), 1);
    // Regresión: ruta, imágenes y modo por piezas de la Chupitería aprobada.
    await page.goto(`${url}/#/pedir/chupiteria`);
    await page.locator('.nev-g').first().waitFor();
    assert.equal(await page.locator('.filters').count(), 0);
    assert.equal(await page.locator('.nev-p').count(), 37);
    await page.locator('[data-bar="1"]').click();
    await page.locator('.nev-g').first().locator('.nev-hit').click();
    assert.equal(await page.locator('.nev-g').first().locator('.nev-p.sel').count(), 1);
    assert.equal(await page.locator('.nev-g').first().locator('.count').textContent(), '1');
    await page.screenshot({ path: path.join(captures, 'chupiteria-regresion.png') });
    // Si falla el recurso del plano, se puede pedir con tarjetas sin buscador.
    const fallback = await browser.newContext();
    await fallback.addInitScript(() => localStorage.setItem('whoAsked', 'true'));
    const other = await fallback.newPage();
    await other.route('**/img/nevera/frontal/nevera.v3.json', (r) => r.abort());
    await other.goto(`${url}/#/pedir/nevera`);
    await other.locator('.grid .card').first().waitFor();
    assert.equal(await other.locator('.grid .card').count(), 5);
    assert.equal(await other.locator('.filters').count(), 0);
    assert.deepEqual(errors, []);
    console.log('QA OK: pedido, VIP, cajas, restar, pendientes, agotados, fallback, altas/bajas, 37 piezas y movimiento reducido.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
