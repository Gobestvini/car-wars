"""Crop transparent padding and validate extracted assets; preserve source originals."""
import hashlib
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8-sig'))
report = []
for asset in manifest['assets']:
    source = Path(asset['sourceFile'])
    image = Image.open(source).convert('RGBA')
    original_size = image.size
    box = (0, 0, image.width, image.height)
    alpha = image.getchannel('A')
    if asset['transparent']:
        if alpha.getextrema()[0] != 0:
            raise ValueError(f"Missing alpha: {asset['name']}")
        bounds = alpha.point(lambda v: 255 if v > 16 else 0).getbbox()
        if not bounds:
            raise ValueError(f"Empty asset: {asset['name']}")
        box = (max(0, bounds[0]-8), max(0,bounds[1]-8),
               min(image.width,bounds[2]+8), min(image.height,bounds[3]+8))
        image = image.crop(box)
    target = root / asset['path']
    image.save(target, optimize=True)
    asset.update(width=image.width, height=image.height, crop=list(box),
                 originalSize=list(original_size),
                 sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
                 status='Normalized and alpha-validated; original preserved')
    report.append(dict(name=asset['name'], size=list(image.size),
                       alphaExtrema=list(image.getchannel('A').getextrema()),
                       transparent=asset['transparent']))
(root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(root/'asset-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
