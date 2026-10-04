# Flujo de Orquesta: imágenes de Premium («Resto») y BoldCrew

Copia **todo lo que hay debajo de la línea** y pégalo en «Crear con IA».

Antes de ejecutar el flujo:

- Carpeta de trabajo: `C:\Users\mrani\inventariovessel`, en la rama `claude/determined-mayer-kd98oe`
  (haz `git pull` antes). Nunca en `main`.
- Si en `C:\Users\mrani\inventariovessel\assets` quedan restos de ejecuciones anteriores, bórralos.
- Orquesta puede limitar cuántos bloques corren a la vez: si es así, los generadores esperan su turno.

---

Crea un flujo llamado «Vessel · Imágenes de Premium y BoldCrew». Sigue esta especificación al pie de la
letra.

REGLAS PARA CONSTRUIR EL FLUJO
1. Crea exactamente los 19 bloques listados, con el id, tipo, proveedor, modelo, permiso y título indicados.
2. Las instrucciones de cada bloque son el texto entre «===== INSTRUCCIONES =====» y «===== FIN =====».
   Cópialas literalmente y completas: no las resumas, traduzcas, reordenes ni añadas nada.
3. Crea exactamente las conexiones de la sección CONEXIONES y ninguna más. Si Orquesta exige un Merge para
   que un bloque reciba varias entradas, añade un Merge por cada bloque destino que lo necesite, sin cambiar
   nada más.
4. Sin bucles ni reintentos entre bloques.
5. Los bloques de «lectura» no escriben archivos. Los de «escritura» sí pueden escribir y ejecutar comandos
   en la carpeta de trabajo.

ESTRUCTURA
- Fase 0. «brief» (Entrada): contexto, las 30 botellas, el formato de imagen y las instrucciones comunes de
  generación. Se conecta a todos los bloques IA.
- Fase 1. «buscador» (Claude Opus): elige la mejor imagen de referencia de cada botella (oficial o de
  tienda), la descarga y escribe una ficha por botella.
- Fase 2. Diez generadores de Codex, «gen-01» a «gen-10», a la vez: cada uno hace 3 botellas.
- Fase 3. «union-generacion» (Merge) → «recorte» (Codex): quita el fondo y deja las 30 imágenes con el
  mismo formato que las actuales, y prepara hojas de comparación.
- Fase 4. «revisor» (Claude Opus, lectura): compara cada imagen nueva con su referencia y da visto bueno o
  malo, explicando qué está mal.
- Fase 5. «rehacer» (Codex): rehace solo las que están mal, con las indicaciones del revisor.
- Fase 6. «revisor-final» (Claude Sonnet, lectura): revisa las rehechas y la coherencia del conjunto.
- Fase 7. «cierre» (Codex): quita lo que siga mal, deja el manifest final, pasa los tests, commit y push a
  la rama actual. Luego «salida».

BLOQUES

────────────────────────────────────────
id: brief · tipo: Entrada · título: Brief común
===== INSTRUCCIONES =====
PROYECTO: «Vessel · Reposición», web app de reposición e inventario de una discoteca. El repositorio es la
carpeta de trabajo actual. HTML/CSS/JS sin build en public/; servidor Node en server/.

OBJETIVO: hacer de nuevo, con un formato único y limpio, la imagen de catálogo de las 29 botellas del grupo
Premium (en la app se llama «Resto») y la de BoldCrew Original: 30 en total. Las fotos que tienen ahora no
siguen el formato y algunas son de otro producto. Esta ejecución solo hace imágenes: no toca la base de
datos, ni el catálogo, ni el código de la app.

FORMATO OBLIGATORIO DE CADA IMAGEN (igual que las 20 que ya hay en public/img/botellas/*.png)
- public/img/botellas/<slug>.png: PNG con fondo transparente, 512×683 px, menos de 150 KB.
- Una sola botella, de frente, a la altura de la etiqueta, entera (tapón y base dentro), centrada, al 94 %
  de la altura del lienzo y con la base a la misma altura que las actuales.
- Foto de estudio realista: luz suave y uniforme, reflejos discretos, sin sombra proyectada, sin reflejo en
  el suelo, sin manos, sin atrezo, sin texto añadido.
- Referencia de estilo: public/img/botellas/larios-12.png, j-b-rare.png, brugal-anejo.png y cutty-sark.png.
- public/img/botellas/manifest.json asocia el slug con su archivo:
  "<slug>": { "file": "<slug>.png", "model": "openai-imagegen", "refs": [<urls>], "confidence": "alta|media",
  "generated_at": "AAAA-MM-DD" }. La app usa el PNG del manifest antes que cualquier otra foto, así que no
  hace falta tocar la base de datos. Las 20 entradas que ya hay en el manifest y sus PNG NO se tocan.

LAS 30 BOTELLAS (slug → producto exacto, 70 cl salvo que se diga otra cosa)
Lote 01: brockmans → Brockmans Gin · bulldog-london-dry → Bulldog London Dry Gin · gvine-floraison → G’Vine Floraison
Lote 02: hendricks → Hendrick’s Gin · macaronesian-white-gin → Macaronesian Gin (botella blanca) · martin-millers → Martin Miller’s Gin
Lote 03: nordes → Nordés Gin (la del local: Limited Edition Nº2, blanca con dibujos marinos azules) · roku → Roku Gin · zeeland-pink-n12 → Zeeland Pink Gin Nº12
Lote 04: beluga-noble → Beluga Noble Vodka (Export) · belvedere-organic → Belvedere Organic Vodka · titos-handmade-vodka → Tito’s Handmade Vodka
Lote 05: ciroc-original → Cîroc Vodka · ciroc-apple → Cîroc Apple · ciroc-red-berry → Cîroc Red Berry
Lote 06: ciroc-french-vanilla → Cîroc French Vanilla · ciroc-pineapple → Cîroc Pineapple · don-julio-reposado → Don Julio Reposado
Lote 07: chivas-regal-12 → Chivas Regal 12 · glenmorangie-the-original → Glenmorangie The Original 10 · monkey-shoulder → Monkey Shoulder
Lote 08: the-macallan-12 → The Macallan 12 Double Cask · boldcrew-original → BoldCrew Original Blended Scotch Whisky · zacapa → Ron Zacapa Centenario Solera Gran Reserva 23
Lote 09: abuelo-12 → Ron Abuelo 12 Años · abuelo-anejo → Ron Abuelo Añejo · barcelo-imperial → Barceló Imperial
Lote 10: brugal-1888 → Brugal 1888 · brugal-doble-reserva → Brugal Doble Reserva · flor-de-cana-12 → Flor de Caña 12 Años

FOTOS DEL LOCAL: docs/catalogo/referencias/<slug>.jpg son recortes de fotos reales de la contrabarra de
Vessel. Existen para todas menos ciroc-pineapple, don-julio-reposado, chivas-regal-12, monkey-shoulder,
abuelo-12 y abuelo-anejo. Mandan sobre cualquier imagen web cuando no coincidan (diseño de etiqueta, color,
tapón, malla). No sirven como imagen limpia: están oscuras y recortadas.

CARPETAS DE TRABAJO (assets/ está en .gitignore y no se sube)
- assets/premium/fichas.json y assets/premium/referencias/<slug>.<ext>: las escribe el buscador.
- assets/premium/bruto/<slug>.png: las escriben los generadores.
- assets/premium/revision/: hojas de comparación del recorte.

INSTRUCCIONES DE GENERACIÓN (comunes a gen-01 … gen-10 y a rehacer)
Para cada botella de tu lote:
1. Lee su ficha en assets/premium/fichas.json. Abre la referencia descargada
   (assets/premium/referencias/<slug>.<ext>) y, si existe, la foto del local
   (docs/catalogo/referencias/<slug>.jpg).
2. Genera la imagen con tu herramienta de generación de imágenes (openai-imagegen), usando la referencia
   descargada como imagen de entrada y este encargo: "Re-photograph this exact bottle as a professional
   studio packshot: " + el prompt de la ficha. Si la herramienta no admite imagen de entrada, genera solo
   con el prompt.
3. Guarda el resultado en assets/premium/bruto/<slug>.png.
4. Ábrelo y compruébalo contra la referencia: botella entera con tapón y base, de frente, fondo blanco
   liso, una sola botella, forma, colores, tapón y distintivos correctos, y textos de etiqueta iguales a
   los de la ficha, sin letras inventadas ni deformes. Si falla algo, haz UN único reintento corrigiendo el
   encargo. Si vuelve a fallar, deja la mejor de las dos y anótalo.
No toques nada fuera de assets/premium/bruto/.
Devuelve una tabla slug → estado (ok | reintentada-ok | dudosa) → nota, y el mismo contenido en un bloque
```json``` [{slug, status, note}].

REGLAS PARA TODOS
- La petición original manda. Las correcciones que ya están en la rama se mantienen aunque no aparezcan en
  esta petición.
- No inventes texto en las etiquetas: solo marca, expresión y lo que se lea con seguridad.
- Solo se tocan: assets/, scripts/images/, public/img/botellas/ (las 30 nuevas y el manifest) y
  public/img/botellas/CREDITOS.md.
- Nunca push a main.
===== FIN =====

────────────────────────────────────────
id: buscador · tipo: IA · proveedor: Claude · modelo: Opus · permiso: escritura · título: Buscador de referencias
===== INSTRUCCIONES =====
Para cada una de las 30 botellas del brief, busca en la web (WebSearch y WebFetch) la mejor imagen de
referencia de la expresión exacta, con este orden de preferencia:
1. Web oficial de la marca o del grupo (packshot de producto).
2. Tienda online fiable (El Corte Inglés, Drinks&Co, Uvinum, Bodeboca, The Whisky Exchange, Master of
   Malt, Open Food Facts…).
3. Otras fuentes, solo si no hay nada de lo anterior.

Requisitos de la imagen elegida: botella sola, de frente, entera, fondo liso (blanco o transparente), al
menos 600 px de alto y con la etiqueta legible. Si existe la foto del local (docs/catalogo/referencias/
<slug>.jpg), la referencia tiene que tener el MISMO diseño de etiqueta y botella que la del local; si el
diseño actual de la marca no coincide con el del local, busca el que coincide.

Para cada botella:
- Descarga la imagen elegida con `curl -L --max-time 20 -A "Mozilla/5.0"` en
  assets/premium/referencias/<slug>.<ext>. Ábrela y comprueba que es la botella correcta; si no, prueba la
  siguiente.
- Escribe su ficha.

Escribe assets/premium/fichas.json: un array con un elemento por botella:
- slug, nombre, lote;
- referencia: ruta local descargada; ref_url: URL directa de la imagen; ref_pagina: página de origen;
  tipo_fuente: "oficial" | "tienda" | "otra";
- confidence: "alta" (oficial o tienda y coincide con el local) o "media" (hay variantes o no hay foto del
  local);
- botella, vidrio, liquido, tapon, etiquetas (con los textos EXACTOS que se leen con seguridad) y
  distintivos (malla, banda de palma, sello, relieve…);
- diferencias_con_local: si las hay;
- prompt: en inglés, con esta plantilla rellenada:
  "Professional studio product photograph of a single bottle of <nombre exacto>, <botella>, <vidrio>,
  <liquido>, <tapon>, <etiquetas con textos exactos>, <distintivos>. Front view at label height, entire
  bottle visible including cap and base, centered, bottle fills 90% of frame height, portrait 3:4. Pure
  white seamless background (#FFFFFF), soft even lighting, gentle reflections, no cast shadow, no props,
  no hands, no extra text, photorealistic, ultra sharp label."

No escribas nada fuera de assets/premium/. Devuelve una tabla slug → tipo_fuente → confidence → ref_pagina,
y termina con «RESUMEN: N referencias, O oficiales, T de tienda, X otras».
===== FIN =====

────────────────────────────────────────
id: gen-01 · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Generación · Lote 01
===== INSTRUCCIONES =====
Te toca el LOTE 01: brockmans, bulldog-london-dry, gvine-floraison. Sigue las INSTRUCCIONES DE GENERACIÓN
del brief.
===== FIN =====

────────────────────────────────────────
id: gen-02 · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Generación · Lote 02
===== INSTRUCCIONES =====
Te toca el LOTE 02: hendricks, macaronesian-white-gin, martin-millers. Sigue las INSTRUCCIONES DE
GENERACIÓN del brief.
===== FIN =====

────────────────────────────────────────
id: gen-03 · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Generación · Lote 03
===== INSTRUCCIONES =====
Te toca el LOTE 03: nordes, roku, zeeland-pink-n12. Sigue las INSTRUCCIONES DE GENERACIÓN del brief.
===== FIN =====

────────────────────────────────────────
id: gen-04 · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Generación · Lote 04
===== INSTRUCCIONES =====
Te toca el LOTE 04: beluga-noble, belvedere-organic, titos-handmade-vodka. Sigue las INSTRUCCIONES DE
GENERACIÓN del brief.
===== FIN =====

────────────────────────────────────────
id: gen-05 · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Generación · Lote 05
===== INSTRUCCIONES =====
Te toca el LOTE 05: ciroc-original, ciroc-apple, ciroc-red-berry. Sigue las INSTRUCCIONES DE GENERACIÓN
del brief. Las tres comparten botella: que el color del círculo, del líquido y el texto de la variedad
sean los de cada una.
===== FIN =====

────────────────────────────────────────
id: gen-06 · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Generación · Lote 06
===== INSTRUCCIONES =====
Te toca el LOTE 06: ciroc-french-vanilla, ciroc-pineapple, don-julio-reposado. Sigue las INSTRUCCIONES DE
GENERACIÓN del brief.
===== FIN =====

────────────────────────────────────────
id: gen-07 · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Generación · Lote 07
===== INSTRUCCIONES =====
Te toca el LOTE 07: chivas-regal-12, glenmorangie-the-original, monkey-shoulder. Sigue las INSTRUCCIONES DE
GENERACIÓN del brief.
===== FIN =====

────────────────────────────────────────
id: gen-08 · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Generación · Lote 08
===== INSTRUCCIONES =====
Te toca el LOTE 08: the-macallan-12, boldcrew-original, zacapa. Sigue las INSTRUCCIONES DE GENERACIÓN del
brief.
===== FIN =====

────────────────────────────────────────
id: gen-09 · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Generación · Lote 09
===== INSTRUCCIONES =====
Te toca el LOTE 09: abuelo-12, abuelo-anejo, barcelo-imperial. Sigue las INSTRUCCIONES DE GENERACIÓN del
brief.
===== FIN =====

────────────────────────────────────────
id: gen-10 · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Generación · Lote 10
===== INSTRUCCIONES =====
Te toca el LOTE 10: brugal-1888, brugal-doble-reserva, flor-de-cana-12. Sigue las INSTRUCCIONES DE
GENERACIÓN del brief. Brugal 1888 y Doble Reserva llevan malla de cordel: que se vea entera y bien
anudada.
===== FIN =====

────────────────────────────────────────
id: union-generacion · tipo: Merge · título: Unión de la generación
(Junta las salidas de gen-01 a gen-10, en ese orden.)

────────────────────────────────────────
id: recorte · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Recorte, formato y hojas de comparación
===== INSTRUCCIONES =====
Recibes los informes de los 10 generadores.

1. Entorno de Python fuera del repo (si no existe): `python -m venv ~/.cache/vessel-img` e instala
   scripts/images/requirements.txt en él.
2. scripts/images/process.py ya existe y recorta con el formato correcto. Adáptalo para que, además de su
   lista actual, pueda procesar una lista leída de un JSON (assets/premium/seleccion.json:
   [{slug, file, source, model, refs, confidence}]), sin cambiar lo que ya hace con cutty-sark y
   flor-de-cana-anejo-reserva. Escribe ese JSON con las 30 botellas: source =
   assets/premium/bruto/<slug>.png; refs = [ref_url, ref_pagina] y confidence de assets/premium/fichas.json.
3. Ejecútalo para las 30: quita el fondo, elimina halos, recorta, escala al 94 % de 683 px de alto (sin
   pasar del 90 % de 512 px de ancho), centra con la base a la altura de larios-12.png y j-b-rare.png, y
   guarda public/img/botellas/<slug>.png por debajo de 150 KB. Añade las 30 entradas al manifest sin tocar
   las 20 que ya hay.
4. Si alguna queda cortada, con restos de fondo o deforme, ajusta los parámetros de ese slug. No regeneres.
5. Hojas de comparación en assets/premium/revision/<slug>.png: a la izquierda la referencia
   (assets/premium/referencias/<slug>.*), en el centro la foto del local si existe, y a la derecha el PNG
   nuevo sobre blanco y sobre #111214. Y una hoja de conjunto assets/premium/revision/_todas.png con las 30
   nuevas junto a larios-12 y cutty-sark sobre #111214.

Sin commit ni push. Informe: tabla slug → KB → ajustes → incidencias.
===== FIN =====

────────────────────────────────────────
id: revisor · tipo: IA · proveedor: Claude · modelo: Opus · permiso: lectura · título: Revisor (referencia frente a imagen nueva)
===== INSTRUCCIONES =====
Para cada una de las 30 botellas, abre su hoja assets/premium/revision/<slug>.png y, si hace falta más
detalle, la referencia, la foto del local y public/img/botellas/<slug>.png. Lee su ficha en
assets/premium/fichas.json.

Compara la imagen nueva con la referencia y con la foto del local:
- ¿Es el mismo producto y la misma expresión? Forma de la botella, hombros, cuello, tapón, color del vidrio
  y del líquido, distintivos (malla, banda, sello, relieve).
- ¿Los textos de la etiqueta son los correctos y legibles, sin letras inventadas ni deformes?
- ¿Está entera, de frente, sin halo ni restos de fondo, del mismo tamaño y a la misma altura que las demás?
- ¿Parece una foto real, no un dibujo?

No escribas archivos. Devuelve un bloque ```json``` con un elemento por botella:
{slug, veredicto: "ok" | "mal", gravedad: "producto" | "texto" | "forma" | "recorte" | null,
que_esta_mal: "descripción concreta", como_arreglarlo: "instrucción concreta para regenerarla o recortarla",
prompt_corregido: "el prompt de la ficha con las correcciones, en inglés" (solo si veredicto es "mal")}.
Sé exigente: «ok» solo si la reconocerías sin dudar en la estantería.
Termina con «RESUMEN: N ok, M mal».
===== FIN =====

────────────────────────────────────────
id: rehacer · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Rehacer las que están mal
===== INSTRUCCIONES =====
Recibes el veredicto del revisor. Si todas están «ok», dilo y termina sin tocar nada.

Para cada botella con veredicto «mal»:
- Si la gravedad es «recorte»: vuelve a procesarla con scripts/images/process.py ajustando sus parámetros,
  sin regenerarla.
- Si no: regénerala siguiendo las INSTRUCCIONES DE GENERACIÓN del brief, pero con el prompt_corregido y
  aplicando como_arreglarlo. Sobrescribe assets/premium/bruto/<slug>.png y vuelve a procesarla con
  scripts/images/process.py. Actualiza su hoja assets/premium/revision/<slug>.png.
Un único intento por botella.

Sin commit ni push. Devuelve un bloque ```json``` [{slug, accion: "regenerada" | "recortada", nota}].
===== FIN =====

────────────────────────────────────────
id: revisor-final · tipo: IA · proveedor: Claude · modelo: Sonnet · permiso: lectura · título: Revisión final y coherencia
===== INSTRUCCIONES =====
1. Para cada botella que rehacer haya tocado, repite la revisión del bloque revisor con su hoja actualizada
   y di «ok» o «mal» con el motivo.
2. Abre assets/premium/revision/_todas.png y comprueba que las 30 nuevas encajan con las actuales: mismo
   tamaño, misma línea de base, luz y realismo parecidos, sin halos sobre fondo oscuro.
3. Comprueba que public/img/botellas/manifest.json es JSON válido, que las 20 entradas anteriores siguen
   igual y que cada PNG nuevo mide 512×683 y pesa menos de 150 KB.

No escribas archivos. Devuelve un bloque ```json``` [{slug, veredicto_final: "ok" | "quitar", motivo}] con
las 30 botellas (las que no rehacer no tocó y el revisor dio por «ok» quedan «ok» salvo que veas un fallo
claro en la hoja de conjunto), más una lista de problemas de coherencia si los hay.
===== FIN =====

────────────────────────────────────────
id: cierre · tipo: IA · proveedor: Codex · modelo: el Codex por defecto · permiso: escritura · título: Cierre, tests, commit y push
===== INSTRUCCIONES =====
1. Para cada botella con veredicto_final «quitar»: borra su PNG y su entrada del manifest. Esa botella
   seguirá con la foto que tenía.
2. Corrige los problemas de coherencia que sean de recorte o alineación volviendo a ejecutar
   scripts/images/process.py para ese slug. No regeneres.
3. CREDITOS.md: añade una sección con las botellas nuevas, el modelo (openai-imagegen) y la fuente de
   referencia de cada una, indicando que son representaciones generadas a partir de imágenes oficiales o de
   tienda y de fotos del local, no fotografías oficiales.
4. Comprueba que manifest.json es válido y que `git diff public/img/botellas/manifest.json` solo añade
   entradas. Ejecuta `npm test`: todos deben pasar.
5. Un único commit con los PNG nuevos, el manifest, CREDITOS.md y scripts/images/ (assets/ no se sube),
   con el mensaje «Imágenes nuevas de Premium y BoldCrew». Push a la rama actual. Nunca a main y nunca
   --force. No despliegues.

Informe final para Alejandro, en español sencillo: cuántas botellas tienen imagen nueva, cuáles se han
rehecho y por qué, cuáles se han quitado y siguen con la foto antigua, y el resultado de los tests.
===== FIN =====

────────────────────────────────────────
id: salida · tipo: Salida · título: Resultado

CONEXIONES
1. brief → buscador
2. brief → gen-01
3. brief → gen-02
4. brief → gen-03
5. brief → gen-04
6. brief → gen-05
7. brief → gen-06
8. brief → gen-07
9. brief → gen-08
10. brief → gen-09
11. brief → gen-10
12. brief → recorte
13. brief → revisor
14. brief → rehacer
15. brief → revisor-final
16. brief → cierre
17. buscador → gen-01
18. buscador → gen-02
19. buscador → gen-03
20. buscador → gen-04
21. buscador → gen-05
22. buscador → gen-06
23. buscador → gen-07
24. buscador → gen-08
25. buscador → gen-09
26. buscador → gen-10
27. gen-01 → union-generacion
28. gen-02 → union-generacion
29. gen-03 → union-generacion
30. gen-04 → union-generacion
31. gen-05 → union-generacion
32. gen-06 → union-generacion
33. gen-07 → union-generacion
34. gen-08 → union-generacion
35. gen-09 → union-generacion
36. gen-10 → union-generacion
37. union-generacion → recorte
38. recorte → revisor
39. revisor → rehacer
40. revisor → revisor-final
41. rehacer → revisor-final
42. revisor-final → cierre
43. cierre → salida
