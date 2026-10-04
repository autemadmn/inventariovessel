# Flujo de Orquesta: imágenes de los habituales que faltan

Copia **todo lo que hay debajo de la línea** y pégalo en «Crear con IA».

Antes de ejecutar el flujo:

- Abre como carpeta de trabajo tu copia del repo, en la rama `claude/determined-mayer-kd98oe` (o en la rama
  de trabajo donde la hayas fusionado). Nunca en `main`.
- Gemini CLI necesita la extensión Nano Banana y una clave de API de Gemini con generación de imágenes
  (`NANOBANANA_GEMINI_API_KEY` o `GEMINI_API_KEY`).
- Codex necesita su herramienta de generación de imágenes, la misma con la que se hicieron los 18 PNG
  actuales («openai-imagegen» en el manifest).
- Python 3.10 o superior para el recorte. El primer uso de rembg descarga un modelo de unos 170 MB.

---

Crea un flujo llamado «Vessel · Imágenes de los habituales que faltan». Sigue esta especificación al pie
de la letra.

REGLAS PARA CONSTRUIR EL FLUJO
1. Crea exactamente los 12 bloques listados, con el id, tipo, proveedor, modelo, permiso y título indicados.
2. Las instrucciones de cada bloque son el texto entre «===== INSTRUCCIONES =====» y «===== FIN =====».
   Cópialas literalmente y completas: no las resumas, traduzcas, reordenes ni añadas nada.
3. Crea exactamente las conexiones de la sección CONEXIONES y ninguna más. Si Orquesta exige un Merge para
   que un bloque reciba varias entradas, añade un Merge por cada bloque destino que lo necesite, sin cambiar
   nada más.
4. Sin bucles ni reintentos entre bloques.
5. Los bloques de «lectura» no escriben archivos. Los de «escritura» sí pueden escribir y ejecutar comandos
   en la carpeta de trabajo.

ESTRUCTURA
- Fase 0. «brief» (Entrada) lleva el contexto común y se conecta a todos los bloques IA.
- Fase 1. «fichas» (Gemini 2.5 Flash, lectura) busca referencias visuales reales de las 4 botellas.
- Fase 2. Dos generadores trabajan a la vez con las mismas fichas: «gen-gemini» (Gemini 2.5 Pro con Nano
  Banana, escritura) y «gen-codex» (Codex, escritura). Cada uno hace una candidata por botella.
- Fase 3. «union-candidatas» (Merge) → «seleccion» (Claude Opus, lectura). Selección compara las dos
  candidatas con la foto real del local y con los 18 PNG actuales, y elige una por botella.
- Fase 4. «recorte» (Codex, escritura) quita el fondo, normaliza y escribe los PNG finales y el manifest.
- Fase 5. Dos revisores de solo lectura a la vez: «rev-producto» (Gemini 2.5 Pro) y «rev-coherencia»
  (Claude Sonnet).
- Fase 6. «union-revision» (Merge) → «correcciones» (Codex, escritura): aplica lo que digan las revisiones,
  hace commit y push a la rama actual. Luego «salida».

BLOQUES

────────────────────────────────────────
id: brief · tipo: Entrada · título: Brief común
===== INSTRUCCIONES =====
PROYECTO: «Vessel · Reposición», web app de reposición e inventario de una discoteca. El repositorio es la
carpeta de trabajo actual. HTML/CSS/JS sin build en public/; servidor Node en server/.

OBJETIVO: crear las imágenes de catálogo de 4 botellas del grupo «Habituales» que hoy no tienen imagen, con
el mismo aspecto que las 18 que ya hay. Esta ejecución solo hace imágenes: no toca la base de datos, ni el
catálogo, ni el código de la app.

CÓMO FUNCIONAN LAS IMÁGENES HOY
- Cada imagen es public/img/botellas/<archivo>.png: PNG transparente de 512×683 px, botella de frente,
  entera (tapón y base), centrada, al 94 % de la altura del lienzo, sin sombra ni reflejo en el suelo,
  menos de 150 KB. Referencia de estilo: public/img/botellas/larios-12.png, skyy.png, j-b-rare.png y
  brugal-anejo.png.
- public/img/botellas/manifest.json asocia el SLUG del producto con su archivo:
  "<slug>": { "file": "<archivo>.png", "model": "<modelo>", "refs": [<urls>], "confidence": "alta|media",
  "generated_at": "AAAA-MM-DD" }.
- La app muestra el PNG del manifest si existe; si no, la foto subida o una silueta (public/js/ui.js,
  thumb()). Si una botella sale mal, es mejor no ponerla: se queda la silueta.
- Las 18 entradas que ya hay en el manifest y sus PNG NO se tocan.

LAS 4 BOTELLAS (slug del manifest → archivo → producto exacto → foto real del local)
1. boldcrew-original → boldcrew-original.png → BoldCrew Original, blended scotch whisky 70 cl (botella
   transparente de hombros cuadrados, etiqueta blanca con «BOLD» en gris y «Crew» manuscrito en naranja,
   tapón negro con banda naranja) → docs/catalogo/referencias/boldcrew-original.jpg
2. cutty-sark → cutty-sark.png → Cutty Sark Blended Scotch Whisky 70 cl (botella verde, etiqueta amarilla con
   un velero) → docs/catalogo/referencias/cutty-sark.jpg
3. flor-de-cana-anejo-reserva → flor-de-cana-anejo-reserva.png → Flor de Caña Añejo Reserva 5 años 70 cl,
   etiqueta negra «Terroir volcánico», diseño actual con el volcán → docs/catalogo/referencias/flor-de-cana-anejo-reserva.jpg
4. aperol → aperol.png → Aperol 70 cl (sin foto del local; solo referencias web)

Cutty Sark y Aperol aún no están dados de alta en la app: su imagen se verá cuando se creen con esos
nombres (slug cutty-sark y aperol). Esta ejecución no los crea.

Las fotos de docs/catalogo/referencias/ son recortes de fotos reales de la barra de Vessel: mandan sobre
cualquier referencia web cuando no coincidan (diseño de etiqueta, color, tapón).

REGLAS PARA TODOS
- La petición original manda. Las correcciones que ya están en la rama se mantienen aunque no aparezcan en
  esta petición.
- No inventes texto en las etiquetas: solo marca y expresión, y lo que se lea con seguridad.
- No toques nada fuera de: assets/ (ignorado por git), scripts/images/, public/img/botellas/ y
  public/img/botellas/CREDITOS.md.
- Nunca push a main.
===== FIN =====

────────────────────────────────────────
id: fichas · tipo: IA · proveedor: Gemini · modelo: gemini-2.5-flash · permiso: lectura · título: Fichas visuales
===== INSTRUCCIONES =====
Para cada una de las 4 botellas del brief:
1. Abre la foto real del local (docs/catalogo/referencias/<slug>.jpg) si la hay.
2. Busca en la web (google_web_search y web_fetch) la página oficial de la marca y fotos de producto de
   tiendas fiables, de la expresión exacta y con el diseño de etiqueta que coincide con la foto del local.

No escribas archivos. Devuelve un único bloque ```json``` con un array. Cada elemento tiene:
- slug, archivo, nombre;
- confidence: "alta" (referencia oficial que coincide con la foto del local) o "media" (varias fuentes
  coinciden pero hay variantes de diseño). Si no sabes qué botella es, "baja";
- refs: de 2 a 4 URLs de imágenes o páginas usadas;
- botella: silueta, hombros, cuello, base, proporción alto/ancho, relieves;
- vidrio: color y transparencia;
- liquido: color visible;
- tapon: material, color y forma;
- etiquetas: posición, colores, tipografía y los textos EXACTOS que se leen claramente. Lo que no se lea
  con seguridad es "no legible";
- distintivos: malla, sello, cordón, grabados…;
- diferencias_con_local: en qué se diferencia la mejor referencia web de la foto del local;
- image_url_referencia: URL directa (.jpg/.png/.webp) de la mejor foto frontal;
- prompt: en inglés, con esta plantilla rellenada:
  "Professional studio product photograph of a single bottle of <nombre exacto>, <botella>, <vidrio>,
  <liquido>, <tapon>, <etiquetas con textos exactos>, <distintivos>. Front view at label height, entire
  bottle visible including cap and base, centered, bottle fills 90% of frame height, portrait 3:4. Pure
  white seamless background (#FFFFFF), soft even lighting, gentle reflections, no cast shadow, no props,
  no hands, no extra text, photorealistic, ultra sharp label."

Termina con una línea: «RESUMEN: N fichas, A alta, M media, B baja».
===== FIN =====

────────────────────────────────────────
id: gen-gemini · tipo: IA · proveedor: Gemini · modelo: gemini-2.5-pro · permiso: escritura · título: Candidatas Gemini (Nano Banana)
===== INSTRUCCIONES =====
Recibes las fichas. Generas una candidata por botella con la extensión Nano Banana (modelo
gemini-2.5-flash-image).

Para cada ficha con confidence "alta" o "media":
1. Imagen de entrada: la foto del local (docs/catalogo/referencias/<slug>.jpg) si existe; si no, descarga
   image_url_referencia con `curl -L --max-time 20` en assets/referencias/<slug>.<ext>. Pide una edición:
   "Re-photograph this exact bottle as a professional studio packshot: " + prompt de la ficha. Sin imagen
   de entrada, genera solo con el prompt.
2. Guarda el resultado en assets/candidatas/gemini/<slug>.png.
3. Ábrela y compárala con la ficha y con la foto del local: botella entera con tapón y base, fondo blanco
   liso, una sola botella, forma y colores correctos, textos iguales a los de la ficha y sin letras
   deformes. Si falla algo, haz UN único reintento corrigiendo el prompt. Si vuelve a fallar, borra el
   archivo y márcala como fallida.

Las fichas "baja" no se generan. No toques nada fuera de assets/.

Devuelve una tabla con slug, estado (ok | reintentada-ok | fallida | omitida-baja), archivo y nota, y el
mismo contenido en un bloque ```json``` [{slug, generador: "gemini", status, file, note}].
===== FIN =====

────────────────────────────────────────
id: gen-codex · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Candidatas Codex (imagegen)
===== INSTRUCCIONES =====
Recibes las fichas. Generas una candidata por botella con tu herramienta de generación de imágenes (la
misma que hizo los PNG actuales, «openai-imagegen»).

Para cada ficha con confidence "alta" o "media":
1. Usa como imagen de referencia la foto del local (docs/catalogo/referencias/<slug>.jpg) si existe; si no,
   descarga image_url_referencia con `curl -L --max-time 20` en assets/referencias/<slug>.<ext>. Pide
   "Re-photograph this exact bottle as a professional studio packshot: " + prompt de la ficha. Si la
   herramienta no admite imagen de entrada, genera solo con el prompt.
2. Guarda el resultado en assets/candidatas/codex/<slug>.png.
3. Ábrela y compárala con la ficha y con la foto del local: botella entera con tapón y base, fondo blanco
   liso, una sola botella, forma y colores correctos, textos iguales a los de la ficha y sin letras
   deformes. Si falla algo, haz UN único reintento corrigiendo el prompt. Si vuelve a fallar, borra el
   archivo y márcala como fallida.

Las fichas "baja" no se generan. No toques nada fuera de assets/.

Devuelve una tabla con slug, estado (ok | reintentada-ok | fallida | omitida-baja), archivo y nota, y el
mismo contenido en un bloque ```json``` [{slug, generador: "codex", status, file, note}].
===== FIN =====

────────────────────────────────────────
id: union-candidatas · tipo: Merge · título: Unión de candidatas
(Junta las salidas de fichas, gen-gemini y gen-codex, en ese orden.)

────────────────────────────────────────
id: seleccion · tipo: IA · proveedor: Claude · modelo: Opus · permiso: lectura · título: Selección de la mejor candidata
===== INSTRUCCIONES =====
Para cada una de las 4 botellas, abre:
- la foto del local (docs/catalogo/referencias/<slug>.jpg), si existe;
- assets/candidatas/gemini/<slug>.png y assets/candidatas/codex/<slug>.png, las que existan;
- dos o tres PNG actuales como referencia de estilo (public/img/botellas/larios-12.png, j-b-rare.png,
  brugal-anejo.png).

Elige la candidata que mejor cumple, por este orden:
1. Es el producto correcto y coincide con la botella del local (forma, colores, tapón, diseño de etiqueta).
2. Textos de etiqueta correctos, sin letras inventadas ni deformes.
3. Botella entera, frontal, fondo limpio, fácil de recortar.
4. Se parece en luz, encuadre y realismo a los PNG actuales.

Si ninguna es aceptable, elige "ninguna": esa botella se quedará con la silueta.

No escribas archivos. Devuelve un bloque ```json``` [{slug, archivo_final, elegida: "gemini" | "codex" |
"ninguna", origen: "<ruta de la candidata>", model: "gemini-2.5-flash-image" | "openai-imagegen", refs,
confidence, motivo}]. Toma refs y confidence de las fichas.
===== FIN =====

────────────────────────────────────────
id: recorte · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Recorte, transparencia y manifest
===== INSTRUCCIONES =====
Recibes la selección. Solo procesas las botellas con elegida distinta de "ninguna".

1. Entorno de Python fuera del repo: `python3 -m venv ~/.cache/vessel-img && ~/.cache/vessel-img/bin/pip
   install "rembg[cpu]" pillow`. Deja las dependencias en scripts/images/requirements.txt.

2. Crea o actualiza scripts/images/process.py. Para cada candidata elegida:
   1. Quita el fondo con rembg (modelo isnet-general-use; si el borde queda sucio, alpha_matting=True).
   2. Elimina el halo blanco: erosión de alfa de 1 px y descontaminación del color.
   3. Recorta al contorno del canal alfa.
   4. Escala manteniendo la proporción para que la botella mida el 94 % de 683 px de alto, sin pasar del
      90 % de 512 px de ancho.
   5. Centra en horizontal sobre un lienzo transparente de 512×683 px, con la base a la misma altura que en
      los PNG actuales (mide la de larios-12.png y j-b-rare.png y usa esa).
   6. Guarda en public/img/botellas/<archivo_final> optimizado. Si pasa de 150 KB, cuantiza a 256 colores
      conservando el alfa.
   7. Añade al manifest.json una entrada por slug con el formato del brief (model, refs y confidence de la
      selección; generated_at = fecha de hoy). No modifiques ni reordenes las 18 entradas existentes.
   8. Genera assets/revision.png: hoja de contactos con cada botella nueva junto a larios-12.png y
      j-b-rare.png, sobre cuadros, sobre blanco y sobre #111214, con el slug debajo.

3. Ejecútalo y revisa el resultado. Si alguna queda cortada, con restos de fondo o deforme, ajusta los
   parámetros de ese slug (diccionario de ajustes en el script). No regeneres imágenes.

4. CREDITOS.md: en la sección de PNG generadas, añade los nuevos slugs y el modelo con el que se hizo cada
   uno. Indica que son representaciones generadas a partir de referencias públicas y fotos del local, no
   fotografías oficiales.

Sin commit ni push.

Informe final: tabla slug → archivo, KB, generador y ajustes; slugs sin imagen; ruta de revision.png.
===== FIN =====

────────────────────────────────────────
id: rev-producto · tipo: IA · proveedor: Gemini · modelo: gemini-2.5-pro · permiso: lectura · título: Revisión de producto
===== INSTRUCCIONES =====
Abre assets/revision.png, cada PNG nuevo de public/img/botellas/ y su foto del local en
docs/catalogo/referencias/. Lee public/img/botellas/manifest.json.

Para cada slug nuevo, di si la imagen sirve para reconocer la botella de un vistazo en un móvil:
- producto correcto y con el mismo diseño que la foto del local;
- textos de etiqueta inventados o deformes;
- halo o restos de fondo;
- partes cortadas.
Si hace falta, busca la referencia oficial en la web.

No escribas archivos. Devuelve un bloque ```json``` [{slug, veredicto: "mantener" | "quitar", motivo}].
«Quitar» solo para errores claros de producto, texto o recorte.
===== FIN =====

────────────────────────────────────────
id: rev-coherencia · tipo: IA · proveedor: Claude · modelo: Sonnet · permiso: lectura · título: Revisión de coherencia con las actuales
===== INSTRUCCIONES =====
Compara cada PNG nuevo con los 18 actuales de public/img/botellas/. Comprueba con medidas (abre los
archivos y lee tamaño, caja del alfa y altura de la base):
- 512×683 px, fondo transparente, menos de 150 KB;
- altura de la botella (≈94 %) y línea de base iguales a las actuales, centrada;
- luz, reflejos y realismo parecidos: que no desentone en la cuadrícula de «Pedir» sobre el fondo oscuro
  de la app (#111214);
- manifest.json válido, con las 18 entradas intactas y las nuevas con file, model, refs, confidence y
  generated_at.

No escribas archivos. Devuelve una lista de problemas concretos (slug, problema, arreglo propuesto) o
«Sin problemas».
===== FIN =====

────────────────────────────────────────
id: union-revision · tipo: Merge · título: Unión de revisiones
(Junta las salidas de recorte, rev-producto y rev-coherencia, en ese orden.)

────────────────────────────────────────
id: correcciones · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Correcciones, commit y push
===== INSTRUCCIONES =====
1. Aplica los arreglos de rev-coherencia que sean de recorte, tamaño o alineación, volviendo a ejecutar
   scripts/images/process.py con ajustes para ese slug. No regeneres imágenes.
2. Para cada slug con veredicto "quitar" en rev-producto: borra su PNG y su entrada del manifest, y quítalo
   de CREDITOS.md.
3. Comprueba que manifest.json es JSON válido y que las 18 entradas originales siguen iguales
   (`git diff public/img/botellas/manifest.json` solo debe añadir líneas).
4. Ejecuta `npm test`. Todos deben pasar.
5. Haz un único commit con los PNG, el manifest, CREDITOS.md y scripts/images/ (assets/ no se sube), con
   el mensaje «Imágenes de los habituales que faltaban». Push a la rama actual. Nunca a main.

Informe final para Alejandro, en español sencillo: qué botellas tienen imagen nueva y con qué generador,
cuáles se quedan con silueta y por qué, y el resultado de los tests.
===== FIN =====

────────────────────────────────────────
id: salida · tipo: Salida · título: Resultado

CONEXIONES
1. brief → fichas
2. brief → gen-gemini
3. brief → gen-codex
4. brief → seleccion
5. brief → recorte
6. brief → rev-producto
7. brief → rev-coherencia
8. brief → correcciones
9. fichas → gen-gemini
10. fichas → gen-codex
11. fichas → union-candidatas
12. gen-gemini → union-candidatas
13. gen-codex → union-candidatas
14. union-candidatas → seleccion
15. seleccion → recorte
16. recorte → rev-producto
17. recorte → rev-coherencia
18. recorte → union-revision
19. rev-producto → union-revision
20. rev-coherencia → union-revision
21. union-revision → correcciones
22. correcciones → salida
