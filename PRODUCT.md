# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Personal de barra** (dos barras de la discoteca Vessel): piden reposición desde el móvil durante la
  noche, con prisa, poca luz y ruido. Tocan botellas y envían; pocos segundos por pedido.
- **Quien repone** (almacén ↔ barras): consulta la lista compartida de lo que falta, lo lleva todo y
  confirma con «Hecho».
- **Encargado**: con más calma y en almacén u oficina con luz normal, revisa informes, corrige
  errores, prevé necesidades y prepara la lista de compra.

El uso se reparte entre barra (luz baja, prisa) y almacén/oficina (luz normal).

## Product Purpose

Organizar la reposición de botellas entre almacén y las dos barras, guardar lo realmente repuesto
cada noche y usar ese historial para prever compras. Éxito: pedir y completar una reposición en
segundos, sin escribir, y que el encargado compre con datos reales.

## Positioning

Una herramienta interna hecha a la medida de dos barras y su almacén: catálogo propio con fotos de
las botellas de sus estanterías, noches de trabajo que cruzan la medianoche y previsión sencilla y
explicable. No es un TPV ni un inventario genérico.

## Operating Context

- Móviles del personal (principalmente) y alguna tablet; web publicada en Cloudflare, sin red local.
- Noche de trabajo: lo anterior a las 12:00 cuenta para la noche anterior.
- Flujo: Pedir (barra) → Reponer (lista compacta + «Hecho») → Gestión (encargado, con PIN).
- Varias personas usan la app a la vez; la lista se actualiza sola cada pocos segundos.

## Capabilities and Constraints

- Catálogo provisional de 49 productos (ginebras, vodkas, whiskies, rones, tequila); productos
  dudosos marcados «por confirmar»; dos botellas sin identificar fuera de la pantalla de pedir.
- Agotado en almacén ≠ falta en barra.
- Informes por producto/barra/noche/semana/mes; «consumo» solo si el nivel de las barras es el mismo.
- Previsión por promedio por noche o por día de la semana; lista de compra editable en botellas/cajas.
- Fuera de alcance: nevera, copas individuales, VIP, integración con Ágora.
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

- 29 fotos de referencia de botellas con licencia libre en `public/img/botellas/` (créditos en
  `CREDITOS.md`); el resto se fotografían desde la app. No inventar fotos de productos dudosos.
- No hay logo, fotografías del local ni material de marca.

## Product Principles

1. La rapidez manda: cada toque de más en barra es un coste.
2. Claridad de estado: qué falta, dónde y si está agotado, visible de un vistazo.
3. Registrar solo lo que realmente pasó; los errores se corrigen con constancia, no se borran.
4. Nada inventado: lo dudoso se marca como dudoso.

## Anti-references (confirmed by the user)

- Que parezca una plantilla genérica hecha con IA.
- Perder rapidez (más toques, objetivos más difíciles de acertar, más lectura).
- Estética «hortera de discoteca»: neones, brillos y efectos exagerados.
