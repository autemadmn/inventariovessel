# Nevera de Chupitería · entrega final

> **En el repositorio de la app** solo están los scripts y las texturas. Las fotos de referencia
> (`referencias/`) y la página de prueba independiente (`preview.html`) se quedaron fuera por peso; están en
> el ZIP original «Vessel-nevera-final». La app usa `public/img/nevera/nevera.v2.json`, que genera
> `layout_app.py` a partir de `seleccion.v2.json` con los slugs reales del catálogo.


Recursos de Blender/Cycles con los diseños de las referencias proporcionadas.
La escena modela el hombro visible y el tapón; no se generan botellas completas.
Solo se modifican los scripts de esta carpeta y los recursos de `public/img/nevera`.
La página de revisión sigue aislada de la aplicación.

## Abrir la interfaz y seleccionar

La entrega descargable se abre con doble clic en `index.html`, después de
extraer el ZIP. No requiere servidor, conexión ni instalación. En el repositorio
también se puede abrir directamente `scripts/nevera/preview.html`.

Cada una de las **12 botellas y 25 chapas** tiene un botón independiente.
Un toque marca exclusivamente esa pieza; otro la desmarca. Se pueden combinar
productos y cantidades libremente: seleccionar dos botellas equivale a pedir
dos. La selección cubre la silueta con **blanco al 34 %** y un contorno blanco
de 6 px. El nombre y el logotipo siguen visibles.

La nevera ocupa hasta 968 px de ancho y mantiene un mínimo de **640 px** para
que cada chapa tenga una zona circular de toque de aproximadamente **50 px**.
En pantallas estrechas se desplaza horizontalmente dentro de su propio panel.
Las zonas de toque de chapas contiguas no se solapan. Los botones admiten Tab,
Espacio y Enter, e indican su estado con `aria-pressed`.

El orden de las chapas es **B limón → Estrella Galicia sin gluten → Estrella
Galicia 0,0 → 1906 → Desperados**. Los identificadores técnicos anteriores se
conservan. Las chapas que cambiaron de compartimento se volvieron a renderizar
con Blender en su nueva posición.

El resumen inferior suma solo las piezas marcadas. **Limpiar** desmarca todo.
**Ver pedido** muestra las cantidades agrupadas y permite descargar una lista
de texto. Esa lista no se envía a un proveedor ni al servidor de la aplicación.
La selección comienza vacía al abrir o recargar la página.

`seleccion.json` define las 37 piezas, sus imágenes, máscaras, coordenadas y
zonas de toque. `preview-data.js` contiene esos mismos datos para abrir la
interfaz sin HTTP. Los estados agrupados de `layout.json` se entregan también
como recursos gráficos; la interfaz utiliza exclusivamente piezas individuales.

## Regenerar todo con un comando

Requisitos: Blender 4.2+ y Python 3.10+ con Pillow (`python -m pip install -r
scripts/nevera/requirements.txt`). La ejecución se realiza con Blender 5.2.0 LTS
instalado en este equipo; la compatibilidad con 4.2 no se ha probado.

```powershell
blender -b --python-exit-code 1 -P scripts/nevera/render.py -- --all --python python
```

En Windows, si `python` es un alias de Microsoft Store, usar una ruta de Python
real. Comando con los ejecutables disponibles en este equipo:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' -b --python-exit-code 1 -P scripts/nevera/render.py -- --all --python 'C:\Users\mrani\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
```

También se puede usar un Python que tenga `bpy` y Pillow:
`python scripts/nevera/render.py --all --python python`.

Cycles usa 128 muestras máximas, muestreo adaptativo, eliminación de ruido y
semilla 1906. `--samples 256` aumenta el límite. `--device AUTO` utiliza CUDA
si está disponible; `--device CPU` fuerza CPU. Si una escena falla en GPU,
se vuelve a intentar en CPU. No se guarda un `.blend` binario en el repositorio.

Después de la primera generación completa, `--only <slug> --all` o `--only
bandeja --all` reconstruye únicamente ese recurso y sus estados. `--only
<slug> --position 1` hace una prueba de material sin exportar WebP. PNG y
capturas intermedias se guardan en `_build/v2/`, ignorado por Git.
`python scripts/nevera/postproceso.py` exporta de nuevo los PNG existentes.

## Referencias y diseños

Los originales están en `referencias/`. `preparar_texturas.py` los recorta con
coordenadas explícitas, normaliza los círculos y crea `texturas/<slug>.png`.
No se redibujan logos. Las ligeras correcciones de exposición y cada recorte
se registran en `texturas/fuentes.json` y en el manifiesto del resultado.

- 1906, B RADLER, Estrella de disco dorado y 0,0 utilizan los primeros planos
  aportados. La 0,0 es plateada con franja azul, según esa referencia.
- El diseño del disco dorado dice **SIN GLUTEN**. Se mantiene el slug técnico
  `estrella-galicia-especial` por compatibilidad; no se modifica el catálogo.
- Desperados usa la **chapa dorada con agave rojo**, por corrección explícita
  del usuario. La referencia verde anterior se conserva sin asignarla.
- Jägermeister usa la fotografía del tapón real: banda naranja, nombre y
  “Germany”. Se sustituye el ciervo de la composición general.
- Buen amigo y Fireball usan sus tapones recortados de la composición aportada:
  blanco sobre negro y blanco/dragón sobre rojo. Los originales de esos dos
  recortes tienen aproximadamente 100 px de diámetro; ampliar la textura no
  añade detalle fotográfico. No se han encontrado ni descargado otros logos.
- El tapón blanco y el hombro estampado rosa proceden de esa composición.
  Es una referencia gráfica, no una fotografía de producto identificado.

Los nueve diseños tienen textura de referencia, sin etiquetas de slug como
marcador. La B amarilla muestra “B RADLER”, pero su identidad comercial no se
añade al catálogo. La botella rosa sigue sin identificar y no recibe una marca.
Si un nuevo producto no tiene fotografía se conserva el mecanismo de textura
provisional (color y slug); queda registrado en `layout.json`.

## Realismo y escala

Fondo **1080 × 1500 px**, cámara ortográfica cenital, **1,8 px/mm**. Las medidas
de la bandeja (aproximadamente 600 × 833 mm en el encuadre) son visuales, no
mediciones del local.

El vidrio tiene una pared hueca de 2,2 mm, perfil de hombro moldeado, rebordes,
líquido interior con absorción volumétrica y refracción separada del vidrio.
Los tapones incluyen nervaduras de agarre y borde de cierre. Las chapas modelan
21 dientes con 24 muestras por diente y varios perfiles de pliegue. El patrón
rosa se aplica sobre un hombro curvo esmaltado.

Tres luces rectangulares y un entorno oscuro forman una única iluminación
de nevera: frío suave, una reflexión lateral ligeramente cálida y reflejos
alargados. El acero tiene rugosidad y microrelieve direccionales, acabado
anisótropo y un borde embutido de varios radios. No usa neones ni HDRI externo.

**Cada pieza se renderiza en su posición final** bajo esa cámara y esas luces,
incluidas las pequeñas rotaciones de las chapas. Un plano shadow catcher
conserva contacto y reflejo tenue sobre el acero. Las chapas se renderizan a 2x
y reducen con Lanczos; los hombros de botella se renderizan a resolución nativa.
Todos los recursos publicados terminan con la misma escala que el fondo.

No se calculan reflejos entre productos ni la sombra de un producto sobre
los separadores, ya que los estados se componen de piezas aisladas. La cámara
y las luces sí coinciden exactamente. Las colas tenues de sombra se desvanecen
en los 12 px de margen del sprite, sin borrar la geometría del producto.

## Estados y contorno más marcado

Cada estado conserva todo el lienzo de su hueco. El manifiesto incluye tanto
coordenadas `pixels` como un `rect` en porcentaje. Escalar la nevera completa
por el mismo factor mantiene la coincidencia entre bandeja, producto y contorno.

- Botellas: desaparecen arriba → centro → abajo. La de abajo es la última.
- Chapas: arriba → centro izquierda → centro derecha → abajo izquierda → abajo
  derecha. La formación inicial es 1–2–2 en los cinco compartimentos.
- Estado 0: sin imagen de producto ni contorno; se ve la bandeja vacía.

El halo v2 se obtiene con Pillow del alfa: umbral 128 para excluir sombras
tenues, dilatación de **9 px**, resta de la silueta y Gauss de 0,5 px.
Su núcleo es **blanco puro al 100 %**, unos 3 px al mostrar la nevera a 390 px
de ancho. Imagen y halo mantienen idéntico lienzo y posición. Se dibuja detrás
del producto, con fundido de 150 ms; el fundido se desactiva si se solicita
reducir movimiento.
Los contornos agrupados se conservan como recursos. La interfaz final utiliza
las máscaras individuales de `seleccion.py`: dilatación de 6 px y relleno
blanco al 34 %, sin teñir la sombra del producto. La máscara se superpone al
producto en su mismo lienzo y añade una sombra tenue de contraste con CSS.

## Cambiar un producto o versión

1. Añadir una entrada `(slug, color del vidrio/disco, color del cierre)` a
   `BOTTLES` o `CAPS` de `config.py`, y su fotografía circular a `texturas/`.
2. Para un recorte reproducible, guardar el original en `referencias/` y añadir
   la coordenada a `SOURCES` en `preparar_texturas.py`.
3. Sustituir una entrada conserva los huecos actuales. Ampliar las listas
   requiere ajustar además sus rectángulos y los separadores de `render.py`.
4. Subir `VERSION` a 3 cuando se publiquen nuevas imágenes. Se generan `.v3.webp`
   y `_build/v3/`; el manifiesto apunta a esa versión. Los archivos anteriores
   se conservan para los consumidores que aún los necesiten. `layout.v1.json`
   conserva el manifiesto inicial; `layout.json` es el activo.

## Revisar y comprobar

```powershell
python scripts/nevera/verificar.py
python -m http.server 8765 --bind 127.0.0.1
```

Abrir `http://127.0.0.1:8765/scripts/nevera/preview.html`, o directamente el
archivo HTML. La página no se enlaza desde la aplicación.

QA automatizada:

```powershell
node scripts/nevera/revisar.cjs
```

Requiere el paquete `playwright` y Chromium; `NEVERA_PLAYWRIGHT` permite indicar
la ruta al paquete y `NEVERA_CHROMIUM` usar un Chrome/Edge ya instalado. El
script abre su propio servidor temporal y comprueba en móvil a 390 × 844 px
la selección y deselección independiente, combinación de productos, cantidades,
orden, zonas de toque de al menos 44 px sin solapamiento, teclado, descarga del
pedido y reducción de movimiento. También verifica la carga de todas las
imágenes desde disco sin servidor. Las capturas de móvil y escritorio quedan
en `_build/capturas-final/`. `NEVERA_PACKAGE_INDEX` permite verificar el HTML
del paquete final en lugar del HTML del repositorio.

`verificar.py` comprueba dimensiones, alfa del halo, blanco puro, máscaras de
relleno de cada pieza, márgenes transparentes y presupuesto. `pesos.md` lista
cada recurso activo y su calidad
real: ≤30.000 bytes por estado/contorno, ≤150.000 para el fondo y ≤1.500.000
para el conjunto. El exportador conserva la resolución y parte de calidad 80;
solo reduce RGB si hace falta. El alfa de WebP se mantiene sin pérdida.

## Preparar la entrega

Tras generar y verificar los recursos, `python scripts/nevera/empaquetar.py`
crea en `_build/entrega/` una carpeta y un ZIP con el HTML independiente, los
recursos activos, fuentes de Blender/Pillow y referencias. Excluye versiones
anteriores, cachés, renders intermedios y los archivos de la aplicación.
