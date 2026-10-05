"""Single source of truth: pixels at 1x; 1.8 pixels per millimetre."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT.parents[1] / 'public' / 'img' / 'nevera'
VERSION = 2
BUILD = ROOT / '_build' / f'v{VERSION}'
WIDTH, HEIGHT = 1080, 1500
PX_PER_MM = 1.8
BOTTLES = [
    ('buen-amigo', '#a65a16', '#151617'),
    ('fireball', '#b6130b', '#bd1527'),
    ('jagermeister', '#092b19', '#dbc3a0'),
    ('rosa-por-confirmar', '#eaa6ba', '#f6f4ec'),
]
CAPS = [
    ('b-amarilla-por-confirmar', '#e9bd12', '#e9bd12'),
    ('estrella-galicia-especial', '#bb9229', '#17191b'),
    ('estrella-galicia-00', '#b8babb', '#aeb4b9'),
    ('estrella-galicia-1906', '#17191b', '#17191b'),
    ('desperados', '#b99b55', '#b99b55'),
]
# Fixed canvases for every state, including empty margins for the halo.
SLOTS = [
    dict(id=f'chapas-{i + 1}', tipo='chapas', capacidad=5, slug=p[0],
         pixels=dict(x=44 + 198*i, y=90, w=200, h=320))
    for i, p in enumerate(CAPS)
] + [
    dict(id=f'botellas-{i + 1}', tipo='botellas', capacidad=3, slug=p[0],
         pixels=dict(x=48 + 250*i, y=474, w=234, h=960))
    for i, p in enumerate(BOTTLES)
]
# Counts use the LAST n positions. Removal: top, mid-left, mid-right,
# bottom-left, bottom-right. Bottles: top, middle, bottom.
POSITIONS = {
    'chapas': [(100, 62), (57, 146), (143, 146), (57, 230), (143, 230)],
    'botellas': [(117, 150), (117, 470), (117, 790)],
}
SPRITE_SIZES = {'chapas': (116, 116), 'botellas': (234, 306)}
SPRITE_UPSCALE = {'chapas': 2, 'botellas': 1}
# Strong white core: ~3px on a 390px mobile composition.
HALO_RADIUS, HALO_BLUR, HALO_OPACITY = 9, .5, 1.0
