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
    (dest/'fuentes.json').write_text(json.dumps(dict(referencia='referencias/composicion.png',
        dimensiones=list(original.size),recortes=specs,
        nuevos={'agua-cabreiroa-33-cl':'PET neutro sin marca ni etiqueta; agua pendiente de confirmar',
                'red-bull-sugarfree':'Silueta neutra en la app; textura de maqueta descartada',
                'heineken':'Siluetas neutras en la app; textura con marca incorrecta descartada'},
        nota='Arte de la composición proporcionada; ampliar no añade detalle fotográfico.'),ensure_ascii=False,indent=2),encoding='utf-8')

if __name__=='__main__':prepare()
