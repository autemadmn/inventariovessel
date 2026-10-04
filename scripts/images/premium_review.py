"""Hojas de revisión e informe de los 30 recortes Premium, sin regeneración.

Ejecutar después de process.py --selection assets/premium/seleccion.json.
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

import process

ROOT = process.ROOT
PREMIUM = ROOT / "assets/premium"
REVIEW = PREMIUM / "revision"
NOTES = {
    "hendricks": "Recorte corregido sin regenerar: cuerpo negro opaco y RGB original recuperados; aprobado en revisión final.",
    "nordes": "Aprobada en revisión final: edición Nº2 correcta; distribución de conchas distinta de la referencia.",
    "chivas-regal-12": "Aprobada en revisión final: microletras bajo el escudo ilegibles, sin efecto al tamaño de la app.",
    "brugal-1888": "Aprobada en revisión final: párrafo pequeño ilegible como en la referencia; se conservó el primer intento.",
}


def font(size):
    path = Path("C:/Windows/Fonts/arial.ttf")
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default(size=size)


def on_background(path, color="white", fit=True):
    tile = Image.new("RGBA", process.CANVAS, color)
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image).convert("RGBA")
        if fit:
            image = ImageOps.contain(image, (488, 659), Image.Resampling.LANCZOS)
        tile.alpha_composite(image, ((512 - image.width) // 2, (683 - image.height) // 2))
    return tile.convert("RGB")


def comparison(ficha):
    slug = ficha["slug"]
    reference = ROOT / ficha["referencia"]
    local = ROOT / "docs/catalogo/referencias" / (slug + ".jpg")
    output = process.OUTPUT / (slug + ".png")
    sheet = Image.new("RGB", (2048, 785), "#e5e5e5")
    draw = ImageDraw.Draw(sheet)
    draw.text((16, 10), slug, font=font(25), fill="black")
    labels = ["Referencia descargada", "Foto del local", "PNG nuevo · blanco", "PNG nuevo · #111214"]
    tiles = [on_background(reference), on_background(local) if local.exists() else None,
             on_background(output, fit=False), on_background(output, "#111214", fit=False)]
    for index, (label, tile) in enumerate(zip(labels, tiles)):
        x = index * 512
        draw.text((x + 12, 48), label, font=font(20), fill="black")
        if tile:
            sheet.paste(tile, (x, 82))
        else:
            draw.text((x + 256, 420), "No disponible", font=font(23), fill="#666666", anchor="mm")
        draw.line((x, 82, x, 765), fill="#aaa")
    sheet.save(REVIEW / (slug + ".png"), optimize=True)
    return local.exists()


def overview(slugs):
    slugs = ["larios-12", "cutty-sark"] + slugs
    sheet = Image.new("RGB", (2048, 4 * 378), "#111214")
    draw = ImageDraw.Draw(sheet)
    for index, slug in enumerate(slugs):
        tile = on_background(process.OUTPUT / (slug + ".png"), "#111214", fit=False)
        tile = tile.resize((256, 342), Image.Resampling.LANCZOS)
        x, y = index % 8 * 256, index // 8 * 378
        sheet.paste(tile, (x, y))
        draw.text((x + 128, y + 358), slug, font=font(15), fill="white", anchor="mm")
    sheet.save(REVIEW / "_todas.png", optimize=True)


def main():
    REVIEW.mkdir(parents=True, exist_ok=True)
    fichas = json.loads((PREMIUM / "fichas.json").read_text(encoding="utf-8"))
    report = json.loads((PREMIUM / "procesado/informe.json").read_text(encoding="utf-8"))
    images = {item["slug"]: item for item in report["images"]}
    rows = []
    for ficha in fichas:
        slug = ficha["slug"]
        local = comparison(ficha)
        item = images[slug]
        a = item["adjustments"]
        adjustments = f"Erosión {a['erode_px']} px; alfa ≤{a['alpha_floor']}; {item['scaled_size'][0]}×{item['scaled_size'][1]}"
        if a.get("opaque_interior"):
            adjustments += "; interior opaco y RGB original recuperados"
        if item["scaled_size"][1] < round(683 * .94):
            adjustments += "; límite de ancho 90 %"
        incidents = NOTES.get(slug, "Sin incidencia de recorte observada.")
        if not local:
            incidents += " Sin foto del local."
        rows.append({"slug": slug, "KB": item["KB"], "ajustes": adjustments,
                     "incidencias": incidents, "foto_local": local,
                     "confidence": ficha["confidence"], "hoja": f"assets/premium/revision/{slug}.png"})
    overview([f["slug"] for f in fichas])
    process.json_write(REVIEW / "informe.json", {"baseline_exclusive": report["baseline_exclusive"],
                       "originals_unchanged": report["originals_unchanged"], "images": rows})
    lines = ["# Premium: recorte y revisión", "",
             "30 PNG de 512×683, transparentes, menores de 150.000 bytes. Base: y=668 (borde exclusivo).",
             "20 PNG originales y sus entradas intactos. Sin regeneración, commit ni push.", "",
             "| Slug | KB (1000 bytes) | Ajustes | Incidencias |", "|---|---:|---|---|"]
    lines += [f"| {r['slug']} | {r['KB']:.2f} | {r['ajustes']} | {r['incidencias']} |" for r in rows]
    (REVIEW / "informe.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Listo: {len(rows)} comparaciones, _todas.png e informe.json/md en {REVIEW}")


if __name__ == "__main__":
    main()
