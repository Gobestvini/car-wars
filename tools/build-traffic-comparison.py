"""Compose concept crops with actual production-material WebGL captures."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/art/models/traffic-sedans'
font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',22)
small=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',18)
canvas=Image.new('RGB',(1440,960),'#f7f4eb')
draw=ImageDraw.Draw(canvas)
for col,title in enumerate(['CONCEPT','GAME FRONT','GAME REAR']):
    draw.text((col*480+18,16),title,font=font,fill='#17263a')
for row,(name,reference) in enumerate([('police','02-police-patrol'),('grey','03-grey-traffic'),('green','04-green-traffic')]):
    concept=Image.open(ROOT/f'docs/art/vehicles/2026-10-09/{reference}.png').crop((590,550,1060,905))
    sources=[concept]+[Image.open(OUT/f'verification/{name}-{view}.png').crop((180,180,750,510)) for view in ['front','rear']]
    for col,im in enumerate(sources):
        im.thumbnail((450,250),Image.Resampling.LANCZOS)
        canvas.paste(im,(col*480+(480-im.width)//2,60+row*300+(260-im.height)//2))
        draw.text((col*480+18,60+row*300+270),name.upper(),font=small,fill='#17263a')
canvas.save(OUT/'comparison.png')
