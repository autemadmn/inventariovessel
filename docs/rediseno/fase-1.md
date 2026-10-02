# Fase 1 · In Vessel por puntos: mapa, inventario por punto, estantería y descuadres

Esta es la **petición** de la fase 1. Manda sobre cualquier plan intermedio. La fuente es
`docs/rediseno/propuesta.md` (con `img/plano-vessel.jpg` y `img/maqueta-estanteria.jpg`). Donde la
propuesta y este archivo no coinciden, manda este archivo: recoge lo que el usuario ha decidido
después.

La pestaña «Viajes» y las necesidades de pedido son de la **fase 2** (`fase-2.md`). No se hacen aquí.

## Decisiones ya tomadas (no se discuten)

- **Almacén** sigue con el selector de arriba «In Vessel · Out Vessel».
  - **In Vessel** pasa a ser el **mapa del local**. Cada punto del mapa tiene su propio inventario.
  - **Out Vessel** (el almacén de fuera, la «warehouse») sigue siendo un **único inventario**, igual
    que ahora. Se mantienen las entradas de mercancía. No lleva mapa.
- **Barra inferior:** sigue con 4 pestañas en esta fase (Pedir · Reponer · Almacén · Gestión). La
  quinta («Viajes») llega en la fase 2.
- **Alcance:** se dibujan **todos** los puntos del plano: neveras, almacén de cerveza y refrescos,
  chupitería y barra VIP. Todos se pueden abrir y contar.
  - El catálogo solo tiene alcohol fuerte. **No se inventan productos.**
  - Se añaden las categorías «Cervezas», «Refrescos» y «Vinos» para que el encargado dé de alta
    esos productos desde Catálogo. Hasta entonces, esos puntos salen vacíos, con un mensaje que
    explica cómo añadirlos.
- El viaje Out → In Vessel actual **se queda donde está** en esta fase. Solo cambia a qué punto llega
  la mercancía (ver «Movimientos»).

## Puntos de In Vessel (según el plano)

| Clave | Nombre en la app | Tipo | Número en el plano | Qué guarda |
| --- | --- | --- | --- | --- |
| `alm-alcohol` | Almacén alcohol | almacén | 3 | alcohol fuerte |
| `nevera-vino` | Nevera de vino | nevera | 3 (dentro del almacén de alcohol) | vino |
| `alm-cerveza` | Almacén cerveza y refrescos | almacén | 2 (las **dos** zonas marcadas con 2 abren este mismo punto) | cerveza caliente, refrescos |
| `neveras-cerveza` | Neveras de cerveza | nevera | 1 (8 neveras en 4 parejas; un único punto) | cerveza fría |
| `neveras-especial` | Neveras cerveza especial | nevera | 4 (ver nota) | cerveza especial |
| `chupiteria` | Nevera chupitería | nevera | 5 (cuadrado negro) | alguna cerveza y alcohol de chupito |
| `barra-1` | Barra 1 | barra | Barra 1 | de todo; enlazada con la barra 1 de Pedir/Reponer |
| `barra-2` | Barra 2 | barra | Barra 2 | de todo; enlazada con la barra 2 de Pedir/Reponer |
| `barra-vip` | Barra VIP | barra | dentro de la zona VIP | de todo; **no** sale en Pedir ni Reponer |

**Nota sobre el punto 4.** La leyenda del plano lo describe, pero el número no aparece dibujado.
Colócalo provisionalmente en los dos cuadrados pequeños que hay junto a la puerta, bajo la «Zona
descanso» y a la izquierda de la columna de neveras. Debe poder moverse cambiando una sola línea del
archivo de datos del mapa. Avisa de ello en el informe final.

Los nombres de los puntos se pueden renombrar desde Ajustes (engranaje), igual que las barras. Los
puntos no se crean ni se borran desde la app en esta fase: el mapa es fijo.

## Mapa de In Vessel

- Es un **SVG dibujado con datos** (un archivo de datos del mapa con coordenadas y la clave de cada
  punto). **No** se usa la foto del plano como fondo.
- Respeta la distribución real y las proporciones aproximadas del plano: zona pública a la izquierda
  (Barra 1 abajo y Barra 2 encima, en la pared izquierda; pista «Normal»; DJ arriba a la izquierda;
  VIP arriba; salas de entrada abajo; baños en el centro) y la franja del personal a la derecha
  (pasillo hacia el VIP abajo, almacén de cerveza y refrescos, sala del personal, columna de
  neveras, chupitería arriba de esa columna y almacén de alcohol arriba a la derecha).
- Lenguaje visual de Vessel: líneas limpias, etiquetas compactas y zonas seleccionables. Lo que no
  es punto de almacenaje (baños, DJ, salas de entrada, zona de descanso, sala del personal, pista)
  se dibuja tenue, como contexto, y no se puede pulsar.
- Usa los tokens de color de `app.css` y funciona en claro y en oscuro (la app sigue el ajuste del
  móvil). La propuesta habla de «fondo oscuro»: en modo oscuro tiene que verse así.
- El dibujo cabe en el ancho del móvil (390 px) sin scroll horizontal. Cada punto tiene una zona
  táctil de al menos 44 × 44 px, aunque en el plano sea pequeño (por ejemplo, la chupitería).
- Cada punto es un elemento enfocable con nombre accesible. Debajo del mapa hay una **lista de los
  puntos** (nombre, tipo y estado) que hace lo mismo: alternativa accesible y atajo rápido.
- Estado discreto en cada punto: «sin contar nunca», «con descuadre en el último recuento» o normal.
  Sin neones ni brillos.
- Bajo el mapa sigue estando el acceso a la **vista en lista de todo In Vessel** (la suma de todos
  los puntos), con las secciones actuales (No queda, Queda poco, Sin contar…), para no perder lo que
  ya funciona.
- Rutas con hash, por ejemplo `#/almacen/in` (mapa) y `#/almacen/in/<clave>` (punto). El botón atrás
  del móvil vuelve al mapa.

## Inventario de un punto: la estantería

Como `img/maqueta-estanteria.jpg`, adaptado al estilo actual de la app:

- Arriba: nombre del punto y un selector **«Contar · Consultar»**.
  - **Contar** (por defecto): recuento a ciegas, como ahora. Las tarjetas no muestran cifras
    esperadas y los campos de cantidad empiezan vacíos.
  - **Consultar:** las tarjetas muestran el stock teórico del punto (en cajas y sueltas si se sabe
    cuántas botellas tiene una caja) y la fecha del último recuento. Al tocar una botella se abre su
    ficha de ese punto (historial, rotura, mover).
- Pestañas compactas de categoría con scroll horizontal. Solo salen las categorías con productos en
  ese punto, en este orden: Ginebras, Rones, Vodkas, Whiskies, Tequila, Cervezas, Refrescos, Vinos,
  Otros.
- Rejilla de tarjetas compactas (imagen + nombre) dentro de una estantería dibujada con CSS, sobria.
  Imagen con la prioridad actual: PNG «flotando», después foto y, si no hay, silueta neutra.
  - En el móvil son 3 o 4 tarjetas por fila; hay que comprobar que caben a 390 px sin cortar nombres
    de forma ilegible.
- Al tocar una botella en modo Contar se queda seleccionada y aparece un **panel fijo abajo**, encima
  de la barra de pestañas, con: imagen, nombre, «Cajas − [ ] +» (con «de N» si se sabe cuántas
  botellas lleva una caja), «Botellas − [ ] +» y el botón **«Hecho»**.
  - Si no se sabe cuántas botellas lleva una caja, solo sale «Botellas».
  - «Hecho» guarda el recuento de ese punto, marca la tarjeta como contada y pasa sola a la
    siguiente botella de la estantería.
  - En los almacenes, si lo contado no coincide con lo esperado, la tarjeta muestra después el
    descuadre (por ejemplo «−3 cajas» o «−5 botellas»). Antes de contar, nunca.
- Se reutiliza lo que ya existe: los campos de recuento, la cola para cuando no hay conexión, la
  clave anti-duplicados y el bloqueo por almacén.
- **Qué productos salen en un punto:** los que tienen ese punto como «punto principal», los que tienen
  stock o algún recuento allí, y, en las barras, los productos activos de la selección de Pedir.
  - Un botón «Añadir botella a este punto» permite buscar cualquier producto del catálogo y
    contarlo allí.
  - Punto vacío: mensaje claro, por ejemplo «Aún no hay productos aquí. Da de alta cervezas y
    refrescos en Gestión › Catálogo», sin inventar nada.
- Sigue existiendo el modo «Contar» guiado actual, ahora por punto.

## Movimientos entre puntos (requisito de la propuesta)

Para que los descuadres sean fiables, todo cambio de sitio se registra:

- **Punto principal de cada producto.** Cada producto tiene un «punto principal»: el almacén donde se
  guarda. Por defecto va según su categoría:
  - alcohol fuerte y «Otros» → Almacén alcohol;
  - cervezas y refrescos → Almacén cerveza y refrescos;
  - vinos → Nevera de vino.

  Se puede cambiar en la ficha del producto (Catálogo).
- **Reponer «Hecho»** (sin cambiar cómo se usa Reponer): lo repuesto sale del punto principal del
  producto y entra en el punto de la barra correspondiente (Barra 1 o Barra 2).
- **Viaje Out → In Vessel «Hecho»:** cada línea entra en el punto principal de su producto (antes
  entraba en «In Vessel»).
- **Mover:** desde la ficha de una botella en un punto, «Mover a…» elige el destino y la cantidad
  (cajas y botellas) y registra un traslado entre los dos puntos.
- **Roturas:** se registran en el punto donde ocurren (ahora siempre van a In Vessel).
- Los traslados se pueden anular desde el historial, como ahora, con motivo y sin borrar nada.

## Stock teórico y descuadres por punto

- Igual que ahora, pero por punto:
  - el punto de partida es el último recuento de ese punto;
  - se suma lo que entra (viajes, traslados recibidos, reposiciones recibidas si es una barra);
  - se resta lo que sale (traslados enviados, reposiciones a barras si es el punto principal,
    roturas).
- **Almacenes** (Almacén alcohol y Almacén cerveza y refrescos): las salidas se registran, así que
  la diferencia al contar es un **descuadre** de verdad. Sale en Gestión › Descuadres con el nombre
  del punto, y el mapa lo marca.
- **Barras y neveras:** la app no registra ventas (es independiente de Ágora) ni cada cerveza que se
  saca de una nevera. Allí la diferencia al contar no es una pérdida.
  - Se muestra como «**Consumo desde el último recuento**» (último recuento + entradas − salidas −
    recuento nuevo), con una frase que lo explica.
  - No cuenta como descuadre ni sale en la lista de descuadres.
- Gestión › Descuadres: se añade el nombre del punto en cada fila, un filtro por punto y los totales
  por punto. Out Vessel sigue saliendo como hasta ahora.
- **In Vessel en total** (lista y avisos de «queda poco») = suma de todos los puntos de In Vessel.
  Los avisos de existencias siguen sin impedir pedir.

## Datos y migración

- Nueva migración idempotente `supabase/migrations/0005_puntos.sql` (se puede ejecutar varias veces
  sin duplicar nada). La migración:
  - añade a `stores` lo necesario: tipo de punto, clave del mapa, barra enlazada y si pertenece a In
    Vessel;
  - añade al producto su punto principal;
  - crea los puntos de la tabla de arriba.
- **No se pierde historia.** El almacén actual «In Vessel» (id 1) pasa a ser el punto «Almacén
  alcohol» con todos sus recuentos, movimientos y descuadres. Hoy todo el stock contado de In
  Vessel es alcohol fuerte del almacén de alcohol.
- Out Vessel (id 2) no cambia.
- Nada se borra. Los errores se corrigen y queda constancia (auditoría, como ahora).
- Las operaciones que tocan stock usan `SELECT … FOR UPDATE` más escritura condicional, como el resto
  de la app. Dos recuentos del mismo punto a la vez no se pisan.
- **Copia de seguridad JSON:** incluye lo nuevo. Una copia **antigua** (sin puntos) sigue
  importándose bien con `scripts/db/import-backup.mjs`: lo que era «In Vessel» va a «Almacén
  alcohol».
- Si cambia `server/catalog.js`, se regenera la semilla con `node scripts/db/build-seed.mjs`.
- **Las categorías nuevas no aparecen en Pedir** salvo que el encargado las meta en un grupo de la
  selección. Hay que comprobar cómo se comportan hoy los productos sin grupo y garantizarlo.
- La comprobación de migraciones del servidor (`server/schema.js`) detecta si falta la 0005 y da el
  mismo mensaje claro que con las anteriores.

## README

Añade al README una sección corta y en lenguaje llano: **«Actualizar Supabase a la fase 1 (puntos de
In Vessel)»**. Debe explicar:

- que hay que ejecutar `0005_puntos.sql` en el editor SQL de Supabase **antes** de publicar `main`;
- dónde pegarla y qué botón pulsar;
- qué mensaje sale si se olvida.

Ningún bloque toca producción.

## Fuera de esta fase

- La pestaña Viajes, «Agotados», «Necesidades», el ticket y «Pedido» (fase 2).
- Editar el mapa desde la app, crear puntos nuevos, VIP en Pedir/Reponer, ventas o Ágora.
- Productos nuevos inventados, fotos o PNG nuevos.

## Criterios de aceptación (los comprueba el bloque Comparador)

1. Almacén › In Vessel muestra el mapa SVG con los 9 puntos de la tabla en su sitio aproximado. Out
   Vessel sigue siendo una lista única.
2. Cada punto se abre al tocarlo en el mapa o en la lista de debajo, con zona táctil ≥ 44 px. Atrás
   vuelve al mapa.
3. El mapa y la estantería se ven bien a 390 × 844 en claro y en oscuro, sin scroll horizontal.
4. La estantería tiene pestañas de categoría, tarjetas con imagen, panel inferior con Cajas, Botellas
   y «Hecho», y pasa sola a la siguiente botella.
5. En modo Contar no se ve ninguna cifra esperada antes de guardar. En modo Consultar se ve el stock
   teórico del punto.
6. Reponer «Hecho» resta del punto principal y suma a la barra. El viaje «Hecho» suma al punto
   principal. «Mover a…» y las roturas registran el punto. Todo queda en el historial y se puede
   anular.
7. En los almacenes la diferencia sale como descuadre (con su punto en Gestión › Descuadres). En
   barras y neveras sale como «Consumo desde el último recuento» y no como descuadre.
8. La migración 0005 es idempotente. La historia de «In Vessel» queda en «Almacén alcohol». Las
   copias antiguas siguen importándose.
9. Existen las categorías Cervezas, Refrescos y Vinos. No se ha creado ningún producto nuevo y no
   aparecen en Pedir sin grupo.
10. `npm test` pasa entero (los tests de antes más los nuevos de puntos, movimientos, descuadres,
    migración y copia). El de concurrencia real puede seguir saltándose sin `TEST_DATABASE_URL`.
11. README con la sección para actualizar Supabase. No se ha tocado producción ni `main`.
