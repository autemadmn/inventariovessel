"""Validate shipped WebPs, budget, transparent padding and exact halo alpha."""
import json
from PIL import Image, ImageChops
from config import *
from postproceso import halo

layout=json.loads((OUTPUT/'layout.json').read_text(encoding='utf-8'))
paths=[OUTPUT/layout['fondo']['imagen'],OUTPUT/'layout.json']
assert Image.open(paths[0]).size==(WIDTH,HEIGHT)
assert paths[0].stat().st_size<=150_000
assert len(layout['huecos'])==9
for slot in layout['huecos']:
    rect=slot['pixels']
    assert rect['x']>=0 and rect['y']>=0
    assert rect['x']+rect['w']<=WIDTH and rect['y']+rect['h']<=HEIGHT
    assert len(slot['estados'])==slot['capacidad']
    for n,state in slot['estados'].items():
        product=Image.open(OUTPUT/state['imagen']).convert('RGBA')
        outline=Image.open(OUTPUT/state['contorno']).convert('RGBA')
        assert product.size==outline.size==(rect['w'],rect['h'])
        pa,oa=product.getchannel('A'),outline.getchannel('A')
        for a in (pa,oa):
            assert a.crop((0,0,a.width,1)).getbbox() is None
            assert a.crop((0,a.height-1,a.width,a.height)).getbbox() is None
            assert a.crop((0,0,1,a.height)).getbbox() is None
            assert a.crop((a.width-1,0,a.width,a.height)).getbbox() is None
        # True silhouette (not faint shadows) has room for the complete halo.
        bounds=pa.point(lambda a:255 if a>=128 else 0).getbbox()
        assert bounds and bounds[0]>5 and bounds[1]>5
        assert bounds[2]<product.width-5 and bounds[3]<product.height-5,(slot['slug'],n,bounds)
        assert oa.getextrema()[1]==round(255*HALO_OPACITY)
        assert ImageChops.difference(halo(pa).getchannel('A'),oa).getbbox() is None
        for px in outline.getdata():
            if px[3]: assert px[:3]==(255,255,255)
        for file in state.values():
            path=OUTPUT/file
            assert path.stat().st_size<=30_000
            paths.append(path)
total=sum(p.stat().st_size for p in paths)
assert len(paths)==76 and total<=1_500_000
print(f'OK: 37 states + 37 halos + tray + layout. {total:,} bytes.')
selection=json.loads((OUTPUT/'seleccion.json').read_text(encoding='utf-8'))
assert len(selection['piezas'])==37
assert len({p['id'] for p in selection['piezas']})==37
assert selection['ordenChapas']==['B limón','Estrella Galicia sin gluten','Estrella Galicia 0,0','1906','Desperados']
for piece in selection['piezas']:
    image=Image.open(OUTPUT/piece['imagen']).convert('RGBA')
    overlay=Image.open(OUTPUT/piece['seleccion']).convert('RGBA')
    assert image.size==overlay.size==(piece['pixels']['w'],piece['pixels']['h'])
    mask=image.getchannel('A').point(lambda a:255 if a>=128 else 0)
    filled=overlay.getchannel('A')
    assert filled.getextrema()[1]==255
    # Every opaque object pixel receives 34% white, excluding its shadow.
    for m,rgba in zip(mask.getdata(),overlay.getdata()):
        if m: assert rgba==(255,255,255,87)
        if rgba[3]: assert rgba[:3]==(255,255,255)
    for name in ('imagen','seleccion'):
        file=OUTPUT/piece[name]
        assert file.stat().st_size<=30_000
        paths.append(file)
paths.append(OUTPUT/'seleccion.json')
total=sum(p.stat().st_size for p in paths)
assert total<=1_500_000
print(f'OK: 37 individual images + 37 filled white selection masks. Active total: {total:,} bytes.')
