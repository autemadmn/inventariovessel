# Flujo de Orquesta: «Pedir» por secciones

Copia **todo lo que hay debajo de la línea** y pégalo en «Crear con IA».

Antes de ejecutar el flujo: carpeta de trabajo `C:\Users\mrani\inventariovessel`, en la rama
`claude/determined-mayer-kd98oe` y con `git pull` hecho. Adjunta al Input el boceto
`docs\rediseno\img\boceto-pedir-secciones.jpg`.

---

Crea un flujo llamado «Vessel · Pedir por secciones». Sigue esta especificación al pie de la letra.

REGLAS PARA CONSTRUIR EL FLUJO
1. Crea exactamente los 10 bloques listados, con el id, tipo, proveedor, modelo, permiso y título indicados.
2. Las instrucciones de cada bloque son el texto entre «===== INSTRUCCIONES =====» y «===== FIN =====».
   Cópialas literalmente y completas.
3. Crea exactamente las conexiones de la sección CONEXIONES. Si Orquesta exige un Merge para que un bloque
   reciba varias entradas, añádelo sin cambiar nada más.
4. Sin bucles ni reintentos entre bloques.
5. Los bloques de «lectura» no escriben archivos. Los de «escritura» sí pueden escribir y ejecutar comandos.

ESTRUCTURA
- «brief» (Entrada) → «plan» (Claude Opus, lectura): contrato técnico.
- A la vez: «backend» (Codex), «interfaz» (Claude Sonnet) e «imagenes» (Codex), sobre archivos distintos.
- «union-codigo» (Merge) → «integracion» (Codex): une, pasa tests y saca capturas.
- «estetica» (Claude, lectura): revisión visual con la skill impeccable.
- «correcciones» (Codex): aplica la revisión, tests, commit y push a la rama actual. Luego «salida».

BLOQUES

────────────────────────────────────────
id: brief · tipo: Entrada · título: Brief común
===== INSTRUCCIONES =====
PROYECTO: «Vessel · Reposición», web app de reposición e inventario de una discoteca. El repositorio es la
carpeta de trabajo actual. HTML/CSS/JS sin build en public/ (vistas en public/js/views/, utilidades en
public/js/ui.js y state.js, estilos en public/css/), servidor Node en server/ (lógica en server/services.js),
Postgres (PGlite en local y tests, Supabase en producción) con migraciones en supabase/migrations/.
Tests: `npm test`.

QUÉ HAY QUE HACER (boceto: docs/rediseno/img/boceto-pedir-secciones.jpg)
La pestaña «Pedir» deja de ser una sola lista y pasa a tener una portada con 5 botones:
- Arriba, el selector de barra de siempre.
- Una cuadrícula de 2×2 con cuatro botones grandes, cada uno con su nombre y una foto de botella:
  · «Alcohol» (foto: Tanqueray) · «Nevera» (foto: Estrella Galicia)
  · «Chupitería» (fotos: Jägermeister y el tequila rosa DIEX) · «Refrescos» (foto: Schweppes tónica)
- Debajo, un botón ancho «Otros».
- Abajo, la barra de navegación de siempre.
Al tocar un botón se abre esa sección con exactamente el mismo estilo que tiene hoy «Pedir» (cuadrícula de
botellas por grupos, buscador, sumar con un toque, restar, carrito y enviar). «Alcohol» es lo que hoy sale
al abrir «Pedir». Hay que poder volver a la portada con un botón claro y con el botón atrás del móvil
(ruta #/pedir/<seccion>). El carrito es uno solo por barra para todas las secciones: lo que se añade en
Nevera y en Alcohol se envía junto, y la barra del carrito se ve también en la portada.

SECCIONES Y GRUPOS
- Cada grupo de la selección pertenece a una sección: alcohol, nevera, chupiteria, refrescos u otros.
  Cada sección muestra sus grupos en su orden. El encargado elige la sección de cada grupo en
  Gestión → Selección.
- El grupo «Resto» pasa a llamarse «Premium». «Habituales» y «Premium» son de la sección alcohol.

UNIDAD DE PEDIDO
- Cada producto tiene unidad de pedido: «botella» (por defecto), «caja» o «bolsa».
- En los productos por caja, un toque en «Pedir» añade una caja (per_case unidades). Internamente se
  guarda en unidades, como hasta ahora, para que el stock y los informes sigan igual. En «Pedir», en el
  carrito y en «Reponer» se muestra «2 cajas» en vez de «48».
- El encargado puede cambiar la unidad en Gestión → Catálogo.

PRODUCTOS NUEVOS (fuente: docs/catalogo/productos-identificados.md)
Sección alcohol:
- Habituales, al final: Cutty Sark (whisky) y Aperol (otros).
- Premium, al final: Larios 150 Aniversario (ginebra), Talisker 10 (whisky), Johnnie Walker Black Label 12
  (whisky) y Cîroc Summer Colada (vodka).
Sección nevera, grupo «Nevera»: Estrella Galicia (cerveza, caja de 24), Heineken (cerveza, botella,
caja de 24), Red Bull (refresco, caja de 24), Red Bull Sugarfree (refresco, caja de 24) y Agua Cabreiroá
33 cl (refresco, caja de 35).
Sección chupiteria:
- Grupo «Chupitos»: Jägermeister, Fireball, Buen Amigo Oro, DIEX Crema de Fresas con Tequila (el tequila
  rosa), Karlova Blue, Karlova Red y Cassaya. Todos categoría licor y unidad botella.
- Grupo «Cervezas especiales»: Desperados, 1906 Reserva Especial, B.Lemon, Estrella Galicia 0,0 y Estrella
  Galicia sin gluten (cerveza, botella, caja de 24); y Vino blanco (vino, botella).
Sección refrescos:
- Grupo «Refrescos»: Pepsi, Pepsi Zero, 7Up, Schweppes Limón, Schweppes Naranja, Schweppes Tónica,
  Schweppes Tónica Zero, Schweppes Fresa y Perrier (refresco, caja de 24).
- Grupo «Zumos»: Zumo de naranja, Zumo de melocotón y Zumo de piña (refresco, caja de 24).
Sección otros, grupo «Otros»: Hielo (otros, bolsa), Stella Artois y Tyris Original (cerveza, botella,
caja de 24).
Categoría nueva: «licor» (Licores). Punto de almacenaje principal (main_store_id, por map_key):
Estrella Galicia → neveras-cerveza; Heineken, Desperados, 1906 y Estrella sin gluten → neveras-especial;
chupitos, Estrella 0,0, B.Lemon, Stella Artois y Tyris → chupiteria; vino blanco → nevera-vino; refrescos,
agua, Red Bull y zumos → alm-cerveza; alcohol → alm-alcohol; hielo → sin punto.
Todos los productos nuevos quedan «confirmados». Los slugs salen del nombre (slugify de server/catalog.js).

REGLAS PARA TODOS
- La petición original manda. Las correcciones que ya están en la rama se mantienen aunque no aparezcan en
  esta petición.
- La migración nueva es supabase/migrations/0009_pedir_secciones.sql: idempotente, sin borrar datos ni
  historia, y lo que sea alta o renombre se aplica una sola vez (marca en settings), como en 0007 y 0008.
- No se cambia cómo se calculan el stock, los informes ni los viajes.
- Todo el texto de la interfaz en español de España, claro y corto.
- Nunca push a main ni despliegue.
===== FIN =====

────────────────────────────────────────
id: plan · tipo: IA · proveedor: Claude · modelo: Opus · permiso: lectura · título: Plan y contrato técnico
===== INSTRUCCIONES =====
Lee el repositorio (public/js/views/pedir.js, seleccion.js, catalogo.js, reponer.js, public/js/state.js,
main.js, server/services.js, server/catalog.js, las migraciones y los tests) y el boceto. No escribas
archivos.

Escribe el CONTRATO para backend, interfaz e imagenes:
A. Cambios de base de datos exactos (columnas, valores permitidos, la migración 0009 entera en SQL).
B. Cambios de API: qué devuelven bootstrap y live (section en grupos, order_unit en productos), y cómo se
   cambia la sección de un grupo y la unidad de un producto.
C. Rutas y comportamiento de la interfaz: portada, #/pedir/<seccion>, volver, carrito único, cajas.
D. Archivos de cada bloque, sin solaparse:
   - backend: supabase/migrations/0009_pedir_secciones.sql, server/*, test/*.
   - interfaz: public/js/views/*, public/js/state.js, public/js/main.js, public/css/*.
   - imagenes: public/img/botellas/*, scripts/images/*.
E. Lista de tests nuevos y de tests actuales que hay que ajustar (por ejemplo, los que usan «Resto»).
F. Riesgos, con una línea de decisión cada uno.
===== FIN =====

────────────────────────────────────────
id: backend · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Base de datos y servidor
===== INSTRUCCIONES =====
Implementa la parte de backend del CONTRATO: la migración 0009, los cambios en server/ y los tests (nuevos
y ajustados). Toca solo tus archivos. Ejecuta `npm test` hasta que pase todo. Sin commit.
Informe: archivos cambiados, decisiones y resultado de los tests.
===== FIN =====

────────────────────────────────────────
id: interfaz · tipo: IA · proveedor: Claude · modelo: Sonnet · permiso: escritura · título: Interfaz de Pedir por secciones
===== INSTRUCCIONES =====
Implementa la parte de interfaz del CONTRATO, siguiendo el boceto y el estilo actual de la app (fondo
oscuro, tipografía Archivo, botellas flotantes de public/img/botellas, iconos de public/js/icons.js):
- Portada de «Pedir»: selector de barra, los 4 botones grandes de 2×2 con su foto (usa imageFor(slug):
  tanqueray-london-dry; estrella-galicia; jagermeister y diex-crema-fresas-tequila; schweppes-tonica; si
  aún no hay PNG, una silueta), el botón ancho «Otros» y la barra del carrito. Cada botón muestra cuántas
  unidades de esa sección hay en el carrito.
- Vista de sección: la de hoy, filtrada por los grupos de esa sección, con un botón para volver.
- Cajas: un toque suma una caja en los productos por caja y se muestra «N cajas» en tarjeta, carrito y
  «Reponer».
- Gestión → Selección: elegir la sección de cada grupo. Gestión → Catálogo: unidad de pedido y categoría
  «Licores».
Toca solo tus archivos. Pensado para móvil (390 px) y para tablet fija en la barra: botones grandes,
fáciles de tocar con prisa y con poca luz. Sin commit.
Informe: archivos cambiados y decisiones.
===== FIN =====

────────────────────────────────────────
id: imagenes · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Imágenes de los botones
===== INSTRUCCIONES =====
Crea las imágenes de botella que faltan para los botones de la portada: estrella-galicia (botellín de
Estrella Galicia), jagermeister (Jägermeister 70 cl), diex-crema-fresas-tequila (DIEX Crema de Fresas con
Tequila 70 cl: botella blanca con rombos rosas, turquesa y amarillos y tapón blanco) y schweppes-tonica
(botellín de vidrio de Schweppes Tónica 20 cl).
Mismo proceso y formato que las actuales: openai-imagegen a partir de una foto oficial o de tienda y
después scripts/images/process.py (PNG transparente de 512×683, al 94 % de alto, menos de 150 KB). Añade
las 4 al manifest sin tocar las demás y anótalas en CREDITOS.md. Compara cada una con su referencia antes de
darla por buena; si alguna no queda bien, no la pongas (el botón usará la silueta). Sin commit.
Informe: qué imágenes quedan y de dónde sale cada referencia.
===== FIN =====

────────────────────────────────────────
id: union-codigo · tipo: Merge · título: Unión
(Junta las salidas de backend, interfaz e imagenes, en ese orden.)

────────────────────────────────────────
id: integracion · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Integración y capturas
===== INSTRUCCIONES =====
1. Une las tres partes y arregla lo que no encaje con el CONTRATO.
2. `npm test`: todo debe pasar.
3. Arranca la app en local (npm start, con PGlite) y recorre: portada de Pedir, cada sección, añadir
   botellas y cajas desde varias secciones, enviar, verlo en Reponer y marcarlo como hecho, volver con el
   botón atrás, y en Gestión cambiar la sección de un grupo y la unidad de un producto.
4. Guarda capturas en tmp-capturas/pedir-secciones/ a 390×844 y a 1024×768: portada, Alcohol, Nevera,
   Chupitería, Refrescos, Otros, carrito con cajas, Reponer y Gestión → Selección.
Sin commit. Informe: qué has arreglado, tests, recorrido y rutas de las capturas.
===== FIN =====

────────────────────────────────────────
id: estetica · tipo: IA · proveedor: Claude · modelo: Opus · permiso: lectura · título: Revisión estética (impeccable)
===== INSTRUCCIONES =====
Usa la skill impeccable para revisar las capturas de tmp-capturas/pedir-secciones/ y el código de la
interfaz nueva, comparándolos con el boceto (docs/rediseno/img/boceto-pedir-secciones.jpg) y con el resto
de la app.
Revisa: jerarquía visual de la portada, tamaño y tacto de los botones con prisa y poca luz, cómo lucen las
fotos de botella en los botones, coherencia con las demás pantallas, legibilidad, contraste y
accesibilidad, estados (vacío, cargando, sin barra elegida, agotado), móvil y tablet, y textos.
No escribas archivos. Devuelve una lista priorizada (alta, media, baja) de cambios concretos: dónde, qué
está mal y cómo dejarlo. Solo lo que mejore de verdad; nada de rediseños ajenos al boceto.
===== FIN =====

────────────────────────────────────────
id: correcciones · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Correcciones, commit y push
===== INSTRUCCIONES =====
Aplica los cambios de prioridad alta y media de la revisión estética, y los de baja que sean pequeños.
Vuelve a pasar `npm test` y a sacar las capturas de la portada y de una sección. Un único commit con el
mensaje «Pedir por secciones: Alcohol, Nevera, Chupitería, Refrescos y Otros», y push a la rama actual.
Nunca a main y nunca --force. No despliegues: la migración 0009 hay que aplicarla en Supabase antes.
Informe final para Alejandro, en español sencillo: qué ha cambiado en Pedir, qué productos nuevos hay, qué
imágenes faltan aún, el resultado de los tests y qué tiene que hacer para publicarlo.
===== FIN =====

────────────────────────────────────────
id: salida · tipo: Salida · título: Resultado

CONEXIONES
1. brief → plan
2. brief → backend
3. brief → interfaz
4. brief → imagenes
5. brief → integracion
6. brief → estetica
7. brief → correcciones
8. plan → backend
9. plan → interfaz
10. plan → imagenes
11. plan → integracion
12. backend → union-codigo
13. interfaz → union-codigo
14. imagenes → union-codigo
15. union-codigo → integracion
16. integracion → estetica
17. integracion → correcciones
18. estetica → correcciones
19. correcciones → salida
