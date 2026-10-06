# Vessel · Nevera frontal dentro de Pedir

Cinco zonas: dos Lanjarón 33 cl, dos Red Bull, dos Red Bull Sugarfree, cinco chapas Heineken y cuatro botellas Estrella Galicia. Todas tienen imagen y máscara. Un toque conserva el paso del catálogo (35 aguas, 24 de cada Red Bull y Estrella, 1 Heineken); no cambia la lógica de pedido. Confirmar el pack real de agua y renombrar su producto existente en Gestión.

`config.py` conserva centros, rectángulos y zonas de toque. Heineken ocupa la balda central. Las áreas de toque no se solapan y alcanzan 44 px en los cuatro tamaños de QA. La nevera cabe entre cabecera y carrito. Chupitería conserva su plano y las 37 piezas; sus botones de chapas ahora reparten toda la fila de forma independiente del dibujo, 44 px en 360×640.

## Fuentes

Las texturas nuevas son recortes fotográficos: chapa Heineken Original, diseño original de Red Bull conservado en referencias/composicion.png y etiqueta Lanjarón aportada. `preparar_texturas.py` vuelve a crear sus texturas a partir de `referencias/`, conserva letras originales y documenta recortes y enlaces en `texturas/fuentes.json`. Ver `public/img/nevera/frontal/CREDITOS.md`. No hay siluetas activas en el plano frontal.

## Regenerar

Python con Pillow y Blender 5.2:

```powershell
$nvPython = 'C:\Users\mrani\.cache\vessel-img\Scripts\python.exe'
$nvBlender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
& $nvBlender -b --python-exit-code 1 -P scripts/nevera/frontal/render.py -- --all --samples 64 --python $nvPython
& $nvPython -B scripts/nevera/frontal/verificar.py
```

`--all` renderiza todos los grupos, incluidos Heineken, Red Bull normal y agua, con sus pases de emisión. `--only <slug>` permite regenerar uno. `--masks-only` renueva solo geometría. Los intermedios `_build/` se excluyen de Git.

Los WebP publicados son inmutables. **Antes de exportar un cambio, aumentar la versión del grupo en config.py** (Red Bull normal usa v4). El postproceso conserva archivos ya publicados y crea solamente nuevas versiones; `save` rechaza un intento de sobrescritura con bytes distintos. La bandeja v1 y grupos v2 anteriores se conservan.

Límites: fondo ≤150.000 bytes, grupo ≤80.000, selección ≤30.000, total ≤1.500.000. Total actual 174.410 bytes; registro en `pesos.md`. Máscara blanca al 34 % y contorno exterior 6 px alineados a la geometría. No se necesita ninguna migración nueva.

## Comprobar

Servidor local en puerto 3137 con DATA_DIR temporal en `assets/final/qa-data`, sin DATABASE_URL. Para la revisión de Catálogo, configurar MANAGER_PIN=2468 solo en este servidor de pruebas.

```powershell
$env:NEVERA_PLAYWRIGHT = 'C:\Users\mrani\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
$env:NEVERA_CHROMIUM = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/nevera/frontal/revisar.cjs
node scripts/images/revisar-final.cjs
npm test
```

`NEVERA_URL` permite cambiar el servidor. La revisión final crea pedidos **solo en la base temporal local** para las tres barras; debe ejecutarse con esa copia. Guarda capturas en `tmp-capturas/final/`: portada, Alcohol/Premium, Nevera, Chupitería, Refrescos/Zumos, Otros, Reponer, carrito y Catálogo, en claro y oscuro, a 360×640, 390×844, 768×1024 y 1024×768. Comprueba imágenes cargadas, overflow, toques de 44 px, ausencia de solapes y sumar/restar chapas.

El plano activo también lleva versión: `nevera.v5.json` (dos Red Bull y dos Sugarfree, como en v3). Los frontales v2/v3 y el plano de Chupitería se conservan byte a byte. Para una exportación futura, aumentar también `PLAN_VERSION` en config.py y actualizar la referencia de Pedir.

Actualización 6 de octubre de 2026: se retiran todos los rótulos visibles de productos; quedan las cantidades, pendientes, agotados y nombres accesibles para lectores de pantalla. Las cuatro latas de Red Bull normal comparten una zona de pedido, y Sugarfree permanece en las tarjetas. La migración 0011 ya está aplicada y verificada en producción.
