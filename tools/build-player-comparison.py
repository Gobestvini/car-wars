"""Compose captured game views beside concept crops without altering the art."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root=Path(__file__).resolve().parents[1]
out=root/'docs/art/models/player-sedan-v2/concept-review'
concept=Image.open(root/'docs/art/vehicles/2026-10-09/01-yellow-getaway.png').convert('RGB')
font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',22)
small=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',18)
views={
    'front':((25,175,292,397),(230,160,570,450)),
    'rear':((317,175,575,397),(230,165,570,440)),
    'left':((595,174,1056,397),(75,155,725,445)),
    'right':((1070,174,1533,397),(75,155,725,445)),
    'top':((25,472,293,910),(240,55,560,545)),
    'front-quarter':((580,562,1058,890),(130,150,670,460)),
    'rear-quarter':((1074,562,1534,892),(130,150,670,460)),
}

def sheet(names,filename):
    canvas=Image.new('RGB',(1440,60+len(names)*300),'#f7f4eb')
    draw=ImageDraw.Draw(canvas)
    for col,title in enumerate(['CONCEPT','GAME BEFORE','GAME AFTER']):
        draw.text((col*480+20,15),title,font=font,fill='#17263a')
    for row,name in enumerate(names):
        reference,gamecrop=views[name]
        sources=[concept.crop(reference)]+[Image.open(out/phase/(name+'.png')).crop(gamecrop) for phase in ['before','after']]
        for col,im in enumerate(sources):
            im.thumbnail((450,252),Image.Resampling.LANCZOS)
            canvas.paste(im,(col*480+(480-im.width)//2,60+row*300+(260-im.height)//2))
            draw.text((col*480+20,60+row*300+270),name,font=small,fill='#17263a')
    canvas.save(out/filename)

sheet(list(views),'all-views.png')
sheet(['front-quarter','left','rear-quarter'],'comparison.png')
