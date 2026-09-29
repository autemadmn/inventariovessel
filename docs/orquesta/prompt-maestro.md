# Prompt maestro para «Crear con IA» (Orquesta)

Copia **todo lo que hay debajo de la línea** y pégalo en «Crear con IA».

Antes de ejecutar el flujo:

- Crea una rama nueva en tu copia del repo (`git switch -c supabase`) y abre esa carpeta como carpeta de trabajo de la sesión de Orquesta.
- Gemini CLI necesita la extensión Nano Banana y una clave de API de Gemini con acceso a generación de imágenes (`NANOBANANA_GEMINI_API_KEY` o `GEMINI_API_KEY`).
- Necesitas Python 3.10 o superior para el recorte. El primer uso de rembg descarga un modelo de unos 170 MB.

---

Crea un flujo llamado «Vessel · Supabase, selección editable, personal e imágenes». Sigue esta especificación al pie de la letra.

REGLAS PARA CONSTRUIR EL FLUJO
1. Crea exactamente los 21 bloques listados, con el id, tipo, proveedor, modelo, permiso y título indicados.
2. Las instrucciones de cada bloque son el texto entre la línea «===== INSTRUCCIONES =====» y la línea «===== FIN =====». Cópialas literalmente y completas: no las resumas, traduzcas, reordenes ni añadas nada.
3. Crea exactamente las conexiones de la sección CONEXIONES y ninguna más. Si Orquesta exige un bloque Merge para que un bloque reciba varias entradas, añade un Merge por cada bloque destino que lo necesite, sin cambiar nada más.
4. Sin bucles ni reintentos entre bloques. Como máximo 6 bloques IA a la vez (la estructura ya lo garantiza).
5. Los bloques de «lectura» no escriben archivos. Los de «escritura» sí pueden escribir y ejecutar comandos en la carpeta de trabajo.

ESTRUCTURA (verbalizada)
- Fase 0. «brief» (Entrada) lleva el contexto común y se conecta a todos los bloques IA, que así saben qué es el proyecto, qué hay que conseguir y las reglas.
- Fase 1. Arrancan a la vez 4 bloques:
  - «arquitecto» (Claude Opus, lectura) lee el repo y escribe el CONTRATO técnico.
  - «fichas-1», «fichas-2» y «fichas-3» (Gemini 2.5 Flash, lectura) buscan referencias visuales reales de cada botella, un lote cada uno.
- Fase 2. Hay dos carriles independientes que se solapan:
  - Código, en cuanto termina el arquitecto: «backend» (Codex, escritura), «interfaz-a» (Claude Sonnet, escritura) e «interfaz-b» (Claude Sonnet, escritura). Trabajan a la vez sobre archivos que no se pisan.
  - Imágenes: cada «imagenes-N» (Gemini 2.5 Pro con Nano Banana, escritura) arranca en cuanto termina su «fichas-N».
  - Pico de concurrencia: 3 bloques de código y 3 de imágenes, 6 en total.
- Fase 3. «union-imagenes» (Merge) junta los tres lotes y se lo pasa a «recorte» (Codex, escritura). Recorte quita el fondo, normaliza tamaño y peso, y escribe los PNG finales y su manifest. Puede solaparse con los bloques de código que aún sigan.
- Fase 4. «union-codigo» (Merge) junta backend, interfaz-a, interfaz-b y recorte, y se lo pasa a «integracion» (Claude Opus, escritura). Integración conecta las piezas, ejecuta los tests y escribe el README.
- Fase 5. Tres revisores de solo lectura trabajan a la vez:
  - «rev-backend» (Codex),
  - «rev-ux» (Claude Sonnet),
  - «rev-imagenes» (Gemini 2.5 Pro).
- Fase 6. «union-revision» (Merge) junta el informe de integración y las tres revisiones y se lo pasa a «correcciones» (Claude Opus, escritura). Este bloque aplica los arreglos, vuelve a probar y hace un único commit local sin push. Luego va a «salida» (Salida).

BLOQUES

────────────────────────────────────────
id: brief · tipo: Entrada · título: Brief común
===== INSTRUCCIONES =====
PROYECTO: «Vessel · Reposición». App web para reponer botellas en las dos barras de una discoteca. El repositorio es la carpeta de trabajo actual.
- Frontend: vanilla JS sin build, módulos ES, en public/ (vistas en public/js/views/, utilidades en public/js/ui.js, iconos Lucide en public/js/icons.js, estilos en public/css/app.css). La CSP es 'self', así que no hay scripts inline ni manejadores de evento en atributos. Las plantillas usan html`` con escape (public/js/ui.js).
- Servidor: un único manejador Request/Response (server/handler.js). Corre en Cloudflare Workers (server/worker.js) y en Node (server/index.js).
- Base de datos hoy: Cloudflare D1 (server/db-d1.js) y node:sqlite (server/db-node.js), detrás de un adaptador async { all, get, run, batch } que devuelve { changes, lastId }.
- Lógica de negocio en server/services.js; esquema y semilla en server/schema.js; catálogo inicial en server/catalog.js.
- Tests: `npm test` (node --test "test/*.test.js"). Todos deben seguir pasando.
- Tiempo real por polling: /api/live cada 4 s y /api/bootstrap cada 60 s (public/js/main.js).
- Accesos: código de personal (cabecera X-Access-Code) y PIN de encargado (cabecera X-Manager-Pin), tomados de secretos o de ajustes.

OBJETIVOS
1. Supabase (Postgres) como base de datos.
   - El Worker sigue siendo la API y el portero: el navegador nunca habla con Supabase.
   - Conexión con postgres.js usando el secreto DATABASE_URL (pooler de Supabase en modo transacción, puerto 6543, prepare: false) y `compatibility_flags: ["nodejs_compat"]` en wrangler.jsonc.
   - RLS activado en todas las tablas y sin políticas.
   - En local y en tests se usa PGlite (@electric-sql/pglite) con el mismo SQL.
   - Migraciones en supabase/migrations/. Un script importa la copia JSON que ya exporta la app (/api/backup).
   - D1 y node:sqlite dejan de usarse.
   - Solo se escribe código y SQL. El usuario sube las migraciones y despliega después.
2. Lista compartida funcionando ya: lo que pide o repone un móvil se ve en los demás en 4 s o menos.
   - Se mantiene la atomicidad actual: dos «Hecho» simultáneos nunca cuentan dos veces; el segundo recibe 409.
   - En Postgres (READ COMMITTED) esto exige bloquear la línea (SELECT … FOR UPDATE, en orden de id) dentro de la misma transacción que la escritura condicional.
3. Selección editable por el encargado (con PIN):
   - añadir y quitar botellas de la selección;
   - crear, renombrar, borrar y ordenar grupos;
   - ordenar a mano las botellas dentro de cada grupo y moverlas entre grupos.
   - Grupos iniciales: «Habituales» (las 19 de la lista de abajo, en ese orden) y «Resto» (el resto de productos activos, por categoría y nombre).
   - «Pedir» muestra los grupos en su orden. Un producto fuera de la selección no aparece en «Pedir», pero sigue en el catálogo y en el histórico.
4. Personal. El encargado añade, quita (desactiva), renombra y ordena los nombres del personal que repone. Iniciales: Carlos, Sergio, Alejandro.
   - Al entrar ya no se escribe el nombre: se elige uno de la lista con botones grandes.
   - El selector se puede cerrar («Ahora no») y abrir luego desde el botón de arriba a la derecha.
   - No son cuentas ni permisos de Supabase, solo nombres para el registro.
5. Imágenes nuevas: un PNG transparente de alta calidad por botella, generado con Gemini a partir de referencias visuales reales.
   - Ubicación: public/img/botellas/<slug>.png (512×683 px, botella centrada al 94 % de la altura, menos de 150 KB), más public/img/botellas/manifest.json.
   - En la interfaz se ven «flotando»: sin recuadro ni fondo, con una sombra suave.
   - Sin PNG, se muestra la foto subida por el encargado si la hay. Si no hay ninguna, una silueta SVG neutra de botella; nunca una foto inventada.

REGLAS PARA TODOS
- Interfaz y textos en español. Se mantiene el estilo existente «Estándar limpio» (PRODUCT.md): fuente Archivo, iconos Lucide, tokens de color de app.css, modo claro y oscuro, diálogos como hoja inferior en el móvil. Nada de estética de discoteca ni de plantilla de IA. Pensado para usarse con una mano en un móvil de 390 px.
- No inventar nombres, capacidades, botellas por caja ni textos de etiqueta. Lo que está «por confirmar» sigue así.
- Fuera de alcance: nevera, copas, VIP, Ágora.
- Prohibido: git push, desplegar, conectarse a Supabase o Cloudflare, leer o escribir valores de secretos. Solo se pueden nombrar STAFF_CODE, MANAGER_PIN y DATABASE_URL.
- Cada bloque de escritura toca solo los archivos que el CONTRATO le asigna. Si necesita un cambio en otro dominio, lo anota en su informe como «PETICIÓN PARA INTEGRACIÓN: …».
- Al terminar, cada bloque devuelve un informe breve con: archivos tocados, decisiones, pendientes y cómo probarlo.

PRODUCTOS Y SLUGS (el slug es el nombre del archivo de imagen; [?] = por confirmar)
Lote 1 · Ginebras (17):
- Bulldog London Dry = bulldog-london-dry
- Brockmans = brockmans
- Hendrick’s = hendricks
- Roku = roku
- G’Vine Floraison = gvine-floraison
- Macaronesian White Gin = macaronesian-white-gin
- Nordés = nordes
- Martin Miller’s = martin-millers
- Tanqueray London Dry = tanqueray-london-dry
- Larios Rosé = larios-rose
- Larios Pomelo = larios-pomelo
- Larios 12 = larios-12
- Master’s London Dry = masters-london-dry
- Master’s Pink = masters-pink
- Puerto de Indias [?, aparentemente Strawberry] = puerto-de-indias
- Zeeland Nº8 = zeeland-n8
- Zeeland Pink Nº12 = zeeland-pink-n12

Lote 2 · Vodkas y whiskies (19):
- Belvedere Organic = belvedere-organic
- Beluga Noble = beluga-noble
- Tito’s Handmade Vodka = titos-handmade-vodka
- Cîroc Original = ciroc-original
- Cîroc Apple = ciroc-apple
- Cîroc Red Berry = ciroc-red-berry
- Cîroc French Vanilla = ciroc-french-vanilla
- Cîroc Pineapple = ciroc-pineapple
- SKYY = skyy
- Moskovskaya = moskovskaya
- Jack Daniel’s Old No. 7 = jack-daniels-old-no-7
- Dewar’s White Label = dewars-white-label
- Johnnie Walker Red Label = johnnie-walker-red-label
- J&B Rare = j-b-rare
- DYC 8 = dyc-8
- Glenmorangie The Original [?, confirmar edad] = glenmorangie-the-original
- Monkey Shoulder = monkey-shoulder
- Chivas Regal 12 = chivas-regal-12
- The Macallan 12 [?, confirmar expresión] = the-macallan-12

Lote 3 · Rones y tequila (13):
- Cacique Añejo = cacique-anejo
- Barceló Añejo = barcelo-anejo
- Barceló Imperial = barcelo-imperial
- Flor de Caña Añejo Reserva [?, confirmar edad] = flor-de-cana-anejo-reserva
- Flor de Caña 12 = flor-de-cana-12
- Abuelo Añejo = abuelo-anejo
- Abuelo 12 = abuelo-12
- Brugal Doble Reserva = brugal-doble-reserva
- Brugal 1888 = brugal-1888
- Brugal Añejo (la de la malla) = brugal-anejo
- Zacapa [?, aparentemente Solera 23] = zacapa
- Old / Old Sport [?, marca sin identificar: sin imagen] = old-old-sport
- Don Julio Reposado = don-julio-reposado

Regla de slug para productos nuevos:
1. Quitar tildes, «º» y apóstrofos.
2. Cambiar «&» por «-».
3. Pasar a minúsculas.
4. Sustituir cualquier otro carácter que no sea letra o número por «-».
5. Juntar los guiones seguidos y quitar los de los extremos.

HABITUALES, en orden de estantería:
1. moskovskaya
2. skyy
3. zeeland-n8
4. puerto-de-indias
5. masters-pink
6. larios-rose
7. larios-pomelo
8. larios-12
9. tanqueray-london-dry
10. masters-london-dry
11. jack-daniels-old-no-7
12. dewars-white-label
13. johnnie-walker-red-label
14. j-b-rare
15. old-old-sport
16. dyc-8
17. cacique-anejo
18. barcelo-anejo
19. brugal-anejo
===== FIN =====

────────────────────────────────────────
id: arquitecto · tipo: IA · proveedor: Claude · modelo: Opus · permiso: lectura · título: Arquitecto (contrato técnico)
===== INSTRUCCIONES =====
Eres el arquitecto. Lee el repo a fondo: server/*.js, public/js/**/*.js, public/css/app.css, public/index.html, test/*.test.js, wrangler.jsonc, package.json, PRODUCT.md y README.md. No escribas archivos.

Devuelve un documento llamado CONTRATO, preciso y sin ambigüedades. Lo usarán tres bloques que trabajan a la vez sin verse entre sí, así que todo lo que deban compartir tiene que estar fijado aquí. Estructura obligatoria:

A. ESQUEMA POSTGRES
- SQL completo de supabase/migrations/0001_schema.sql: todas las tablas actuales traducidas, más las nuevas.
  - staff(id, name, active, sort, created_at).
  - product_groups(id, name, sort, created_at).
  - En products: slug único, group_id (FK a product_groups, ON DELETE SET NULL; NULL significa fuera de la selección) y group_order.
  - Eliminar habitual y habitual_order (se migran a grupos).
  - settings.catalog_rev, un contador que sube con cada cambio de catálogo, grupos o personal.
  - `ALTER TABLE … ENABLE ROW LEVEL SECURITY` en todas las tablas, sin políticas.
  - Idempotente (IF NOT EXISTS).
- Qué inserta 0002_seed.sql: catálogo, grupos «Habituales» (19, en orden) y «Resto», personal inicial y ajustes por defecto. Idempotente: no duplica nada si se ejecuta dos veces.
- Tipos:
  - ids integer identity, nunca bigint. postgres.js devuelve bigint y numeric como texto: exige casts ::int / ::float8 en agregados.
  - Fechas: mantener texto ISO como hoy salvo que demuestres que cambiarlas no rompe comparaciones.
  - Las respuestas JSON deben tener exactamente las mismas claves y tipos que hoy, más los añadidos.

B. ADAPTADOR Y SERVICIOS
- Interfaz del adaptador:
  - { all, get, run, batch, tx(fn) }; run devuelve { changes, lastId }, que sale de RETURNING id.
  - Conversión de «?» a $n.
  - server/db-pg.js (postgres.js) y server/db-pglite.js (PGlite, aplica las migraciones al arrancar).
- Traducciones SQLite a Postgres que hay que hacer en services.js: INSERT OR IGNORE, PRAGMA, GROUP_CONCAT, datetime, booleanos, etc. Lístalas con archivo y función.
- Patrón atómico en Postgres para completeLines, deliver, claim, cancel y undo:
  1. Transacción.
  2. SELECT … FOR UPDATE de las líneas implicadas, en orden de id.
  3. La misma escritura condicional de hoy.
  4. changes = 0 → 409.
  Pon el pseudocódigo exacto.

C. API. Para cada endpoint: método, ruta, nivel (staff/manager), cuerpo, respuesta y errores.
- Existentes que cambian:
  - /api/bootstrap añade groups [{id,name,sort}] y staff [{id,name,sort}] (solo activos); los productos añaden slug, group_id y group_order.
  - /api/live añade catalog_rev.
  - POST y PUT /api/products aceptan group_id en lugar de habitual.
- Nuevos:
  - GET /api/staff (todos, también inactivos).
  - POST /api/staff {name}.
  - PUT /api/staff/order {ids}.
  - PUT /api/staff/:id {name?, active?}.
  - POST /api/groups {name}.
  - PUT /api/groups/order {ids}.
  - PUT /api/groups/:id {name}.
  - DELETE /api/groups/:id?move_to=<id|none>.
  - PUT /api/products/order {items:[{id, group_id|null, group_order}]}, atómico y validado.
- Las rutas literales van antes que las de :id.
- Validación: nombres de 1 a 40 caracteres, recortados y únicos sin distinguir mayúsculas.
- Todo cambio del encargado se audita con `by` y sube catalog_rev.

D. FRONTEND
- Forma de state tras bootstrap.
- Cómo se obtiene p.image: public/img/botellas/manifest.json se carga una vez y image = /img/botellas/<slug>.png si el slug está en el manifest.
- Prioridad al pintar: image flotante, luego photo enmarcada, luego silueta.
- Recarga inmediata de bootstrap cuando cambia catalog_rev.
- API de utilidades que interfaz-a debe exponer para interfaz-b:
  - thumb(p, size);
  - toast(msg, kind, {action:{label,onClick}});
  - la silueta;
  - iconos nuevos en icons.js: grip-vertical, arrow-up, arrow-down, folder-plus, user-plus, pencil, trash, bottle.

E. PROPIEDAD DE ARCHIVOS (ningún archivo en dos listas)
- backend: server/**, supabase/**, scripts/db/**, test/**, package.json, package-lock.json, wrangler.jsonc, .dev.vars.example.
- interfaz-a: public/index.html, public/js/main.js, public/js/state.js, public/js/api.js, public/js/ui.js, public/js/icons.js, public/js/views/pedir.js, public/js/views/reponer.js, public/css/app.css. Además, el enlace en index.html a public/css/gestion.css.
- interfaz-b: public/js/views/gestion.js, public/js/views/seleccion.js (nuevo), public/js/views/personal.js (nuevo), public/js/views/catalogo.js, public/css/gestion.css (nuevo).
- recorte: scripts/images/**, assets/**, public/img/botellas/*.png, public/img/botellas/manifest.json, public/img/botellas/CREDITOS.md.
- integracion: todo lo demás (README.md, .gitignore, borrar los .jpg sustituidos y el mapa PHOTOS).
- Revísalo contra el código real. Si algo no encaja, reasigna, pero sin solapes.

F. IMÁGENES
- Convenciones:
  - assets/bruto/<slug>.png: generadas, fondo blanco.
  - public/img/botellas/<slug>.png: final.
  - manifest.json: {"<slug>": {"file":"<slug>.png","model":"gemini-2.5-flash-image","refs":[urls],"confidence":"alta|media","generated_at":"ISO"}}.

G. PLAN DE PRUEBAS
- Qué tests adaptar y cuáles añadir: grupos, orden, personal, catalog_rev, migración de habituales, seed idempotente e import del backup.
- Un test de concurrencia real contra Postgres que solo se ejecuta si existe TEST_DATABASE_URL.

H. RIESGOS Y DECISIONES que tomas tú, justificadas en una línea cada una.
===== FIN =====

────────────────────────────────────────
id: fichas-1 · tipo: IA · proveedor: Gemini · modelo: gemini-2.5-flash · permiso: lectura · título: Fichas visuales · Lote 1 Ginebras
===== INSTRUCCIONES =====
Te toca el LOTE 1 (Ginebras) de la lista del brief.

Para cada producto del lote, busca en la web (google_web_search y web_fetch) la página oficial de la marca y fotos de producto de tiendas fiables, de la expresión exacta. No escribas archivos.

Devuelve un único bloque ```json``` con un array. Cada elemento tiene:
- slug, nombre;
- confidence: "alta" (referencia oficial inequívoca), "media" (varias fuentes coinciden pero hay variantes de diseño) o "baja" (no sabes qué botella es exactamente);
- refs: de 2 a 4 URLs de las imágenes o páginas usadas;
- botella: silueta, hombros, cuello, base, proporción alto/ancho aproximada, relieves;
- vidrio: color y transparencia;
- liquido: color visible;
- tapon: material, color y forma;
- etiquetas: posición, colores, tipografía y los textos EXACTOS que se leen claramente. Solo marca y expresión; lo que no se lea con seguridad se escribe "no legible". Nunca inventes texto.
- distintivos: malla, sello, cordón, grabados…;
- image_url_referencia: la URL directa (.jpg/.png/.webp) de la mejor foto frontal si la encuentras;
- prompt: en inglés, para Nano Banana, con esta plantilla rellenada con los datos de la ficha:
  "Professional studio product photograph of a single bottle of <nombre exacto>, <botella>, <vidrio>, <liquido>, <tapon>, <etiquetas con textos exactos>, <distintivos>. Front view at label height, entire bottle visible including cap and base, centered, bottle fills 90% of frame height, portrait 3:4. Pure white seamless background (#FFFFFF), soft even lighting, gentle reflections, no cast shadow, no props, no hands, no extra text, photorealistic, ultra sharp label."

Reglas:
- Productos [?]: usa "baja" salvo que una referencia sea inequívoca para lo que se describe. Si la variante es dudosa, describe la más probable y anótalo en "nota".
- old-old-sport: confidence "baja" y sin prompt.
- Termina con una línea: «RESUMEN: N fichas, A alta, M media, B baja».
===== FIN =====

────────────────────────────────────────
id: fichas-2 · tipo: IA · proveedor: Gemini · modelo: gemini-2.5-flash · permiso: lectura · título: Fichas visuales · Lote 2 Vodkas y whiskies
===== INSTRUCCIONES =====
Te toca el LOTE 2 (Vodkas y whiskies) de la lista del brief.

Para cada producto del lote, busca en la web (google_web_search y web_fetch) la página oficial de la marca y fotos de producto de tiendas fiables, de la expresión exacta. No escribas archivos.

Devuelve un único bloque ```json``` con un array. Cada elemento tiene:
- slug, nombre;
- confidence: "alta" (referencia oficial inequívoca), "media" (varias fuentes coinciden pero hay variantes de diseño) o "baja" (no sabes qué botella es exactamente);
- refs: de 2 a 4 URLs de las imágenes o páginas usadas;
- botella: silueta, hombros, cuello, base, proporción alto/ancho aproximada, relieves;
- vidrio: color y transparencia;
- liquido: color visible;
- tapon: material, color y forma;
- etiquetas: posición, colores, tipografía y los textos EXACTOS que se leen claramente. Solo marca y expresión; lo que no se lea con seguridad se escribe "no legible". Nunca inventes texto.
- distintivos: malla, sello, cordón, grabados…;
- image_url_referencia: la URL directa (.jpg/.png/.webp) de la mejor foto frontal si la encuentras;
- prompt: en inglés, para Nano Banana, con esta plantilla rellenada con los datos de la ficha:
  "Professional studio product photograph of a single bottle of <nombre exacto>, <botella>, <vidrio>, <liquido>, <tapon>, <etiquetas con textos exactos>, <distintivos>. Front view at label height, entire bottle visible including cap and base, centered, bottle fills 90% of frame height, portrait 3:4. Pure white seamless background (#FFFFFF), soft even lighting, gentle reflections, no cast shadow, no props, no hands, no extra text, photorealistic, ultra sharp label."

Reglas:
- Productos [?]: usa "baja" salvo que una referencia sea inequívoca para lo que se describe. Si la variante es dudosa, describe la más probable y anótalo en "nota".
- Cîroc: cada sabor tiene su propio color de detalle; no los confundas.
- Termina con una línea: «RESUMEN: N fichas, A alta, M media, B baja».
===== FIN =====

────────────────────────────────────────
id: fichas-3 · tipo: IA · proveedor: Gemini · modelo: gemini-2.5-flash · permiso: lectura · título: Fichas visuales · Lote 3 Rones y tequila
===== INSTRUCCIONES =====
Te toca el LOTE 3 (Rones y tequila) de la lista del brief.

Para cada producto del lote, busca en la web (google_web_search y web_fetch) la página oficial de la marca y fotos de producto de tiendas fiables, de la expresión exacta. No escribas archivos.

Devuelve un único bloque ```json``` con un array. Cada elemento tiene:
- slug, nombre;
- confidence: "alta" (referencia oficial inequívoca), "media" (varias fuentes coinciden pero hay variantes de diseño) o "baja" (no sabes qué botella es exactamente);
- refs: de 2 a 4 URLs de las imágenes o páginas usadas;
- botella: silueta, hombros, cuello, base, proporción alto/ancho aproximada, relieves;
- vidrio: color y transparencia;
- liquido: color visible;
- tapon: material, color y forma;
- etiquetas: posición, colores, tipografía y los textos EXACTOS que se leen claramente. Solo marca y expresión; lo que no se lea con seguridad se escribe "no legible". Nunca inventes texto.
- distintivos: malla, sello, cordón, grabados…;
- image_url_referencia: la URL directa (.jpg/.png/.webp) de la mejor foto frontal si la encuentras;
- prompt: en inglés, para Nano Banana, con esta plantilla rellenada con los datos de la ficha:
  "Professional studio product photograph of a single bottle of <nombre exacto>, <botella>, <vidrio>, <liquido>, <tapon>, <etiquetas con textos exactos>, <distintivos>. Front view at label height, entire bottle visible including cap and base, centered, bottle fills 90% of frame height, portrait 3:4. Pure white seamless background (#FFFFFF), soft even lighting, gentle reflections, no cast shadow, no props, no hands, no extra text, photorealistic, ultra sharp label."

Reglas:
- Productos [?]: usa "baja" salvo que una referencia sea inequívoca para lo que se describe. Si la variante es dudosa, describe la más probable y anótalo en "nota".
- brugal-anejo lleva la malla característica.
- old-old-sport: confidence "baja" y sin prompt.
- Termina con una línea: «RESUMEN: N fichas, A alta, M media, B baja».
===== FIN =====

────────────────────────────────────────
id: backend · tipo: IA · proveedor: Codex · modelo: luna (o el Codex por defecto si no existe) · permiso: escritura · título: Base de datos y API (Supabase)
===== INSTRUCCIONES =====
Implementa la parte de servidor según el CONTRATO que recibes del arquitecto. Solo tocas los archivos de «backend» de la sección E.

Tareas:
1. `npm install postgres @electric-sql/pglite`. Quita wrangler solo si el contrato lo dice; lo normal es que se quede como devDependency.
2. supabase/migrations/0001_schema.sql y 0002_seed.sql, exactamente como la sección A.
   - Idempotentes, con RLS activado en todas las tablas y sin políticas.
   - La semilla genera el catálogo desde los mismos datos que server/catalog.js. Para no mantener dos copias, genera 0002 con un script (scripts/db/build-seed.mjs) y deja el .sql resultante en el repo.
3. server/db-pg.js (postgres.js, prepare:false, max 1 conexión por petición en el Worker, cierre con ctx.waitUntil) y server/db-pglite.js (aplica las migraciones al arrancar). Los dos con la interfaz de la sección B.
   - server/worker.js usa db-pg con env.DATABASE_URL.
   - server/index.js usa db-pg si existe DATABASE_URL y, si no, PGlite en ./data/pglite.
   - Borra db-d1.js y db-node.js y el binding D1 de wrangler.jsonc. Añade nodejs_compat.
4. services.js y handler.js:
   - Traduce el SQL a Postgres.
   - Aplica el patrón atómico con SELECT … FOR UPDATE en completeLines, deliver, claim, cancel y undo.
   - Implementa los endpoints de la sección C: grupos, personal, orden y catalog_rev.
   - Sustituye habitual por grupos.
   - ensureSchema ya no crea tablas en producción: comprueba que existen y, si faltan, responde 503 con «Faltan las migraciones de Supabase».
5. scripts/db/import-backup.mjs <backup.json>:
   - Lee DATABASE_URL e importa la copia de /api/backup en una transacción, respetando ids.
   - Ajusta las secuencias identity con setval.
   - Convierte habitual/habitual_order en grupos.
   - Es idempotente: si ya hay datos, aborta con un mensaje claro salvo que se pase --force.
6. .dev.vars.example con DATABASE_URL=, STAFF_CODE= y MANAGER_PIN= vacíos.
7. Tests, que pasan con PGlite:
   - adapta los existentes;
   - añade los de la sección G;
   - añade el test de concurrencia real, que se salta si no hay TEST_DATABASE_URL.
   - `npm test` tiene que acabar en verde. Pega el resumen final de la salida.

Prohibido: conectarse a Supabase, desplegar, hacer push o commit. No toques public/.

Informe final: archivos, decisiones, salida de npm test y PETICIONES PARA INTEGRACIÓN.
===== FIN =====

────────────────────────────────────────
id: interfaz-a · tipo: IA · proveedor: Claude · modelo: Sonnet · permiso: escritura · título: Interfaz A · acceso, personal al entrar, Pedir y botellas flotantes
===== INSTRUCCIONES =====
Implementa tu parte del frontend según el CONTRATO. Solo tocas los archivos de «interfaz-a» de la sección E. Antes de empezar, lee PRODUCT.md y public/css/app.css para respetar el estilo.

1. Selector de personal (public/js/main.js) en lugar de askWho:
   - Diálogo «¿Quién eres?» con un botón grande por cada nombre activo de state.staff, en su orden.
   - Pulsar un nombre lo guarda en el dispositivo y cierra el diálogo.
   - «Ahora no» cierra sin guardar. Sale solo la primera vez y después desde el botón de arriba a la derecha.
   - Si el nombre guardado ya no está en la lista activa, se borra y se vuelve a preguntar una vez.
   - Si la lista está vacía, se ofrece escribir el nombre como hoy.
   - Accesible: foco en el primer nombre, Esc cierra.
2. state.js y main.js:
   - Guardan groups y staff de bootstrap.
   - Cargan public/img/botellas/manifest.json una vez (si falla, sigue sin imágenes) y rellenan p.image.
   - Recargan bootstrap en cuanto /api/live trae un catalog_rev distinto.
3. ui.js:
   - thumb(p, size) con la prioridad del contrato:
     - PNG: `<span class="thumb float">`, object-fit: contain, sin fondo ni borde, con `filter: drop-shadow(...)` suave, que funcione en claro y oscuro;
     - foto subida: el recuadro actual;
     - sin imagen: silueta SVG de botella en tono neutro según categoría.
   - Tamaños iguales a los actuales para no mover la maqueta.
   - toast con acción opcional {label, onClick} (por ejemplo, «Deshacer»).
   - icons.js: añade los iconos del contrato, con los trazados reales de Lucide.
4. pedir.js: secciones = grupos en su orden, con productos por group_order. Sin grupos vacíos. Los productos con group_id nulo no salen. La búsqueda recorre toda la selección respetando ese orden. Las etiquetas «Dudoso», «N pend.» y «Agotado» se quedan como están.
5. reponer.js: solo adapta las miniaturas a thumb nuevo. El flujo compacto con «Hecho» no cambia.
6. app.css: estilos de .thumb.float y de la silueta. Añade en index.html el `<link rel="stylesheet" href="/css/gestion.css">`.
7. Comprueba con `node --check` cada archivo JS que toques. Si hay Playwright y Chromium, arranca la app (`npm start`) y haz capturas a 390 px de «Pedir» y del selector de personal en claro y oscuro; guárdalas en assets/capturas/.

No toques gestion.js, seleccion.js, personal.js, catalogo.js ni gestion.css (son de interfaz-b), ni server/. Sin commit ni push.

Informe final: archivos, la API exacta que expones (thumb, toast, iconos), capturas y PETICIONES PARA INTEGRACIÓN.
===== FIN =====

────────────────────────────────────────
id: interfaz-b · tipo: IA · proveedor: Claude · modelo: Sonnet · permiso: escritura · título: Interfaz B · Gestión · Selección y Personal
===== INSTRUCCIONES =====
Implementa las pestañas nuevas de Gestión según el CONTRATO. Solo tocas los archivos de «interfaz-b» de la sección E. Usa la API de ui.js que fija el contrato (thumb, toast con acción, iconos nuevos) aunque interfaz-a la esté escribiendo a la vez. Lee PRODUCT.md y public/css/app.css para respetar el estilo.

1. gestion.js: añade las pestañas «Selección» y «Personal» justo detrás de «Informes».

2. seleccion.js, pestaña «Selección». Debe ser útil e intuitiva en un móvil con una mano.
   - Grupos:
     - Cada grupo es una sección con cabecera: nombre, recuento, botones ↑ y ↓ para mover el grupo, y un menú con «Renombrar» y «Borrar grupo».
     - Al borrar, un diálogo pregunta a dónde van sus botellas: a otro grupo o fuera de la selección.
     - Botón «Nuevo grupo».
   - Botellas: cada fila tiene thumb flotante, nombre, asa de arrastre y menú (…) con «Subir», «Bajar», «Mover a grupo…» y «Quitar de la selección».
   - Arrastrar y soltar con pointer events:
     - en táctil, pulsación larga de unos 250 ms en el asa y vibración corta;
     - hueco visible donde caerá;
     - autodesplazamiento cerca de los bordes;
     - soltar sobre otro grupo mueve la botella a ese grupo;
     - Esc o soltar fuera cancela.
     - Todo lo que se hace arrastrando se puede hacer también con los botones o el menú (accesibilidad).
   - Sección final «Fuera de la selección»: productos activos sin grupo, con buscador y botón «Añadir a…» que abre la elección de grupo.
   - Guardado optimista:
     - Aplicas el cambio en pantalla y envías PUT /api/products/order solo con los grupos afectados, o el endpoint de grupos que toque.
     - Toast «Guardado» con «Deshacer», que envía el orden anterior.
     - Si falla, se revierte y sale el error.
   - Estados vacíos claros («Este grupo está vacío: arrastra botellas aquí o usa Mover a grupo»).

3. personal.js, pestaña «Personal»:
   - lista de nombres con ↑ y ↓, «Renombrar» y «Quitar»; quitar desactiva, con confirmación, y el nombre sigue en el histórico;
   - sección plegada «Retirados» con «Volver a activar»;
   - campo «Añadir persona» con validación (1 a 40 caracteres, sin repetidos);
   - una línea de ayuda: «Estos nombres aparecen al abrir la app para elegir quién la usa».

4. catalogo.js: sustituye la casilla «Habitual» por un selector «Grupo» (con la opción «Fuera de la selección») y la etiqueta Habitual por el nombre del grupo. El resto no cambia.

5. gestion.css: todos los estilos nuevos, con los tokens de app.css, en modo claro y oscuro, con objetivos táctiles de al menos 44 px y sin desbordes a 390 px.

6. `node --check` en cada archivo que toques. Si hay Playwright, haz capturas a 390 px de Selección (incluido un arrastre a medias) y de Personal en assets/capturas/.

No toques main.js, state.js, ui.js, icons.js, app.css, index.html, pedir.js, reponer.js ni server/. Sin commit ni push.

Informe final: archivos, cómo se usa cada pantalla y PETICIONES PARA INTEGRACIÓN.
===== FIN =====

────────────────────────────────────────
id: imagenes-1 · tipo: IA · proveedor: Gemini · modelo: gemini-2.5-pro · permiso: escritura · título: Generación de imágenes · Lote 1 Ginebras
===== INSTRUCCIONES =====
Recibes las fichas del LOTE 1. Generas las imágenes con la extensión Nano Banana (modelo gemini-2.5-flash-image).

Para cada ficha con confidence "alta" o "media":
1. Si hay image_url_referencia, descárgala con `curl -L --max-time 20` en assets/referencias/<slug>.<ext>. Úsala como imagen de entrada de la edición de Nano Banana, pidiendo: "Re-photograph this exact bottle as a professional studio packshot: " + prompt de la ficha. Si la descarga falla, genera solo con el prompt de la ficha.
2. Mueve el resultado a assets/bruto/<slug>.png (crea las carpetas si no existen).
3. Abre la imagen y compárala con la ficha:
   - botella entera, con tapón y base dentro;
   - fondo blanco liso;
   - una sola botella;
   - forma y colores correctos;
   - textos de etiqueta iguales a los de la ficha, sin letras inventadas o deformes.
   Si falla algo, haz UN único reintento corrigiendo el prompt. Si vuelve a fallar, borra el archivo y márcala como fallida.

Las fichas "baja" no se generan (se quedarán con la silueta). No toques nada fuera de assets/.

Devuelve una tabla con slug, estado (ok | reintentada-ok | fallida | omitida-baja), archivo, confidence, refs y nota.
Después, el mismo contenido en un bloque ```json``` [{slug, status, file, confidence, refs, note}].
===== FIN =====

────────────────────────────────────────
id: imagenes-2 · tipo: IA · proveedor: Gemini · modelo: gemini-2.5-pro · permiso: escritura · título: Generación de imágenes · Lote 2 Vodkas y whiskies
===== INSTRUCCIONES =====
Recibes las fichas del LOTE 2. Generas las imágenes con la extensión Nano Banana (modelo gemini-2.5-flash-image).

Para cada ficha con confidence "alta" o "media":
1. Si hay image_url_referencia, descárgala con `curl -L --max-time 20` en assets/referencias/<slug>.<ext>. Úsala como imagen de entrada de la edición de Nano Banana, pidiendo: "Re-photograph this exact bottle as a professional studio packshot: " + prompt de la ficha. Si la descarga falla, genera solo con el prompt de la ficha.
2. Mueve el resultado a assets/bruto/<slug>.png (crea las carpetas si no existen).
3. Abre la imagen y compárala con la ficha:
   - botella entera, con tapón y base dentro;
   - fondo blanco liso;
   - una sola botella;
   - forma y colores correctos;
   - textos de etiqueta iguales a los de la ficha, sin letras inventadas o deformes.
   Si falla algo, haz UN único reintento corrigiendo el prompt. Si vuelve a fallar, borra el archivo y márcala como fallida.

Las fichas "baja" no se generan (se quedarán con la silueta). No toques nada fuera de assets/.

Devuelve una tabla con slug, estado (ok | reintentada-ok | fallida | omitida-baja), archivo, confidence, refs y nota.
Después, el mismo contenido en un bloque ```json``` [{slug, status, file, confidence, refs, note}].
===== FIN =====

────────────────────────────────────────
id: imagenes-3 · tipo: IA · proveedor: Gemini · modelo: gemini-2.5-pro · permiso: escritura · título: Generación de imágenes · Lote 3 Rones y tequila
===== INSTRUCCIONES =====
Recibes las fichas del LOTE 3. Generas las imágenes con la extensión Nano Banana (modelo gemini-2.5-flash-image).

Para cada ficha con confidence "alta" o "media":
1. Si hay image_url_referencia, descárgala con `curl -L --max-time 20` en assets/referencias/<slug>.<ext>. Úsala como imagen de entrada de la edición de Nano Banana, pidiendo: "Re-photograph this exact bottle as a professional studio packshot: " + prompt de la ficha. Si la descarga falla, genera solo con el prompt de la ficha.
2. Mueve el resultado a assets/bruto/<slug>.png (crea las carpetas si no existen).
3. Abre la imagen y compárala con la ficha:
   - botella entera, con tapón y base dentro;
   - fondo blanco liso;
   - una sola botella;
   - forma y colores correctos;
   - textos de etiqueta iguales a los de la ficha, sin letras inventadas o deformes.
   Si falla algo, haz UN único reintento corrigiendo el prompt. Si vuelve a fallar, borra el archivo y márcala como fallida.

Las fichas "baja" no se generan (se quedarán con la silueta). No toques nada fuera de assets/.

Devuelve una tabla con slug, estado (ok | reintentada-ok | fallida | omitida-baja), archivo, confidence, refs y nota.
Después, el mismo contenido en un bloque ```json``` [{slug, status, file, confidence, refs, note}].
===== FIN =====

────────────────────────────────────────
id: union-imagenes · tipo: Merge · título: Unión de lotes de imágenes
(Junta las salidas de imagenes-1, imagenes-2 e imagenes-3, en ese orden.)

────────────────────────────────────────
id: recorte · tipo: IA · proveedor: Codex · modelo: luna (o el Codex por defecto si no existe) · permiso: escritura · título: Recorte, transparencia y optimización
===== INSTRUCCIONES =====
Recibes los informes de los tres lotes de imágenes y el CONTRATO (sección F). Solo tocas los archivos de «recorte» de la sección E.

1. Entorno de Python fuera del repo: `python3 -m venv ~/.cache/vessel-img && ~/.cache/vessel-img/bin/pip install "rembg[cpu]" pillow`. Deja las dependencias escritas en scripts/images/requirements.txt.

2. scripts/images/process.py hace esto para cada assets/bruto/<slug>.png:
   1. Quita el fondo con rembg (modelo isnet-general-use; si el borde queda sucio, alpha_matting=True).
   2. Elimina el halo blanco de los bordes: erosión de alfa de 1 px y descontaminación del color.
   3. Recorta al contorno del canal alfa.
   4. Escala manteniendo la proporción para que la botella mida el 94 % de 683 px de alto, sin pasar del 90 % de 512 px de ancho.
   5. Centra la imagen en horizontal sobre un lienzo transparente de 512×683 px, con la base a la misma altura en todas.
   6. Guarda en public/img/botellas/<slug>.png optimizado. Si pasa de 150 KB, cuantiza a 256 colores conservando el alfa.
   7. Escribe public/img/botellas/manifest.json con el formato de la sección F, usando refs y confidence de los informes.
   8. Genera assets/revision.png: una hoja de contactos con cada botella sobre fondo de cuadros, sobre blanco y sobre #111214, y su slug debajo, para detectar halos.

3. Ejecútalo y revisa el resultado. Si alguna queda cortada, con restos de fondo o deforme, corrígela ajustando parámetros para ese slug (en un diccionario de ajustes dentro del script). No regeneres nada.

4. CREDITOS.md: añade una sección «Imágenes generadas con IA (Gemini)» que diga que son representaciones generadas a partir de referencias públicas y no fotografías reales, y enumere los slugs.

Sin commit ni push.

Informe final: tabla slug → KB, estado y ajustes; slugs sin imagen (fallidas u omitidas); y dónde está revision.png.
===== FIN =====

────────────────────────────────────────
id: union-codigo · tipo: Merge · título: Unión de código e imágenes
(Junta las salidas de backend, interfaz-a, interfaz-b y recorte, en ese orden.)

────────────────────────────────────────
id: integracion · tipo: IA · proveedor: Claude · modelo: Opus · permiso: escritura · título: Integración y pruebas
===== INSTRUCCIONES =====
Recibes el CONTRATO y los informes de backend, interfaz-a, interfaz-b y recorte. Todo su trabajo ya está en la carpeta. Tu trabajo es que funcione de punta a punta.

1. Lee `git status` y `git diff`. Atiende cada «PETICIÓN PARA INTEGRACIÓN». Comprueba que interfaz-a e interfaz-b usan la misma API: thumb, toast con acción, iconos y forma de state. Comprueba también que el frontend coincide con los endpoints y respuestas reales de handler.js.

2. Limpieza:
   - Borra los .jpg de public/img/botellas/ que tengan ya su PNG.
   - Borra de server/catalog.js las entradas de PHOTOS que apunten a jpg borrados; si el mapa queda vacío, bórralo entero.
   - Actualiza CREDITOS.md.
   - En .gitignore añade assets/, data/ y .dev.vars.
   - Busca y elimina restos de habitual, D1 y node:sqlite.

3. Pruebas:
   - `npm install`, luego `npm test` en verde.
   - `node --check` en todos los .js de public/js.
   - Arranca `npm start`, que usará PGlite, y prueba con curl usando un STAFF_CODE y un MANAGER_PIN de prueba solo en variables de entorno de esta shell:
     - auth;
     - bootstrap con groups (Habituales con 19 en orden y Resto) y staff (Carlos, Sergio, Alejandro);
     - pedir 3 botellas, completar con «Hecho» y enviar dos «Hecho» simultáneos a la misma línea (uno 200 y otro 409);
     - crear, renombrar, ordenar y borrar un grupo (moviendo sus botellas);
     - PUT /api/products/order;
     - dar de alta, ordenar y desactivar a una persona;
     - comprobar que catalog_rev sube;
     - /api/backup y luego scripts/db/import-backup.mjs contra una PGlite nueva, si el script lo permite.
   - Si hay Playwright y Chromium, a 390 px en claro y oscuro: entrar, elegir persona, pedir, reponer, Gestión → Selección (mover una botella entre grupos) y Personal. Capturas en assets/capturas/.

4. README.md: sección nueva «Pasar a Supabase», paso a paso para alguien no técnico:
   1. Crear el proyecto en Supabase.
   2. Ejecutar 0001 y luego 0002 en el SQL Editor, o usar `supabase db push`.
   3. Copiar la URI del pooler en modo Transaction (puerto 6543).
   4. `npx wrangler secret put DATABASE_URL`.
   5. Antes de desplegar, descargar la copia en la app actual (Gestión → Ajustes → copia de seguridad).
   6. `DATABASE_URL=… node scripts/db/import-backup.mjs copia.json`.
   7. `npx wrangler deploy`.
   8. Comprobar la app.
   9. Cómo volver atrás.
   Actualiza también la sección de desarrollo local (PGlite) y la de tests.

5. Sin commit ni push.

Informe final: qué has cambiado, salida de npm test, resultado de cada prueba de curl (sin secretos) y lista de lo que no has podido verificar.
===== FIN =====

────────────────────────────────────────
id: rev-backend · tipo: IA · proveedor: Codex · modelo: luna (o el Codex por defecto si no existe) · permiso: lectura · título: Revisión de servidor y base de datos
===== INSTRUCCIONES =====
Revisa en modo solo lectura server/**, supabase/**, scripts/db/**, test/** y wrangler.jsonc contra el CONTRATO. Busca bugs reales, no gustos:
- SQL inyectable;
- carreras y doble conteo: SELECT … FOR UPDATE y orden de bloqueo en completeLines, deliver, claim, cancel y undo;
- transacciones mal cerradas;
- conexiones sin cerrar en el Worker;
- prepare:false;
- tipos que vuelven como texto (bigint o numeric);
- RLS sin activar en alguna tabla;
- migraciones o seed no idempotentes;
- setval tras el import;
- validaciones que faltan en order, grupos y personal (ids inexistentes, grupos de otro lado, nombres duplicados);
- rutas :id que capturan rutas literales;
- auditoría y catalog_rev;
- secretos en el código;
- tests que no prueban lo que dicen.

Para cada hallazgo: severidad (BLOQUEANTE / IMPORTANTE / MENOR), archivo:línea, qué falla con un ejemplo concreto y el arreglo exacto. Sin hallazgos inventados. Si todo está bien, dilo.
===== FIN =====

────────────────────────────────────────
id: rev-ux · tipo: IA · proveedor: Claude · modelo: Sonnet · permiso: lectura · título: Revisión de interfaz y usabilidad
===== INSTRUCCIONES =====
Revisa en modo solo lectura public/** y las capturas de assets/capturas/ si existen, contra el brief, PRODUCT.md y el CONTRATO. Piensa en el personal de barra con prisa, una mano y poca luz, y en el encargado ordenando la selección desde el móvil.

Comprueba:
- el selector de personal (se puede cerrar, recuerda el nombre, no molesta);
- Pedir por grupos;
- Selección: arrastre táctil real, alternativas sin arrastre, deshacer, estados vacíos, borrar grupo, fuera de la selección;
- Personal;
- botellas flotantes (sombra en oscuro, silueta sin imagen, tamaños coherentes);
- objetivos táctiles de al menos 44 px;
- contraste en claro y oscuro;
- desbordes a 390 px;
- foco, etiquetas y Esc;
- CSP (nada inline);
- textos en español claros, sin jerga técnica;
- que Reponer no haya cambiado de comportamiento.

Para cada hallazgo: severidad (BLOQUEANTE / IMPORTANTE / MENOR), archivo:línea, qué ve el usuario y el arreglo exacto. Sin hallazgos inventados.
===== FIN =====

────────────────────────────────────────
id: rev-imagenes · tipo: IA · proveedor: Gemini · modelo: gemini-2.5-pro · permiso: lectura · título: Revisión de imágenes
===== INSTRUCCIONES =====
Abre assets/revision.png y cada public/img/botellas/*.png. Lee public/img/botellas/manifest.json y los nombres de producto del brief.

Para cada slug, di si la imagen es aceptable para reconocer la botella de un vistazo en un móvil. Comprueba:
- que es el producto correcto (forma, colores, tapón);
- textos de etiqueta inventados o deformes;
- halo o restos de fondo;
- partes cortadas;
- tamaño o alineación distintos del resto;
- aspecto de dibujo o poco realista.

Si hace falta, busca en la web la referencia oficial para comparar.

Devuelve un bloque ```json``` [{slug, veredicto: "mantener" | "quitar", motivo}]. «Quitar» significa que se borrará y se usará la silueta, así que solo para errores claros de producto, texto o recorte. No escribas archivos.
===== FIN =====

────────────────────────────────────────
id: union-revision · tipo: Merge · título: Unión de integración y revisiones
(Junta las salidas de integracion, rev-backend, rev-ux y rev-imagenes, en ese orden.)

────────────────────────────────────────
id: correcciones · tipo: IA · proveedor: Claude · modelo: Opus · permiso: escritura · título: Correcciones finales y commit
===== INSTRUCCIONES =====
Recibes el informe de integración y las tres revisiones.

1. Verifica cada hallazgo contra el código. Arregla todos los BLOQUEANTES e IMPORTANTES que sean reales, y los MENORES triviales. Si descartas uno, explica por qué en una línea.
2. Imágenes marcadas «quitar»: borra el PNG y su entrada en manifest.json y CREDITOS.md.
3. Vuelve a pasar `npm test`, `node --check` en public/js y las pruebas de curl de integración que afecten a lo que has tocado. Todo en verde.
4. `git add -A`. Comprueba que no entran assets/, data/, .dev.vars, node_modules ni secretos. Haz UN commit en la rama actual con el mensaje «Supabase, selección editable, personal y botellas en PNG» y un cuerpo con viñetas de lo principal. Sin push.
5. Informe final para el dueño del proyecto, en español llano:
   - qué hace ahora la app;
   - cómo se usa Selección y Personal;
   - pasos siguientes (remitir a la sección «Pasar a Supabase» del README);
   - imágenes incluidas y cuáles quedan con silueta;
   - lo que no se ha podido verificar;
   - preguntas abiertas: los productos «por confirmar», las dos botellas sin identificar (la verde a la derecha del J&B y la de ron con malla, posible duplicado de Brugal Añejo) y Old / Old Sport.
===== FIN =====

────────────────────────────────────────
id: salida · tipo: Salida · título: Resultado
(Muestra el informe final de correcciones.)

CONEXIONES (origen → destino)
1. brief → arquitecto
2. brief → fichas-1
3. brief → fichas-2
4. brief → fichas-3
5. brief → backend
6. brief → interfaz-a
7. brief → interfaz-b
8. brief → imagenes-1
9. brief → imagenes-2
10. brief → imagenes-3
11. brief → recorte
12. brief → integracion
13. brief → rev-backend
14. brief → rev-ux
15. brief → rev-imagenes
16. brief → correcciones
17. arquitecto → backend
18. arquitecto → interfaz-a
19. arquitecto → interfaz-b
20. arquitecto → recorte
21. arquitecto → integracion
22. arquitecto → rev-backend
23. arquitecto → rev-ux
24. fichas-1 → imagenes-1
25. fichas-2 → imagenes-2
26. fichas-3 → imagenes-3
27. imagenes-1 → union-imagenes
28. imagenes-2 → union-imagenes
29. imagenes-3 → union-imagenes
30. union-imagenes → recorte
31. backend → union-codigo
32. interfaz-a → union-codigo
33. interfaz-b → union-codigo
34. recorte → union-codigo
35. union-codigo → integracion
36. integracion → rev-backend
37. integracion → rev-ux
38. integracion → rev-imagenes
39. integracion → union-revision
40. rev-backend → union-revision
41. rev-ux → union-revision
42. rev-imagenes → union-revision
43. union-revision → correcciones
44. correcciones → salida

COMPROBACIÓN ANTES DE DEVOLVER EL JSON
- 21 bloques: 1 Entrada, 16 IA, 3 Merge, 1 Salida. 44 conexiones.
- Sin ciclos: todas las conexiones van de una fase a otra posterior.
- Concurrencia máxima 6: 3 bloques de código y 3 carriles de imágenes, que son cadenas.
- Todas las instrucciones copiadas completas y literales.
