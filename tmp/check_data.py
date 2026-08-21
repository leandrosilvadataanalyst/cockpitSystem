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

KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
URL = os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1'


def get(path):
    req = urllib.request.Request(URL + path, headers={'apikey': KEY, 'Authorization': 'Bearer ' + KEY})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


rows = get('/tratativas?select=card_id,titulo,cliente,squad_id,etapa,categoria_step,churn,thread_criada,data_atualizacao_etapa&order=card_id')
print(f'{len(rows)} tratativa(s):')
for r in rows:
    print(json.dumps(r, ensure_ascii=False, indent=2))

hist = get('/tratativa_historico?select=card_id,etapa,entrou_em,saiu_em,duracao_dias&order=card_id,entrou_em')
print(f'\n{len(hist)} registro(s) de historico:')
for h in hist:
    print(f"  card {h['card_id']}: {h['etapa']} | entrou {h['entrou_em'][:10]} | saiu {(h['saiu_em'] or 'ATUAL')[:10] if h['saiu_em'] else 'ATUAL'} | {h['duracao_dias'] if h['duracao_dias'] is not None else '-'} d")
