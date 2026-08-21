import os
import re
import json
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
for line in (BASE / '.env').read_text(encoding='utf-8').splitlines():
    m = re.match(r'^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$', line)
    if m and m.group(1) not in os.environ:
        os.environ[m.group(1)] = m.group(2).strip('"\'')

# Simula o BROWSER: usa a anon key (papel `anon` no banco)
KEY = os.environ['SUPABASE_ANON_KEY']
URL = os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1'

for table in ('tratativas', 'squads'):
    req = urllib.request.Request(
        f'{URL}/{table}?select=*&limit=3',
        headers={'apikey': KEY, 'Authorization': 'Bearer ' + KEY})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            rows = json.loads(r.read())
        print(f'ANON ve {len(rows)} linha(s) em {table}')
    except Exception as e:
        print(f'ANON erro em {table}: {e}')
