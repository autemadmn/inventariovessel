# Reposición de barras

Web app sencilla para gestionar la reposición de botellas de alcohol en las dos barras de la discoteca:
preparar listas de reposición en segundos, registrar lo que se entrega cada noche y consultar ese historial
en Informes.

Es una aplicación **independiente**: no se conecta con Ágora ni con ningún otro sistema del local.
Se publica en internet (Cloudflare) y el personal la usa desde el navegador del móvil o la tablet (no hace
falta red local ni instalar nada). Todos los dispositivos ven la misma lista, que se actualiza sola cada
pocos segundos.

## Cómo se usa

### Al abrir la app
Sale «¿Quién eres?» con un botón por cada persona del personal (Gestión → Personal). Se elige una vez
y el dispositivo lo recuerda; «Ahora no» lo cierra y el botón de arriba a la derecha lo vuelve a abrir.
No son cuentas: el nombre solo sirve para que el registro diga quién pidió y quién repuso.

### Pedir (personal de barra)
Salen las botellas de la **selección**, agrupadas y en el orden que decide el encargado (al principio,
«Habituales» en el orden de la estantería y luego «Resto»).

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
- Lista compacta de lo que falta, separada por barra: foto, nombre, «Faltan N» y la cantidad (x4).
- Se repone todo y al terminar se pulsa **«Hecho»**: queda registrado como repuesto de una vez.
  En las pestañas Barra 1 / Barra 2, «Hecho» completa solo esa barra.
- Opcional: tocar una fila para indicar que esta vez se lleva menos (lo que no se lleve sigue
  pendiente), quitarla de la lista o marcar el producto como **agotado en almacén**. Así se cumple
  que solo se registra lo realmente repuesto: si se piden 4 y se llevan 3, se registran 3 y queda 1.
- Si dos personas pulsan «Hecho» a la vez, solo cuenta una vez; lo que se pida mientras tanto sigue
  pendiente.
- **Agotado en almacén** (desde la fila o desde «Agotados en almacén»): no quedan botellas para
  reponer. Es distinto de «falta en la barra»: lo pedido sigue visible. Cuando llega mercancía se
  vuelve a marcar como disponible.

### Gestión (encargado, con PIN)
Cuatro pestañas (Informes, Selección, Personal y Catálogo) y Ajustes en el engranaje.

- **Informes** (se abre por defecto): qué alcohol se ha repuesto. Arriba, «Último finde · Este mes · Mes
  pasado»; debajo, los grupos de la selección en su orden (y «Otras» si alguna botella sin grupo se movió).
  Cada botella sale con su imagen, el número de botellas repuestas en grande, las cajas («5 cajas + 2») si se
  conocen las botellas por caja y la etiqueta «Agotado». Las que no se repusieron quedan plegadas al final.
- **Detalle de botella** (tocando una fila): total del periodo y sus cajas, reparto Barra 1 / Barra 2 y una
  gráfica con un punto por semana de todo su histórico (las semanas sin apertura no salen). Desde aquí se
  marca agotada o disponible y se cambian las botellas por caja. Plegadas al final, las reposiciones del
  periodo con «Corregir» (motivo obligatorio) y «Añadir una olvidada». Nada se borra.
- **Selección**: qué botellas salen en «Pedir». Crear, renombrar, ordenar y borrar grupos; ordenar las
  botellas dentro de cada grupo y moverlas entre grupos arrastrando desde el asa (en el móvil, mantener
  pulsado) o con el menú «…» de cada fila. Una botella «fuera de la selección» no sale en «Pedir», pero
  sigue en el catálogo, en Reponer y en el histórico. Los cambios llegan a los demás móviles en unos segundos.
- **Personal**: añadir, renombrar, ordenar y quitar (desactivar) los nombres que salen en «¿Quién eres?».
  Los retirados siguen en el histórico y se pueden volver a activar.
- **Catálogo**: ver las botellas, añadir una y editarla: foto (desde la cámara del móvil), nombre, grupo,
  botellas por caja, agotado y activo. Categoría, estado, capacidad y nota quedan en «Más datos». También se
  resuelven aquí las botellas sin identificar.
- **Ajustes** (engranaje): nombres de las barras, códigos de acceso y copia de seguridad. La jornada (corte a
  las 12:00, hora de Madrid) no se cambia desde la app.

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
- **Imágenes**, por orden de prioridad:
  1. Imagen de catálogo: `public/img/botellas/<slug>.png` (botella sin fondo, se ve «flotando»),
     listada en `public/img/botellas/manifest.json`.
  2. Foto: la propia que haga el encargado desde Gestión → Catálogo → «Foto», o la de referencia
     que traen 29 productos confirmados (Open Food Facts y Wikimedia Commons; fuentes y licencias en
     `public/img/botellas/CREDITOS.md`).
  3. Si no hay ninguna, una silueta neutra de botella: nunca una foto inventada.
  Los productos por confirmar no llevan foto hasta saber la variedad exacta. El *slug* (nombre del archivo
  de imagen) se fija al crear el producto y no cambia al renombrarlo.

## Fuera de esta versión

Productos de la nevera, registro de copas individuales, operativa de la VIP e integración con Ágora.

## Publicarla en Cloudflare (recomendado)

La app funciona como un **Worker de Cloudflare** (la API y el control de acceso) con la base de datos en
**Supabase** (Postgres). El navegador nunca habla con Supabase: solo con el Worker. Los planes gratuitos de
Cloudflare y Supabase son suficientes para dos barras.

Si es la primera vez, haz antes los pasos 1 a 4 de [Pasar a Supabase](#pasar-a-supabase) (crear la base
de datos y guardar el secreto `DATABASE_URL`).

1. Crea una cuenta gratuita en https://dash.cloudflare.com/sign-up (o entra en la tuya).
2. En el menú de la izquierda: **Compute (Workers) → Workers & Pages → Create → Import a repository**
   (o «Continue with GitHub»). Conecta tu cuenta de GitHub y elige el repositorio **inventariovessel**.
3. En la configuración que aparece:
   - **Project name**: `reposicion-barras` (debe coincidir con el nombre de `wrangler.jsonc`).
   - **Build command**: déjalo vacío. **Deploy command**: `npx wrangler deploy` (el que propone).
   - Rama: `main`.
4. Pulsa **Create and deploy**. En uno o dos minutos Cloudflare crea el Worker y da una dirección
   `https://reposicion-barras.<tu-usuario>.workers.dev`.
5. **Pon los secretos**: entra en el Worker → **Settings → Variables and Secrets → Add** y crea
   tres del tipo **Secret**:
   - `STAFF_CODE`: el código que usará el personal para entrar.
   - `MANAGER_PIN`: el PIN del encargado (distinto).
   - `DATABASE_URL`: la dirección de Supabase (ver [Pasar a Supabase](#pasar-a-supabase), paso 3).
   Guarda (**Deploy**). Sin los dos primeros, cualquiera que conozca la dirección podría entrar; sin el
   tercero, la app muestra «Falta el secreto DATABASE_URL.».
6. Abre la dirección en el móvil y usa **«Añadir a pantalla de inicio»** para tenerla como una app.

Cada vez que se sube un cambio a `main`, Cloudflare vuelve a publicar la app sola; los datos no se tocan.

**Copias de seguridad**: Gestión → Ajustes → «Descargar copia de seguridad» descarga todos los datos
(JSON), salvo las fotos propias. Supabase hace además sus propias copias diarias (según el plan).

**Límites del plan gratuito** (holgados para este uso): 100 000 peticiones al día al Worker. Cada móvil
con la app abierta consulta la lista cada 4 segundos (unas 900 peticiones por hora) y cada petición abre
y cierra una conexión con Supabase. Un proyecto gratuito de Supabase se pausa tras una semana sin uso: se
reactiva desde su panel.

## Pasar a Supabase

Paso a paso para cambiar la base de datos de Cloudflare D1 (versión anterior) a Supabase sin perder nada.
Calcula media hora. Hazlo con el local cerrado.

1. **Crea el proyecto en Supabase.** Entra en https://supabase.com, **New project**. Ponle un nombre
   (por ejemplo `reposicion-barras`), elige una contraseña de base de datos larga (guárdala en un sitio
   seguro: se usa en el paso 3) y la región más cercana (por ejemplo *West EU*). Espera a que termine de
   crearse.
2. **Crea las tablas.** En el panel del proyecto: **SQL Editor → New query**. Ejecuta primero
   `CREATE SCHEMA IF NOT EXISTS vessel_reposicion;`. Después, antes del contenido de cada archivo
   `supabase/migrations/0001_schema.sql`, `0002_seed.sql` y `0003_informe.sql`, añade en la misma consulta
   `SET search_path TO vessel_reposicion;` y pulsa **Run**. Así las tablas quedan en el esquema que
   usa el Worker (`DATABASE_SCHEMA` en `wrangler.jsonc`). Las migraciones se pueden repetir sin duplicar datos.
3. **Copia la dirección de conexión.** Botón **Connect** (arriba) → **Connection string** →
   **Session pooler** (puerto **5432**). Copia la URI, que tiene esta forma:
   `postgresql://postgres.<proyecto>:[YOUR-PASSWORD]@<pooler-host>:5432/postgres`,
   y cambia `[YOUR-PASSWORD]` por la contraseña del paso 1.
4. **Guárdala como secreto en Cloudflare.** En la carpeta del repositorio:
   ```bash
   npx wrangler secret put DATABASE_URL
   ```
   y pega la URI cuando la pida. (O en el panel: Worker → Settings → Variables and Secrets → Add →
   Secret `DATABASE_URL`.) No la escribas nunca en un archivo del repositorio.
5. **Descarga la copia de la app actual, antes de desplegar.** En la app que está funcionando ahora:
   Gestión → Ajustes → «Descargar copia de seguridad». Guarda el archivo (por ejemplo `copia.json`).
   A partir de aquí, que nadie pida ni reponga hasta terminar.
6. **Importa la copia en Supabase.** En la carpeta del repositorio (hace falta `npm install` una vez):
   ```bash
   # macOS / Linux
   DATABASE_URL='postgresql://…5432/postgres' node scripts/db/import-backup.mjs copia.json
   ```
   ```powershell
   # Windows (PowerShell)
   $env:DATABASE_URL='postgresql://…5432/postgres'; node scripts/db/import-backup.mjs copia.json
   ```
   Muestra cuántas filas ha importado de cada tabla. Las copias de la versión anterior se convierten
   solas: los «habituales» pasan al grupo «Habituales» en su orden, el resto a «Resto», y se crea el
   personal inicial (Carlos, Sergio, Alejandro). Si la base ya tiene noches o pedidos, se detiene; para
   sustituirlos, repite añadiendo `--force`. Las **fotos propias** hechas con el móvil no viajan en la
   copia: el script dice cuántas eran; vuelve a hacerlas desde Gestión → Catálogo.
7. **Despliega**: `npx wrangler deploy` (o sube el cambio a `main` si Cloudflare publica solo).
8. **Comprueba la app**: entra con el código, elige tu nombre, mira que «Pedir» muestra Habituales y
   Resto, pide una botella de prueba en un móvil y comprueba que aparece en «Reponer» en otro en unos
   segundos; márcala como hecha. En Gestión → Informes deben verse las noches anteriores. Si sale
   «Faltan las migraciones de Supabase.», repite el paso 2; si sale «Falta el secreto DATABASE_URL.»,
   el paso 4.
9. **Cómo volver atrás** si algo va mal: en Cloudflare, Worker → **Deployments**, elige el despliegue
   anterior a este cambio y pulsa **Rollback** (o vuelve a desplegar el commit anterior). La base D1 no se
   ha borrado y vuelve a usarse tal como estaba en el paso 5; lo que se haya registrado después solo
   estará en Supabase (descárgalo con la copia de seguridad antes de volver atrás si lo necesitas).
   Cuando todo funcione unos días con Supabase, la base D1 se puede borrar desde el panel de Cloudflare.

### Compartir un proyecto de Supabase con otra aplicación

Para no modificar sus tablas, crea un esquema y un usuario de Postgres exclusivos para Reposición.
Ejecuta `0001_schema.sql` y `0002_seed.sql` con el `search_path` fijado a ese esquema. Configura
`DATABASE_SCHEMA` con su nombre (en `wrangler.jsonc` para el Worker y como variable de entorno en Node
al importar la copia). La URI `DATABASE_URL` debe usar el usuario propio mediante el **Session pooler**:
`postgresql://<usuario>.<proyecto>:[YOUR-PASSWORD]@<pooler-host>:5432/postgres`.
El usuario debe tener `USAGE` y `CREATE` en su esquema y ser propietario de sus tablas, sin permisos
sobre las tablas de la otra app.

## Probarla en local

Requisitos: **Node.js 22.16 o superior**.

```bash
npm install        # dependencias (postgres, PGlite y las herramientas de Cloudflare)
npm start          # versión Node: http://localhost:3000
npm run cf:dev     # versión Cloudflare en local: http://localhost:8787 (necesita .dev.vars)
npm test           # pruebas automáticas
```

**Base de datos en local.** Sin `DATABASE_URL`, `npm start` usa **PGlite** (Postgres dentro del propio
proceso, sin instalar nada) con los datos en `./data/pglite`. Al arrancar aplica las migraciones de
`supabase/migrations/`, así que el SQL es el mismo que en Supabase. Con `DATABASE_URL` usa ese Postgres.
Para cargar una copia en la base local:
`node scripts/db/import-backup.mjs copia.json --pglite data/pglite` (con la app parada).
Los datos de la versión anterior en `./data/*.db` (SQLite) no se leen: descarga su copia de seguridad
con la versión anterior e impórtala así.

Variables de entorno de la versión Node: `STAFF_CODE`, `MANAGER_PIN`, `DATABASE_URL` (opcional),
`DATABASE_SCHEMA` (si se comparte proyecto),
`DATA_DIR` y `PORT`. Para `npm run cf:dev`, copia `.dev.vars.example` como `.dev.vars` y rellénalo.
También hay un `Dockerfile` por si se prefiere un servidor propio (PGlite en el volumen `/data`, o
Supabase con `DATABASE_URL`).

**Pruebas.** `npm test` crea una base PGlite nueva en memoria para cada prueba: no hace falta Supabase.
`test/concurrency-pg.test.js` comprueba dos «Hecho» simultáneos con dos conexiones reales; solo se
ejecuta con `TEST_DATABASE_URL` apuntando a un Postgres **de pruebas** (nunca al de producción): crea un
esquema temporal y lo borra al terminar.

Si cambias el catálogo inicial en `server/catalog.js`, regenera la semilla con
`node scripts/db/build-seed.mjs` (una prueba avisa si no coinciden).

## Estructura

```
server/
  worker.js     entrada para Cloudflare Workers (API; los archivos de public/ los sirve Cloudflare)
  index.js      entrada para Node (API + archivos de public/)
  handler.js    rutas de la API y control de acceso (Request/Response estándar)
  services.js   lógica: solicitudes, entregas, selección, personal, informes, previsión, compras
  schema.js     ajustes por defecto y comprobación de que las migraciones están aplicadas
  db-pg.js      acceso a Postgres/Supabase (postgres.js)
  db-pglite.js  acceso a PGlite (local y pruebas; aplica las migraciones al abrir)
  sql.js        utilidades comunes de los dos adaptadores
  import-backup.js  importación de copias de seguridad (también de la versión anterior)
  dates.js      noches de trabajo, semanas y meses
  catalog.js    catálogo inicial, grupos, personal inicial y slugs
supabase/migrations/
  0001_schema.sql  tablas (RLS activado, sin políticas)
  0002_seed.sql    datos iniciales (generado por scripts/db/build-seed.mjs)
  0003_informe.sql validación de botellas por caja
scripts/db/     build-seed.mjs e import-backup.mjs
public/         interfaz (HTML, CSS y JavaScript sin compilación)
  js/shared/forecast.js  cálculo de previsión y compra conservado para la API
  img/botellas/          imágenes y fotos de referencia, manifest.json y créditos
test/           pruebas (node --test)
wrangler.jsonc  configuración de Cloudflare
```
