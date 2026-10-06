# Actualización y publicación · 6 de octubre de 2026

El usuario autoriza aplicar las migraciones y fusionar la rama de trabajo en main para publicar en GitHub, después de quitar los rótulos de la nevera. Confirma sustituir Sugarfree por Red Bull normal en el plano frontal.

## Cambios

Nevera frontal sin nombres superpuestos. Cuatro latas Red Bull normales forman una única zona táctil; Sugarfree permanece disponible en las tarjetas. Se conservan los indicadores de cantidad, pendientes y agotado y las etiquetas accesibles. Plano `nevera.v4.json` y grupo Red Bull v4, con caché independiente de versiones anteriores. Cuatro zonas, 174.410 bytes de WebP. Chupitería conserva sus 37 piezas.

## Migración de producción

Proyecto Supabase `bolsillo` (`vgabqiwharxvwpjplqcl`), esquema `vessel_reposicion`. Inspección previa: migraciones anteriores presentes; faltaba la marca de 0011, había dos barras. Ejecutada `0011_vip_y_otros.sql` con `SET search_path TO vessel_reposicion;` mediante el CLI autenticado. Verificación posterior: marca `vip_y_otros=1`, barras 1/2/VIP, punto `barra-vip` enlazado a barra 3 y Perrier, Schweppes Fresa y Tónica Zero en Otros. Los 90 productos de producción permanecen.

## Validación

137 pruebas correctas, 0 fallidas, 1 omitida por falta de TEST_DATABASE_URL. Revisión de Nevera: cuatro tamaños, pedido por cajas, restar, teclado, VIP, pendientes, agotados, Sugarfree en catálogo y ausencia de rótulos. Revisión completa: 88 capturas, cuatro tamaños y dos temas; imágenes cargadas, carrito y objetivos táctiles correctos.

Las migraciones publicadas no se editan. Se preservan los archivos sin seguimiento preexistentes y los recursos antiguos. No se incluyen intermedios ni capturas en Git.

## Publicación de la migración 0012 · 6 de octubre de 2026

El usuario autoriza aplicar únicamente la migración 0012 en producción, fusionar la rama `claude/happy-rubin-z4fac5` en main, hacer push y registrar esta publicación. La rama estaba en `a81eaf7` («Alcohol como estantería y barra inferior fija en la webapp instalada») y contenía todo `origin/main`. No había cambios en archivos seguidos; se conservaron intactos los archivos sin seguimiento ajenos a la tarea.

### Cambios

Alcohol se presenta como una estantería con pestañas por categoría, baldas de cuatro botellas y búsqueda entre todas las categorías. Refrescos muestra seis cajas en dos columnas, sin buscador ni el rótulo «Caja de 24». Zumos pasa a Otros. La nevera frontal muestra dos Red Bull y dos Sugarfree, sin tarjetas debajo; Chupitería muestra la nevera completa. Almacén presenta el mapa sin la lista de puntos debajo. Reponer permite seleccionar líneas y registrar como hechas únicamente las marcadas. Se publica también la corrección de la barra inferior para la webapp instalada.

### Migración de producción

Proyecto Supabase `bolsillo` (`vgabqiwharxvwpjplqcl`), esquema `vessel_reposicion`, mediante el editor SQL autenticado. Se ejecutó todo `supabase/migrations/0012_zumos_en_otros.sql` sin editar, con `SET search_path TO vessel_reposicion;` delante y conservando la transacción del archivo.

Antes: `vip_y_otros=1`, marca `zumos_en_otros` ausente, `catalog_rev=15` y 90 productos. Los grupos, en su orden anterior, eran:

| Grupo | Sección | sort |
| --- | --- | ---: |
| Habituales | alcohol | 10 |
| Premium | alcohol | 20 |
| Nevera | nevera | 30 |
| Chupitos | chupiteria | 40 |
| Cervezas especiales | chupiteria | 50 |
| Refrescos | refrescos | 60 |
| Zumos | refrescos | 70 |
| Otros | otros | 80 |

Después: `zumos_en_otros=1`, Zumos con `section=otros` y `sort=90`, igual al máximo de todos los grupos. `catalog_rev=16`, exactamente una revisión más. El número de productos permanece en 90. No se hicieron pedidos, recuentos ni otros cambios de operación en producción.

### Validación

`npm.cmd test` tanto en la rama como después de la fusión en main: 138 pruebas, 137 correctas, 0 fallidas y 1 omitida por falta de `TEST_DATABASE_URL`. Las pruebas se ejecutaron sin `DATABASE_URL` ni `TEST_DATABASE_URL`.

Revisión de navegador en local a 390×844 con Node y PGlite en `assets/publicacion-0012-local/`: categorías y baldas de Alcohol, tocar para sumar, búsqueda de Zeeland desde Rones, seis cajas de Refrescos en dos columnas, Zumos en Otros, ambas neveras y mapa de Almacén. En Reponer se prepararon dos líneas únicamente en la base temporal; «Seleccionar todo» marcó ambas y «Hecho» entregó solo la marcada, dejando la otra pendiente. Capturas y registros en `tmp-capturas/publicacion-0012/`, excluidos de Git. El servidor temporal se detuvo al terminar la revisión.

### Despliegue

Fusión sin conflictos ni reescritura de historia, con el mensaje autorizado. Commit de main publicado: `fa30f5b0bfe709ad2af83add27ae54aa17bdc7ed`.

El push activó automáticamente [Cloudflare Build 4375d215](https://dash.cloudflare.com/6bceba3748192554503b9137c23b337e/workers/services/view/reposicion-barras/production/builds/4375d215-6bee-4d12-a58b-76f64e6c12f7). Terminó correctamente: 137 pruebas correctas, 0 fallidas y 1 omitida; comandos de build y deploy completados. Versión desplegada: `29c26e33-97e6-4320-8a4b-34b47d8eb700`.

Comprobado en [Vessel publicado](https://reposicion-barras.autemadmn.workers.dev): Alcohol muestra la estantería con pestañas y baldas de cuatro; Otros incluye Zumos de naranja, melocotón y piña. La revisión de producción fue solo de lectura.

Pendiente de la comprobación de Alejandro en el iPhone: abrir la app desde la pantalla de inicio y confirmar que la barra inferior permanece fija al hacer scroll. Si aparece la versión anterior, cerrar la app por completo y volver a abrirla.
