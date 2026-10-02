# Fase 2 · Pestaña «Viajes»: Necesidades (ticket) y Pedido

Esta es la **petición** de la fase 2. Manda sobre cualquier plan intermedio. Requiere la **fase 1**
terminada (puntos de In Vessel, punto principal de cada producto y migración 0005). La fuente es
`docs/rediseno/propuesta.md` (con `img/maqueta-viajes.jpg`). Donde la propuesta y este archivo no
coinciden, manda este archivo.

## Decisiones ya tomadas (no se discuten)

- **Barra inferior con 5 pestañas:** Pedir · Reponer · Almacén · **Viajes** · Gestión. Viajes lleva
  el icono Lucide «truck». Gestión no cambia de sitio.
- **Viajes es solo lo de la maqueta:** «Agotados» arriba y «Necesidades» en formato ticket. No hay
  nada de proveedores.
- **Dentro de Viajes hay dos pestañas: «Necesidades» y «Pedido».**
  - **Necesidades** (por defecto): Agotados + ticket de Necesidades.
  - **Pedido:** lo que el jefe lee en Out Vessel (la warehouse) mientras recoge la mercancía. Es el
    viaje Out → In Vessel que ya existe, que se saca de Almacén y se rediseña para leerlo de pie en
    el almacén.
- **Out Vessel** sigue siendo un único inventario. In Vessel sigue siendo el mapa de la fase 1.
- **Acceso:** el mismo que el viaje actual (código del local). Sin PIN nuevo.

## Viajes › Necesidades

Como `img/maqueta-viajes.jpg`, adaptado al estilo actual de la app (Archivo, tokens claro/oscuro,
sin efectos de discoteca).

### Agotados

- Título «Agotados» y enlace «Ver todos ›» que abre la lista completa.
- Fila horizontal con scroll de tarjetas: imagen (PNG «flotando», después foto y si no, silueta),
  etiqueta «Sin stock» con punto rojo y nombre.
- **Qué es un agotado:** un producto contado al menos una vez cuyo stock teórico en su **punto
  principal** es 0 o menos, **o** que tiene marcado «agotado en almacén» desde Reponer.
- Al tocar una tarjeta, el producto pasa al ticket de Necesidades si no estaba, con la cantidad
  recomendada (o 0 si no hay datos para recomendar).
- Sin agotados: una línea discreta («No hay nada agotado»), sin hueco vacío.

### Ticket «Necesidades»

- Tarjeta con **estética de ticket**: fondo claro tipo papel, bordes superior e inferior dentados,
  muescas laterales, separadores de puntos y título grande «Necesidades».
  - Debajo del título, «Estimación según consumo y stock actual».
  - Se hace con CSS (máscaras o degradados), sin imágenes.
  - Es sobrio y profesional, también en modo oscuro (puede seguir siendo claro sobre el fondo
    oscuro, como en la maqueta).
- **Cada línea lleva:**
  - imagen y nombre;
  - un subtítulo de estado y rotación, por ejemplo «Sin stock · Alta rotación» o «Queda poco ·
    Rotación media»;
  - un control «− [N] +» con la unidad debajo («cajas»).
- **Recomendación:** se reutiliza la lógica actual de sugerencias del viaje (`suggestions` en
  `server/almacen.js`), con dos cambios:
  1. El stock de referencia es el del **punto principal** del producto, no el de «In Vessel».
  2. Se expresa en **cajas** (redondeando hacia arriba).

  Lo demás se mantiene:
  - consumo semanal × (semanas entre viajes + 1) − stock − lo que ya está en el Pedido;
  - tope por lo que haya en Out Vessel, si se sabe;
  - sin recuento o sin consumo no se inventa una recomendación.
- **Rotación:** alta, media o baja según el consumo semanal del producto, por tercios entre los
  productos con consumo. Sin consumo, no se muestra la rotación.
- **Sin botellas por caja.** Si un producto no tiene el dato, la línea va en «botellas» y avisa con
  un enlace para indicar cuántas botellas lleva la caja. No se inventa el dato.
- **Cantidades ajustadas.** El encargado sube o baja cada cantidad.
  - El ajuste se guarda **en el servidor** y se ve igual en todos los móviles.
  - Cada cambio queda registrado con quién lo hizo y cuándo.
  - Una cantidad ajustada a mano se distingue de la recomendada (por ejemplo, «recomendado 10»
    en pequeño al lado).
- **Pie del ticket:** «N productos · M cajas» (más «· K botellas» si hay líneas en botellas) y el
  botón principal **«Añadir al pedido»** con el icono «truck».
  - Pasa las líneas con cantidad mayor que 0 al Pedido abierto (o crea uno), en botellas
    internamente (cajas × botellas por caja).
  - Después, esas líneas salen del ticket.
  - Es seguro si dos móviles lo pulsan a la vez: no se duplican líneas. Se usa el bloqueo del viaje
    abierto y una clave anti-duplicados.
- Ticket vacío: mensaje claro, por ejemplo «Nada que pedir según el consumo y el stock actuales».

### Puntos de aprovisionamiento (propuesta, apartado 7)

- En **Almacén alcohol** y **Almacén cerveza y refrescos**, la ficha de cada botella muestra
  «Próximo viaje: N cajas (recomendado M)» con el mismo control «− [N] +».
- Es **el mismo dato** que la línea del ticket: cambiarlo en un sitio lo cambia en el otro.
- Barras y neveras no tienen esta función.

## Viajes › Pedido

- Es el viaje abierto Out → In Vessel de siempre: mismas tablas (`trips`, `trip_lines`), mismas
  reglas y los mismos 409 si alguien ya lo terminó.
- **Diseñado para leerse en el almacén:**
  - letra grande y cantidades en **cajas y sueltas** («3 cajas + 4»);
  - agrupado por categoría;
  - cada línea con una casilla grande «Cargado» y la cantidad cargada editable;
  - el stock que queda en Out Vessel en pequeño («En Out Vessel: 4 cajas»).
- Se pueden añadir apuntes de texto libre, como ahora.
- **«Hecho»** abajo, fijo: termina el viaje.
  - Cada línea cargada entra en el **punto principal** de su producto (regla de la fase 1).
  - Lo no cargado pasa al siguiente pedido, como ahora.
- **Al quitar el viaje de Almacén:**
  - `#/almacen/viaje` redirige a `#/viajes/pedido`;
  - «Apuntar para el viaje» de la ficha de una botella sigue funcionando y añade al Pedido.
- Pedido vacío: mensaje y un enlace a Necesidades.

## Datos

- Migración idempotente `supabase/migrations/0006_necesidades.sql`, solo con lo necesario. Por
  ejemplo, una tabla de ajustes de necesidades por producto con: cantidad, unidad, quién, cuándo y si
  está activo o ya pasó al pedido. Nada se borra: se marca.
- RLS activado y sin políticas, como el resto.
- La copia de seguridad JSON incluye lo nuevo, y las copias antiguas se siguen importando.
- `server/schema.js` detecta si falta la 0006.
- Las rutas nuevas siguen el estilo de `server/handler.js` (por ejemplo `/api/viajes/...`). Las
  rutas antiguas del viaje siguen funcionando o redirigen, para no romper móviles con la versión
  anterior abierta.

## README

Añade una sección corta en lenguaje llano: **«Actualizar Supabase a la fase 2 (Viajes)»**. Debe
explicar que hay que ejecutar `0006_necesidades.sql` en el editor SQL de Supabase **antes** de
publicar `main`. Ningún bloque toca producción.

## Fuera de esta fase

- Proveedores, precios, pedidos por correo o PDF.
- Cambios en el mapa o en los puntos de la fase 1.
- Productos o fotos inventados.

## Criterios de aceptación (los comprueba el bloque Comparador)

1. La barra inferior tiene 5 pestañas en este orden: Pedir, Reponer, Almacén, Viajes, Gestión.
   Caben a 390 px sin cortar textos.
2. Viajes tiene las pestañas «Necesidades» (por defecto) y «Pedido».
3. «Agotados» sigue la definición de arriba (punto principal ≤ 0 o agotado en almacén) y funciona
   «Ver todos».
4. El ticket «Necesidades» se parece a la maqueta (papel, bordes dentados, puntos), en claro y en
   oscuro, sin parecer una plantilla ni «hortera».
5. Recomendación en cajas con la lógica de antes sobre el punto principal. Sin datos no hay
   recomendación inventada. Sin botellas por caja, la línea va en botellas y avisa.
6. Los ajustes se guardan en el servidor, se ven en otro móvil y quedan registrados. Es el mismo
   dato en el ticket y en la ficha de los almacenes principales.
7. «Añadir al pedido» pasa las líneas al Pedido sin duplicar aunque dos móviles pulsen a la vez, y
   las quita del ticket.
8. «Pedido» se lee en cajas y sueltas con casillas grandes. «Hecho» mete cada línea en el punto
   principal y pasa lo no cargado al siguiente.
9. El viaje ya no está en Almacén. `#/almacen/viaje` redirige y «Apuntar para el viaje» sigue
   funcionando.
10. La migración 0006 es idempotente, la copia incluye lo nuevo y las copias antiguas se importan.
11. `npm test` pasa entero (los de antes más los nuevos de necesidades, añadir al pedido con
    concurrencia y pedido). README actualizado. No se ha tocado producción ni `main`.
