# Actualización y publicación · 6 de octubre de 2026

El usuario autoriza aplicar las migraciones y fusionar la rama de trabajo en main para publicar en GitHub, después de quitar los rótulos de la nevera. Confirma sustituir Sugarfree por Red Bull normal en el plano frontal.

## Cambios

Nevera frontal sin nombres superpuestos. Cuatro latas Red Bull normales forman una única zona táctil; Sugarfree permanece disponible en las tarjetas. Se conservan los indicadores de cantidad, pendientes y agotado y las etiquetas accesibles. Plano `nevera.v4.json` y grupo Red Bull v4, con caché independiente de versiones anteriores. Cuatro zonas, 174.410 bytes de WebP. Chupitería conserva sus 37 piezas.

## Migración de producción

Proyecto Supabase `bolsillo` (`vgabqiwharxvwpjplqcl`), esquema `vessel_reposicion`. Inspección previa: migraciones anteriores presentes; faltaba la marca de 0011, había dos barras. Ejecutada `0011_vip_y_otros.sql` con `SET search_path TO vessel_reposicion;` mediante el CLI autenticado. Verificación posterior: marca `vip_y_otros=1`, barras 1/2/VIP, punto `barra-vip` enlazado a barra 3 y Perrier, Schweppes Fresa y Tónica Zero en Otros. Los 90 productos de producción permanecen.

## Validación

137 pruebas correctas, 0 fallidas, 1 omitida por falta de TEST_DATABASE_URL. Revisión de Nevera: cuatro tamaños, pedido por cajas, restar, teclado, VIP, pendientes, agotados, Sugarfree en catálogo y ausencia de rótulos. Revisión completa: 88 capturas, cuatro tamaños y dos temas; imágenes cargadas, carrito y objetivos táctiles correctos.

Las migraciones publicadas no se editan. Se preservan los archivos sin seguimiento preexistentes y los recursos antiguos. No se incluyen intermedios ni capturas en Git.
