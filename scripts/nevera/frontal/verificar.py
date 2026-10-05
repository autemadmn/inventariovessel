"""Check active WebP budgets, alignment and physical touch rectangles."""
import json
from PIL import Image
from config import OUTPUT

plano = json.loads((OUTPUT/'nevera.v2.json').read_text(encoding='utf-8'))
assert Image.open(OUTPUT/plano['fondo']['imagen']).size == (1080, 1440)
files = [(plano['fondo']['imagen'], 150_000)]
for zona in plano['zonas']:
    r, h = zona['rect'], zona['hit']
    assert h['w'] >= 200 and h['h'] >= 200
    if 'imagen' in zona:
        assert Image.open(OUTPUT/zona['imagen']).size == (r['w'], r['h'])
        assert Image.open(OUTPUT/zona['seleccion']).size == (r['w'], r['h'])
        files += [(zona['imagen'], 80_000), (zona['seleccion'], 30_000)]
    else:
        assert zona['silueta'] in ('chapas', 'latas')
total = 0
for name, limit in files:
    n = (OUTPUT/name).stat().st_size
    assert n <= limit, (name, n)
    total += n
assert total <= 1_500_000
print(f'OK: {len(plano["zonas"])} zonas; {total} bytes de WebP activos.')
