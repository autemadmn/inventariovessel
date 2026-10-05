"""Pillow preparation, state assembly, aligned white halos and asset audit."""
import argparse
import io
import json
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
from config import *

BUILD.mkdir(parents=True,exist_ok=True)

def font(size):
    for path in ('C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if Path(path).exists():
            return ImageFont.truetype(path,size)
    return ImageFont.load_default(size=size)

def prepare():
    # Rebuild the exact crops from the supplied references, including the user's
    # corrected Jägermeister and gold/red Desperados closures.
    from preparar_texturas import prepare_references
    prepare_references()
    provisional=[]
    (BUILD/'provisionales').mkdir(exist_ok=True)
    for slug,color,cap_color in CAPS+BOTTLES:
        if (ROOT/'texturas'/f'{slug}.png').exists():
            continue
        provisional.append(slug)
        im=Image.new('RGBA',(512,512),(0,0,0,0))
        draw=ImageDraw.Draw(im)
        draw.ellipse((0,0,511,511),fill=cap_color)
        lines=slug.split('-')
        # Marker only; no brand logos, invented brand names or lettering copies.
        text='\n'.join(lines)
        light=cap_color in ('#17191b','#151617','#bd1527','#1245af')
        draw.multiline_text((256,256),text,fill='#f0eeeb' if light else '#292d30',
                            font=font(26),anchor='mm',align='center',spacing=6)
        im.save(BUILD/'provisionales'/f'{slug}.png')
    (BUILD/'texturas.json').write_text(json.dumps({'provisionales':provisional},indent=2),encoding='utf-8')
    return provisional

def webp(image,path,limit):
    # Keep resolution/alpha and reduce only RGB quality if necessary.
    for quality in (80,76,72,68,62,56,50,44,38,30):
        data=io.BytesIO()
        image.save(data,'WEBP',quality=quality,method=6,exact=True)
        if len(data.getvalue())<=limit:
            path.write_bytes(data.getvalue())
            return quality
    raise RuntimeError(f'{path.name} exceeds {limit} bytes even at quality 30')

def silhouette(alpha):
    # Opaque geometry defines the silhouette; faint catcher shadows are excluded.
    return alpha.point(lambda a: 255 if a>=128 else 0)

def halo(alpha):
    mask=silhouette(alpha)
    expanded=mask.filter(ImageFilter.MaxFilter(2*HALO_RADIUS+1))
    ring=ImageChops.subtract(expanded,mask).filter(ImageFilter.GaussianBlur(HALO_BLUR))
    # Strong white 9px ring: approximately 3px at 390px screen width.
    contour=Image.new('RGBA',alpha.size,(255,255,255,0))
    contour.putalpha(ring.point(lambda a: round(a*HALO_OPACITY)))
    return contour

def feather_shadow(sprite):
    # Catcher tails can reach the render border. Fade only faint shadow pixels
    # through the transparent padding, preserving every geometry pixel.
    alpha=sprite.getchannel('A')
    values=list(alpha.getdata())
    for y in range(sprite.height):
        for x in range(sprite.width):
            i=y*sprite.width+x
            d=min(x,y,sprite.width-1-x,sprite.height-1-y)
            if values[i]<128 and d<12:
                t=d/12
                values[i]=round(values[i]*t*t*(3-2*t))
    alpha.putdata(values)
    sprite.putalpha(alpha)
    return sprite

def process(only=None):
    OUTPUT.mkdir(parents=True,exist_ok=True)
    provisional=prepare()
    version=f'v{VERSION}'
    qualities={}
    previous={}
    if only:
        # A partial export requires a completed export at the same version.
        for line in (ROOT/'pesos.md').read_text(encoding='utf-8').splitlines():
            parts=[p.strip() for p in line.split('|')]
            if len(parts)==3 and parts[2].isdigit():
                previous[parts[0]]=int(parts[2])
    name=f'bandeja.{version}.webp'
    if not only or only=='bandeja':
        tray=Image.open(BUILD/'bandeja.png').convert('RGB')
        assert tray.size==(WIDTH,HEIGHT)
        qualities[name]=webp(tray,OUTPUT/name,150_000)
    else:
        qualities[name]=previous[name]
    slots=[]
    for slot in SLOTS:
        slug,kind,cap=slot['slug'],slot['tipo'],slot['capacidad']
        rect=slot['pixels']
        export=not only or only==slug
        if export:
            sprites=[]
            for index in range(cap):
                sprite=Image.open(BUILD/f'{slug}-pos{index+1}.png').convert('RGBA')
                target=SPRITE_SIZES[kind]
                factor=SPRITE_UPSCALE[kind]
                assert sprite.size==(target[0]*factor,target[1]*factor),(slug,sprite.size)
                if factor!=1: sprite=sprite.resize(target,Image.Resampling.LANCZOS)
                sprites.append(feather_shadow(sprite))
        states={}
        for count in range(1,cap+1):
            file=f'{slug}-{count}.{version}.webp'
            outline=f'{slug}-{count}-contorno.{version}.webp'
            if export:
                im=Image.new('RGBA',(rect['w'],rect['h']),(0,0,0,0))
                for index in range(cap-count,cap):
                    cx,cy=POSITIONS[kind][index]
                    sprite=sprites[index]
                    im.alpha_composite(sprite,(cx-sprite.width//2,cy-sprite.height//2))
                contour=halo(im.getchannel('A'))
                qualities[file]=webp(im,OUTPUT/file,30_000)
                qualities[outline]=webp(contour,OUTPUT/outline,30_000)
            else:
                qualities[file]=previous[file]
                qualities[outline]=previous[outline]
            states[str(count)]={'imagen':file,'contorno':outline}
        slots.append({k:slot[k] for k in ('id','tipo','capacidad','slug')} | {
            'rect':{k:round(v/(WIDTH if k in ('x','w') else HEIGHT)*100,8) for k,v in rect.items()},
            'pixels':rect,'estados':states,
            'ordenDesaparicion':(['arriba','centro','abajo'] if kind=='botellas' else
                                ['arriba','centro-izquierda','centro-derecha','abajo-izquierda','abajo-derecha'])})
    layout={'version':VERSION,'fondo':{'imagen':name,'w':WIDTH,'h':HEIGHT},
            'pxPorMm':PX_PER_MM,'huecos':slots,'texturasProvisionales':provisional,
            'porConfirmar':['b-amarilla-por-confirmar','rosa-por-confirmar'],
            'estadoCero':'sin imagen; fondo visible',
            'render':{'motor':'Cycles','blender':json.loads((BUILD/'render-info.json').read_text())['blender'],
                      'camara':'ortografica cenital','sprites':'cada instancia renderizada en su posición real',
                      'muestreoPx':SPRITE_UPSCALE,
                      'contorno':{'radioPx':HALO_RADIUS,'desenfoquePx':HALO_BLUR,'opacidad':HALO_OPACITY}},
            'fuentesTexturas':json.loads((ROOT/'texturas'/'fuentes.json').read_text(encoding='utf-8'))}
    (OUTPUT/'layout.json').write_text(json.dumps(layout,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    from seleccion import export
    qualities.update(export(layout, webp, feather_shadow))
    paths=[OUTPUT/file for file in qualities]+[OUTPUT/'layout.json', OUTPUT/'seleccion.json']
    total=sum(p.stat().st_size for p in paths)
    assert total<=1_500_000, f'Total budget exceeded: {total}'
    lines=['Archivo | Bytes | Calidad','--- | ---: | ---:']
    lines += [f'{p.name} | {p.stat().st_size} | {qualities.get(p.name,"—")}' for p in sorted(paths)]
    folder_total=sum(p.stat().st_size for p in OUTPUT.iterdir() if p.is_file())
    lines += [f'**TOTAL ACTIVO v{VERSION} ({len(paths)} archivos)** | **{total}** |',
              f'\nCarpeta completa, incluyendo versiones anteriores: {folder_total} bytes.',
              f'\nTexturas provisionales: {", ".join(provisional) or "ninguna"}.']
    (ROOT/'pesos.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('\n'.join(lines))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--prepare',action='store_true')
    parser.add_argument('--only',choices=[p[0] for p in CAPS+BOTTLES]+['bandeja'])
    args=parser.parse_args()
    prepare() if args.prepare else process(args.only)
