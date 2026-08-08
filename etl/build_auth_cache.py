"""
build_auth_cache.py — extract the sign-in roster into its own small file.
==============================================================================

WHY
------------------------------------------------------------------------------
`js/auth.js` reads the roster from `IQVIA_CACHE.users`, so `cache/iqvia.data.js`
had to be downloaded and JavaScript-parsed on EVERY page load, by every user,
before anyone could sign in.

That file is 4.4 MB. The roster inside it is about 20 KB.

The other 4.38 MB is competitor market-share data that only matters if you open
the IQVIA page. Pulling the roster out lets that whole cache become lazy — it
now loads when the IQVIA tab is opened, and not before.

WHY NOT USE cache/userAuth.js, WHICH ALREADY EXISTS
------------------------------------------------------------------------------
Because it has no password hashes. Compared field by field: 25 accounts in
both, all 25 differing, and every difference is the missing `hash`. It is the
human-readable config mirror written by sync_users.py, not an authentication
source. Swapping auth.js onto it would have broken every login.

SAFETY
------------------------------------------------------------------------------
Derived from cache/iqvia.data.js, so it cannot drift from it — regenerate this
whenever that is rebuilt. `auth.js` prefers this file and falls back to
`IQVIA_CACHE.users` if it is absent, so a missing or stale run degrades to
exactly today's behaviour rather than locking anyone out.
"""

import os
import re
import sys
import json

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_JS = os.path.join(ROOT_DIR, 'cache', 'iqvia.data.js')
OUT_JS = os.path.join(ROOT_DIR, 'cache', 'auth.data.js')


def extract_users(text):
    """
    Pull the `users` object out of the IQVIA cache file.

    Parsed by brace matching rather than a regex: the values contain braces and
    escaped quotes, and a regex that looked right on today's file would fail
    silently and lock everyone out the first time an account name contained
    something unexpected. Silent failure is not acceptable in an auth path.
    """
    key = '"users"'
    i = text.find(key)
    if i < 0:
        return None
    j = text.find(':', i + len(key))
    if j < 0:
        return None

    depth = 0
    start = None
    in_str = False
    esc = False
    for k in range(j, len(text)):
        ch = text[k]
        if in_str:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == '{':
            if depth == 0:
                start = k
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return text[start:k + 1]
    return None


def build():
    if not os.path.exists(SRC_JS):
        print('[auth-cache] SKIP: {0} not found'.format(os.path.basename(SRC_JS)))
        return 0

    with open(SRC_JS, 'r', encoding='utf-8') as fh:
        text = fh.read()

    raw = extract_users(text)
    if not raw:
        print('[auth-cache] ERROR: could not locate the users object in the IQVIA cache.')
        print('             auth.js will keep reading IQVIA_CACHE.users, so nothing breaks,')
        print('             but cache/iqvia.data.js must stay eagerly loaded.')
        return 1

    try:
        users = json.loads(raw)
    except Exception as exc:                              # noqa: BLE001
        print('[auth-cache] ERROR: users object did not parse as JSON: {0}'.format(exc))
        return 1

    if not isinstance(users, dict) or not users:
        print('[auth-cache] ERROR: users object is empty — refusing to write.')
        return 1

    # Every account must still carry what auth.js needs. Writing a roster that
    # is missing hashes would lock people out, and the fallback would not save
    # them because the file WOULD exist and therefore be preferred.
    missing = [e for e, u in users.items() if not isinstance(u, dict) or not u.get('hash')]
    if missing:
        print('[auth-cache] ERROR: {0} account(s) have no password hash: {1}'.format(
            len(missing), ', '.join(missing[:3])))
        print('             Refusing to write a roster that cannot authenticate.')
        return 1

    payload = json.dumps(users, separators=(',', ':'), ensure_ascii=False)
    with open(OUT_JS, 'w', encoding='utf-8') as fh:
        fh.write('window.AUTH_USERS = ' + payload + ';\n')

    print('[auth-cache] {0} accounts -> cache/auth.data.js ({1:.1f} KB, was {2:.1f} MB inside the IQVIA cache)'
          .format(len(users), os.path.getsize(OUT_JS) / 1024.0, os.path.getsize(SRC_JS) / 1e6))
    return 0


if __name__ == '__main__':
    sys.exit(build())
