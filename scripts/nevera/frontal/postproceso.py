"""Composite frontal groups from Cycles and emission masks; no rectangular catcher halos."""
import argparse
import io
import json
from PIL import Image, ImageFilter, ImageChops
from config import *


def save(im, path, limit):
    for quality in (86,82,78,74,70,64,58,50):
        data=io.BytesIO()
        im.save(data,'WEBP',quality=quality,method=6,exact=True)
        if len(data.getvalue()) <= limit:
            path.write_bytes(data.getvalue())
            return
    raise RuntimeError(f'{path.name} exceeds budget')


def process():
    OUTPUT.mkdir(parents=True,exist_ok=True)
    zones=[]
    for group in GROUPS:
        ident=group['id'];version=group['version'];rect=group['rect']
        if group.get('silueta'):
            zones.append(dict(slug=ident,rect=rect,hit=group['hit']|dict(round=False),silueta=group['silueta']))
            continue
        file=f'{ident}-grupo.v{version}.webp';selection=f'{ident}-seleccion.v{version}.webp'
        # Heineken v1 is copied unchanged from the reference delivery.
        if version != 1:
            image=Image.new('RGBA',(rect['w'],rect['h']))
            silhouette=Image.new('L',image.size)
            w,h=group['size']
            for i,x in enumerate(group['centros']):
                raw=Image.open(BUILD/f'{ident}-{i+1}.png').convert('RGBA')
                geometry=Image.open(BUILD/f'{ident}-{i+1}-mascara.png').getchannel('A')
                assert raw.size == (w,h) == geometry.size
                # No catcher: remove the rectangular gray reflection behind beer.
                raw.putalpha(ImageChops.multiply(raw.getchannel('A'),geometry))
                left=x-w//2-rect['x'];top=group['base']-h+(0 if ident=='heineken' else 10)-rect['y']
                image.alpha_composite(raw,(left,top))
                layer=Image.new('L',image.size);layer.paste(geometry,(left,top))
                silhouette=ImageChops.lighter(silhouette,layer)
            mask=silhouette.point(lambda a:255 if a>=128 else 0)
            ring=ImageChops.subtract(mask.filter(ImageFilter.MaxFilter(13)),mask)
            filled=ImageChops.lighter(mask.point(lambda a:round(a*.34)),ring)
            overlay=Image.new('RGBA',image.size,(255,255,255,0));overlay.putalpha(filled)
            save(image,OUTPUT/file,80_000)
            save(overlay,OUTPUT/selection,30_000)
        zones.append(dict(slug=ident,rect=rect,hit=group['hit']|dict(round=False),imagen=file,seleccion=selection))
    manifest=dict(version=2,seccion='nevera',base='img/nevera/frontal/',
        fondo=dict(imagen='bandeja.v1.webp',w=WIDTH,h=HEIGHT),marcar='producto',zonas=zones,
        seleccion=dict(rellenoBlanco=.34,contornoPx=6))
    (OUTPUT/'nevera.v2.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    files=['bandeja.v1.webp']+[f for z in zones if 'imagen' in z for f in (z['imagen'],z['seleccion'])]
    total=sum((OUTPUT/f).stat().st_size for f in files)
    assert total<=1_500_000
    lines=['Archivo | Bytes','--- | ---:']+[f'{f} | {(OUTPUT/f).stat().st_size}' for f in files]+[f'\nTotal: {total} bytes.']
    (ROOT/'pesos.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('\n'.join(lines))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--masks-only',action='store_true',help='Recompose existing product renders with refreshed emission masks')
    parser.parse_args()
    process()
