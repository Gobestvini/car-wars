"""Unretouched actual-game before/after and material comparisons for TASK-0078."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/art/verification/mockup-light-materials-followup'
FONT = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 18)
reference = Image.open(ROOT / 'docs/art/concepts/2026-10-08/02-gameplay-thief.png').convert('RGB')
before = json.loads((OUT / 'before/app/report.json').read_text())
after = json.loads((OUT / 'after/app/report.json').read_text())
assert len(before['scenes']) == len(after['scenes']) == 36
comparisons = []
for b, a in zip(before['scenes'], after['scenes']):
    for key in ['width', 'height', 'q', 'b', 'mode', 'camera', 'target', 'car', 'seed', 'props']:
        assert a[key] == b[key], (key, b[key], a[key])
    # Shadow-caster coverage changes with the sun direction; geometry/counts do not.
    comparisons.append({k: a[k] for k in ['width', 'height', 'q', 'b', 'mode']} |
                       {'callsBefore': b['calls'], 'callsAfter': a['calls'],
                        'trianglesBefore': b['triangles'], 'trianglesAfter': a['triangles']})


def sheet(images, labels, name, size=(390, 844)):
    result = Image.new('RGB', (size[0] * len(images), size[1] + 38), '#f8f6f0')
    draw = ImageDraw.Draw(result)
    for i, (image, label) in enumerate(zip(images, labels)):
        fit = ImageOps.contain(image, size)
        result.paste(fit, (i * size[0] + (size[0] - fit.width) // 2, 38 + (size[1] - fit.height) // 2))
        draw.text((i * size[0] + 8, 8), label, font=FONT, fill='#23334b')
    result.save(OUT / name)


labels = ['Mockup (different geometry)', 'Actual game: before', 'Actual game: after']
frames = [Image.open(OUT / f'{phase}/app/390x844-near-high-blur0.png').convert('RGB')
          for phase in ['before', 'after']]
sheet([reference, *frames], labels, 'mockup-before-after.png')
# Explicit independent crops: same semantic material, not the same world geometry.
crops = {
    'roof': ([15, 200, 190, 270], [210, 15, 380, 100]),
    'facade': ([20, 310, 105, 440], [230, 104, 350, 190]),
    'road': ([290, 320, 490, 440], [70, 480, 270, 600]),
    'sidewalk': ([280, 212, 405, 244], [220, 215, 270, 240]),
    'tree': ([430, 180, 580, 325], [138, 85, 186, 185]),
    'car-glass': ([410, 980, 740, 1160], [190, 270, 290, 360]),
    'shadow': ([550, 1150, 760, 1200], [150, 315, 250, 370]),
}
for name, (ref_box, game_box) in crops.items():
    sheet([reference.crop(ref_box), *(image.crop(game_box) for image in frames)],
          labels, f'crop-{name}.png', (330, 260))
for role in ['player', 'civilian', 'police']:
    for side in [-1, 1]:
        images = [Image.open(OUT / f'{phase}/app/1440x900-{role}-side{side}.png')
                  for phase in ['before', 'after']]
        sheet(images, ['Before', 'After'], f'{role}-side{side}.png', (720, 450))
(OUT / 'comparison.json').write_text(json.dumps({
    'sameTransforms': True, 'comparisons': len(comparisons),
    'cropPolicy': 'independent semantic reference/game crops; identical game crops before/after; contain, no color edits',
    'crops': crops, 'renderCost': comparisons}, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'sameTransforms': True, 'comparisons': len(comparisons)}))
