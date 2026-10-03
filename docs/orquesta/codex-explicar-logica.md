# Prompt para Codex · Entender la lógica de la app

En PowerShell, una línea cada vez: `cd C:\Users\mrani\inventariovessel`, `git switch main`, `git pull` y
`codex` (no hace falta acceso total). Pega el texto de abajo.

---

Tarea: entender y explicarme, de forma sencilla, cómo funciona por dentro la app «Vessel · Reposición». La carpeta actual es el repositorio. Yo no programo: quiero entender la lógica, no el código.

REGLAS
- No cambies ningún archivo de la app ni hagas commits. Lo único que puedes crear es el documento final docs/como-funciona.md y, si te hacen falta, scripts de prueba en tmp-capturas\logica\ (esa carpeta no se sube a git).
- Nunca uses DATABASE_URL ni toques producción, Supabase o Cloudflare. Si quieres comprobar un cálculo, hazlo con un ejemplo en una base PGlite en memoria, como hacen los tests de test/.
- No inventes: cada regla que expliques tiene que salir del código o de los tests. Si algo no está claro, dilo como duda.

DÓNDE MIRAR
- README.md y PRODUCT.md: lo que hace la app. Si existen docs/rediseno/fase-1.md y fase-2.md, son lo que se pidió en el rediseño.
- server/services.js: pedidos de barra (createRequest), Reponer y «Hecho» (completeLines, deliver, undoDelivery), «agotado en almacén» (setOutOfStock), correcciones e informes.
- server/almacen.js: puntos de In Vessel, stock teórico por punto (stockRows), consumo semanal (consumption), recuentos (saveCounts), roturas (addBreakage), «Mover a…» (addTransfer), entradas de mercancía (addEntries) y sugerencias (suggestions).
- server/viaje.js: el Pedido o viaje de Out Vessel a In Vessel (tripView, addTripLine, finishTrip).
- server/necesidades.js: Agotados y el ticket de Necesidades (recomendación en cajas, ajustes y «Añadir al pedido»).
- server/control.js: descuadres, historial y anular movimientos.
- server/dates.js: la «noche de trabajo» (lo de antes de las 12:00 cuenta para la noche anterior).
- server/stock-operation.js: protección contra pulsar dos veces o reintentos.
- supabase/migrations/: qué se guarda (tablas).
- test/: los ejemplos de los tests ayudan a confirmar cada regla.

QUÉ QUIERO EN docs/como-funciona.md (en español, frases cortas, con ejemplos con números)
1. El mapa general en 10 líneas: qué lugares existen (Out Vessel y los 9 puntos de In Vessel) y por dónde viaja una botella desde que llega de proveedor hasta que se sirve en barra.
2. El recorrido de una botella, paso a paso, con un ejemplo inventado de números (por ejemplo, 2 cajas de Tanqueray de 6). Para cada paso: qué botón se pulsa, quién lo hace, qué guarda la app y qué número cambia en cada sitio.
   - Entrada de mercancía en Out Vessel.
   - Necesidades → «Añadir al pedido» → Pedido → «Hecho» (traslado a In Vessel).
   - Pedir desde la barra → Reponer → «Hecho».
   - «Mover a…» entre puntos, rotura y «agotado en almacén».
   - Contar un punto.
3. Cómo se calcula el stock teórico de un punto: la fórmula en palabras y un ejemplo. Qué pasa si nunca se ha contado, y qué pasa si dos cosas ocurren a la misma hora.
4. Descuadre frente a «Consumo desde el último recuento»: en qué puntos sale cada uno y por qué, con un ejemplo de cada.
5. Cómo se calcula el consumo semanal y la recomendación del ticket de Necesidades (en cajas): la fórmula en palabras, qué datos usa, cuándo no recomienda nada y por qué, qué es la rotación alta, media o baja, y un ejemplo con números.
6. Qué es un «Agotado» y de dónde sale.
7. La noche de trabajo: ejemplo de un pedido a las 03:00 del sábado y a qué noche cuenta.
8. Qué pasa si dos móviles hacen lo mismo a la vez (dos «Hecho», dos «Añadir al pedido») y cómo se corrigen los errores sin borrar nada.
9. Tabla resumen: acción del usuario → qué se guarda → qué números cambia.
10. Dudas y cosas raras: lo que te parezca incoherente, frágil o distinto de lo que dicen README o las peticiones de fase. Cada punto con dónde está (archivo y función) y por qué te lo parece. Solo explícalo, no lo arregles.

Al terminar, dime en el chat, en 5 o 6 líneas, lo más importante que debo saber y los 3 puntos de «Dudas y cosas raras» que más te preocupan.
