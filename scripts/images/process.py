"""Recorta exclusivamente las candidatas aprobadas; no genera imágenes.

Windows: ~/.cache/vessel-img/Scripts/python.exe scripts/images/process.py
Unix: ~/.cache/vessel-img/bin/python scripts/images/process.py
Instalar primero las dependencias de requirements.txt en ese entorno externo.
Los intermedios, la selección y el informe quedan en assets/procesado/.
Para otra lista: --selection assets/premium/seleccion.json
                --adjustments assets/premium/ajustes.json
Sus intermedios se guardan en procesado/ junto al JSON de selección.
"""

from __future__ import annotations

import argparse
from datetime import date
import hashlib
import io
import json
import os
from pathlib import Path
import statistics

import numpy as np
import imagequant
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "public/img/botellas"
WORK = ROOT / "assets/procesado"
CANVAS = (512, 683)
LIMIT = 150_000  # Más estricto que 150 KiB.
MODEL = "isnet-general-use"
REFERENCES = ("larios-12", "j-b-rare")
SELECTION = [
    {"slug": "cutty-sark", "file": "cutty-sark.png",
     "source": "assets/candidatas/codex/cutty-sark.png",
     "model": "openai-imagegen", "refs": ["docs/catalogo/referencias/cutty-sark.jpg"],
     "confidence": "media"},
    {"slug": "flor-de-cana-anejo-reserva", "file": "flor-de-cana-anejo-reserva.png",
     "source": "assets/candidatas/codex/flor-de-cana-anejo-reserva.png",
     "model": "openai-imagegen", "refs": ["docs/catalogo/referencias/flor-de-cana-anejo-reserva.jpg"],
     "confidence": "media"},
]
# Ajustes independientes por slug. Erosión medida en píxeles del original.
ADJUSTMENTS = {
    "cutty-sark": {"alpha_matting": False, "erode_px": 1, "alpha_floor": 8},
    "flor-de-cana-anejo-reserva": {"alpha_matting": False, "erode_px": 1, "alpha_floor": 8},
}
DEFAULT_ADJUSTMENTS = {"alpha_matting": False, "erode_px": 1, "alpha_floor": 8}


def adjustments_for(slug):
    return {**DEFAULT_ADJUSTMENTS, **ADJUSTMENTS.get(slug, {})}


def load_selection(path):
    entries = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(entries, list) or not entries:
        raise ValueError("La selección debe ser una lista no vacía")
    seen = set()
    for entry in entries:
        for key in ("slug", "file", "source", "model", "refs", "confidence"):
            if key not in entry:
                raise ValueError(f"Falta {key} en la selección")
        slug = entry["slug"]
        if slug in seen or not slug or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in slug):
            raise ValueError(f"Slug repetido o inválido: {slug}")
        seen.add(slug)
        if entry["file"] != slug + ".png" or entry["confidence"] not in ("alta", "media"):
            raise ValueError(f"Archivo o confianza inválidos: {slug}")
        if not isinstance(entry["refs"], list) or not (ROOT / entry["source"]).is_file():
            raise ValueError(f"Referencias o bruto inválidos: {slug}")
    return entries


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def json_write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def alpha_bbox(image, threshold=1):
    return image.convert("RGBA").getchannel("A").point(
        lambda a: 255 if a >= threshold else 0).getbbox()


def preserve_originals():
    snapshot = WORK / "originales.json"
    if not snapshot.exists():
        raw = (OUTPUT / "manifest.json").read_text(encoding="utf-8")
        entries = json.loads(raw)
        json_write(snapshot, {"manifest": entries, "manifest_text": raw,
                              "sha256": {s: digest(OUTPUT / e["file"]) for s, e in entries.items()}})
    return json.loads(snapshot.read_text(encoding="utf-8"))


def measure_baseline():
    measurements = {}
    for slug in REFERENCES:
        with Image.open(OUTPUT / (slug + ".png")) as image:
            assert image.size == CANVAS
            measurements[slug] = {"bbox": alpha_bbox(image), "bbox_alpha_128": alpha_bbox(image, 128)}
    # Borde inferior exclusivo: coincide con la colocación paste(y + height).
    baseline = round(statistics.mean(m["bbox"][3] for m in measurements.values()))
    return baseline, measurements


def cutout(entry, session, refresh):
    from rembg import remove
    slug = entry["slug"]
    adjustments = adjustments_for(slug)
    source = ROOT / entry["source"]
    signature = {"source_sha256": digest(source), "model": MODEL,
                 "alpha_matting": adjustments["alpha_matting"], "decontaminate": True,
                 "matting_erode_size": 3}
    cached = WORK / (slug + ".rembg.png")
    metadata = WORK / (slug + ".rembg.json")
    if refresh or not cached.exists() or not metadata.exists() or json.loads(metadata.read_text()) != signature:
        print(f"rembg: {slug}", flush=True)
        with Image.open(source) as original:
            image = remove(original.convert("RGB"), session=session,
                           alpha_matting=adjustments["alpha_matting"],
                           alpha_matting_erode_size=3, decontaminate=True).convert("RGBA")
        image.save(cached)
        json_write(metadata, signature)
    image = Image.open(cached).convert("RGBA")
    alpha = image.getchannel("A")
    if adjustments["erode_px"]:
        alpha = alpha.filter(ImageFilter.MinFilter(2 * adjustments["erode_px"] + 1))
    values = np.array(alpha)
    values[values <= adjustments["alpha_floor"]] = 0
    values[values >= 250] = 255
    if adjustments.get("opaque_interior"):
        # Una etiqueta clara y una botella cerámica no son agujeros de vidrio.
        # Rellena entre los bordes fiables de cada fila y recupera el RGB del
        # bruto: la descontaminación de rembg también altera esas zonas.
        interior = np.zeros(values.shape, dtype=bool)
        for y, row in enumerate(values):
            xs = np.flatnonzero(row > adjustments.get("interior_threshold", 16))
            if xs.size >= 2:
                interior[y, xs[0]:xs[-1] + 1] = True
        values[interior] = 255
        rgba = np.array(image)
        with Image.open(source) as original:
            original_rgb = np.array(original.convert("RGB"))
        rgba[interior, :3] = original_rgb[interior]
        image = Image.fromarray(rgba)
    if adjustments.get("preserve_source_alpha"):
        # ImageGen ya delimita el objeto: rembg puede confundir el RGB invisible
        # con reflejos o sombras. Interseca ambas máscaras sin ampliar el objeto.
        with Image.open(source) as original:
            source_alpha = np.array(original.convert("RGBA").getchannel("A"))
        source_alpha[source_alpha <= adjustments["alpha_floor"]] = 0
        source_alpha[source_alpha >= 250] = 255
        values = np.minimum(values, source_alpha)
    # Conserva únicamente el componente de la botella; elimina motas aisladas.
    labels, count = ndimage.label(values > 0)
    if not count:
        raise ValueError(f"Sin contorno: {slug}")
    areas = np.bincount(labels.ravel())
    areas[0] = 0
    values[labels != areas.argmax()] = 0
    image.putalpha(Image.fromarray(values))
    # Evita que colores invisibles contaminen el filtro y reduce peso.
    rgba = np.array(image)
    rgba[values == 0, :3] = 0
    image = Image.fromarray(rgba)
    bbox = alpha_bbox(image)
    image = image.crop(bbox)
    return image, bbox


def place(image, baseline, adjustments):
    target_height = round(CANVAS[1] * 0.94)
    max_width = int(CANVAS[0] * 0.90)
    scale = min(target_height / image.height, max_width / image.width)
    width, height = round(image.width * scale), round(image.height * scale)
    image = image.resize((width, height), Image.Resampling.LANCZOS)
    # Lanczos puede crear un segundo contorno casi invisible separado del
    # borde real. Aplica también el umbral de limpieza al tamaño final.
    alpha = np.array(image.getchannel("A"))
    alpha[alpha <= adjustments["alpha_floor"]] = 0
    image.putalpha(Image.fromarray(alpha))
    x, y = (CANVAS[0] - width) // 2, baseline - height
    if y < 0 or baseline > CANVAS[1]:
        raise ValueError("La alineación medida cortaría la botella")
    canvas = Image.new("RGBA", CANVAS)
    canvas.paste(image, (x, y))
    return canvas, {"scaled_size": [width, height], "position": [x, y]}


def encode(image):
    def png_bytes(candidate):
        buffer = io.BytesIO()
        candidate.save(buffer, format="PNG", optimize=True, compress_level=9)
        return buffer.getvalue()
    encoded = png_bytes(image)
    quantized = len(encoded) > LIMIT
    if quantized:
        # libimagequant conserva alfa tRNS y suaviza los degradados del vidrio.
        # El octree de Pillow produjo bandas visibles en estas candidatas.
        palette = imagequant.quantize_pil_image(
            image, max_colors=256, dithering_level=0.8,
            min_quality=0, max_quality=100)
        # La media de un grupo casi opaco puede quedar en 254: conserva
        # los interiores opacos y el fondo exactamente transparente.
        colors = np.array(palette.getpalette("RGBA"), dtype=np.uint8).reshape(-1, 4)
        colors[colors[:, 3] <= 8, 3] = 0
        colors[colors[:, 3] >= 250, 3] = 255
        palette.putpalette(colors.ravel().tolist(), rawmode="RGBA")
        transparent = np.flatnonzero(colors[:, 3] == 0)
        if not transparent.size:
            raise ValueError("La paleta no conserva el fondo transparente")
        # El tramado puede difundir errores de alfa fuera del contorno.
        # Restituye los píxeles que eran totalmente transparentes.
        indices = np.array(palette)
        indices[np.array(image.getchannel("A")) == 0] = transparent[0]
        palette.frombytes(indices.tobytes())
        encoded = png_bytes(palette)
    if len(encoded) > LIMIT:
        raise ValueError(f"PNG de {len(encoded)} bytes; supera el límite")
    decoded = Image.open(io.BytesIO(encoded)).convert("RGBA")
    assert decoded.size == CANVAS
    assert decoded.getchannel("A").getextrema() == (0, 255)
    return encoded, quantized


def append_manifest(entries):
    path = OUTPUT / "manifest.json"
    raw = path.read_bytes().decode("utf-8")
    current = json.loads(raw)
    missing = [(s, e) for s, e in entries.items() if s not in current]
    for slug, entry in entries.items():
        if slug in current and current[slug] != entry:
            raise ValueError(f"No se sobrescribe una entrada existente distinta: {slug}")
    if not missing:
        return
    newline = "\r\n" if "\r\n" in raw else "\n"
    end = raw.rfind("}")
    prefix = raw[:end].rstrip()
    additions = ["  " + json.dumps(s) + ": " + json.dumps(e, ensure_ascii=False) for s, e in missing]
    updated = prefix + ("," if current else "") + newline + ("," + newline).join(additions)
    updated += newline + raw[end:]
    assert list(json.loads(updated))[:len(current)] == list(current)
    path.write_bytes(updated.encode("utf-8"))


def update_credits():
    path = OUTPUT / "CREDITOS.md"
    raw = path.read_bytes().decode("utf-8")
    if "<!-- vessel-reposicion-recortes -->" in raw:
        return
    newline = "\r\n" if "\r\n" in raw else "\n"
    heading = "## Fotografías de referencia"
    position = raw.index(heading)
    addition = "\n".join([
        "<!-- vessel-reposicion-recortes -->",
        "Los nuevos PNG `cutty-sark` y `flor-de-cana-anejo-reserva` se generaron con "
        "OpenAI ImageGen (`openai-imagegen`, candidatas de Codex). Son representaciones "
        "generadas a partir de referencias públicas y fotos del local, no fotografías oficiales. "
        "En estas dos incorporaciones se usaron las fotos del local de "
        "`docs/catalogo/referencias/`; no se verificaron ni se añadieron referencias web nuevas. "
        "El recorte y la transparencia se procesaron con rembg (`isnet-general-use`), "
        "sin regenerar las imágenes.", "", ""])
    path.write_bytes((raw[:position] + addition.replace("\n", newline) + raw[position:]).encode("utf-8"))


def contact_sheet():
    slugs = ["larios-12", "cutty-sark", "flor-de-cana-anejo-reserva", "j-b-rare"]
    width, height, label_height, heading_height = 512, 683, 44, 36
    row_height = height + label_height + heading_height
    sheet = Image.new("RGB", (4 * width, 3 * row_height), "#e0e0e0")
    draw = ImageDraw.Draw(sheet)
    font_path = Path("C:/Windows/Fonts/arial.ttf")
    font = ImageFont.truetype(str(font_path), 19) if font_path.exists() else ImageFont.load_default(size=19)
    for row, background in enumerate(("cuadros", "blanco", "#111214")):
        start = row * row_height
        draw.rectangle((0, start, sheet.width, start + heading_height), fill="#d0d0d0")
        draw.text((12, start + 7), background, fill="black", font=font)
        for column, slug in enumerate(slugs):
            tile = Image.new("RGBA", CANVAS, "white" if background != "#111214" else background)
            if background == "cuadros":
                grid = ImageDraw.Draw(tile)
                for y in range(0, height, 24):
                    for x in range(0, width, 24):
                        if (x // 24 + y // 24) % 2:
                            grid.rectangle((x, y, x + 23, y + 23), fill="#b7bcc2")
            with Image.open(OUTPUT / (slug + ".png")) as image:
                tile.alpha_composite(image.convert("RGBA"))
            x, y = column * width, start + heading_height
            sheet.paste(tile.convert("RGB"), (x, y))
            draw.rectangle((x, y + height, x + width, y + height + label_height), fill="#e0e0e0")
            draw.text((x + width // 2, y + height + label_height // 2), slug,
                      fill="black", font=font, anchor="mm")
    sheet.save(ROOT / "assets/revision.png", optimize=True)


def verify_originals(originals):
    current = json.loads((OUTPUT / "manifest.json").read_text(encoding="utf-8"))
    assert list(current)[:len(originals["manifest"])] == list(originals["manifest"])
    for slug, entry in originals["manifest"].items():
        assert current[slug] == entry, f"Entrada original modificada: {slug}"
        assert digest(OUTPUT / entry["file"]) == originals["sha256"][slug], f"PNG original modificado: {slug}"


def main():
    global WORK
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Recalcular las máscaras rembg")
    parser.add_argument("--selection", type=Path, help="JSON de candidatas; omitir conserva la selección original")
    parser.add_argument("--adjustments", type=Path, help="JSON de ajustes por slug")
    args = parser.parse_args()
    selection = load_selection(args.selection) if args.selection else SELECTION
    if args.selection:
        WORK = args.selection.resolve().parent / "procesado"
    if args.adjustments:
        ADJUSTMENTS.update(json.loads(args.adjustments.read_text(encoding="utf-8-sig")))
    WORK.mkdir(parents=True, exist_ok=True)
    originals = preserve_originals()
    if args.selection:
        # Las nuevas selecciones nunca pueden sobrescribir los PNG originales.
        overlap = set(originals["manifest"]) & {entry["slug"] for entry in selection}
        if overlap:
            raise ValueError(f"Selección contiene originales protegidos: {sorted(overlap)}")
    baseline, reference_measurements = measure_baseline()
    print(json.dumps({"baseline": baseline, "references": reference_measurements}), flush=True)
    json_write(WORK / "seleccion.json", selection)
    from rembg import new_session
    os.environ.setdefault("OMP_NUM_THREADS", "4")
    session = new_session(MODEL, providers=["CPUExecutionProvider"])
    report = {"generated_at": date.today().isoformat(), "baseline_exclusive": baseline,
              "references": reference_measurements, "images": [],
              "without_image": [] if args.selection else ["boldcrew-original", "aperol"]}
    additions = {}
    for entry in selection:
        image, source_bbox = cutout(entry, session, args.refresh)
        canvas, placement = place(image, baseline, adjustments_for(entry["slug"]))
        encoded, quantized = encode(canvas)
        (OUTPUT / entry["file"]).write_bytes(encoded)
        additions[entry["slug"]] = {key: entry[key] for key in ("file", "model", "refs", "confidence")}
        additions[entry["slug"]]["generated_at"] = report["generated_at"]
        with Image.open(OUTPUT / entry["file"]) as saved:
            item = {**entry, "bytes": len(encoded), "KB": round(len(encoded) / 1000, 2),
                    "quantized_256_rgba": quantized, "source_bbox": source_bbox,
                    "output_bbox": alpha_bbox(saved), "adjustments": adjustments_for(entry["slug"]), **placement}
        report["images"].append(item)
        print(json.dumps(item, ensure_ascii=False), flush=True)
    append_manifest(additions)
    if not args.selection:
        update_credits()
        contact_sheet()
    verify_originals(originals)
    report["originals_unchanged"] = len(originals["manifest"])
    json_write(WORK / "informe.json", report)
    print(f"Verificado: {len(originals['manifest'])} PNG y entradas originales intactos; informe en {WORK}.")


if __name__ == "__main__":
    main()
