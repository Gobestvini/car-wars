import { mkdir, readFile, writeFile } from 'node:fs/promises';
const dir = 'tools/bruno-research';
await mkdir(dir, { recursive: true });
const revisionResponse = await fetch('https://api.github.com/repos/brunosimon/folio-2025/commits/main');
if (!revisionResponse.ok) throw Error(`GitHub revision: HTTP ${revisionResponse.status}`);
const commit = (await revisionResponse.json()).sha;
const files = ['readme.md', 'license.md', 'sources/Game/Ticker.js', 'sources/Game/Viewport.js', 'sources/Game/Time.js', 'sources/Game/Quality.js', 'sources/Game/View.js', 'sources/Game/Rendering.js', 'sources/Game/Monitoring.js', 'sources/Game/Player.js', 'sources/Game/Tracks.js', 'sources/Game/ResourcesLoader.js', 'sources/Game/Inputs/Nipple.js', 'sources/Game/Physics/Physics.js', 'sources/Game/Physics/PhysicsVehicle.js', 'sources/Game/World/VisualVehicle.js'];
const results = await Promise.allSettled(files.map(async path => {
  const response = await fetch(`https://raw.githubusercontent.com/brunosimon/folio-2025/${commit}/${path}`);
  if (!response.ok) throw Error(`${path}: HTTP ${response.status}`);
  await writeFile(`${dir}/${path.replaceAll('/', '__')}`, await response.text());
  return path;
}));
const pages = ['https://threejs-journey.com/', 'https://threejs-journey.com/lessons/performance-tips', 'https://threejs-journey.com/lessons/physics', 'https://threejs-journey.com/lessons/code-structuring-for-bigger-projects', 'https://threejs-journey.com/lessons/intro-and-loading-progress', 'https://threejs-journey.com/webgpu-tsl'];
const pageResults = await Promise.allSettled(pages.map(async (url, i) => {
  const response = await fetch(url);
  if (!response.ok) throw Error(`${url}: HTTP ${response.status}`);
  await writeFile(`${dir}/course-page-${i}.html`, await response.text());
  return url;
}));
const manifest = { checkedOn: '2026-10-05', commit, repository: 'https://github.com/brunosimon/folio-2025', files: results.map((r, i) => ({ path: files[i], status: r.status, error: r.status === 'rejected' ? String(r.reason) : undefined })), pages: pageResults.map((r, i) => ({ url: pages[i], status: r.status, error: r.status === 'rejected' ? String(r.reason) : undefined })) };
await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
