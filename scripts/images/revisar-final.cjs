// Revisión de la app local. Crea únicamente pedidos de prueba en DATA_DIR temporal.
const { chromium }=require(process.env.NEVERA_PLAYWRIGHT || 'C:/Users/mrani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const root=process.env.VESSEL_ROOT || path.resolve(__dirname,'../..');
const url=process.env.NEVERA_URL || 'http://127.0.0.1:3137';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname))throw new Error('La revisión final crea pedidos de prueba: usar exclusivamente un servidor local con DATA_DIR temporal.');
const captures=path.join(root,'tmp-capturas/final');
(async()=>{
 await fs.mkdir(captures,{recursive:true});
 const b=await (await fetch(url+'/api/bootstrap')).json();
 const products=Object.fromEntries(b.products.map(p=>[p.slug,p]));
 for(const bar of b.bars){
  const r=await fetch(url+'/api/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bar_id:bar.id,by:'Revisión local',items:['tanqueray-london-dry','pepsi','red-bull-sugarfree'].map(slug=>({product_id:products[slug].id,qty:products[slug].order_unit==='caja'?products[slug].per_case:2}))})});
  assert.ok(r.ok,await r.text());
 }
 const browser=await chromium.launch({headless:true,executablePath:process.env.NEVERA_CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const summary=[];const errors=[];
 try{
  for(const colorScheme of ['light','dark']) for(const [width,height] of [[360,640],[390,844],[768,1024],[1024,768]]){
   const context=await browser.newContext({viewport:{width,height},colorScheme,reducedMotion:'reduce'});
   await context.addInitScript(()=>{localStorage.setItem('whoAsked','true');localStorage.setItem('bar','1');sessionStorage.setItem('managerPin',JSON.stringify('2468'));});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   async function shot(name,fullPage=true){
    await page.evaluate(async()=>{await document.fonts.ready;const imgs=[...document.images];for(const i of imgs)i.loading='eager';await Promise.all(imgs.map(i=>i.decode().catch(()=>{})));});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: overflow ${width}`);
    const broken=await page.locator('#main img').evaluateAll(imgs=>imgs.filter(i=>!i.naturalWidth).map(i=>i.src));
    assert.deepEqual(broken,[],`${name}: imágenes rotas`);
    const file=`${colorScheme}-${width}x${height}-${name}.png`;
    await page.screenshot({path:path.join(captures,file),fullPage});
    summary.push({colorScheme,width,height,screen:name,file});
   }
   for(const [screen,route] of [['portada','pedir'],['alcohol','pedir/alcohol'],['nevera','pedir/nevera'],['chupiteria','pedir/chupiteria'],['refrescos','pedir/refrescos'],['otros','pedir/otros'],['reponer','reponer'],['catalogo','gestion/catalogo']]){
    await page.goto(`${url}/#/${route}`);await page.waitForFunction(view=>document.body.dataset.view===view,route.split('/')[0]);
    await page.locator('#main').locator('button').first().waitFor();
    if(route.startsWith('pedir/') && !['nevera','chupiteria'].includes(screen)) await page.getByRole('heading',{level:1,name:screen==='alcohol'?'Alcohol':screen==='refrescos'?'Refrescos':'Otros',exact:true}).waitFor();
    if(screen==='portada')await page.locator('#cover [data-sec]').first().waitFor();
    if(screen==='nevera')await page.locator('.nev-zone').first().waitFor();
    if(screen==='chupiteria')await page.locator('.nev-g').first().waitFor();
    if(screen==='catalogo')await page.locator('.cat-list').first().waitFor();
    await shot(screen);
    if(screen==='alcohol'){
     const premium=page.getByRole('heading',{name:/premium/i}).first();
     if(await premium.count()){await premium.scrollIntoViewIfNeeded();await shot('alcohol-premium',false);}
    }
    if(screen==='refrescos'){
     const zumos=page.getByRole('heading',{name:/zumos/i}).first();
     if(await zumos.count()){await zumos.scrollIntoViewIfNeeded();await shot('zumos',false);}
    }
   }
   await page.goto(`${url}/#/pedir/refrescos`);await page.locator(`[data-add="${products.pepsi.id}"]`).first().waitFor();
   await page.evaluate(async(ids)=>{const {state,cart,saveCarts,notify}=await import('/js/state.js');state.bar=1;cart()[ids[0]]=24;cart()[ids[1]]=2;saveCarts();notify('bootstrap');},[products.pepsi.id,products['tanqueray-london-dry'].id]);
   await page.locator('[data-open-cart]').click();await page.locator('.cart-list').waitFor();await shot('carrito',false);
   await page.getByRole('button',{name:'Seguir añadiendo',exact:true}).click();
   await page.goto(`${url}/#/pedir/chupiteria`);await page.locator('.nev-g').first().waitFor();
   const touch=await page.locator('.nevera .nev-hit').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {id:n.dataset.add,x:r.x,y:r.y,width:r.width,height:r.height};}));
   for(const r of touch)assert.ok(r.width>=44&&r.height>=44,JSON.stringify({width,height,r}));
   const cartbar=await page.locator('.cartbar.show').boundingBox();
   if(cartbar)for(const r of touch)assert.ok(r.y+r.height<=cartbar.y+.5,'el carrito tapa una zona de toque');
   for(let i=0;i<touch.length;i++)for(const b of touch.slice(i+1)){
    const a=touch[i];assert.ok(a.x+a.width<=b.x+.02||b.x+b.width<=a.x+.02||a.y+a.height<=b.y+.02||b.y+b.height<=a.y+.02,'toques solapados');
   }
   await page.locator('.nev-chapas-hit').first().click();
   assert.equal(await page.locator('.nev-chapas.on').count(),1);
   await page.locator('.nev-chapas.on .card-minus').click();
   assert.equal(await page.locator('.nev-chapas.on').count(),0);
   summary.push({colorScheme,width,height,screen:'chupiteria-toques',touch});
   console.log(`${colorScheme} ${width}x${height}: pantallas, imágenes, carrito y toques OK`);
   await context.close();
  }
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(captures,'qa.json'),JSON.stringify({screens:summary,errors},null,2)+'\n');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
