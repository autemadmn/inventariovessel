# Prompt para Codex · Publicar las fases 1 y 2

Para usarlo directamente con Codex CLI (no hace falta un flujo de Orquesta). Con el local cerrado.

1. Abre PowerShell en `C:\Users\mrani\inventariovessel`.
2. Escribe tú la dirección de Supabase (la misma que el secreto `DATABASE_URL` de Cloudflare) solo
   para esta ventana. No queda guardada en ningún archivo:
   ```
   $env:DATABASE_URL = "pega-aquí-la-dirección"
   ```
3. En esa misma ventana, arranca Codex con acceso total:
   ```
   codex --sandbox danger-full-access
   ```
4. Pega el prompt de abajo.

---

Tarea: publicar en producción las fases 1 y 2 de «Vessel · Reposición». La carpeta actual es el repositorio. Trabaja paso a paso y PARA en cuanto algo no cuadre: es producción.

REGLAS
- La dirección de la base de datos está en la variable de entorno DATABASE_URL de esta terminal. Nunca la muestres, ni la escribas en archivos, ni en el chat, ni en los logs, ni en commits. Si no existe, para y dime que la defina con $env:DATABASE_URL = "..." en PowerShell antes de abrir Codex.
- Esquema: vessel_reposicion. Todas las consultas, con SET search_path TO vessel_reposicion.
- No hagas pedidos, recuentos ni ningún dato de prueba en producción. Solo las migraciones y las comprobaciones de abajo.
- No uses --force, ni reescribas historia, ni borres ramas.
- Los scripts auxiliares van en tmp-capturas\publicar\ (no se sube a git) y usan la librería postgres que ya está en node_modules (si falta, npm.cmd install). Al terminar, déjalos ahí.
- En Windows: npm.cmd y npx.cmd.

PASO 1 · Preparar el código
- git fetch origin
- Comprueba que origin/almacen tiene los commits «Fase 1: In Vessel por puntos…» y «Fase 2: pestaña Viajes con Necesidades y Pedido», y que existen supabase/migrations/0005_puntos.sql y 0006_necesidades.sql en origin/almacen.
- Comprueba que origin/main está contenido en origin/almacen o que no hay conflictos (git merge-tree o una fusión de prueba en una carpeta temporal). Si hay conflictos, PARA.
- En una copia de origin/almacen (git worktree en tmp-capturas\publicar\wt), ejecuta npm.cmd test sin DATABASE_URL (quítala solo para ese comando). Deben pasar todos salvo el de concurrencia real. Si falla alguno, PARA.

PASO 2 · Comprobar la base de producción (solo lectura)
Con un script de Node y DATABASE_URL:
- Muestra current_user.
- Lista los dueños de todas las tablas y secuencias del esquema:
  SELECT tablename AS objeto, tableowner AS dueno FROM pg_tables WHERE schemaname = 'vessel_reposicion'
  UNION ALL SELECT sequencename, sequenceowner FROM pg_sequences WHERE schemaname = 'vessel_reposicion';
- Si hay más de un dueño distinto, o el dueño no es current_user, PARA y explícamelo.
- Mira si ya están aplicadas: ¿existe la columna stores.map_key (0005)? ¿Existe la tabla need_adjustments (0006)? Es normal que no.

PASO 3 · Copia de seguridad local
Antes de tocar nada, guarda una copia de todas las tablas del esquema en tmp-capturas\publicar\copia-antes-<fecha>.json (cada tabla: SELECT * FROM <tabla>). Comprueba que el archivo existe y dime cuántas filas tiene cada tabla.

PASO 4 · Migraciones
Usa los archivos de origin/almacen (los de la copia del paso 1). Para cada archivo, en este orden: 0005_puntos.sql y después 0006_necesidades.sql:
- Ejecuta en una única transacción: BEGIN; SET LOCAL search_path TO vessel_reposicion; <contenido completo del archivo>; COMMIT. Con postgres.js, sql.begin y sql.unsafe del contenido.
- Si da error, se deshace sola: PARA y dime el error (sin la dirección de la base de datos).
Después comprueba:
- SELECT id, name, map_key FROM stores ORDER BY sort, id → deben salir 10 filas: los 9 puntos (Almacén alcohol con id 1) y Out Vessel.
- Que no quedan productos sin main_store_id.
- Que existe need_adjustments.
- Que el número de filas de stock_counts, stock_moves, deliveries y trips es el mismo que en la copia del paso 3.

PASO 5 · Publicar
- git switch main y git pull origin main.
- git merge --no-ff origin/almacen -m "Publica las fases 1 y 2: In Vessel por puntos y pestaña Viajes"
- git push origin main. Cloudflare publica main sola.
- Espera unos 3 minutos y comprueba https://reposicion-barras.autemadmn.workers.dev:
  - la página principal responde 200;
  - /api/auth responde 200 con JSON (no 503 «Faltan las migraciones de Supabase»). Esa ruta no necesita código y no cambia nada.
  Si sigue saliendo 503 después de 5 minutos, dímelo.

PASO 6 · Informe para mí (no programo: lenguaje llano y corto)
- qué has hecho y qué ha salido bien;
- el resultado de los tests;
- los dueños de la base y las filas antes y después;
- dónde está la copia de seguridad;
- si la web ya responde;
- qué tengo que mirar yo en el móvil.
