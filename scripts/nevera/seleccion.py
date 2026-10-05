"""Export individual pieces and white translucent selection masks."""
import json
from PIL import Image, ImageFilter, ImageChops
from config import ROOT, BUILD, OUTPUT, WIDTH, HEIGHT, SLOTS, POSITIONS, SPRITE_SIZES, SPRITE_UPSCALE, VERSION

LABELS = {
    'b-amarilla-por-confirmar': 'B limón',
    'estrella-galicia-especial': 'Estrella Galicia sin gluten',
    'estrella-galicia-00': 'Estrella Galicia 0,0',
    'estrella-galicia-1906': '1906',
    'desperados': 'Desperados',
    'buen-amigo': 'Buen amigo', 'fireball': 'Fireball',
    'jagermeister': 'Jägermeister', 'rosa-por-confirmar': 'Botella rosa',
}

def export(layout, webp, feather_shadow):
    pieces, qualities = [], {}
    for slot in SLOTS:
        slug, kind = slot['slug'], slot['tipo']
        w, h = SPRITE_SIZES[kind]
        for index, (cx, cy) in enumerate(POSITIONS[kind]):
            im = Image.open(BUILD / f'{slug}-pos{index+1}.png').convert('RGBA')
            if SPRITE_UPSCALE[kind] != 1:
                im = im.resize((w, h), Image.Resampling.LANCZOS)
            im = feather_shadow(im)
            mask = im.getchannel('A').point(lambda a: 255 if a >= 128 else 0)
            # The fill covers the actual object, never its contact shadow.
            # Strong external contour + 34% white interior, with the same canvas.
            ring = ImageChops.subtract(mask.filter(ImageFilter.MaxFilter(13)), mask)
            alpha = ImageChops.lighter(mask.point(lambda a: round(a * .34)), ring)
            overlay = Image.new('RGBA', (w, h), (255, 255, 255, 0))
            overlay.putalpha(alpha)
            file = f'{slug}-pieza-{index+1}.v{VERSION}.webp'
            selected = f'{slug}-pieza-{index+1}-seleccion.v{VERSION}.webp'
            qualities[file] = webp(im, OUTPUT / file, 30_000)
            qualities[selected] = webp(overlay, OUTPUT / selected, 30_000)
            x, y = slot['pixels']['x'] + cx - w//2, slot['pixels']['y'] + cy - h//2
            # The shortest center distance is 84px (same-column rows).
            # Round targets touch but never overlap; each is 50px at 640px.
            hit = dict(x=(w-84)/2, y=(h-84)/2, w=84, h=84, round=True) if kind == 'chapas' else dict(x=12, y=12, w=w-24, h=h-24, round=False)
            pieces.append(dict(id=f'{slot["id"]}-pieza-{index+1}', grupo=slot['id'],
                slug=slug, nombre=LABELS[slug], tipo=kind, numero=index+1,
                pixels=dict(x=x, y=y, w=w, h=h), hit=hit,
                imagen=file, seleccion=selected))
    manifest = dict(version=VERSION, fondo=layout['fondo'], piezas=pieces,
                    ordenChapas=[LABELS[s['slug']] for s in SLOTS if s['tipo']=='chapas'],
                    seleccion=dict(rellenoBlanco=.34, contornoPx=6, anchoMinimoNevera=640))
    data = json.dumps(manifest, ensure_ascii=False, indent=2)
    (OUTPUT / 'seleccion.json').write_text(data+'\n', encoding='utf-8')
    # A classic script also loads under file://, for the downloadable package.
    (ROOT / 'preview-data.js').write_text('window.NEVERA_LAYOUT = '+data+';\n', encoding='utf-8')
    return qualities
