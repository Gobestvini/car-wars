"""Compose unretouched reference / actual-game captures and identical before/after crops."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/art/verification/mockup-light-materials'
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 18)
paths = [ROOT / 'docs/art/concepts/2026-10-08/02-gameplay-thief.png',
         OUT / 'before/app/390x844-high-blur1-follow.png',
         OUT / 'after/app/390x844-high-blur1-follow.png']
sheet = Image.new('RGB', (1170, 880), '#f8f6f0')
draw = ImageDraw.Draw(sheet)
for index, (path, label) in enumerate(zip(paths, ['Mockup (different geometry)', 'Game: before', 'Game: after'])):
    frame = ImageOps.contain(Image.open(path).convert('RGB'), (390, 844))
    sheet.paste(frame, (index * 390 + (390 - frame.width) // 2, 36 + (844 - frame.height) // 2))
    draw.text((index * 390 + 10, 8), label, font=font, fill='#23334b')
sheet.save(OUT / 'mockup-before-after.png')

# These are exact rectangular crops, enlarged equally, without colour manipulation.
crops = {'roof': [190, 560, 310, 630], 'facade': [275, 690, 350, 735],
         'road-and-shadow': [70, 525, 170, 645], 'sidewalk-tree-car': [170, 250, 350, 400]}
for name, box in crops.items():
    crop_sheet = Image.new('RGB', (600, 340), '#f8f6f0')
    d = ImageDraw.Draw(crop_sheet)
    for index, phase in enumerate(['before', 'after']):
        frame = Image.open(OUT / f'{phase}/app/390x844-high-blur0-follow.png').crop(box)
        frame = ImageOps.contain(frame, (300, 300))
        crop_sheet.paste(frame, (index * 300 + (300-frame.width)//2, 40+(300-frame.height)//2))
        d.text((index*300+10, 10), phase, font=font, fill='#23334b')
    crop_sheet.save(OUT / f'crop-{name}.png')

before = json.loads((OUT / 'before/app/report.json').read_text(encoding='utf-8'))
after = json.loads((OUT / 'after/app/report.json').read_text(encoding='utf-8'))
comparison = []
for b, a in zip(before['scenes'], after['scenes']):
    for key in ['width', 'height', 'q', 'b', 'mode', 'camera', 'target', 'car', 'seed', 'props']:
        assert b[key] == a[key], (key, b[key], a[key])
    comparison.append({k: a[k] for k in ['width', 'height', 'q', 'b', 'mode']} |
                      {'callsBefore': b['calls'], 'callsAfter': a['calls'],
                       'trianglesBefore': b['triangles'], 'trianglesAfter': a['triangles']})
(OUT / 'comparison.json').write_text(json.dumps({'sameTransforms': True, 'crops': crops, 'renderCost': comparison}, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'sameTransforms': True, 'comparisons': len(comparison), 'renderCost': comparison[:4]}))
