import json
from pathlib import Path
from hashlib import sha256
from PIL import Image

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
(root / 'assets').mkdir(exist_ok=True)
report = []
for item in manifest['assets']:
    im = Image.open(item['sourceFile']).convert('RGBA')
    alpha = im.getchannel('A')
    box = alpha.point(lambda v: 255 if v > 16 else 0).getbbox()
    assert box and alpha.getextrema() == (0, 255), item['name']
    box = (max(0, box[0]-8), max(0, box[1]-8), min(im.width, box[2]+8), min(im.height, box[3]+8))
    im = im.crop(box)
    out = root / item['path']
    im.save(out)
    item.update(width=im.width, height=im.height, crop=list(box), sha256=sha256(out.read_bytes()).hexdigest(), status='Normalized; actual alpha verified')
    report.append(dict(name=item['name'], width=im.width, height=im.height, alphaExtrema=im.getchannel('A').getextrema()))
(root / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n',encoding='utf-8')
(root / 'asset-verification.json').write_text(json.dumps(report, indent=2)+'\n',encoding='utf-8')
