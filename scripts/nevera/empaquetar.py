"""Create a self-contained offline interface and reproducible source package."""
from pathlib import Path
import json
import shutil
import zipfile
from config import ROOT, OUTPUT

NAME = 'Vessel-nevera-final'
DEST = ROOT / '_build' / 'entrega' / NAME
DEST.mkdir(parents=True, exist_ok=True)
layout = json.loads((OUTPUT / 'layout.json').read_text(encoding='utf-8'))
selection = json.loads((OUTPUT / 'seleccion.json').read_text(encoding='utf-8'))
assets = {layout['fondo']['imagen'], 'layout.json', 'seleccion.json'}
for slot in layout['huecos']:
    for state in slot['estados'].values():
        assets.update(state.values())
for piece in selection['piezas']:
    assets.update((piece['imagen'], piece['seleccion']))
target = DEST / 'public' / 'img' / 'nevera'
target.mkdir(parents=True, exist_ok=True)
for name in sorted(assets):
    shutil.copy2(OUTPUT / name, target / name)
sources = DEST / 'scripts' / 'nevera'
sources.mkdir(parents=True, exist_ok=True)
for file in ROOT.iterdir():
    if file.is_file() and file.suffix in ('.py', '.cjs', '.js', '.html', '.md', '.txt'):
        shutil.copy2(file, sources / file.name)
for directory in ('referencias', 'texturas'):
    shutil.copytree(ROOT / directory, sources / directory, dirs_exist_ok=True)
html = (ROOT / 'preview.html').read_text(encoding='utf-8-sig')
html = html.replace('src="preview-data.js"', 'src="scripts/nevera/preview-data.js"')
html = html.replace("const base='../../public/img/nevera/';", "const base='public/img/nevera/';")
(DEST / 'index.html').write_text(html, encoding='utf-8')
prompt = ('Toca las botellas y chapas que quieras pedir. Cada pieza se selecciona por separado '
          'y se marca en blanco translúcido; puedes seleccionar varias y volver a tocar para '
          'desmarcar. Las cantidades se suman automáticamente. Pulsa «Ver pedido» para revisar '
          'y descargar la lista. En móvil, desliza la nevera hacia los lados.\n')
(DEST / 'PROMPT.txt').write_text(prompt, encoding='utf-8-sig')
(DEST / 'LEEME.txt').write_text(
    'VESSEL · NEVERA FINAL\n\n'
    'Extrae todo el ZIP y abre index.html con doble clic. Mantén su estructura de carpetas.\n'
    'No necesitas instalar nada ni tener conexión a internet.\n\n' + prompt + '\n'
    'La lista se descarga en tu dispositivo; no se envía automáticamente.\n'
    'La selección se reinicia al recargar la página.\n\n'
    'Se incluyen los recursos gráficos y las fuentes de Blender y Pillow.\n'
    'Para regenerarlos, consulta scripts/nevera/README.md.\n', encoding='utf-8-sig')
archive = DEST.with_suffix('.zip')
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for file in sorted(DEST.rglob('*')):
        if file.is_file():
            z.write(file, Path(NAME) / file.relative_to(DEST))
print(json.dumps(dict(carpeta=str(DEST), zip=str(archive), bytes=archive.stat().st_size,
                     recursos=len(assets)), ensure_ascii=False, indent=2))
