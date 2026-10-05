# Flujo de Orquesta: imágenes que faltan y nueva «Pedir → Nevera»

Copia **todo lo que hay debajo de la línea** y pégalo en «Crear con IA».

Antes de ejecutar el flujo:

- Carpeta de trabajo: `C:\Users\mrani\inventariovessel`, en la rama `claude/happy-rubin-z4fac5` con
  `git pull` hecho. Esa rama ya trae lo demás del documento de cambios: Barra VIP, Reponer por
  partes, sin zoom, sin buscador en Chupitería y los 3 refrescos en «Otros». Nunca en `main`.
- La remodelación de Codex «Vessel-Chupiteria-y-Nevera» tiene que estar dentro de
  `C:\Users\mrani\inventariovessel`, como carpeta, ZIP, rama o worktree.
- Las fotos de las cajas de refrescos están en
  `C:\Users\mrani\OneDrive - MARINA DE EMPRESAS\VESSEL\IMAGENES`. OneDrive debe tenerlas
  descargadas («Mantener siempre en este dispositivo»).
- Codex necesita su herramienta de generación de imágenes («openai-imagegen» en el manifest).
  Python 3.10 o superior para `scripts/images/process.py`.

---

Crea un flujo llamado «Vessel · Imágenes que faltan y Pedir → Nevera». Sigue esta especificación al pie
de la letra.

REGLAS PARA CONSTRUIR EL FLUJO
1. Crea exactamente los 10 bloques listados, con el id, tipo, proveedor, modelo, permiso y título indicados.
2. Las instrucciones de cada bloque son el texto entre «===== INSTRUCCIONES =====» y «===== FIN =====».
   Cópialas literalmente y completas: no las resumas, traduzcas, reordenes ni añadas nada.
3. Crea exactamente las conexiones de la sección CONEXIONES y ninguna más. Si Orquesta exige un Merge para
   que un bloque reciba varias entradas, añade un Merge por cada bloque destino que lo necesite, sin cambiar
   nada más.
4. Sin bucles ni reintentos entre bloques.
5. Los bloques de «lectura» no escriben archivos. Los de «escritura» sí pueden escribir y ejecutar comandos
   en la carpeta de trabajo.

ESTRUCTURA
- Fase 0. «brief» (Entrada): contexto común. Se conecta a todos los bloques IA.
- Fase 1, a la vez y sobre archivos distintos:
  · «botellas» (Codex): imágenes de Fireball y de las 5 cervezas especiales, una unidad cada una.
  · «cajas» (Codex): imágenes de las cajas de refrescos a partir de las fotos de OneDrive.
  · «nevera-plan» (Claude Opus, lectura): localiza la remodelación de Codex y escribe el contrato para
    portarla.
- Fase 2. «nevera» (Codex): implementa la nueva «Pedir → Nevera» según el contrato.
- Fase 3. «union» (Merge) → «integracion» (Codex): tests, recorrido y capturas.
- Fase 4. «revision» (Claude Opus, lectura): revisa imágenes y pantallas.
- Fase 5. «cierre» (Codex): aplica la revisión, tests, commit y push a la rama actual. Luego «salida».

BLOQUES

────────────────────────────────────────
id: brief · tipo: Entrada · título: Brief común
===== INSTRUCCIONES =====
PROYECTO: «Vessel · Reposición», web app de reposición e inventario de una discoteca. El repositorio es la
carpeta de trabajo actual, en la rama claude/happy-rubin-z4fac5. HTML/CSS/JS sin build en public/ (vistas
en public/js/views/, estilos en public/css/), servidor Node en server/, migraciones en
supabase/migrations/. Tests: `npm test`. La pestaña «Pedir» tiene secciones (Alcohol, Nevera,
Chupitería, Refrescos y Otros); Chupitería ya se pide tocando una nevera vista desde arriba
(public/js/views/nevera.js, imágenes en public/img/nevera/, scripts en scripts/nevera/).

QUÉ HAY QUE HACER
1. Imágenes de catálogo que faltan (las que salen en las tarjetas de Pedir y en Reponer):
   a. Fireball y las 5 cervezas especiales: 1906 Reserva Especial (1906-reserva-especial), B.Lemon
      (b-lemon), Desperados (desperados), Estrella Galicia 0,0 (estrella-galicia-0-0) y Estrella Galicia
      sin gluten (estrella-galicia-sin-gluten). Fireball es fireball. Cada imagen es UNA SOLA UNIDAD
      (un botellín o una botella), nunca un grupo.
   b. Refrescos: se reponen por cajas, así que cada uno se muestra con la foto de SU CAJA, no con una
      botella. Las fotos están en C:\Users\mrani\OneDrive - MARINA DE EMPRESAS\VESSEL\IMAGENES.
      Productos que se piden por caja y son refresco o zumo: pepsi, pepsi-zero, 7up, schweppes-limon,
      schweppes-naranja, schweppes-tonica, schweppes-tonica-zero, schweppes-fresa, perrier,
      zumo-de-naranja, zumo-de-melocoton y zumo-de-pina. Si en esa carpeta hay cajas de otros productos
      del catálogo (red-bull, red-bull-sugarfree, agua-cabreiroa-33-cl), úsalas también. schweppes-tonica
      tiene ahora una botella: se sustituye por su caja si está la foto.
2. «Pedir → Nevera» cambia de diseño: una vista como la de Chupitería, con los productos de la nevera
   dibujados y pidiéndose tocándolos. Codex ya preparó una remodelación llamada
   «Vessel-Chupiteria-y-Nevera», dentro de C:\Users\mrani\inventariovessel (carpeta, ZIP, rama o
   worktree). Esa versión es la REFERENCIA del diseño.

FORMATO OBLIGATORIO DE LAS IMÁGENES DE CATÁLOGO (igual que las de public/img/botellas/*.png)
- public/img/botellas/<slug>.png: PNG con fondo transparente, 512×683 px, menos de 150 KB, con
  scripts/images/process.py.
- Una sola unidad, de frente, entera, centrada, al 94 % de la altura del lienzo y con la base a la misma
  altura que las actuales. Una caja apaisada ocupa como mucho el 94 % del ancho y apoya en la misma base.
- Foto de estudio realista: luz suave y uniforme, sin sombra proyectada, sin reflejo en el suelo, sin
  manos, sin atrezo y sin texto añadido. Referencia de estilo: larios-12.png, j-b-rare.png,
  brugal-anejo.png y cutty-sark.png.
- public/img/botellas/manifest.json: "<slug>": { "file": "<slug>.png", "model": "openai-imagegen" o
  "foto-local", "refs": [...], "confidence": "alta|media", "generated_at": "AAAA-MM-DD" }. Las entradas
  que ya hay no se tocan, salvo schweppes-tonica si se sustituye por su caja. Anota el origen de cada una
  en public/img/botellas/CREDITOS.md.
- Fotos del local: docs/catalogo/referencias/<slug>.jpg (hay fireball, b-lemon, tyris-original…).
  Mandan sobre cualquier imagen web cuando no coincidan.

REGLAS PARA TODOS
- No inventes texto en etiquetas ni cajas: solo marca, variedad y lo que se lea con seguridad.
- No toques lo que ya funciona en la rama: Barra VIP, Reponer por partes, bloqueo del zoom, Chupitería sin
  buscador y los refrescos en «Otros».
- Carpeta temporal: assets/ (está en .gitignore).
- Nunca push a main y nunca --force.
===== FIN =====

────────────────────────────────────────
id: botellas · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Fireball y cervezas especiales
===== INSTRUCCIONES =====
Haz las 6 imágenes del punto 1a del brief: fireball, 1906-reserva-especial, b-lemon, desperados,
estrella-galicia-0-0 y estrella-galicia-sin-gluten.
Para cada una:
1. Busca una foto oficial o de tienda del producto exacto (botellín de 33 cl para las cervezas, botella
   de 70 cl para Fireball) y guárdala en assets/catalogo/referencias/<slug>.<ext>. Si existe
   docs/catalogo/referencias/<slug>.jpg, ábrela también: es la del local y manda.
2. Genérala con openai-imagegen usando la referencia como imagen de entrada y el encargo "Re-photograph
   this exact single bottle as a professional studio packshot, front view, plain white background".
   Guárdala en assets/catalogo/bruto/<slug>.png.
3. Compruébala contra la referencia: una sola unidad, entera, de frente, forma, colores, tapón o chapa y
   textos correctos, sin letras inventadas. Si falla, UN único reintento corrigiendo el encargo; si vuelve
   a fallar, no la pongas y anótalo.
4. Pásala por scripts/images/process.py hasta public/img/botellas/<slug>.png con el formato del brief, y
   añádela al manifest y a CREDITOS.md.
Toca solo assets/catalogo/, public/img/botellas/ (estas 6, el manifest y CREDITOS.md). Sin commit.
Informe: tabla slug → estado (ok | reintentada-ok | descartada) → referencia usada → nota.
===== FIN =====

────────────────────────────────────────
id: cajas · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Cajas de refrescos
===== INSTRUCCIONES =====
1. Lista los archivos de C:\Users\mrani\OneDrive - MARINA DE EMPRESAS\VESSEL\IMAGENES y decide qué foto
   es la caja de qué producto del punto 1b del brief, mirando cada imagen, no solo el nombre del archivo.
   Si una foto es dudosa o no es una caja, no la uses y anótalo. Copia las elegidas a
   assets/cajas/original/<slug>.<ext>. NO copies las originales al repositorio.
2. Recorta cada caja (quita el fondo con rembg o con el método de scripts/images/process.py), sin
   deformarla ni cambiar su diseño. No la regeneres con IA: es la foto real. Solo si el fondo no se puede
   quitar bien, usa openai-imagegen para limpiarla tomando la foto como imagen de entrada, y compárala con
   la original.
3. Déjala en public/img/botellas/<slug>.png con el formato del brief: caja entera, de frente o en
   tres cuartos como en la foto, como mucho al 94 % del ancho, apoyada en la misma base que las botellas.
   Manifest con "model": "foto-local" (u "openai-imagegen" si se limpió con IA), "refs" con el nombre del
   archivo original y la fecha. Anótalas en CREDITOS.md como «foto propia del local».
Toca solo assets/cajas/, public/img/botellas/ (las cajas, el manifest y CREDITOS.md). Si coincides con
«botellas» en manifest.json o CREDITOS.md, añade tus entradas sin borrar las suyas. Sin commit.
Informe: tabla archivo original → slug → estado → nota, y lista de refrescos que siguen sin caja.
===== FIN =====

────────────────────────────────────────
id: nevera-plan · tipo: IA · proveedor: Claude · modelo: Opus · permiso: lectura · título: Localizar la remodelación y contrato
===== INSTRUCCIONES =====
No escribas archivos.
1. Localiza «Vessel-Chupiteria-y-Nevera» dentro de C:\Users\mrani\inventariovessel: busca carpetas y ZIP
   con ese nombre (también sin acentos ni guiones), ramas de git (`git branch -a`) y worktrees
   (`git worktree list`). Si no la encuentras, dilo claramente al principio de tu salida y escribe el
   contrato basándote en la Chupitería actual. Si hay varias versiones, usa la más reciente y di cuál.
2. Léela entera y compárala con lo que hay en la rama: public/js/views/pedir.js, nevera.js, state.js,
   public/css/app.css, public/img/nevera/, scripts/nevera/, supabase/migrations/0010_chupiteria_nevera.sql
   y test/nevera.test.js.
3. Escribe el CONTRATO para el bloque «nevera»:
   A. Qué productos salen dibujados en la nevera de «Pedir → Nevera» y con qué imágenes (slugs del
      catálogo; hoy el grupo «Nevera» tiene estrella-galicia, heineken, red-bull, red-bull-sugarfree y
      agua-cabreiroa-33-cl, que se piden por caja o botella).
   B. Archivos que hay que copiar o generar y dónde: imágenes versionadas en public/img/nevera/ (o una
      subcarpeta propia), un plano JSON como nevera.v2.json y scripts en scripts/nevera/.
   C. Cómo generalizar nevera.js para que sirva a Chupitería y a Nevera con su propio plano, sin romper
      Chupitería. Tocar un producto suma una unidad de pedido igual que su tarjeta (data-add, cajas
      incluidas). Selección con contorno, número y «−» como en Chupitería. Sin buscador en esta sección.
      La nevera cabe entera en pantalla sin desplazar, de 360×640 a 1024×768 (ver la regla .nevera de
      app.css).
   D. Cambios de base de datos, si hacen falta, como migración nueva 0012 idempotente (no se puede tocar
      ninguna migración anterior), con su test.
   E. Lo que la remodelación de Codex haga distinto de la Chupitería actual y si conviene adoptarlo
      también en Chupitería (solo si mejora y no cambia el flujo de pedir).
   F. Riesgos, con una línea de decisión cada uno.
===== FIN =====

────────────────────────────────────────
id: nevera · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Pedir → Nevera
===== INSTRUCCIONES =====
Implementa el CONTRATO de «nevera-plan». Toca solo public/js/views/pedir.js, nevera.js, state.js si hace
falta, public/css/app.css, public/img/nevera/, scripts/nevera/, supabase/migrations/0012_* y test/.
Las imágenes nuevas llevan versión en el nombre (.vN.webp) para que la caché de
public/_headers (/img/nevera/*, immutable) no sirva las viejas.
Ejecuta `npm test` hasta que pase todo. Sin commit.
Informe: archivos cambiados, de dónde sale cada imagen, decisiones y resultado de los tests.
===== FIN =====

────────────────────────────────────────
id: union · tipo: Merge · título: Unión
(Junta las salidas de botellas, cajas y nevera, en ese orden.)

────────────────────────────────────────
id: integracion · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Integración y capturas
===== INSTRUCCIONES =====
1. Comprueba que manifest.json es JSON válido y que cada entrada apunta a un PNG que existe, de
   512×683 y de menos de 150 KB.
2. `npm test`: todo debe pasar.
3. Arranca la app en local (npm start, con PGlite) y recorre: Pedir → Nevera (tocar productos, cajas,
   «−», enviar), Pedir → Chupitería (sigue igual), Pedir → Refrescos y Otros (se ven las cajas), Reponer
   (marcar una fila, «Hecho» solo de lo marcado) y elegir Barra VIP.
4. Guarda capturas en tmp-capturas/imagenes-y-nevera/ a 390×844, 360×640 y 1024×768: Nevera,
   Chupitería, Refrescos, Otros, Chupitos con Fireball y Reponer. Además, una hoja con todas las
   imágenes nuevas juntas.
Sin commit. Informe: qué has arreglado, tests, recorrido y rutas de las capturas.
===== FIN =====

────────────────────────────────────────
id: revision · tipo: IA · proveedor: Claude · modelo: Opus · permiso: lectura · título: Revisión de imágenes y pantallas
===== INSTRUCCIONES =====
Revisa las capturas de tmp-capturas/imagenes-y-nevera/ y las imágenes nuevas de public/img/botellas/ y
public/img/nevera/.
- Imágenes: producto correcto, una sola unidad (cervezas y Fireball), caja real (refrescos), sin texto
  inventado, mismo tamaño, base y estilo que las existentes.
- Nevera: parecida a la referencia de Codex, coherente con Chupitería, entera sin desplazar, fácil de
  tocar con prisa y poca luz, contorno de selección visible.
No escribas archivos. Devuelve una lista priorizada (alta, media, baja) de cambios concretos: dónde, qué
está mal y cómo dejarlo. Indica qué imágenes hay que quitar porque no son fiables.
===== FIN =====

────────────────────────────────────────
id: cierre · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Correcciones, commit y push
===== INSTRUCCIONES =====
Aplica los cambios de prioridad alta y media de la revisión y quita las imágenes que no sean fiables (la
app usará la silueta). Vuelve a pasar `npm test`. Un único commit con el mensaje «Imágenes de Fireball,
cervezas especiales y cajas de refrescos; Pedir → Nevera como la Chupitería», y push a la rama actual.
Nunca a main y nunca --force. No subas assets/ ni tmp-capturas/.
Informe final para Alejandro, en español sencillo: qué imágenes se han añadido y cuáles faltan, cómo queda
la Nevera, el resultado de los tests y, si hay migración 0012, que hay que ejecutarla en Supabase (SQL
Editor, con `SET search_path TO vessel_reposicion;` delante) antes de publicar.
===== FIN =====

────────────────────────────────────────
id: salida · tipo: Salida · título: Resultado

CONEXIONES
1. brief → botellas
2. brief → cajas
3. brief → nevera-plan
4. brief → nevera
5. brief → integracion
6. brief → revision
7. brief → cierre
8. nevera-plan → nevera
9. botellas → union
10. cajas → union
11. nevera → union
12. union → integracion
13. integracion → revision
14. revision → cierre
15. integracion → cierre
16. cierre → salida
