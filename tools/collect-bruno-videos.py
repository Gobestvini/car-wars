"""Collect public metadata; never download media or use account cookies.
Requires yt-dlp in PYTHONPATH. Raw metadata/captions remain in ignored tools/.
"""
import json
import re
import urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import yt_dlp

root = Path('tools/bruno-research')
output = Path('docs/knowledge')
output.mkdir(parents=True, exist_ok=True)
root.mkdir(parents=True, exist_ok=True)
for tab, filename in [('videos', 'youtube-catalog.json'), ('streams', 'streams.json'), ('shorts', 'shorts.json')]:
    destination = root / filename
    if not destination.exists():
        with yt_dlp.YoutubeDL(dict(quiet=True, no_warnings=True, extract_flat=True, skip_download=True)) as ydl:
            tab_data = ydl.extract_info('https://www.youtube.com/@BrunoSimon/' + tab, download=False)
        destination.write_text(json.dumps(tab_data, ensure_ascii=False), encoding='utf-8')
catalog = json.loads((root / 'youtube-catalog.json').read_text(encoding='utf-8-sig'))
entries = catalog['entries']

def extract(entry):
    path = root / ('metadata-' + entry['id'] + '.json')
    if path.exists():
        data = json.loads(path.read_text(encoding='utf-8'))
    elif entry['id'] == 'OBZtVz6IM18':
        data = json.loads((root / 'devlog1.json').read_text(encoding='utf-8-sig'))
    else:
        options = dict(quiet=True, no_warnings=True, skip_download=True, socket_timeout=12, retries=1, extractor_retries=1)
        with yt_dlp.YoutubeDL(options) as ydl:
            data = ydl.extract_info('https://www.youtube.com/watch?v=' + entry['id'], download=False)
        path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    return {
        'id': entry['id'], 'title': data.get('title', entry['title']),
        'url': 'https://www.youtube.com/watch?v=' + entry['id'],
        'durationSeconds': data.get('duration'), 'published': data.get('upload_date'),
        'chapters': data.get('chapters') or [],
        'metadataStatus': 'read', 'contentStatus': 'not_watched',
        'hasEnglishCaptions': bool(data.get('subtitles', {}).get('en') or data.get('automatic_captions', {}).get('en')),
        # URLs for resource discovery, rather than copying entire descriptions.
        'resourceLinks': list(dict.fromkeys(re.findall(r'https?://[^\s<>]+', data.get('description', '')))),
    }, data

rows = {}
full = {}
with ThreadPoolExecutor(max_workers=2) as pool:
    futures = {pool.submit(extract, entry): entry for entry in entries}
    for count, future in enumerate(as_completed(futures), 1):
        entry = futures[future]
        try:
            row, data = future.result(); rows[entry['id']] = row; full[entry['id']] = data
        except Exception as error:
            rows[entry['id']] = dict(id=entry['id'], title=entry['title'], url='https://www.youtube.com/watch?v=' + entry['id'], durationSeconds=entry.get('duration'), metadataStatus='catalog_only', contentStatus='not_watched', error=str(error)[:300])
        if count % 10 == 0 or count == len(entries):
            print(f'Metadata {count}/{len(entries)}', flush=True)

# Read captions for short, directly relevant portfolio devlogs. Captions are not visual inspection.
captions_blocked = False
for entry in entries:
    if 'Devlog' not in entry['title']:
        continue
    row = rows[entry['id']]
    if captions_blocked:
        row['captionStatus'] = 'not_requested_after_rate_limit'; continue
    data = full.get(entry['id'], {})
    captions = data.get('subtitles', {}).get('en') or data.get('automatic_captions', {}).get('en') or []
    caption = next((item for item in captions if item.get('ext') == 'json3'), None)
    if not caption:
        row['captionStatus'] = 'no_english_track'; continue
    try:
        request = urllib.request.Request(caption['url'], headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request, timeout=12) as response:
            text = response.read().decode('utf-8')
        parsed = json.loads(text)
        cues = [{'seconds': event.get('tStartMs', 0) / 1000, 'text': ''.join(segment.get('utf8', '') for segment in event.get('segs', []))} for event in parsed.get('events', []) if event.get('segs')]
        (root / ('captions-' + entry['id'] + '.json')).write_text(json.dumps(cues, ensure_ascii=False), encoding='utf-8')
        row['captionStatus'] = 'retrieved_not_yet_analyzed'
        row['captionCueCount'] = len(cues)
    except Exception as error:
        row['captionStatus'] = 'unavailable'; row['captionError'] = str(error)[:200]
        if '429' in str(error) or '403' in str(error): captions_blocked = True

result = {'checkedOn': '2026-10-05', 'source': 'https://www.youtube.com/@BrunoSimon/videos', 'scope': 'public videos tab; excludes private/deleted videos and separate streams/shorts tabs', 'videoCount': len(entries), 'totalDurationSeconds': sum(entry.get('duration') or 0 for entry in entries), 'videos': [rows[entry['id']] for entry in entries]}
(output / 'videos.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'videos': len(rows), 'metadataRead': sum(row['metadataStatus'] == 'read' for row in rows.values()), 'captionsRetrieved': sum(row.get('captionStatus') == 'retrieved_not_yet_analyzed' for row in rows.values())}), flush=True)
