"""Crop user-supplied photographs without redrawing or replacing their logos.

Source originals are retained in referencias/. Coordinates are explicit so the
conversion is reviewable and reproducible. Only crop, ellipse mask, resampling
and a mild exposure adjustment are applied; watermarks are retained.
"""
from PIL import Image, ImageDraw, ImageEnhance
import json
from config import ROOT

REFERENCES = ROOT / 'referencias'
TEXTURES = ROOT / 'texturas'
TEXTURES.mkdir(exist_ok=True)
SOURCES = {
    'estrella-galicia-1906': ('1906.png', (25, 30, 181, 186), 1.12, 'primer plano 1906'),
    'b-amarilla-por-confirmar': ('b-radler.png', (222, 104, 1002, 884), 1, 'primer plano B RADLER'),
    'estrella-galicia-especial': ('estrella-dorada.png', (23, 22, 209, 208), 1.08, 'Estrella Galicia SIN GLUTEN, disco dorado'),
    'estrella-galicia-00': ('estrella-00.png', (330, 300, 2740, 2710), 1, 'Estrella Galicia 0,0: metal plateado y franja azul'),
    'desperados': ('desperados-dorada.png', (138, 78, 1100, 1040), 1.12, 'Chapa dorada con agave rojo, asignada a Desperados por corrección explícita del usuario'),
    'buen-amigo': ('composicion.png', (106, 740, 206, 840), 1, 'tapón Buen amigo de la referencia general'),
    'fireball': ('composicion.png', (316, 746, 414, 844), 1, 'tapón Fireball y dragón de la referencia general'),
    'jagermeister': ('jagermeister.png', (55, 37, 175, 151), 1.08, 'tapón real Jägermeister con banda naranja'),
    'rosa-por-confirmar': ('composicion.png', (746, 747, 824, 825), 1, 'tapón blanco sin marca de la referencia general'),
}

def circular(source, rect, exposure=1):
    image=Image.open(REFERENCES/source).convert('RGB').crop(rect)
    image=image.resize((1024,1024), Image.Resampling.LANCZOS)
    if exposure != 1:
        image=ImageEnhance.Brightness(image).enhance(exposure)
    alpha=Image.new('L',(1024,1024),0)
    ImageDraw.Draw(alpha).ellipse((0,0,1023,1023),fill=255)
    image=image.convert('RGBA')
    image.putalpha(alpha)
    return image

def prepare_references():
    sources={}
    for slug,(source,rect,exposure,note) in SOURCES.items():
        circular(source,rect,exposure).save(TEXTURES/f'{slug}.png')
        sources[slug]={'archivo':source,'recorte':rect,'exposicion':exposure,'nota':note}
    # The unbranded decorative shoulder is taken from the supplied composition.
    pink=Image.open(REFERENCES/'composicion.png').convert('RGB').crop((697,701,873,885))
    pink.resize((1024,1024),Image.Resampling.LANCZOS).save(TEXTURES/'rosa-hombro.png')
    info={'texturas':sources,'rosaHombro':'composicion.png: [697,701,873,885]',
          'noAsignadas':['desperados.png'],
          'nota':'La referencia verde de Desperados fue sustituida por la dorada con agave rojo por indicación del usuario. La chapa-agave es una copia de esa referencia.'}
    (TEXTURES/'fuentes.json').write_text(json.dumps(info,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    # Inspect all labels at their real native size and at 390px mobile scale.
    sheet=Image.new('RGB',(1200,320),'#172026')
    draw=ImageDraw.Draw(sheet)
    for i,slug in enumerate(SOURCES):
        tex=Image.open(TEXTURES/f'{slug}.png')
        sheet.paste(tex.resize((106,106),Image.Resampling.LANCZOS),(i*132+12,20),
                    tex.resize((106,106),Image.Resampling.LANCZOS))
        thumb=tex.resize((32,32),Image.Resampling.LANCZOS)
        sheet.paste(thumb,(i*132+48,170),thumb)
        draw.text((i*132+8,224),slug.replace('estrella-galicia','EG'),fill='white')
    from config import BUILD
    BUILD.mkdir(parents=True,exist_ok=True)
    sheet.save(BUILD/'texturas-revision.png')

if __name__=='__main__':
    prepare_references()
