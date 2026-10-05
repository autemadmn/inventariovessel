"""Prepara la nevera de Chupitería para la app.

Lee scripts/nevera/seleccion.v2.json (salida de render.py + seleccion.py), traduce los nombres
de trabajo del render a los slugs del catálogo, copia solo las imágenes que usa la app y
escribe public/img/nevera/nevera.v2.json con las posiciones en % del fondo.

Uso: python scripts/nevera/layout_app.py --src <carpeta con las .webp de la entrega>
Si cambia una imagen, se sube la versión (v3) en el render y aquí, para no chocar con la caché.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/img/nevera"
VERSION = 2

# Nombre de trabajo del render → (slug del catálogo, nombre corto para la etiqueta).
PRODUCTOS = {
    "b-amarilla-por-confirmar": ("b-lemon", "B.Lemon"),
    "estrella-galicia-especial": ("estrella-galicia-sin-gluten", "Sin gluten"),
    "estrella-galicia-00": ("estrella-galicia-0-0", "0,0"),
    "estrella-galicia-1906": ("1906-reserva-especial", "1906"),
    "desperados": ("desperados", "Desperados"),
    "buen-amigo": ("buen-amigo-oro", "Buen Amigo"),
    "fireball": ("fireball", "Fireball"),
    "jagermeister": ("jagermeister", "Jäger"),
    "rosa-por-confirmar": ("diex-crema-de-fresas-con-tequila", "DIEX"),
}


def pct(value: float, total: float) -> float:
    return round(value / total * 100, 4)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", type=Path, required=True)
    args = parser.parse_args()

    data = json.loads((ROOT / "scripts/nevera/seleccion.v2.json").read_text(encoding="utf-8"))
    w, h = data["fondo"]["w"], data["fondo"]["h"]
    OUT.mkdir(parents=True, exist_ok=True)
    usadas = {data["fondo"]["imagen"]}

    grupos: dict[str, dict] = {}
    for p in sorted(data["piezas"], key=lambda p: (p["grupo"], p["numero"])):
        slug, corto = PRODUCTOS[p["slug"]]
        g = grupos.setdefault(p["grupo"], {"id": p["grupo"], "slug": slug, "corto": corto, "tipo": p["tipo"],
                                          "piezas": [], "_box": [w, h, 0, 0]})
        px = p["pixels"]
        box = g["_box"]
        box[0], box[1] = min(box[0], px["x"]), min(box[1], px["y"])
        box[2], box[3] = max(box[2], px["x"] + px["w"]), max(box[3], px["y"] + px["h"])
        g["piezas"].append({
            "x": pct(px["x"], w), "y": pct(px["y"], h), "w": pct(px["w"], w), "h": pct(px["h"], h),
            "img": p["imagen"], "sel": p["seleccion"],
        })
        usadas |= {p["imagen"], p["seleccion"]}

    salida = []
    for g in grupos.values():
        x0, y0, x1, y1 = g.pop("_box")
        g.update({"x": pct(x0, w), "y": pct(y0, h), "w": pct(x1 - x0, w), "h": pct(y1 - y0, h)})
        salida.append(g)

    layout = {"version": VERSION, "fondo": {"img": data["fondo"]["imagen"], "w": w, "h": h}, "grupos": salida}
    (OUT / f"nevera.v{VERSION}.json").write_text(json.dumps(layout, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for name in sorted(usadas):
        shutil.copy2(args.src / name, OUT / name)
    total = sum((OUT / n).stat().st_size for n in usadas)
    print(f"{len(salida)} grupos, {len(usadas)} imágenes, {total / 1024:.0f} KB")


if __name__ == "__main__":
    main()
