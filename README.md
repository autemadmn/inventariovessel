# Reposición de barras

Web app sencilla para gestionar la reposición de botellas de alcohol en las dos barras de la discoteca:
preparar listas de reposición en segundos, registrar lo que se entrega cada noche y usar ese historial
para prever compras.

Es una aplicación **independiente**: no se conecta con Ágora ni con ningún otro sistema del local.
Se publica en internet (Cloudflare) y el personal la usa desde el navegador del móvil o la tablet (no hace
falta red local ni instalar nada). Todos los dispositivos ven la misma lista, que se actualiza sola cada
pocos segundos.

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

## Publicarla en Cloudflare (recomendado)

La app funciona como un **Worker de Cloudflare** con su base de datos **D1**. El plan gratuito de
Cloudflare es suficiente para dos barras y los datos se guardan de forma permanente.

1. Crea una cuenta gratuita en https://dash.cloudflare.com/sign-up (o entra en la tuya).
2. En el menú de la izquierda: **Compute (Workers) → Workers & Pages → Create → Import a repository**
   (o «Continue with GitHub»). Conecta tu cuenta de GitHub y elige el repositorio **inventariovessel**.
3. En la configuración que aparece:
   - **Project name**: `reposicion-barras` (debe coincidir con el nombre de `wrangler.jsonc`).
   - **Build command**: déjalo vacío. **Deploy command**: `npx wrangler deploy` (el que propone).
   - Rama: `main`.
4. Pulsa **Create and deploy**. En uno o dos minutos Cloudflare crea el Worker y la base de datos
   (se crea sola la primera vez) y da una dirección `https://reposicion-barras.<tu-usuario>.workers.dev`.
5. **Pon los códigos de acceso**: entra en el Worker → **Settings → Variables and Secrets → Add** y crea
   dos del tipo **Secret**:
   - `STAFF_CODE`: el código que usará el personal para entrar.
   - `MANAGER_PIN`: el PIN del encargado (distinto).
   Guarda (**Deploy**). Sin ellos, cualquiera que conozca la dirección podría entrar.
6. Abre la dirección en el móvil y usa **«Añadir a pantalla de inicio»** para tenerla como una app.

Cada vez que se sube un cambio a `main`, Cloudflare vuelve a publicar la app sola; los datos no se tocan.

**Copias de seguridad**: Gestión → Ajustes → «Descargar copia de seguridad» descarga todos los datos
(JSON). Cloudflare D1 además guarda un historial de los últimos días (*Time Travel*).

**Límites del plan gratuito** (holgados para este uso): 100 000 peticiones al día al Worker y
5 millones de lecturas / 100 000 escrituras diarias en D1. Cada móvil con la app abierta consulta la
lista cada 4 segundos (unas 900 peticiones por hora).

## Probarla en local

Requisitos: **Node.js 22.16 o superior**.

```bash
npm install        # solo hace falta para las herramientas de Cloudflare
npm start          # versión Node: http://localhost:3000 (datos en ./data)
npm run cf:dev     # versión Cloudflare en local: http://localhost:8787
npm test           # pruebas automáticas
```

En la versión Node, las variables de entorno son `STAFF_CODE`, `MANAGER_PIN`, `DATA_DIR` y `PORT`.
También hay un `Dockerfile` por si se prefiere un servidor propio con un volumen persistente en `/data`.

## Estructura

```
server/
  worker.js     entrada para Cloudflare Workers (API; los archivos de public/ los sirve Cloudflare)
  index.js      entrada para Node (API + archivos de public/)
  handler.js    rutas de la API y control de acceso (Request/Response estándar)
  services.js   lógica: solicitudes, entregas, correcciones, informes, previsión, compras
  schema.js     tablas y datos iniciales
  db-d1.js      acceso a Cloudflare D1
  db-node.js    acceso a SQLite en Node
  dates.js      noches de trabajo, semanas y meses
  catalog.js    catálogo inicial y fotos de referencia
public/         interfaz (HTML, CSS y JavaScript sin compilación)
  js/shared/forecast.js  cálculo de previsión y compra (lo usan el servidor y el navegador)
  img/botellas/          fotos de referencia y sus créditos
test/           pruebas (node --test)
wrangler.jsonc  configuración de Cloudflare
```
