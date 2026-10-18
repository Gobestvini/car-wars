"""Install the CarWars route in the shared Caddy config, validate, then hot-reload.

Run on the VPS: python3 configure-caddy.py /srv/tower/checkout/server/deploy/Caddyfile
Existing inode is preserved because Docker bind-mounts the file itself.
"""
import pathlib
import shutil
import subprocess
import sys
import time

path = pathlib.Path(sys.argv[1]).resolve(strict=True)
original = path.read_text()
marker = '\t# CarWars hosted preview (managed by CarWars deploy/configure-caddy.py)'
route = marker + '''
\tredir /carwars /carwars/ 308
\thandle_path /carwars/* {
\t\theader Cache-Control "no-store"
\t\treverse_proxy carwars-multiplayer:2577
\t}
'''
anchor = '{$API_DOMAIN} {\n'
if original.count(anchor) != 1:
    raise SystemExit('Expected exactly one API_DOMAIN block; config left unchanged')
# Keep a separate origin from White Tower's root-scoped offline service worker.
desired = original.replace(route, '')
desired = desired.replace(anchor, anchor + route, 1)
if desired != original:
    backup = path.with_name(path.name + '.before-carwars-' + str(time.time_ns()))
    shutil.copy2(path, backup)
    path.write_text(desired)
    changed = True
else:
    changed = False

def caddy(command):
    subprocess.run(['docker', 'exec', 'tower-platform-caddy-1', 'caddy', command,
                    '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], check=True)

try:
    caddy('validate')
    caddy('reload')
except BaseException:
    if changed:
        path.write_text(original)
        caddy('reload')
    raise
print('CarWars route validated and hot-reloaded; existing services preserved')
