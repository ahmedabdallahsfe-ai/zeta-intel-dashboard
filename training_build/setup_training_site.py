# -*- coding: utf-8 -*-
"""Copy the production web app (code only) into training/ and patch the COPY:
 - own sign-in session key (signing in to training never touches the real dashboard's session)
 - a visible "TRAINING - SAMPLE DATA" ribbon and page title
Production files are only read. Data comes from build_training_data.py (training/cache)."""
import os, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = os.path.join(ROOT, 'training')
os.makedirs(T, exist_ok=True)
for d in ('js', 'css'):
    if os.path.isdir(os.path.join(T, d)): shutil.rmtree(os.path.join(T, d))
    shutil.copytree(os.path.join(ROOT, d), os.path.join(T, d), ignore=shutil.ignore_patterns('*.bak*', '*.removed_*'))
os.makedirs(os.path.join(T, 'assets'), exist_ok=True)
for f in ('chart.umd.min.js', 'xlsx.core.min.js', 'pako.min.js'):
    shutil.copy2(os.path.join(ROOT, 'assets', f), os.path.join(T, 'assets', f))
for f in ('zeta_logo.png',):
    shutil.copy2(os.path.join(ROOT, f), os.path.join(T, f))

def patch(rel, pairs):
    p = os.path.join(T, rel)
    b = open(p, 'rb').read()
    for old, new, n in pairs:
        c = b.count(old)
        assert c == n, (rel, old, c)
        b = b.replace(old, new)
    open(p, 'wb').write(b)

patch('js/auth.js', [(b'var SESSION_KEY = "zeta_session";', b'var SESSION_KEY = "zeta_training_session";', 1)])
patch('js/iqvia.js', [(b"localStorage.removeItem('zeta_session');", b"localStorage.removeItem('zeta_training_session');", 1)])
patch('js/sprint.js', [(b'localStorage.getItem("zeta_session")', b'localStorage.getItem("zeta_training_session")', 1)])

html = open(os.path.join(ROOT, 'dashboard.html'), 'rb').read()
ribbon = (b'<body>\r\n  <div id="zeta-training-ribbon" style="position:fixed;left:12px;bottom:12px;z-index:2147483000;'
          b'background:#B45309;color:#fff;font:600 12px/1.2 Inter,Arial,sans-serif;padding:7px 12px;border-radius:6px;'
          b'box-shadow:0 2px 8px rgba(0,0,0,.25);pointer-events:none;letter-spacing:.3px">'
          b'TRAINING DASHBOARD &middot; SAMPLE DATA &mdash; names and numbers are not real</div>')
nl = b'\r\n' if b'\r\n' in html else b'\n'
assert html.count(b'<body>') == 1
html = html.replace(b'<body>', ribbon.replace(b'\r\n', nl), 1)
assert html.count(b'<title>Zeta Commercial Excellence Dashboard</title>') == 1
html = html.replace(b'<title>Zeta Commercial Excellence Dashboard</title>', b'<title>TRAINING - Zeta Commercial Excellence Dashboard</title>')
open(os.path.join(T, 'dashboard.html'), 'wb').write(html)
open(os.path.join(T, 'index.html'), 'w', encoding='utf-8').write(
    '<!doctype html><meta charset="utf-8"><title>Zeta Training Dashboard</title>'
    '<meta http-equiv="refresh" content="0; url=dashboard.html"><a href="dashboard.html">Open the training dashboard</a>\n')
print('training site ready:', T)
