import os
import re
import sys
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
for line in (BASE / '.env').read_text(encoding='utf-8').splitlines():
    m = re.match(r'^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$', line)
    if m and m.group(1) not in os.environ:
        os.environ[m.group(1)] = m.group(2).strip('"\'')

url = os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1/tratativas?select=card_id&limit=3'
req = urllib.request.Request(url, headers={
    'apikey': os.environ['SUPABASE_SERVICE_ROLE_KEY'],
    'Authorization': 'Bearer ' + os.environ['SUPABASE_SERVICE_ROLE_KEY'],
})
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        rows = json.loads(r.read())
        print('TABELA tratativas: EXISTE |', len(rows), 'linha(s) de exemplo')
except Exception as e:
    print('TABELA tratativas:', e)
