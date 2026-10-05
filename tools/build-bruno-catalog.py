"""Publish factual catalogs from cached public metadata; no transcripts or lesson bodies."""
import json
import re
from pathlib import Path
from html.parser import HTMLParser

raw = Path('tools/bruno-research')
out = Path('docs/knowledge')

class Links(HTMLParser):
    def __init__(self):
        super().__init__(); self.href = None; self.parts = []; self.links = []
    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.href = dict(attrs).get('href'); self.parts = []
    def handle_data(self, data):
        if self.href: self.parts.append(data)
    def handle_endtag(self, tag):
        if tag == 'a' and self.href:
            self.links.append((self.href, ' '.join(' '.join(self.parts).split())))
            self.href = None

parser = Links()
parser.feed((raw / 'course-page-0.html').read_text(encoding='utf8'))
lessons = {}
for href, text in parser.links:
    if '/lessons/' not in href or not re.match(r'^\d+\s', text): continue
    url = href if href.startswith('https://') else 'https://threejs-journey.com' + href
    lessons[url] = dict(url=url, catalogLabel=text, access='free' if ' free ' in text else 'preview', contentStatus='catalog_only')
courses = {'checkedOn': '2026-10-05', 'source': 'https://threejs-journey.com/',
    'courses': [
        {'title': 'Three.js Journey — Three.js Course', 'url': 'https://threejs-journey.com/', 'lessonCount': 66, 'advertisedHours': 93},
        {'title': 'WebGPU & TSL', 'url': 'https://threejs-journey.com/webgpu-tsl', 'lessonCount': 21, 'advertisedHours': 24},
    ], 'lessons': list(lessons.values())}
(out / 'courses.json').write_text(json.dumps(courses, ensure_ascii=False, indent=2), encoding='utf8')

catalog = json.loads((out / 'videos.json').read_text(encoding='utf8'))
catalog['additionalTabs'] = []
for tab in ['streams', 'shorts']:
    data = json.loads((raw / (tab + '.json')).read_text(encoding='utf-8-sig'))
    catalog['additionalTabs'].append({'source': 'https://www.youtube.com/@BrunoSimon/' + tab,
        'entries': [dict(id=v['id'], title=v['title'], url='https://www.youtube.com/watch?v=' + v['id'],
            durationSeconds=v.get('duration'), metadataStatus='catalog_only', contentStatus='not_watched') for v in data.get('entries', [])]})
review = {
    'OBZtVz6IM18': '30–1028s: architecture, ordered updates, physics, input, raycast vehicle',
    '5i_-p4ET2JE': '1–299s: car model, reusable wheel, materials and visual feedback',
    'EhZwt9P4GP4': '6–1407s: performance, draw calls, quality and asset pipeline',
    'Uc3Ujdh8Ba4': '285–975s: camera framing, touch joystick, resize and input modes',
}
for video in catalog['videos']:
    if video['id'] in review:
        video['captionStatus'] = 'sections_reviewed'
        video['reviewedSections'] = review[video['id']]
catalog['scope'] = 'public videos tab plus separate streams and shorts catalogs; private/deleted/unlisted videos are not covered'
(out / 'videos.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf8')
lines = ['# Каталог видео Bruno Simon', '', 'Проверено 2026-10-05. Это индекс публичных материалов, а не утверждение о просмотре всех роликов.', '',
    '90 видео во вкладке Videos, 2 записи во вкладке Live и 1 Short. У 89 видео прочитаны метаданные; одно осталось с данными каталога после ошибки загрузчика. Получены субтитры 16 девлогов; разделы четырёх разобраны. Полные субтитры здесь не публикуются.', '',
    'Машинный индекс, главы, даты, длительности, ссылки и статусы: [videos.json](videos.json).', '',
    '| Видео | Длительность | Что изучено |', '| --- | ---: | --- |']
for video in catalog['videos']:
    status = 'Разделы субтитров разобраны' if video['id'] in review else 'Субтитры получены, не разобраны' if video.get('captionStatus') == 'retrieved_not_yet_analyzed' else 'Только метаданные' if video['metadataStatus'] == 'read' else 'Только каталог'
    seconds = video.get('durationSeconds') or 0
    lines.append(f"| [{video['title'].replace('|', '/')} ]({video['url']}) | {seconds // 3600}:{seconds // 60 % 60:02}:{seconds % 60:02} | {status} |")
for tab in catalog['additionalTabs']:
    lines += ['', '## ' + tab['source'].rsplit('/', 1)[1], '']
    for entry in tab['entries']: lines.append(f"- [{entry['title']}]({entry['url']}) — только каталог.")
(out / 'videos.md').write_text('\n'.join(lines) + '\n', encoding='utf8')
lines = ['# Курсы и уроки', '', 'Проверено 2026-10-05 по [официальному сайту](https://threejs-journey.com/). Найдены два самостоятельных курса: Three.js Course (66 уроков, около 93 часов) и WebGPU & TSL (21 урок, около 24 часов). Бандл — вариант доступа к обоим, не третий курс. Сайт указывает 116 часов для комплекта; длительности округлены и не складываются точно.', '',
    'Приватное содержимое не читалось. В таблице перечислены названия и доступность из публичного каталога; preview означает доступное начало, не полный урок. Разобранные открытые начала: Physics, Code structuring for bigger projects, Performance tips, Intro and loading progress.', '',
    'Короткие ролики, эфиры и devlog не считаем отдельными платными курсами. Упоминание возможного будущего курса про портфолио в Devlog 1 не означает, что он уже выпущен.', '',
    'Для нашей игры порядок изучения: базовая сцена → размеры и камера → загрузка GLTF → физика → структура → измерения и оптимизация → загрузочный экран. Шейдеры — для конкретных эффектов; R3F и WebGPU & TSL — отдельные направления развития.', '',
    'Полный индекс: [courses.json](courses.json).', '', '| Урок | Доступ по каталогу |', '| --- | --- |']
for lesson in lessons.values(): lines.append(f"| [{lesson['catalogLabel']}]({lesson['url']}) | {lesson['access']} |")
(out / 'courses.md').write_text('\n'.join(lines) + '\n', encoding='utf8')
print(json.dumps({'lessons': len(lessons), 'videos': len(catalog['videos']), 'extraEntries': sum(len(t['entries']) for t in catalog['additionalTabs'])}))
