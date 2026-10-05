# Vessel · Nevera frontal: fuentes y recursos activos

La bandeja v1 y Estrella Galicia v2 conservan sus WebP publicados. El plano v4 tiene cuatro zonas: agua, cuatro Red Bull normales, cinco chapas Heineken y cuatro Estrella Galicia. Se mantienen los pasos del pedido; no hay rótulos de nombres visibles.

| Recursos | Fuente y método |
|---|---|
| `bandeja.v1.webp` | Entrega local del usuario; acero modelado en Blender/Cycles. |
| `red-bull-grupo.v4.webp` y selección v4 | Diseño de `referencias/composicion.png`; cuatro latas con Blender/Cycles 64 muestras, ocupando también el antiguo hueco de Sugarfree. |
| `estrella-galicia-grupo.v2.webp` y selección v2 | Fotos recortadas de la composición y renders existentes sin catcher exterior. |
| `heineken-grupo.v3.webp` y selección v3 | [Fotografía real de chapa Original](https://crowncaps.info/caps/345831), recorte circular sin dibujar texto. Cinco chapas con la geometría original y Cycles 64 muestras. |
| `red-bull-sugarfree-grupo.v3.webp` y selección v3 (archivados, fuera del plano activo) | [Diseño oficial español Sugarfree 250 ml](https://www.redbull.com/es-es/energydrink/products/red-bull-sugarfree). Sus píxeles se aplican al cuerpo original de las dos latas; Cycles 64 muestras. |
| `agua-cabreiroa-33-cl-grupo.v3.webp` y selección v3 | Etiqueta recortada de `Caja de agua lanjaron.png`, foto aportada por el usuario. Lanjarón 33 cl confirmado; tapones rojos sobre la geometría original PET, Cycles 64 muestras. |

Máscaras de emisión de la misma geometría: blanco 34 % y contorno exterior 6 px, mismo lienzo y posición que cada grupo. Sin ImageGen en esta nevera. Orígenes, recortes e imágenes fuente en `scripts/nevera/frontal/texturas/fuentes.json`. Total activo: **174.410 bytes**, según `pesos.md`. Todos los límites se verifican.

El catálogo conserva su slug y nombre históricos de Cabreiroá y 35 unidades por caja. En Gestión → Catálogo debe renombrarse el mismo producto a Agua Lanjarón 33 cl y confirmarse el número de unidades, sin duplicarlo ni cambiar el historial.

El plano activo también lleva versión: `nevera.v4.json`. El frontal v2 y el plano de Chupitería se conservan byte a byte. Para una exportación futura, aumentar también `PLAN_VERSION` en config.py y actualizar la referencia de Pedir.
