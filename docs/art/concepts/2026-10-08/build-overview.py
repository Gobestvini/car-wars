"""Assemble a review contact sheet; source PNGs remain untouched."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
ITEMS = [
    ("01-role-selection.png", "01  ВЫБОР РОЛИ"),
    ("02-gameplay-thief.png", "02  УГОНЩИК"),
    ("03-gameplay-cop.png", "03  КОП"),
    ("04-victory.png", "04  ПОБЕДА"),
    ("05-defeat.png", "05  ПРОИГРЫШ"),
]
WIDTH, HEIGHT, GAP = 390, 780, 22
sheet = Image.new("RGB", (WIDTH * 5 + GAP * 6, HEIGHT + 134), "#e9eff7")
draw = ImageDraw.Draw(sheet)
font_path = Path("C:/Windows/Fonts/seguisb.ttf")
font = ImageFont.truetype(str(font_path), 22) if font_path.exists() else ImageFont.load_default()
draw.text((GAP, 16), "CAR WARS  /  КОНЦЕПТЫ ОСНОВНЫХ ЭКРАНОВ", fill="#26334c", font=font)
for index, (filename, label) in enumerate(ITEMS):
    x = GAP + index * (WIDTH + GAP)
    draw.text((x, 60), label, fill="#26334c", font=font)
    with Image.open(ROOT / filename) as source:
        assert source.size == (887, 1774), (filename, source.size)
        preview = source.convert("RGB").resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
        sheet.paste(preview, (x, 100))
sheet.save(ROOT / "overview.png")
print(f"Saved {sheet.width}x{sheet.height} overview; each screen displayed at 390x780")
