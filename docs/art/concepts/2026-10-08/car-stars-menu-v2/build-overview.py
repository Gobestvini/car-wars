"""Build a side-by-side preview without modifying source concept PNGs."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parent
ITEMS = [("01-thief-selected.png", "ВЫБРАН УГОНЩИК"), ("02-city-selected.png", "ВЫБРАН ГОРОД")]
WIDTH, HEIGHT, GAP = 390, 780, 22
sheet = Image.new("RGB", (WIDTH * 2 + GAP * 3, HEIGHT + 124), "#e9eff7")
draw = ImageDraw.Draw(sheet)
font_path = Path("C:/Windows/Fonts/seguisb.ttf")
font = ImageFont.truetype(str(font_path), 22) if font_path.exists() else ImageFont.load_default()
draw.text((GAP, 15), "CAR STARS  /  ГЛАВНОЕ МЕНЮ", fill="#26334c", font=font)
for index, (filename, label) in enumerate(ITEMS):
    x = GAP + index * (WIDTH + GAP)
    draw.text((x, 55), label, fill="#26334c", font=font)
    with Image.open(ROOT / filename) as source:
        assert source.size == (887, 1774), (filename, source.size)
        sheet.paste(source.convert("RGB").resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS), (x, 92))
sheet.save(ROOT / "overview.png")
print(f"Saved {sheet.width}x{sheet.height} overview, previews at 390x780")
