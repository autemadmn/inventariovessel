from pathlib import Path
ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT.parents[2] / 'public' / 'img' / 'nevera' / 'frontal'
BUILD = ROOT / '_build'
WIDTH, HEIGHT = 1080, 1440
PLAN_VERSION = 4
PX_PER_MM = 1.8
GROUPS = [
    dict(id='agua-cabreiroa-33-cl', tipo='botellas', cantidad=2, version=3,
         rect=dict(x=106,y=132,w=289,h=393), hit=dict(x=106,y=120,w=289,h=390),
         centros=[179,323], base=514, size=(142,384)),
    dict(id='red-bull', tipo='latas', cantidad=4, version=4,
         rect=dict(x=395,y=179,w=579,h=346), hit=dict(x=395,y=120,w=579,h=390),
         centros=[468,612,758,902], base=514, size=(124,334)),
    dict(id='heineken', tipo='chapas', cantidad=5, version=3,
         rect=dict(x=106,y=552,w=868,h=153), hit=dict(x=106,y=510,w=868,h=270),
         centros=[180,360,540,720,900], base=685, size=(130,130)),
    dict(id='estrella-galicia', tipo='botellas', cantidad=4, version=2,
         rect=dict(x=106,y=745,w=868,h=590), hit=dict(x=106,y=780,w=868,h=560),
         centros=[207,429,651,873], base=1314, size=(198,574)),
]
