# Cómo funciona por dentro Vessel · Reposición

Explicación sin código del estado de la app tras las fases 1 y 2. Cada regla sale del código o de
los tests. Los números del ejemplo se han comprobado ejecutando la app en una base de prueba en
memoria (script `tmp-capturas/logica/ejemplo.mjs`, que no se sube a GitHub).

## 1. El mapa general

- **Out Vessel** es la warehouse, fuera del local. Es un solo inventario.
- **In Vessel** es el local, con 9 puntos:
  - 2 almacenes: Almacén alcohol y Almacén cerveza y refrescos.
  - 4 neveras: Nevera de vino, Neveras de cerveza, Neveras cerveza especial y Nevera chupitería.
  - 3 barras: Barra 1, Barra 2 y Barra VIP.
- Cada producto tiene un **punto principal**, que es su almacén:
  - el alcohol fuerte va a Almacén alcohol;
  - la cerveza y los refrescos, a Almacén cerveza y refrescos;
  - el vino, a la Nevera de vino.
- **El viaje de una botella:**
  1. El proveedor la deja en Out Vessel («Ha llegado mercancía»).
  2. El Pedido la lleva a su punto principal en In Vessel.
  3. Reponer la lleva del punto principal a la Barra 1 o la Barra 2.
  4. Se sirve en barra. La app no registra la venta.
- Entre puntos del local se usa **«Mover a…»**. Las **roturas** se apuntan en el punto donde ocurren.
- **Contar** un punto fija lo que hay de verdad. Desde ahí, la app vuelve a calcular.
- **La app no guarda un número de stock.** Guarda hechos (recuentos, entradas, viajes, reposiciones,
  movimientos y roturas) y calcula el stock cada vez que lo enseña.

## 2. El recorrido de una botella (ejemplo: Tanqueray, cajas de 6)

| Paso | Quién y qué botón | Qué guarda la app | Out | Alcohol | Barra 1 | Barra VIP |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Encargado: Almacén › Alcohol › Contar 8 | Un recuento (8) | — | 8 | — | — |
| 2 | Encargado: Out Vessel › «Ha llegado mercancía» 12 | Una entrada de 12 en Out | 12 | 8 | — | — |
| 3 | Sáb 12: Barra 1 pide 4; en Reponer pulsan «Hecho» | Un pedido de barra y una reposición de 4, de Alcohol a Barra 1 | 12 | 4 | 4 | — |
| 4 | Sáb 19: Barra 1 pide 3; «Hecho» | Otra reposición de 3 | 12 | 1 | 7 | — |
| 5 | Lun 21: Viajes › Necesidades recomienda **2 cajas** | Nada (es un cálculo) | 12 | 1 | 7 | — |
| 6 | Encargado: «Añadir al pedido» | Una línea en el Pedido abierto: 12 botellas | 12 | 1 | 7 | — |
| 7 | En la warehouse: marca «Cargado» (12) y pulsa «Hecho» | Un traslado de 12, de Out a Alcohol | 0 | 13 | 7 | — |
| 8 | Ficha de la botella en Alcohol › «Mover a…» Barra VIP, 2 | Un traslado de 2 | 0 | 11 | 7 | 2 |
| 9 | Ficha en Alcohol › Rotura, 1 | Una rotura de 1 | 0 | 10 | 7 | 2 |
| 10 | Contar Alcohol: 9 | Un recuento (9, se esperaban 10) | 0 | **9** | 7 | 2 |
| 11 | Contar Barra 1: 3 | Un recuento (3, se esperaban 7) | 0 | 9 | **3** | 2 |

- **Paso 10:** sale un **descuadre de −1**.
- **Paso 11:** sale **«Consumo desde el último recuento: 4»** (en las barras no hay descuadre;
  lo explica el apartado 4).
- **«Agotado en almacén»** se marca desde Reponer. No cambia ningún número: solo pone una
  etiqueta al producto (ver apartado 6).
- **«—»** quiere decir que la app aún no controla ese producto en ese punto. Nunca se ha contado
  allí ni ha entrado nada. Sale como «Sin contar».

## 3. Cómo se calcula el stock teórico de un punto

**Fórmula:** último recuento del punto + lo que ha entrado desde entonces − lo que ha salido desde
entonces.

- **Entra:**
  - las entradas de mercancía;
  - los viajes que llegan;
  - los «Mover a…» hacia ese punto;
  - en las barras, las reposiciones que llegan.
- **Sale:**
  - los «Mover a…» desde ese punto;
  - las roturas;
  - las reposiciones que salen de él, si es el punto principal del producto;
  - los viajes que salen de Out Vessel.

Ejemplo, en el Almacén alcohol: recuento 8 − 4 − 3 (reposiciones) + 12 (viaje) − 2 (mover) − 1
(rotura) = **10**.

- **Si nunca se ha contado** pero ha entrado algo, la app empieza a contar desde 0 justo antes de
  esa primera entrada.
  - Ejemplo: Out Vessel no se había contado nunca. Al entrar 12, su stock es 12.
  - Si nunca se ha contado y no ha entrado nada, la app no da cifra: «Sin contar».
- **Si dos cosas ocurren a la misma hora,** las desempata un número de orden que se asigna al
  guardar. Así, un recuento y una reposición del mismo segundo se aplican en el orden en que
  llegaron.
- **El total de In Vessel** (la vista en lista) es la suma de los 9 puntos.
- **Los movimientos anulados no cuentan.** Se anulan desde Historial, con motivo.

## 4. Descuadre frente a «Consumo desde el último recuento»

Al contar, la app guarda lo contado y lo que esperaba. Lo que significa la diferencia depende del
punto:

- **Descuadre** sale en los dos almacenes y en Out Vessel. Allí toda salida se registra
  (reposición, viaje, mover, rotura). Si falta algo, es una pérdida o un error de registro.
  - Ejemplo: se esperaban 10 y hay 9, así que el descuadre es −1.
  - Sale en Gestión › Descuadres, con su punto, y el mapa lo marca con «!».
- **Consumo** sale en las barras y las neveras. Allí la app no registra lo que se sirve (no está
  conectada a Ágora), así que la diferencia es lo que se ha consumido.
  - Ejemplo: se esperaban 7 en Barra 1 y hay 3, así que el consumo es 4.
  - No sale en la lista de descuadres.

## 5. Consumo semanal y recomendación del ticket de Necesidades

**Consumo semanal:**

- Solo cuenta lo **repuesto a las barras** con Reponer «Hecho».
- La app toma las **últimas 8 semanas con actividad**, es decir, con algún pedido o reposición. Las
  semanas sin actividad no cuentan.
- Hacen falta **al menos 2 semanas** con actividad. Si no, no hay consumo y no recomienda nada.
- **Consumo semanal = lo repuesto en esas semanas ÷ número de semanas.**
  - Ejemplo: 4 + 3 = 7 en 2 semanas, así que 3,5 botellas por semana.

**Recomendación**, producto a producto:

1. Necesidad = consumo semanal × (semanas entre viajes + 1). El ajuste «semanas entre viajes» vale
   2 por defecto, así que cubre 3 semanas. Ejemplo: 3,5 × 3 = 10,5.
2. Se resta el stock del **punto principal** (si es negativo, cuenta como 0) y lo que ya está en el
   Pedido. Ejemplo: 10,5 − 1 − 0 = 9,5.
3. Se redondea hacia arriba a cajas completas. Ejemplo: 9,5 se queda en 12 botellas, que son
   **2 cajas**.
4. No recomienda más de lo que queda en Out Vessel, si Out tiene cifra. En el ejemplo, Out tiene 12,
   así que se quedan las 12.

**Cuándo no recomienda nada:** sin al menos 2 semanas de actividad, sin consumo de ese producto, o
si el producto **nunca se ha contado en su punto principal**.

**Más detalles del ticket:**

- **Sin botellas por caja,** la línea va en botellas.
- **Rotación:** se ordenan los productos con consumo de más a menos y se parten en tres tercios
  (alta, media, baja). Sin consumo, no hay rotación.
- **Estado de cada línea:**
  - «Sin stock»: el punto principal está a 0 o menos, o el producto está marcado como agotado.
  - «Queda poco»: lo que hay no llega para las semanas entre viajes. En el ejemplo, 1 ÷ 3,5 es
    menos de 2 semanas.
- **Ajustar una cantidad** (− o +) guarda un ajuste en el servidor, con quién y cuándo. El ajuste
  anterior queda como «sustituido».
- **«Añadir al pedido»** pasa al Pedido las líneas con cantidad mayor que 0 (en botellas: cajas × 6)
  y las saca del ticket.

## 6. Qué es un «Agotado»

Un producto sale en Agotados por una de estas dos razones:

- su punto principal está a **0 o menos** y se ha contado alguna vez (en el ejemplo, al contar
  Alcohol = 0, Tanqueray sale en Agotados);
- alguien lo marcó como **«agotado en almacén»** desde Reponer.

La marca de «agotado en almacén» se quita a mano, desde Reponer. No se quita sola cuando llega un
viaje.

## 7. La noche de trabajo

Lo que pasa antes de las 12:00 del mediodía (hora de Madrid) cuenta para la noche anterior.

- **Pedido el sábado 26 a las 03:00** → noche del **viernes 25**.
- **Pedido el sábado 26 a las 13:00** → noche del **sábado 26**.
- **Un «Hecho» de Reponer cuenta en la noche del pedido,** aunque se pulse después de las 12:00.

## 8. Dos móviles a la vez y cómo se corrigen errores

**Dos móviles a la vez:**

- **Dos «Hecho» a la vez en Reponer:** solo cuenta uno. El otro recibe «Ya estaba hecho: otra
  persona lo ha repuesto». Lo pedido después de abrir la lista sigue pendiente.
- **Dos «Añadir al pedido» a la vez:** el Pedido abierto se bloquea mientras se escribe y cada
  producto solo entra una vez. Tampoco se duplica si la conexión se corta y el móvil reintenta,
  porque cada operación lleva una clave anti-duplicados.
- **Dos recuentos del mismo punto a la vez:** se ponen en fila, uno detrás de otro.
- **Dos «Hecho» del mismo Pedido:** el segundo recibe «Este viaje ya está hecho».

**Corregir errores sin borrar:**

- **Una reposición:** se puede deshacer desde la lista durante 10 minutos (ajustable). Después, el
  encargado la corrige (cantidad, barra o producto) indicando el motivo. Queda el antes y el después
  en el registro de cambios.
- **Movimientos de almacén** (entradas, viajes, mover y roturas): se **anulan** con motivo. El
  movimiento se conserva, marcado como anulado, y deja de contar.
- **Recuentos:** no se corrigen. Se vuelve a contar, y el último recuento manda.

## 9. Tabla resumen

| Acción | Qué se guarda | Qué números cambia |
| --- | --- | --- |
| Pedir (barra) | Línea de pedido de la noche | Ninguno; aparece en Reponer |
| Reponer «Hecho» | Reposición: barra, producto, cantidad y punto de origen | Punto principal −N, barra +N y consumo semanal |
| Ha llegado mercancía (Out) | Entrada en Out Vessel | Out +N |
| Ha llegado mercancía (In) | Entrada en el punto principal de cada producto | Punto principal +N |
| Ajustar Necesidades | Ajuste con quién y cuándo | Ninguno; cambia el ticket |
| Añadir al pedido | Líneas del Pedido abierto | Ninguno todavía |
| Pedido «Hecho» | Un traslado por línea cargada; lo no cargado pasa al siguiente Pedido | Out −N y punto principal +N |
| Mover a… | Traslado entre dos puntos | Origen −N y destino +N |
| Rotura | Rotura en un punto | Punto −N |
| Agotado en almacén | Marca en el producto con su historial | Ninguno; sale en Agotados |
| Contar | Recuento (lo contado y lo esperado) | El punto pasa a lo contado; descuadre o consumo |
| Anular movimiento | Marca de anulado y motivo | Deshace el efecto de ese movimiento |

## 10. Dudas y cosas raras

1. **El consumo semanal solo mira las barras 1 y 2** (`consumption`, en server/almacen.js).
   - La cerveza, los refrescos y el vino casi nunca pasan por Pedir y Reponer, así que no tendrán
     consumo ni recomendación en el ticket.
   - Lo mismo con la Barra VIP: no está en Pedir y lo que se lleva allí con «Mover a…» no cuenta
     como consumo.
2. **La semana en curso cuenta como semana entera** (`consumption`). Si es lunes y solo se ha
   repuesto 1 botella, esa semana baja la media y la recomendación sale más corta de lo que debería.
3. **La recomendación solo mira el stock del punto principal** (`recommendationData`, en
   server/almacen.js). Lo que se haya movido a neveras o a la Barra VIP no cuenta como «lo que
   hay». Puede ser lo correcto (lo de la barra se va a gastar), pero conviene saberlo.
4. **Sin recuento en el punto principal no hay recomendación** (`recommendationData`). Aunque
   llegue un viaje, si nunca se ha contado ese producto en su almacén, el ticket no lo sugiere.
   Hay que contar al menos una vez cada almacén.
5. **«Agotado en almacén» no se quita solo** (`setOutOfStock`, en server/services.js). Si llega un
   viaje y nadie lo desmarca en Reponer, sigue saliendo en Agotados y como «Sin stock» en el
   ticket.
6. **Out Vessel puede quedarse en negativo** (`finishTrip`, en server/viaje.js). El Pedido no
   comprueba lo que hay en Out. Va con la regla de que los avisos nunca impiden, pero un número
   negativo en Out indica que falta registrar una entrada o un recuento.
7. **«Ha llegado mercancía» desde el mapa de In Vessel** mete la mercancía directamente en el
   punto principal, sin pasar por Out Vessel (`addEntries`). Está bien si el proveedor entrega en
   el local; si entrega en la warehouse, hay que elegir Out Vessel o los números de Out no cuadran.
8. **Corregir una reposición antigua no recalcula descuadres pasados** (`correctDelivery`). Lo
   esperado se guarda en el momento de contar. Si después se corrige una reposición anterior a ese
   recuento, el descuadre de entonces no cambia.
9. **Deshacer o corregir una reposición sobrescribe la fila.** El valor anterior solo queda en el
   registro de cambios (`undoDelivery`, `correctDelivery`). Cumple «queda constancia», pero no es
   un movimiento nuevo como en el almacén.
