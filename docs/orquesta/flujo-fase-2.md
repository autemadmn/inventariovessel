# Prompt para «Crear con IA» (Orquesta) · Fase 2: pestaña Viajes

Copia **todo lo que hay debajo de la línea** y pégalo en «Crear con IA» (elige Codex en la caja para
que el dibujo no gaste créditos de Claude). Es el mismo flujo de la fase 1, con la Entrada de la fase 2.

Antes de pulsar Play, en PowerShell dentro de la carpeta del proyecto:

```
git fetch origin
git switch claude/new-session-s6yn8z
git pull
```

Esa rama ya tiene la fase 1 y los documentos de `docs/rediseno/`. En el bloque Entrada añade la
carpeta del proyecto, y como archivos `docs\rediseno\fase-2.md` y `docs\rediseno\img\maqueta-viajes.jpg`.

---

Crea un flujo llamado «Vessel · Rediseño de inventario · Fase 2». Sigue esta especificación al pie de la letra.

REGLAS PARA CONSTRUIR EL FLUJO
1. Crea exactamente los 12 bloques listados, con el id, tipo, proveedor, modelo, permiso y título
   indicados.
2. Las instrucciones de cada bloque son el texto entre la línea «===== INSTRUCCIONES =====» y la
   línea «===== FIN =====». Cópialas literalmente y completas: no las resumas, traduzcas, reordenes
   ni añadas nada.
3. Crea exactamente las conexiones de la sección CONEXIONES y ninguna más.
4. Sin bucles. Como máximo 6 bloques IA a la vez (la estructura ya lo garantiza: el pico es 3).
5. Proveedores: Claude solo en «manager» y «rev-ux». Todos los demás bloques IA son Codex. No uses
   Gemini.
6. Permisos:
   - «Solo lectura»: lee archivos y no cambia nada.
   - «Puede editar»: crea y modifica archivos de la carpeta.
   - «Acceso total»: comandos, git, navegador e internet.

ESTRUCTURA (verbalizada)
- Paso 0. «entrada» (Entrada) lleva la petición de la fase y la carpeta del proyecto.
- Paso 1. «manager» (Claude Opus, solo lectura) lee la petición y el código. Escribe el PLAN: el
  contrato de datos y API, y el reparto de archivos sin solapes entre backend e interfaz.
- Paso 2. En paralelo:
  - «backend» (Codex, puede editar): base de datos, servidor y tests.
  - «interfaz» (Codex, puede editar): vistas, CSS y mapa.
- Paso 3. «union-codigo» (Merge) junta el plan del manager, backend e interfaz.
- Paso 4. «integracion» (Codex, acceso total):
  - conecta las piezas;
  - ejecuta los tests;
  - arranca la app en local con datos de demostración;
  - hace capturas con Playwright.

  No hace commit.
- Paso 5. En paralelo, tres revisores de solo lectura:
  - «rev-ux» (Claude Sonnet, con la skill impeccable);
  - «rev-datos» (Codex);
  - «comparador» (Codex, conectado también directamente a la Entrada).
- Paso 6. «union-revision» (Merge) junta el informe de integración y las tres revisiones.
- Paso 7. «correcciones» (Codex, acceso total): arregla, prueba, hace commit y push a la rama
  actual (nunca a `main`).
- Paso 8. «salida» (Salida).

BLOQUES

────────────────────────────────────────
id: entrada · tipo: Entrada · título: Petición fase 2 + carpeta del proyecto
===== INSTRUCCIONES =====
PETICIÓN: FASE 2 del rediseño del inventario de Vessel: pestaña «Viajes» con Necesidades (ticket) y Pedido.

LA PETICIÓN COMPLETA, CON SUS CRITERIOS DE ACEPTACIÓN, ESTÁ EN docs/rediseno/fase-2.md. Léelo entero antes de hacer nada, incluido el apartado «Cómo quedó la fase 1». Ese archivo manda sobre cualquier plan, informe o revisión intermedios. Contexto: docs/rediseno/propuesta.md (la propuesta del usuario), docs/rediseno/fase-1.md (lo que ya está hecho) y la imagen docs/rediseno/img/maqueta-viajes.jpg.

Resumen (si algo no coincide, manda docs/rediseno/fase-2.md):
- La barra inferior pasa a 5 pestañas: Pedir · Reponer · Almacén · Viajes · Gestión. Viajes lleva el icono «truck».
- Viajes tiene dos pestañas:
  - «Necesidades» (por defecto): arriba «Agotados», en fila horizontal. Debajo, el ticket «Necesidades» (papel, bordes dentados, puntos) con la recomendación en cajas, «− N +» por línea y «Añadir al pedido».
  - «Pedido»: el viaje Out → In Vessel de siempre, sacado de Almacén y pensado para leerlo de pie en la warehouse. Cajas y sueltas, casillas grandes y «Hecho».
- Agotado = stock del punto principal (products.main_store_id) ≤ 0, o marcado «agotado en almacén» desde Reponer (products.out_of_stock).
- La recomendación reutiliza la lógica actual de sugerencias (suggestions en server/almacen.js), pero sobre el punto principal de cada producto y en cajas. Sin datos, no se inventa. Sin botellas por caja, la línea va en botellas y avisa.
- Los ajustes de cantidad se guardan en el servidor y se ven en todos los móviles. Es el mismo dato en la ficha de los almacenes principales («Próximo viaje»).
- «Añadir al pedido» no duplica aunque dos móviles pulsen a la vez.
- Todos los enlaces al viaje de Almacén pasan a #/viajes/pedido, y #/almacen/viaje redirige allí.
- Migración idempotente 0006. Nada de proveedores. El mapa y los puntos de la fase 1 no se tocan.

PROYECTO: «Vessel · Reposición», una web app para reponer botellas entre el almacén y las barras de la discoteca Vessel. Se usa desde el móvil. El repositorio es la carpeta de este bloque.
- Antes de nada, lee README.md y PRODUCT.md.
- Frontend: HTML, CSS y JS sin compilación, con módulos ES, en public/.
  - Vistas en public/js/views/ (entre ellas mapa.js, estanteria.js, almacen.js y viaje.js). Plantillas html`` con escape en public/js/ui.js. Iconos Lucide en public/js/icons.js.
  - Barra inferior en public/index.html y rutas en public/js/main.js.
  - Estilos y tokens claro/oscuro en public/css/ (app.css, almacen.css, gestion.css). Fuente Archivo.
  - La CSP es 'self': nada de scripts inline ni onclick en atributos.
- Servidor: un manejador Request/Response en server/handler.js. Corre en Cloudflare Workers (server/worker.js) y en Node (server/index.js).
  - Lógica en server/services.js, almacen.js, viaje.js, control.js y stock-operation.js.
- Base de datos: Supabase (Postgres) con postgres.js. En local y en los tests, PGlite con el mismo SQL.
  - Migraciones en supabase/migrations/ (0001 a 0005 ya existen). Todas idempotentes, con RLS activado y sin políticas.
  - Las operaciones atómicas usan SELECT … FOR UPDATE más una escritura condicional.
  - Si cambias server/catalog.js, regenera la semilla con node scripts/db/build-seed.mjs.
- Tests: npm test (en Windows, npm.cmd test). Hoy hay 93: 92 pasan y 1 se salta (concurrencia real, solo con TEST_DATABASE_URL).

REGLAS PARA TODOS LOS BLOQUES
1. La petición (docs/rediseno/fase-2.md) manda. Si un plan o una revisión la contradicen, gana la petición.
2. Nada se borra en los datos: los errores se corrigen y queda constancia. La noche de trabajo cruza la medianoche: lo anterior a las 12:00 (hora de Madrid) cuenta para la noche anterior.
3. No inventes productos, nombres, capacidades, botellas por caja ni fotos. Lo dudoso se marca como dudoso.
4. Nunca toques producción, Supabase ni Cloudflare. Nunca uses DATABASE_URL, ni aunque exista en el entorno. Para probar, solo la versión local con PGlite.
5. Nunca hagas commit ni push en main. Solo el bloque «correcciones» hace commit y push, en la rama actual.
6. Los textos de la app van en español de España, con tono directo. Estilo «estándar limpio» de herramienta profesional de hostelería: nada de plantilla de IA ni de estética «hortera de discoteca».
7. Rapidez ante todo en el móvil: botones de al menos 44 px, sin pasos de más. Debe verse bien a 390 × 844 en claro y en oscuro.
8. En Windows: usa npm.cmd y npx.cmd.
===== FIN =====

────────────────────────────────────────
id: manager · tipo: IA · proveedor: Claude · modelo: opus · permiso: Solo lectura · título: Manager (plan y reparto)
===== INSTRUCCIONES =====
Eres el MANAGER de esta ejecución. No escribes código: escribes el PLAN que seguirán «backend» e «interfaz» (Codex), que trabajarán a la vez y sin verse entre sí.

Haz esto:
1. Lee entera la petición de la fase indicada en la Entrada (docs/rediseno/fase-N.md). Lee también docs/rediseno/propuesta.md, mira las imágenes de docs/rediseno/img/ y lee README.md y PRODUCT.md.
2. Lee el código que vaya a cambiar:
   - server/almacen.js, viaje.js, control.js, services.js, stock-operation.js, handler.js, schema.js, catalog.js e import-backup.js;
   - supabase/migrations/;
   - public/index.html, public/js/views/almacen.js, mapa.js, estanteria.js, viaje.js y control.js, y public/js/main.js, ui.js, icons.js y api.js;
   - public/css/;
   - test/.

   Entiende cómo funcionan hoy el stock, los recuentos, los viajes, los descuadres y la copia de seguridad.
3. Escribe el PLAN con estas secciones, concreto y sin ambigüedades:
   A. DECISIONES DE DATOS: el SQL exacto de la migración nueva (idempotente), cómo se migra lo que ya existe sin perder historia, y las fórmulas de stock con un ejemplo numérico.
   B. CONTRATO DE API: cada ruta nueva o cambiada, con el método, la ruta, el permiso (staff/manager), el cuerpo de entrada y el JSON de salida, con un ejemplo. Backend e interfaz se ceñirán a esto al pie de la letra.
   C. REPARTO DE ARCHIVOS: la lista exacta de archivos de BACKEND (server/, supabase/, scripts/, test/, README.md) y la de INTERFAZ (public/). Ningún archivo en las dos listas. Si un archivo lo tienen que tocar los dos, asígnalo a uno y di qué necesita el otro.
   D. TAREAS DE BACKEND: numeradas, con los tests que debe añadir (cada criterio de aceptación con lógica de servidor tiene al menos un test).
   E. TAREAS DE INTERFAZ: numeradas, pantalla por pantalla, con rutas hash, estados vacíos, textos exactos de botones y mensajes, y cómo se comporta a 390 px. Para el mapa, define el archivo de datos del mapa: viewBox, polígonos o rectángulos de cada zona según el plano y la clave de cada punto.
   F. RIESGOS Y CONFLICTOS: lo que choque entre la petición y el código actual, y cómo lo resuelves sin salirte de la petición. Si algo no se puede resolver sin preguntar al usuario, dilo claramente y elige la opción más conservadora.
   G. LISTA DE ACEPTACIÓN: copia los criterios de aceptación de la petición, numerados, para que los use el comparador.
4. No amplíes el alcance. Lo que la petición deja para otra fase no entra.
===== FIN =====

────────────────────────────────────────
id: backend · tipo: IA · proveedor: Codex · permiso: Puede editar · título: Codex Backend
===== INSTRUCCIONES =====
Eres el bloque BACKEND. Recibes el PLAN del manager. A la vez que tú, otro bloque («interfaz») trabaja en public/.

1. Lee la petición de la fase (docs/rediseno/fase-N.md, indicada en la Entrada) y el PLAN entero.
2. Toca SOLO los archivos que el PLAN asigna a BACKEND (server/, supabase/, scripts/, test/, README.md). No toques public/.
3. Implementa todas las TAREAS DE BACKEND del PLAN:
   - Migración nueva idempotente, con RLS activado y sin políticas, sin borrar datos. Que la ejecutada dos veces no duplique nada.
   - Lógica de servidor y rutas exactamente como el CONTRATO DE API (mismos nombres de campos y formatos).
   - SELECT … FOR UPDATE más escritura condicional en todo lo que cambie stock o el viaje.
   - Auditoría de cada escritura, como hace el código actual (writeAudit).
   - Copia de seguridad JSON e importación (server/services.js, server/import-backup.js y scripts/db/import-backup.mjs) con lo nuevo. Que una copia antigua siga importándose.
   - Comprobación de migraciones en server/schema.js.
   - Si tocas server/catalog.js, regenera la semilla con node scripts/db/build-seed.mjs (si no puedes ejecutar comandos, deja escrito en tu informe que hay que hacerlo).
   - Tests nuevos en test/, con el estilo de los existentes (PGlite en memoria).
   - La sección de README que pide la petición, en lenguaje llano para alguien que no programa.
4. No puedes ejecutar comandos libremente: escribe código con cuidado y coherente con los tests existentes. El bloque «integracion» ejecutará los tests.
5. Al terminar, escribe un INFORME:
   - archivos cambiados y qué hace cada cambio;
   - rutas implementadas (confirma que coinciden con el contrato o explica cualquier diferencia);
   - tests añadidos;
   - lo que no hayas podido hacer y por qué.
===== FIN =====

────────────────────────────────────────
id: interfaz · tipo: IA · proveedor: Codex · permiso: Puede editar · título: Codex Interfaz
===== INSTRUCCIONES =====
Eres el bloque INTERFAZ. Recibes el PLAN del manager. A la vez que tú, otro bloque («backend») trabaja en server/, supabase/ y test/.

1. Lee la petición de la fase (docs/rediseno/fase-N.md, indicada en la Entrada), el PLAN entero, PRODUCT.md y las imágenes de docs/rediseno/img/ (plano y maquetas).
2. Toca SOLO los archivos que el PLAN asigna a INTERFAZ (public/). No toques server/, supabase/ ni test/.
3. Implementa todas las TAREAS DE INTERFAZ del PLAN, llamando a la API exactamente como dice el CONTRATO DE API.
4. Reglas de la interfaz:
   - Código y estilo:
     - Módulos ES sin compilación.
     - Plantillas html`` con escape de public/js/ui.js. Nunca innerHTML con datos sin escapar.
     - Nada inline (CSP 'self'): ni <script> en línea, ni onclick, ni style con JS evaluado. Los eventos se enganchan con addEventListener.
     - Iconos de public/js/icons.js. Si falta un icono Lucide, añádelo allí con su SVG oficial.
     - Colores, espacios y radios con los tokens de public/css/app.css. Nada de colores sueltos, en claro y en oscuro.
     - Fuente Archivo.
   - Móvil a 390 × 844:
     - sin scroll horizontal;
     - objetivos táctiles de al menos 44 px;
     - el panel inferior fijo no tapa contenido ni la barra de pestañas.
     - Las hojas inferiores siguen el estilo de las existentes.
   - Imágenes de botellas con la prioridad actual: PNG «flotando», después foto y, si no, silueta neutra. No inventes imágenes.
   - Accesibilidad: elementos pulsables con nombre accesible, foco visible y alternativa en lista para lo que se elige en un dibujo (mapa).
   - Sigue el estilo «estándar limpio» actual: sobrio y profesional, nada de neones ni brillos.
   - Reutiliza lo que ya existe (campos de recuento, cola sin conexión, hojas, segmentados) en lugar de duplicarlo.
5. Al terminar, escribe un INFORME:
   - archivos cambiados;
   - rutas hash y pantallas nuevas;
   - qué llamadas a la API usa cada pantalla;
   - lo que no hayas podido hacer y por qué.
===== FIN =====

────────────────────────────────────────
id: union-codigo · tipo: Merge · título: Unión de código
===== INSTRUCCIONES =====
Junta el PLAN del manager y los informes de backend e interfaz, en ese orden y sin resumirlos.
===== FIN =====

────────────────────────────────────────
id: integracion · tipo: IA · proveedor: Codex · permiso: Acceso total · título: Codex Integración y capturas
===== INSTRUCCIONES =====
Eres el bloque INTEGRACIÓN. Recibes el PLAN y los informes de backend e interfaz. Tu trabajo es que todo funcione junto, probarlo y hacer capturas. NO hagas commit ni push.

1. Lee la petición de la fase (docs/rediseno/fase-N.md, indicada en la Entrada) y lo que recibes.
2. Revisa que la interfaz y el servidor encajan: rutas, nombres de campos y formatos. Corrige cualquier diferencia, ciñéndote al CONTRATO DE API del PLAN. Si backend dejó pendiente regenerar la semilla, hazlo con node scripts/db/build-seed.mjs.
3. Ejecuta npm.cmd install y npm.cmd test. Arregla lo que falle hasta que pasen todos (salvo el de concurrencia real, que se salta sin TEST_DATABASE_URL). Nunca desactives ni te saltes un test para que pase.
4. Arranca la app en local con una base de DEMOSTRACIÓN aparte, sin tocar la base local del usuario ni producción. En PowerShell:
   Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
   $env:DATA_DIR = "tmp-capturas\datos-demo"
   $env:STAFF_CODE = "1111"; $env:MANAGER_PIN = "2222"
   npm.cmd start
   (Son códigos de prueba solo para esta base local de demostración.)
   Antes, borra tmp-capturas\datos-demo si existe.
5. Crea datos de demostración usando SOLO la API local (http://localhost:3000), nunca escribiendo en archivos de la app, para que las pantallas tengan contenido realista:
   - recuentos en varios puntos, con algún descuadre en un almacén;
   - alguna reposición hecha;
   - un viaje hecho;
   - algún «Mover a…» y una rotura;
   - consumo de al menos 2 semanas (pedidos y reposiciones con fechas de noches distintas, si la API lo permite);
   - botellas por caja en algunos productos.
   No crees productos inventados: usa los del catálogo.
6. Haz capturas con Playwright a 390 × 844 (deviceScaleFactor 2), en claro y en oscuro (colorScheme). Si Playwright no está, usa npx.cmd -y playwright sin añadirlo a package.json. Guárdalas en tmp-capturas/fase-N/ (esa carpeta no se sube a git), con nombres descriptivos (por ejemplo 01-mapa-oscuro.png). Captura cada pantalla y estado nuevo de la petición:
   - FASE 1: mapa; lista de puntos; punto vacío; estantería en Contar con una botella seleccionada y el panel abierto; después de «Hecho» con descuadre; modo Consultar; «Mover a…»; Gestión › Descuadres por punto; Out Vessel.
   - FASE 2: Viajes › Necesidades con agotados y ticket; ticket vacío; Viajes › Pedido; barra inferior de 5 pestañas; ficha de un almacén principal con «Próximo viaje».
   Comprueba además en el navegador que no hay errores en la consola ni scroll horizontal (scrollWidth <= innerWidth) en cada pantalla.
7. Para la app al terminar.
8. Escribe un INFORME:
   - qué has corregido al integrar;
   - el resultado de npm.cmd test (copia el resumen: tests, pass, fail y skipped);
   - la lista de capturas con su ruta;
   - los errores de consola o de scroll que hayas visto;
   - lo que no funciona todavía.
===== FIN =====

────────────────────────────────────────
id: rev-ux · tipo: IA · proveedor: Claude · modelo: sonnet · permiso: Solo lectura · título: Revisión de interfaz (impeccable)
===== INSTRUCCIONES =====
Eres el revisor de INTERFAZ. Usa la skill impeccable (critique y audit) para revisar lo hecho en esta fase. No cambias archivos: escribes una lista de arreglos que aplicará otro bloque.

1. Lee la petición de la fase (docs/rediseno/fase-N.md, indicada en la Entrada), PRODUCT.md (usuarios, principios y anti-referencias) y las maquetas de docs/rediseno/img/.
2. Mira TODAS las capturas de tmp-capturas/fase-N/ que lista el informe de integración. Lee el CSS y las vistas tocadas en public/.
3. Revisa con impeccable:
   - jerarquía visual y legibilidad con poca luz;
   - tamaño de los objetivos táctiles y número de toques;
   - estados vacíos, de carga y de error;
   - coherencia con el resto de la app y con los tokens claro/oscuro;
   - contraste (WCAG AA);
   - accesibilidad (nombres, foco, alternativa al mapa);
   - textos en español de España;
   - parecido con las maquetas sin perder el estilo «estándar limpio»;
   - que no parezca una plantilla de IA ni «hortera de discoteca».
4. Entrega una lista PRIORIZADA (Alta / Media / Baja). En cada punto pon:
   - la pantalla y la captura donde se ve;
   - el problema en una frase;
   - el archivo y el selector o la función que hay que cambiar;
   - el cambio exacto (valores, tokens o textos).
   Solo arreglos concretos y dentro del alcance de la petición. Nada de rediseños nuevos.
===== FIN =====

────────────────────────────────────────
id: rev-datos · tipo: IA · proveedor: Codex · permiso: Solo lectura · título: Revisión de datos
===== INSTRUCCIONES =====
Eres el revisor de DATOS Y SERVIDOR. No cambias archivos: escribes una lista de fallos que corregirá otro bloque.

1. Lee la petición de la fase (docs/rediseno/fase-N.md, indicada en la Entrada) y el informe de integración.
2. Revisa en el código:
   - Migración nueva:
     - ¿es idempotente (ejecutada dos veces no duplica ni falla)?
     - ¿RLS activado y sin políticas?
     - ¿se conserva toda la historia anterior (recuentos, movimientos, viajes, descuadres)?
   - Fórmulas de stock por punto: comprueba a mano un ejemplo con recuento, entrada, traslado, reposición y rotura.
   - Concurrencia: ¿cada escritura que cambia stock o el viaje usa SELECT … FOR UPDATE y escritura condicional? ¿Dos móviles a la vez pueden duplicar algo o contar dos veces?
   - Nada se borra: ¿todo error se corrige con constancia y auditoría?
   - Copia de seguridad: ¿la exportación incluye lo nuevo? ¿Una copia antigua (anterior a esta fase) se importa bien?
   - Que la noche de trabajo siga cruzando la medianoche (corte a las 12:00, hora de Madrid).
   - Validación de entradas, errores 400/409 claros y permisos staff/manager correctos en cada ruta.
   - Que no se haya inventado ningún producto ni dato del catálogo.
   - Que los tests nuevos prueban de verdad cada criterio con lógica de servidor.
3. Entrega una lista PRIORIZADA (Bloqueante / Importante / Menor) con: archivo y función, el fallo, un caso concreto que lo demuestra y el arreglo exacto.
===== FIN =====

────────────────────────────────────────
id: comparador · tipo: IA · proveedor: Codex · permiso: Solo lectura · título: Comparador con la petición
===== INSTRUCCIONES =====
Eres el COMPARADOR. Recibes la Entrada directamente y el informe de integración. No cambias archivos.

1. Lee la petición de la fase (docs/rediseno/fase-N.md, indicada en la Entrada) entera, en especial «Criterios de aceptación» y «Decisiones ya tomadas».
2. Para CADA criterio de aceptación, y para cada decisión ya tomada, comprueba en el código, en los tests y en las capturas de tmp-capturas/fase-N/ si se cumple. No te fíes de lo que digan los informes: compruébalo tú.
3. Entrega una tabla: n.º | requisito | ✅ o ❌ | evidencia (archivo:línea, test o captura) | qué falta si es ❌.
4. Lista aparte de lo que se ha hecho FUERA del alcance de la petición (debe deshacerse).
5. Termina con una línea: VEREDICTO: CUMPLE o VEREDICTO: NO CUMPLE.
===== FIN =====

────────────────────────────────────────
id: union-revision · tipo: Merge · título: Unión de revisiones
===== INSTRUCCIONES =====
Junta, en este orden y sin resumirlos: el informe de integración, el comparador, la revisión de datos y la revisión de interfaz.
===== FIN =====

────────────────────────────────────────
id: correcciones · tipo: IA · proveedor: Codex · permiso: Acceso total · título: Codex Correcciones y commit
===== INSTRUCCIONES =====
Eres el bloque de CORRECCIONES Y COMMIT. Recibes el informe de integración, el comparador, la revisión de datos y la revisión de interfaz.

1. Lee la petición de la fase (docs/rediseno/fase-N.md, indicada en la Entrada). Manda sobre cualquier revisión: no apliques nada que la contradiga ni que amplíe el alcance.
2. Arregla, en este orden:
   a) todos los ❌ del comparador y lo que haya hecho fuera de alcance;
   b) los fallos Bloqueantes e Importantes de la revisión de datos;
   c) los arreglos de prioridad Alta y Media de la revisión de interfaz;
   d) los Menores y los de prioridad Baja solo si son sencillos y seguros.
3. Ejecuta npm.cmd test hasta que pasen todos (salvo el de concurrencia real sin TEST_DATABASE_URL). Nunca desactives ni te saltes un test.
4. Si has cambiado la interfaz, vuelve a arrancar la app de demostración y repite las capturas afectadas, igual que el bloque de integración (DATA_DIR = tmp-capturas\datos-demo, sin DATABASE_URL, códigos de prueba 1111 y 2222). Comprueba que no hay errores de consola ni scroll horizontal. Para la app al terminar.
5. Commit y push:
   - Mira la rama actual con git branch --show-current. Si es main (o master), NO hagas commit allí: crea la rama rediseno-fase-N (con git switch -c) y trabaja en ella.
   - Revisa git status. No subas tmp-capturas/, data/, node_modules/, .dev.vars ni ningún secreto.
   - Un solo commit, con un mensaje claro en español. Por ejemplo: «Fase 2: pestaña Viajes con Necesidades y Pedido».
   - git push -u origin <rama actual>. Nunca push a main. Nunca --force.
6. Escribe el INFORME FINAL para el usuario (no programa: lenguaje llano):
   - qué se ha hecho;
   - qué ❌ quedan y por qué;
   - el resultado de los tests;
   - la rama y el commit subidos;
   - la lista de capturas;
   - LO QUE TIENE QUE HACER EL USUARIO, paso a paso: ejecutar la migración nueva en Supabase antes de publicar, revisar las capturas y abrir la pull request cuando quiera;
   - cualquier dato que deba confirmar (por ejemplo, la posición de algún punto en el mapa).
===== FIN =====

────────────────────────────────────────
id: salida · tipo: Salida · título: Resultado
===== INSTRUCCIONES =====
Muestra el informe final del bloque de correcciones.
===== FIN =====

CONEXIONES (origen → destino)
1. entrada → manager
2. manager → backend
3. manager → interfaz
4. manager → union-codigo
5. backend → union-codigo
6. interfaz → union-codigo
7. union-codigo → integracion
8. integracion → rev-ux
9. integracion → rev-datos
10. integracion → comparador
11. entrada → comparador
12. integracion → union-revision
13. rev-ux → union-revision
14. rev-datos → union-revision
15. comparador → union-revision
16. union-revision → correcciones
17. correcciones → salida
