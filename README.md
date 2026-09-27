# Reposición de barras

Web app sencilla para gestionar la reposición de botellas de alcohol en las dos barras de la discoteca:
preparar listas de reposición en segundos, registrar lo que se entrega cada noche y usar ese historial
para prever compras.

Es una aplicación **independiente**: no se conecta con Ágora ni con ningún otro sistema del local.
Se publica en internet y el personal la usa desde el navegador del móvil o la tablet (no hace falta red
local ni instalar nada). Todos los dispositivos ven la misma lista en tiempo real.

## Cómo se usa

### Pedir (personal de barra)
1. Elegir la barra (el dispositivo la recuerda).
2. Tocar las botellas: cada toque suma una. Se ajusta con «−» en la tarjeta o con «+ / −» al revisar.
3. Buscar por nombre (sin tildes: «ciroc», «hendricks») o filtrar por categoría.
4. «Enviar» muestra la lista, por ejemplo:
   ```
   Barceló Añejo: 3 botellas
   Larios 12: 2 botellas
   Tanqueray London Dry: 1 botella
   ```
   Si ya hay botellas pedidas y sin entregar de ese producto para esa barra, se avisa en la tarjeta.

### Reponer (quien repone)
- Cada línea muestra **pedidas, entregadas y faltan**. Solo lo entregado queda registrado como reposición:
  si se piden 3 y se entregan 2, se registran 2 y queda 1 pendiente.
- «Voy yo» avisa al resto de que esa línea ya la lleva alguien. Además, el servidor no permite entregar más
  de lo que falta: si dos personas pulsan a la vez, la segunda recibe un aviso. Así nadie repone lo mismo dos veces.
- «Deshacer» (durante unos minutos) corrige una pulsación por error.
- «⋯ → Anular lo pendiente» retira lo que ya no hace falta.
- **Agotado en almacén** (desde la línea o desde el panel «Agotados en almacén»): indica que no quedan botellas
  para reponer. Es distinto de «falta en la barra»: las solicitudes siguen visibles, marcadas en rojo. Cuando llega
  mercancía se vuelve a marcar como disponible.

### Gestión (encargado, con PIN)
- **Informes**: totales por producto, por barra y en conjunto, por noche, semana o mes, comparados con el
  periodo anterior. Descarga en CSV. Corrección de reposiciones (motivo obligatorio) y alta de reposiciones
  olvidadas. Nada se borra: todo queda en «Cambios».
- **Noches**: una noche de trabajo agrupa todo lo que ocurre hasta la hora de corte (12:00 por defecto) del día
  siguiente, aunque siga después de medianoche. Aquí se indica si las barras empezaron y terminaron con el
  **mismo nivel** de existencias. Los informes solo hablan de «consumo aproximado» cuando todas las noches del
  periodo lo cumplen; si no, hablan de «botellas repuestas».
- **Previsión**: ver abajo.
- **Compras**: ver abajo.
- **Catálogo**: corregir nombres, confirmar capacidad y botellas por caja, añadir fotos (desde la cámara del móvil)
  y resolver las botellas sin identificar.
- **Cambios**: registro de todo lo que se pide, entrega, corrige o modifica, con quién, cuándo y por qué.
- **Ajustes**: nombres de las barras, hora de corte, margen de seguridad, códigos de acceso y copia de seguridad.

## Previsión

Se basa **solo en botellas entregadas**. Las pendientes o no servidas se muestran como aviso, nunca se suman.

- **Promedio por noche** (por defecto): botellas repuestas en el historial ÷ noches del historial × noches
  previstas. Si un mes se repusieron 50 botellas y el siguiente tiene las mismas noches, la previsión es 50;
  si tiene más o menos noches de apertura, se ajusta con el promedio por noche.
- **Por día de la semana**: se activa cuando cada día previsto tiene al menos 3 noches de historial (configurable).
  Suma, noche a noche, el promedio del mismo día de la semana.
- Días de apertura, noches cerradas y noches extra se eligen en la pantalla.
- **Ajuste por evento** (% general o por producto) y **margen de seguridad** configurable.
- Si hay pocas noches de historial (menos de 4, configurable) se avisa y se puede introducir una **estimación manual**.
- Si un producto estuvo **agotado** durante el historial, se advierte de que las reposiciones pueden infravalorar
  su demanda.

## Lista de compra

```
Botellas que comprar = necesidad prevista + margen de seguridad − existencias disponibles − entregas previstas
```

- Existencias disponibles = existencias utilizables − salidas previstas a otros destinos (VIP, etc.), para que
  el almacén compartido no se cuente dos veces.
- El resultado nunca es negativo y se redondea **hacia arriba** a botellas enteras.
- Con las botellas por caja confirmadas se expresa en cajas: «2 cajas + 3 sueltas · o 3 cajas: 9 botellas de más».
- Es una propuesta: el encargado puede cambiar cada cantidad (en botellas o cajas), guardar, copiar el texto,
  descargar CSV o imprimir.

## Catálogo inicial

Solo botellas de las estanterías de las fotos (la nevera queda fuera). Es provisional:

- Marcados **«Por confirmar»**: Puerto de Indias (aparentemente Strawberry), Glenmorangie The Original (edad),
  The Macallan 12 (expresión), Flor de Caña Añejo Reserva (edad), Zacapa (aparentemente Solera 23) y
  Old / Old Sport (marca y categoría).
- **Sin identificar** (no aparecen para pedir): la botella pequeña y oscura entre The Macallan y Zacapa, y la
  botella de ron con malla entre Barceló y Flor de Caña. Desde Catálogo se marcan como producto nuevo o como
  uno que ya existe, sin crear duplicados.
- No se han inventado capacidades ni botellas por caja: quedan «sin confirmar» hasta que el encargado
  las introduzca.
- **Fotos**: 29 productos confirmados traen una foto de referencia de fuentes con licencia libre
  (Open Food Facts y Wikimedia Commons), revisada una a una; fuentes y licencias en
  `public/img/botellas/CREDITOS.md`. Los productos por confirmar no llevan foto hasta saber la variedad
  exacta. Donde no hay foto se muestra un distintivo con las iniciales. Desde Gestión → Catálogo → «Foto»
  se puede hacer una foto propia con el móvil, que sustituye a la de referencia.

## Fuera de esta versión

Productos de la nevera, registro de copas individuales, operativa de la VIP e integración con Ágora.

## Puesta en marcha

Requisitos: **Node.js 22.16 o superior**. No tiene dependencias externas (usa `node:sqlite`).

```bash
npm start          # http://localhost:3000
npm test           # pruebas automáticas
```

Variables de entorno:

| Variable      | Uso                                                                   |
|---------------|-----------------------------------------------------------------------|
| `STAFF_CODE`  | Código de acceso para todo el personal (**obligatorio en internet**). |
| `MANAGER_PIN` | PIN de la zona de gestión (**obligatorio en internet**).              |
| `DATA_DIR`    | Carpeta de datos (base de datos y fotos). Por defecto `./data`.       |
| `PORT`        | Puerto HTTP. Por defecto `3000`.                                      |

Si no se definen, también se pueden fijar desde Gestión → Ajustes. Sin ellos la app queda abierta a
cualquiera que conozca la dirección.

### Publicarla en internet

**Opción rápida (Render):** crea una cuenta en https://render.com con tu usuario de GitHub, pulsa
**New → Blueprint**, elige este repositorio y escribe el código del personal (`STAFF_CODE`) y el PIN del
encargado (`MANAGER_PIN`). En unos minutos Render da una dirección `https://….onrender.com` que se abre
desde cualquier móvil. El plan gratuito sirve para probarla, pero se duerme sin uso (tarda en despertar)
y **borra los datos** al reiniciarse; para usarla de verdad hay que pasar a un plan de pago y activar el
disco indicado en `render.yaml`.

**Otras opciones:**

La app necesita un servidor con **disco persistente** (los datos se guardan en un archivo SQLite dentro de
`DATA_DIR`). Hay un `Dockerfile` listo para cualquier proveedor que ejecute contenedores con un volumen
(Railway, Render, Fly.io, un VPS…):

1. Crear el servicio a partir de este repositorio (usa el `Dockerfile`).
2. Montar un volumen persistente en `/data`.
3. Definir `STAFF_CODE` y `MANAGER_PIN`.
4. Usar la dirección HTTPS que da el proveedor. En el móvil, «Añadir a pantalla de inicio» la deja como una app.

Sin volumen persistente los datos se perderían en cada reinicio o despliegue.

**Copias de seguridad**: Gestión → Ajustes → «Descargar copia de seguridad» descarga la base de datos completa.

## Estructura

```
server/
  index.js      arranque del servidor
  app.js        HTTP: rutas, acceso, archivos estáticos y avisos en tiempo real (SSE)
  services.js   lógica: solicitudes, entregas, correcciones, informes, previsión, compras
  forecast.js   cálculo de previsión y de compra (funciones puras, también se usan en el navegador)
  dates.js      noches de trabajo, semanas y meses
  catalog.js    catálogo inicial
  db.js         esquema SQLite
public/         interfaz (HTML, CSS y JavaScript sin compilación)
test/           pruebas (node --test)
```
