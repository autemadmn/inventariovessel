# Vessel · Pedir → Nevera frontal

Origen común: entrega local del usuario `Vessel-Chupiteria-y-Nevera.zip`
(05/10/2026), recursos y renders de `scripts/cervezas/`. No se han usado
imágenes web ni modificado las imágenes o el plano aprobado de Chupitería.

| Recurso activo | Origen y tratamiento |
| --- | --- |
| `bandeja.v1.webp` | Copia exacta de `public/img/cervezas/bandeja.v1.webp` de la entrega. Acero modelado con Blender/Cycles, vista frontal 1080×1440. |
| `agua-cabreiroa-33-cl-grupo.v2.webp`, `agua-cabreiroa-33-cl-seleccion.v2.webp` | Render nuevo local, Blender 5.2/Cycles, 64 muestras y máscara de emisión. Dos botellas PET neutras sin marca ni etiqueta. El catálogo indica Cabreiroá 33 cl y la referencia Lanjarón: se mantiene el nombre del catálogo, sin presentar Lanjarón como Cabreiroá. Agua pendiente de confirmación. |
| `red-bull-grupo.v2.webp`, `red-bull-seleccion.v2.webp` | Render nuevo local de dos latas con la geometría de la entrega y su textura `red-bull-estampado.png`, recorte de `referencias/composicion.png`. 64 muestras y máscara de emisión. |
| `estrella-galicia-grupo.v2.webp`, `estrella-galicia-seleccion.v2.webp` | Cuatro botellas de Especial: recomposición de los cuatro PNG de Cycles originales y sus máscaras de emisión. Se elimina el catcher exterior que producía halos rectangulares. Texturas de etiqueta y cuello recortadas de la misma composición. |

Las máscaras nuevas usan relleno blanco al 34 % y contorno de 6 píxeles;
comparten lienzo y coordenadas con cada grupo. Postproceso con Pillow a WebP.
Fuentes y recortes en `scripts/nevera/frontal/texturas/fuentes.json`.
Fecha de preparación: 2026-10-05. Total de WebP activos: 130 762 bytes.

## Correcciones de la revisión (2026-10-05)

Heineken y Red Bull Sugarfree usan siluetas SVG neutras de chapas y latas, sin texto ni logotipos. Se han retirado de los recursos publicados sus grupos, máscaras y texturas defectuosas; los originales se conservan únicamente en `assets/correcciones-backup/`. Los scripts de render y postproceso omiten estos dos grupos y conservan el fallback al regenerar.

La selección se muestra con un aro azul en el área de toque de cada producto. La zona de Heineken se amplía a 270 px del plano (más de 56 px a 360×640), sin solaparse con las otras. Las imágenes mantienen su posición; las etiquetas agrupan nombre y pendiente al pie de cada zona. El nombre accesible conserva la denominación completa.
