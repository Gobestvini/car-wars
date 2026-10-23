"""Package generated concepts without changing the original PNG pixels."""
from pathlib import Path
import hashlib
import html
import json
import math
import zipfile
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
PROMPTS = json.loads((ROOT / "prompts.json").read_text(encoding="utf-8"))
ITEMS = PROMPTS["screens"]
FONT = "C:/Windows/Fonts/seguisb.ttf"
groups = [
    ("01-entry", "Entry and multiplayer", ["01-loading", "02-menu-racer", "03-menu-city", "04-play-with-friends", "05-room-lobby"]),
    ("02-playing", "Playing and controls", ["20-match-countdown", "06-gameplay-racer", "07-gameplay-city", "08-city-card-placement", "15-spectating"]),
    ("03-settings", "Pause and settings", ["09-pause", "10-settings", "19-settings-car", "16-reconnecting", "18-loading-error"]),
    ("04-results", "Results and connection", ["11-racer-victory", "12-racer-busted", "13-city-victory", "14-city-defeat", "17-connection-error"]),
]
by_id = {s["id"]: s for s in ITEMS}
def sheet(ids, name, title, columns=5, width=390):
    gap, top, caption = 24, 105, 42
    height = round(width * 844 / 390)
    rows = math.ceil(len(ids) / columns)
    canvas = Image.new("RGB", (columns * (width + gap) + gap, top + rows * (height + caption + gap)), "#e9eff7")
    draw = ImageDraw.Draw(canvas)
    draw.text((gap, 20), "CAR STARS / " + title, fill="#26334c", font=ImageFont.truetype(FONT, 26))
    draw.text((gap, 60), "Mobile portrait concepts / 24 Oct 2026", fill="#52698d", font=ImageFont.truetype(FONT, 17))
    for i, ident in enumerate(ids):
        x, y = gap + (i % columns) * (width + gap), top + (i // columns) * (height + caption + gap)
        label = ident[:2] + " " + by_id[ident]["title"]
        draw.text((x, y), label, fill="#26334c", font=ImageFont.truetype(FONT, 18 if width >= 390 else 14))
        with Image.open(ROOT / (ident + ".png")) as original:
            image = original.convert("RGB")
            image.thumbnail((width, height), Image.Resampling.LANCZOS)
            canvas.paste(image, (x + (width-image.width)//2, y+caption))
    canvas.save(ROOT / name)
    return name

assets = []
for spec in ITEMS:
    path = ROOT / (spec["id"] + ".png")
    with Image.open(path) as img:
        img.load()
        w, h = img.size
        assert w > 0 and h > w
        assert abs(w/h - 390/844) < .01, (path.name, img.size)
        mode = img.mode
        assert mode in ("RGB", "RGBA"), mode
        alpha = img.getchannel("A").getextrema() if mode == "RGBA" else None
    source = Path(spec["selected_output_source"])
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if source.exists():
        assert digest == hashlib.sha256(source.read_bytes()).hexdigest(), path.name
    else:
        saved = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
        expected = next(a for a in saved['assets'] if a['id'] == spec['id'])
        assert digest == expected['technical']['sha256'], path.name
    assets.append({
        "id": spec["id"], "title": spec["title"], "path": path.name,
        "status": "concept-visual-reviewed",
        "technical": {"dimensions": [w,h], "mode": mode, "alpha_extrema": alpha,
                      "bytes": path.stat().st_size, "sha256": digest},
        "source": {"kind": "generated", "tool": PROMPTS["tool"],
                   "created_at": PROMPTS["date"], "prompt": "prompts.json",
                   "terms": "AI-generated; no third-party asset license assigned; model version not disclosed."},
        "verification": {"decodes": True, "portrait_ratio": True,
                         "source_bytes_preserved": True,
                         "visual_inspection": "Generated full-size outputs and 390px-wide sheets reviewed.",
                         "in_engine_reviewed": False, "physical_device_tested": False}
    })
manifest = {
    "schema_version": 1, "date": PROMPTS["date"],
    "art_direction_brief": "README.md",
    "purpose": "Raster concept mockups for existing and planned Car Stars mobile flows",
    "logical_viewport": [390,844], "platform": "mobile portrait", "language": "English",
    "production_imported": False,
    "visual_locks": ["sunny miniature city", "blue roofs", "navy/cream tactile UI",
                     "gold racer", "cyan city", "five energy cards", "three racers plus one city"],
    "assets": assets
}
(ROOT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
report = {
    "date": PROMPTS["date"], "screen_count": len(assets),
    "technical_passed": True, "source_pngs_unchanged": True,
    "total_png_bytes": sum(a["technical"]["bytes"] for a in assets),
    "dimensions": sorted({tuple(a["technical"]["dimensions"]) for a in assets}),
    "manual_review": {
        "reviewed": True,
        "scope": "Composition, English copy, primary actions, family palette, six-star counts, 3+1 lobby, matching five-card energy prices.",
        "refinement": "Card placement regenerated from city gameplay to remove star currency and helicopter and align prices 2/3/2/2/3.",
        "limitations": [
            "Raster concepts, not editable UI or runtime screens; no game code was changed.",
            "Safe-area insets, hit targets, font sizes and contrast are design intentions, not measured DOM constraints.",
            "Camera framing, roadblock geometry and map are illustrative; actual endpoint safety requires game road data.",
            "Landscape, tablet layouts, physical-device testing and game behavior were not validated.",
            "Some fine text, icons and hero proportions vary between generated screens; normalize in implementation."
        ]
    }
}
(ROOT/"verification.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
for name,title,ids in groups:
    sheet(ids, "overview-"+name+".png", title)
sheet([s["id"] for s in ITEMS], "overview.png", "All 20 screens", columns=5, width=250)

cards = "\n".join(
    '<figure data-title="'+html.escape(s["title"].lower())+'"><a href="'+s["id"]+'.png" target="_blank" rel="noopener">'
    '<img loading="lazy" src="'+s["id"]+'.png" alt="'+html.escape(s["title"])+'"></a>'
    '<figcaption>'+s["id"][:2]+' · '+html.escape(s["title"])+'</figcaption></figure>'
    for s in ITEMS)
page = """<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Car Stars — 20 мобильных экранов</title>
<style>*{box-sizing:border-box}body{margin:0;background:#e9eff7;color:#26334c;font:16px system-ui,sans-serif}
header{padding:32px 24px 20px;max-width:1600px;margin:auto}h1{margin:0;font-size:32px}p{max-width:900px;line-height:1.6}
a{color:#075eb8}nav{display:flex;gap:12px;flex-wrap:wrap}nav a{background:#fff6dc;padding:12px 18px;border:2px solid #26334c;border-radius:16px;font-weight:700}
input{margin-top:20px;padding:14px 18px;border:2px solid #26334c;border-radius:12px;font:inherit;width:min(100%,420px)}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,390px));gap:28px;justify-content:center;padding:24px}
figure{margin:0}img{display:block;width:100%;height:auto;border-radius:20px;box-shadow:0 8px 24px #26334c26}
figcaption{font-weight:700;padding:12px 4px}figure[hidden]{display:none}
</style><header><h1>CAR STARS · 20 мобильных экранов</h1>
<p>Вертикальные концепты меню, мультиплеера, игры за гонщика и город, настроек, результатов и ошибок.
Нажмите на экран, чтобы открыть исходный PNG. Это визуальные макеты; поведение игры и реальные безопасные отступы ими не проверены.</p>
<nav><a href="overview.png">Все экраны</a><a href="mobile-screens.zip">Скачать 20 PNG</a><a href="README.md">Описание и ограничения</a></nav>
<input id="search" aria-label="Поиск по английскому названию" placeholder="Поиск: racer, city, settings…"></header>
<main>"""+cards+"""</main><script>
document.querySelector('#search').addEventListener('input',event=>{
const query=event.target.value.trim().toLowerCase();
document.querySelectorAll('figure').forEach(card=>card.hidden=!card.dataset.title.includes(query));
});</script></html>"""
(ROOT/"index.html").write_text(page,encoding="utf-8")
with zipfile.ZipFile(ROOT/"mobile-screens.zip","w",compression=zipfile.ZIP_STORED) as archive:
    for spec in ITEMS:
        archive.write(ROOT/(spec["id"]+".png"),arcname=spec["id"]+".png")
print(json.dumps({"count":len(assets),"dimensions":report["dimensions"],
                  "total_mb":round(report["total_png_bytes"]/1024**2,2),
                  "gallery":"index.html","archive":"mobile-screens.zip"},ensure_ascii=False))
