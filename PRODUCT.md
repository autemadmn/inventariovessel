# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Personal de barra** (Barra 1, Barra 2 y Barra VIP de la discoteca Vessel): piden reposición desde el móvil durante la
  noche, con prisa, poca luz y ruido. Tocan botellas y envían; pocos segundos por pedido.
- **Quien repone** (almacén ↔ barras): consulta la lista compartida de lo que falta, lo lleva todo y
  marca lo que ha llevado en cada viaje y lo confirma con «Hecho».
- **Encargado**: con más calma y en almacén u oficina con luz normal, revisa informes, corrige
  errores, prevé necesidades y prepara la lista de compra.

El uso se reparte entre barra (luz baja, prisa) y almacén/oficina (luz normal).

## Product Purpose

Organizar la reposición de botellas entre almacén y las tres barras, guardar lo realmente repuesto
cada noche y usar ese historial para prever compras. Éxito: pedir y completar una reposición en
segundos, sin escribir, y que el encargado compre con datos reales.

## Positioning

Una herramienta interna hecha a la medida de tres barras y su almacén: catálogo propio con fotos de
las botellas de sus estanterías, noches de trabajo que cruzan la medianoche y previsión sencilla y
explicable. No es un TPV ni un inventario genérico.

## Operating Context

- Móviles del personal (principalmente) y alguna tablet; web publicada en Cloudflare, sin red local.
- Noche de trabajo: lo anterior a las 12:00 cuenta para la noche anterior.
- Flujo: Pedir (barra) → Reponer (lista compacta, marcar lo llevado + «Hecho») → Gestión (encargado, con PIN).
- La interfaz no se amplía con doble toque ni pellizco: en barra un zoom accidental cuesta tiempo.
- Varias personas usan la app a la vez; la lista se actualiza sola cada pocos segundos.

## Capabilities and Constraints

- Catálogo local de 88 productos activos (ginebras, vodkas, whiskies, rones, tequila); productos
  dudosos marcados «por confirmar»; dos botellas sin identificar fuera de la pantalla de pedir.
- Agotado en almacén ≠ falta en barra.
- Informes por producto/barra/noche/semana/mes; «consumo» solo si el nivel de las barras es el mismo.
- Previsión por promedio por noche o por día de la semana; lista de compra editable en botellas/cajas.
- Fuera de alcance: copas individuales, integración con Ágora.
- Selección editable por el encargado (grupos y orden de «Pedir») y lista de personal para elegir
  quién usa el dispositivo (solo nombres, no cuentas).
- Stack: HTML/CSS/JS sin compilación; Cloudflare Workers + Supabase (Postgres) mediante postgres.js;
  PGlite en local y en las pruebas.

## Brand Commitments

- Nombre: **Vessel** (la discoteca). No hay logo ni colores oficiales: el estilo es libre.
- Idioma: español de España, tono directo y práctico.
- Estilo elegido por el usuario: **estándar limpio** de herramienta profesional de hostelería, al
  nivel de Square o Toast, sin guiños temáticos. Tipografía Archivo e iconos Lucide; claro u oscuro
  según el ajuste del móvil.

## Evidence on Hand

- 79 imágenes de catálogo: 63 PNG previos conservados y 16 nuevos. Fuentes, modelos y referencias en `public/img/botellas/manifest.json` y `CREDITOS.md`.
- En el cierre hay ocho fotografías oficiales/de tienda recortadas, la caja Lanjarón aportada y siete imágenes de ImageGen contrastadas con referencias reales. `origen` distingue fotos externas de fotos del local; el campo heredado `foto-local` indica procesamiento fotográfico local.
- Nueve productos conservan silueta justificada: Buen Amigo y Cassaya sin botella completa verificable; Schweppes Zero/Fresa y Perrier sin imagen exacta del pack; los tres zumos sin marca confirmada y vino blanco sin identificar. Lista auditada contra PGlite en `docs/catalogo/imagenes-pendientes.json`.
- Nevera frontal: fotografía real de chapa Heineken, diseño oficial Sugarfree y etiqueta Lanjarón aportada, aplicados a la geometría de Blender/Cycles; todos los grupos tienen imagen y máscara v3 o sus recursos previos.
- Chupitería: plano aprobado y 37 piezas intactos. Zonas táctiles independientes de los dibujos, mínimo 44 px en 360×640.
- No hay logo ni material de marca propio; no se inventan referencias para productos dudosos.

## Product Principles

1. La rapidez manda: cada toque de más en barra es un coste.
2. Claridad de estado: qué falta, dónde y si está agotado, visible de un vistazo.
3. Registrar solo lo que realmente pasó; los errores se corrigen con constancia, no se borran.
4. Nada inventado: lo dudoso se marca como dudoso.

## Anti-references (confirmed by the user)

- Que parezca una plantilla genérica hecha con IA.
- Perder rapidez (más toques, objetivos más difíciles de acertar, más lectura).
- Estética «hortera de discoteca»: neones, brillos y efectos exagerados.
