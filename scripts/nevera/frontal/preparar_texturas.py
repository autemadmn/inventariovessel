"""Explicit artwork crops from the user's reference, without invented logos."""
import json
from PIL import Image, ImageDraw, ImageFilter
from config import ROOT

def prepare():
    original=Image.open(ROOT/'referencias'/'composicion.png').convert('RGB')
    specs={
        'red-bull-estampado':(580,206,685,505),
        'estrella-etiqueta':(195,1027,352,1226),
        'estrella-cuello':(232,795,312,908),
    }
    dest=ROOT/'texturas';dest.mkdir(exist_ok=True)
    for name,crop in specs.items():
        im=original.crop(crop).convert('RGBA')
        if name=='estrella-etiqueta':
            mask=Image.new('L',im.size)
            polygon=[(78,0),(99,8),(104,26),(128,46),(147,78),(156,117),(153,145),(138,169),(113,188),(88,197),(63,197),(41,185),(18,162),(3,142),(0,111),(8,78),(26,46),(55,26),(57,9)]
            ImageDraw.Draw(mask).polygon(polygon,fill=255)
            mask=mask.filter(ImageFilter.GaussianBlur(.5));im.putalpha(mask)
        im.resize((im.width*4,im.height*4),Image.Resampling.LANCZOS).save(dest/f'{name}.png')
    # Recortes fotográficos: no se dibujan logos ni se reconstruyen letras.
    cap=Image.open(ROOT/'referencias/heineken-tapa-foto.png').convert('RGBA').crop((7,15,205,213))
    mask=Image.new('L',cap.size);ImageDraw.Draw(mask).ellipse((0,0,197,197),fill=255)
    cap.putalpha(mask.filter(ImageFilter.GaussianBlur(.4)))
    cap.save(dest/'heineken-tapa.png')
    sugar=Image.open(ROOT/'referencias/red-bull-sugarfree-oficial.png').convert('RGBA').crop((11,35,515,1285))
    sugar.save(dest/'red-bull-sugarfree-estampado.png')
    Image.open(ROOT/'referencias/lanjaron-etiqueta-foto.png').convert('RGBA').save(dest/'lanjaron-etiqueta.png')
    sources=dict(referencia='referencias/composicion.png',dimensiones=list(original.size),recortes=specs,
      nuevos={
       'heineken':dict(referencia='referencias/heineken-tapa-foto.png',
          url='https://crowncaps.info/caps/345831',recorte=[7,15,205,213],
          tratamiento='Foto real de chapa Original: recorte circular, sin recrear texto; Cycles con geometría original'),
       'red-bull-sugarfree':dict(referencia='referencias/red-bull-sugarfree-oficial.png',
          url='https://www.redbull.com/es-es/energydrink/products/red-bull-sugarfree',
          imagen='https://www.redbull.com/energydrink/v1/resources/storyblok/images/f/287059/528x1348/17eee82bc5/es_sf_250ml_ac_sugarfree_country_rgb_packrq-3237_cold_closed_front_com_full.png',
          recorte=[11,35,515,1285],tratamiento='Diseño oficial español 250 ml, sin redibujar letras'),
       'agua-cabreiroa-33-cl':dict(referencia='referencias/lanjaron-etiqueta-foto.png',
          origen='Foto aportada: Caja de agua lanjaron.png',recorteOriginal=[433,587,669,785],
          marcaConfirmada='Lanjarón 33 cl',tratamiento='Etiqueta fotográfica y tapón rojo; slug y pasos del catálogo conservados')},
      nota='Las fuentes conservan los píxeles de los diseños. No se añade texto no visible. Microtexto limitado por resolución.')
    (dest/'fuentes.json').write_text(json.dumps(sources,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':prepare()
