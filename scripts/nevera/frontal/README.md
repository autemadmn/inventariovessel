# Vessel · Nevera frontal dentro de Pedir

Esta carpeta adapta la referencia local `Vessel-Chupiteria-y-Nevera.zip` a
la app. Sustituye la demo independiente de `scripts/cervezas/`: no incluye
su pedido TXT, preview ni empaquetador. No modifica `scripts/nevera/` de
Chupitería. Los recursos activos están en `public/img/nevera/frontal/` y
el contrato de coordenadas y slugs en `nevera.v2.json`.

La balda superior contiene dos botellas PET neutras, dos Red Bull y dos
Sugarfree; la central cinco chapas Heineken y la inferior cuatro Estrella
Galicia Especial. Un toque suma el paso del catálogo a la barra elegida
(35 unidades de agua, 24 de cada Red Bull y de Estrella, 1 Heineken).
Todas las piezas del producto se marcan juntas. El botón menos resta el
mismo paso. Se usa el diálogo y envío de la app. Productos nuevos sin
zona aparecen debajo, en «Más de la nevera». Productos retirados de la
selección dejan su hueco vacío. La vista frontal no tiene buscador.

`config.py` contiene los cinco grupos, centros, rectángulos y zonas de
toque independientes; Heineken ocupa toda la balda central. La app adapta
la nevera al alto disponible, sin ancho mínimo ni desplazamiento horizontal.
Chupitería conserva su plano, 37 piezas y modo de selección por pieza.
Sus huecos de chapas pueden quedar por debajo de 44 px al reducirse: riesgo
preexistente, fuera de esta modificación.

## Origen y decisiones de las imágenes

Ver `public/img/nevera/frontal/CREDITOS.md`. La bandeja v1 se conserva de
la entrega. Heineken y Sugarfree usan siluetas SVG neutras en la app, sin
texto ni logotipos: se han retirado sus grupos, máscaras y texturas por
no ser fiables. `config.py`, el render y el postproceso omiten esos recursos
para que no vuelvan a publicarse al regenerar. El agua permanece neutra:
el catálogo indica Cabreiroá y la foto disponible es de Lanjarón; la marca
requiere confirmación del usuario.

Estrella v2 recompone los renders originales, eliminando el catcher fuera
de la silueta real. Las máscaras de emisión no incluyen acero ni sombras.
El blanco cubre el producto al 34 % y el contorno exterior mide 6 px.
Los grupos y máscaras comparten lienzo y posición. No se ha usado ImageGen.

## Regenerar

Python con Pillow y Blender 5.2. En este equipo:

```powershell
$nvPython = 'C:\Users\mrani\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$nvBlender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
& $nvBlender -b --python-exit-code 1 -P scripts/nevera/frontal/render.py -- --all --samples 64 --python $nvPython
& $nvPython scripts/nevera/frontal/verificar.py
```

`--only <slug>` y `--position 1` regeneran grupos o instancias concretas.
`render.py -- --masks-only --only <slug>` repite solo pases de emisión;
después `postproceso.py --masks-only` recompone los PNG con esas máscaras.
Los intermedios y capturas están en `_build/`, y los logs/pycache se excluyen.
`--all` puede regenerar el fondo en `_build/`, pero el postproceso conserva
el fondo v1 publicado; no sobrescribe esos WebP inmutables.
Para regenerar cualquier recurso ya publicado, subir primero su versión
en `config.py` y en el plano. Las imágenes nuevas de esta integración son v2.

Límites: fondo 150 000 bytes, grupo 80 000, máscara 30 000 y total 1 500 000.
`pesos.md` registra el resultado. No hace falta migración 0012: el seed ya
contiene los cinco productos, sus unidades y sección.

## Comprobar la app

`npm test` incluye pruebas de recursos, dimensiones, catálogo, tamaños de
toque, solapamientos, enlace puro por slug y preservación del plano aprobado.
La importación de `nevera.js` en Node no requiere DOM ni localStorage.

Con un servidor Node local en el puerto 3137 y datos temporales:

```powershell
$env:PORT = '3137'
$env:DATA_DIR = 'C:\Users\mrani\inventariovessel\assets\nevera-qa-data'
node server/index.js
```

En otra terminal, con Playwright disponible:

```powershell
$env:NEVERA_PLAYWRIGHT = 'C:\Users\mrani\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
$env:NEVERA_CHROMIUM = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/nevera/frontal/revisar.cjs
```

`NEVERA_URL` permite cambiar el servidor local. La QA comprueba 360×640,
390×844, 768×1024 y 1024×768: hit de 44 px, encaje con el carrito, sin overflow,
pedido por caja, VIP, restar, cantidades parciales, pendientes, agotados,
altas/bajas, fallback de tarjetas, movimiento reducido y 37 piezas de Chupitería.
Solo revisa el diálogo: no envía solicitudes.

Las zonas táctiles son independientes del rectángulo visual. Heineken ocupa
270 px de alto en el plano, más de 56 px en la pantalla 360×640; las zonas
adyacentes se ajustan sin solapamiento y el dibujo conserva su posición.
La etiqueta junta el nombre (13 px) y el pendiente (11 px), sin elipsis.
