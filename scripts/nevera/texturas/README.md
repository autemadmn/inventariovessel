Las texturas v2 se recortan de los originales aportados por el usuario en
`../referencias/`. `../preparar_texturas.py` registra origen, coordenadas y
exposición en `fuentes.json`; no redibuja logos.

`<slug>.png` representa la cara circular de una chapa/tapón, con transparencia
en las esquinas. `rosa-hombro.png` es el estampado de la referencia general.
Buen amigo, Fireball y rosa proceden de esa composición, no de primeros planos
independientes. El resto usa las fotos nuevas aportadas. Desperados usa la
corrección dorada con agave rojo; Jägermeister el tapón con banda naranja.

Para añadir productos, usar fotos cenitales reales y conservar el original.
Si falta una textura, el marcador provisional (color + slug) se genera en
`../_build/v<version>/provisionales/` y se enumera en `layout.json`.
