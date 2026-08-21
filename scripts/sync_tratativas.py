"""
Sincroniza cards do pipe de Tratativas (Pipefy) -> Supabase.
Equivalente local de api/sync_tratativas.js (para testar sem Node/Vercel).

Autenticacao OAuth2 client_credentials:
    PIPEFY_CLIENT_ID / PIPEFY_CLIENT_SECRET / PIPEFY_TOKEN_URL no .env

Uso:
    python scripts/sync_tratativas.py
"""
import json
import os
import re
import sys
import time
import urllib.request
import urllib.parse
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

# Carrega o .env ANTES de importar config (fallback se python-dotenv nao existir)
_env_path = BASE / '.env'
if _env_path.exists():
    for _line in _env_path.read_text(encoding='utf-8').splitlines():
        _m = re.match(r'^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$', _line)
        if _m and _m.group(1) not in os.environ:
            os.environ[_m.group(1)] = _m.group(2).strip('"\'')

from config import Env  # noqa: E402

GRAPHQL_URL = 'https://api.pipefy.com/graphql'

PIPEFY_CLIENT_ID = os.getenv('PIPEFY_CLIENT_ID', '')
PIPEFY_CLIENT_SECRET = os.getenv('PIPEFY_CLIENT_SECRET', '')
PIPEFY_TOKEN_URL = os.getenv('PIPEFY_TOKEN_URL', '')
PIPEFY_PIPE_ID = os.getenv('PIPEFY_PIPE_ID', '')

# ── Cache do access token OAuth ──
_oauth = {'token': None, 'expires_at': 0}


def _http(url, data=None, headers=None, timeout=30):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    return urllib.request.urlopen(req, timeout=timeout)


def get_bearer_token():
    """Bearer token: usa PIPEFY_TOKEN se existir; senao OAuth2 client_credentials (com cache)."""
    simple = os.getenv('PIPEFY_TOKEN', '').strip()
    if simple:
        return simple

    if _oauth['token'] and time.time() < _oauth['expires_at'] - 60:
        return _oauth['token']

    body = urllib.parse.urlencode({
        'grant_type': 'client_credentials',
        'client_id': PIPEFY_CLIENT_ID,
        'client_secret': PIPEFY_CLIENT_SECRET,
    }).encode()
    try:
        with _http(PIPEFY_TOKEN_URL, data=body) as r:
            resp = json.loads(r.read())
    except Exception:
        # Fallback: Basic Auth no header
        import base64
        basic = base64.b64encode(f'{PIPEFY_CLIENT_ID}:{PIPEFY_CLIENT_SECRET}'.encode()).decode()
        req = urllib.request.Request(
            PIPEFY_TOKEN_URL,
            data=urllib.parse.urlencode({'grant_type': 'client_credentials'}).encode(),
            headers={'Authorization': f'Basic {basic}'},
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read())

    if 'access_token' not in resp:
        raise RuntimeError('OAuth nao retornou access_token')
    _oauth['token'] = resp['access_token']
    _oauth['expires_at'] = time.time() + int(resp.get('expires_in', 3600))
    return _oauth['token']


def gql(query, variables=None):
    token = get_bearer_token()
    body = json.dumps({'query': query, 'variables': variables or {}}).encode()
    req = urllib.request.Request(GRAPHQL_URL, data=body, headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 401:
            _oauth.update(token=None, expires_at=0)
        raise RuntimeError(f'Pipefy HTTP {e.code}')
    if data.get('errors'):
        raise RuntimeError('Pipefy GraphQL: ' + '; '.join(e.get('message', '') for e in data['errors']))
    return data['data']


CARD_NODE = """
  id title url created_at updated_at
  current_phase { id name }
  fields { name value }
  phases_history { phase { id name } firstTimeIn lastTimeIn lastTimeOut }
"""


def fetch_pipe(pipe_id):
    data = gql('query($id: ID!) { pipe(id: $id) { id name phases { id name } } }', {'id': pipe_id})
    if not data.get('pipe'):
        raise RuntimeError(f'Pipe {pipe_id} nao encontrado')
    return data['pipe']


def fetch_all_cards(pipe_id):
    """Usa a query `cards` (documentada); se vier vazia, tenta `allCards` como fallback."""
    def run_paged(field):
        arg = 'pipe_id' if field == 'cards' else 'pipeId'
        var = '$pipe_id' if field == 'cards' else '$pipeId'
        key = 'pipe_id' if field == 'cards' else 'pipeId'
        cards, after = [], None
        while True:
            data = gql("""
              query($pid: ID!, $after: String) {
                %s(%s: $pid, first: 50, after: $after) {
                  pageInfo { endCursor hasNextPage }
                  edges { node { %s } }
                }
              }
            """ % (field, arg, CARD_NODE), {'pid': pipe_id, 'after': after})
            conn = data.get(field)
            if not conn or not isinstance(conn.get('edges'), list):
                return None  # campo inexistente na resposta
            cards.extend(e['node'] for e in conn['edges'])
            if not conn['pageInfo']['hasNextPage']:
                break
            after = conn['pageInfo']['endCursor']
        return cards

    cards = run_paged('cards')
    if not cards:
        fallback = run_paged('allCards')
        if fallback:
            return fallback
    return cards or []


# ── Normalizacao / mapeamento ──
def norm_key(k):
    s = str(k or '').strip().lower()
    s = re.sub(r'[^\w\s]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def unwrap_value(v):
    """Pipefy retorna campos select/conector como lista ou JSON-em-string: '[\"X\"]'."""
    if isinstance(v, list):
        v = v[0] if v else ''
    s = str(v).strip()
    if s.startswith('[') and s.endswith(']'):
        try:
            arr = json.loads(s)
            if isinstance(arr, list) and arr:
                return str(arr[0])
        except Exception:
            pass
    return s


SQUAD_MATCHERS = [
    ('wall', 'wall-street'), ('roman', 'romans'),
    ('legacy', 'legacy'), ('monster', 'monsters-sa'),
]


def squad_to_enum(v):
    if not v:
        return None
    s = norm_key(v)
    for frag, enum_id in SQUAD_MATCHERS:
        if frag in s:
            return enum_id
    return None


def parse_bool(v):
    if v is None or v == '':
        return False
    if isinstance(v, list):
        v = v[0] if v else ''
    return str(v).strip().lower() in ('true', 'sim', 'yes', '1', 'criada')


def to_iso(v):
    if not v:
        return None
    try:
        from datetime import datetime, timezone
        d = datetime.fromisoformat(str(v).replace('Z', '+00:00'))
        return d.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
    except Exception:
        return None


def map_fields(fields):
    items = [(norm_key(f.get('name')), f.get('value')) for f in fields or []]

    def find(matchers):
        for m in matchers:
            for k, v in items:
                if v not in (None, '') and m(k):
                    return unwrap_value(v)
        return None

    eq = lambda target: (lambda k: k == target)
    starts = lambda p: (lambda k: k.startswith(p))
    has = lambda frag: (lambda k: frag in k)

    return {
        # 'Cliente' (fallback: qualquer campo que comece com 'cliente')
        'cliente': find([eq('cliente'), starts('cliente')]),
        # 'Squad'
        'squad_id': squad_to_enum(find([eq('squad')])),
        # 'Produto' (Categoria STEP)
        'categoria_step': find([eq('produto'), has('produto')]),
        # 'Solicitou churn'
        'churn': find([has('churn')]),
        # 'AGORA CRIE UMA THREAD NA WORKSPACE DE CS'
        'thread_criada': parse_bool(find([has('thread')])),
    }


def card_to_payload(card, phase_order):
    mapped = map_fields(card.get('fields'))
    hist = card.get('phases_history') or []

    cur = next((h for h in hist if not h.get('lastTimeOut')), None)
    if not cur and card.get('current_phase'):
        cur = next((h for h in hist if h.get('phase', {}).get('id') == card['current_phase'].get('id')), None)

    entrou = to_iso(cur.get('lastTimeIn') or cur.get('firstTimeIn')) if cur else None

    history = []
    for h in hist:
        nome_fase = (h.get('phase') or {}).get('name', '?')
        if norm_key(nome_fase) == 'start form':
            continue  # pseudo-fase de abertura do card
        ein, eout = to_iso(h.get('firstTimeIn')), to_iso(h.get('lastTimeOut'))
        atual = eout is None
        if not atual and ein and eout and ein == eout:
            continue  # fase nunca visitada: Pipefy repete o mesmo timestamp
        dur = None
        if ein and eout:
            from datetime import datetime
            d1 = datetime.fromisoformat(ein.replace('Z', '+00:00'))
            d2 = datetime.fromisoformat(eout.replace('Z', '+00:00'))
            dur = round((d2 - d1).total_seconds() / 86400, 1)
        history.append({
            'card_id': str(card['id']),
            'etapa': nome_fase,
            'ordem_fase': phase_order.get((h.get('phase') or {}).get('id')),
            'entrou_em': ein,
            'saiu_em': eout,
            'duracao_dias': dur,
            'synced_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        })

    return {
        'card_id': str(card['id']),
        'url': card.get('url'),
        'titulo': card.get('title'),
        'cliente': mapped['cliente'],
        'squad_id': mapped['squad_id'],
        'etapa': (cur.get('phase') or {}).get('name') if cur else (card.get('current_phase') or {}).get('name', 'Caixa de entrada'),
        'categoria_step': mapped['categoria_step'],
        'churn': mapped['churn'],
        'thread_criada': mapped['thread_criada'],
        'data_criacao': to_iso(card.get('created_at')),
        'data_atualizacao_etapa': entrou,
        'pipefy_updated_at': to_iso(card.get('updated_at')),
        'synced_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        '_history': history,
    }


# ── Supabase REST (service_role) ──
def supa(method, path, body=None):
    Env.validate_service()
    url = f'{Env.SUPABASE_URL.rstrip("/")}/rest/v1/{path}'
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        'apikey': Env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': f'Bearer {Env.SUPABASE_SERVICE_ROLE_KEY}',
        'Content-Type': 'application/json',
    }
    if method == 'POST' and 'tratativas?' in path:
        headers['Prefer'] = 'resolution=merge-duplicates,return=representation'
    elif method == 'POST':
        headers['Prefer'] = 'return=representation'
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


MOVE_MUTATION = """
mutation($cardId: ID!, $phaseId: ID!) {
  moveCardToPhase(input: { card_id: $cardId, destination_phase_id: $phaseId }) {
    card { id current_phase { id name } }
  }
}
"""


def move_card_to_phase(card_id, phase_id):
    data = gql(MOVE_MUTATION, {'cardId': str(card_id), 'phaseId': str(phase_id)})
    card = (data.get('moveCardToPhase') or {}).get('card')
    if not card:
        raise RuntimeError('Pipefy nao confirmou a movimentacao do card')
    return card


def move_tratativa(card_id, to_etapa):
    """Move card no Pipefy e reflete em tratativas + historico."""
    if not PIPEFY_PIPE_ID:
        raise RuntimeError('PIPEFY_PIPE_ID ausente no .env')

    pipe = fetch_pipe(PIPEFY_PIPE_ID)
    fase = next((p for p in pipe['phases'] if p['name'].lower() == str(to_etapa).lower()), None)
    if not fase:
        raise RuntimeError(f'Etapa "{to_etapa}" nao existe no pipe')
    ordem_fase = pipe['phases'].index(fase)

    # Fonte da verdade primeiro: falha aqui aborta tudo
    move_card_to_phase(card_id, fase['id'])

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')

    supa('PATCH', f'tratativas?card_id=eq.{card_id}', {
        'etapa': fase['name'],
        'data_atualizacao_etapa': now,
        'synced_at': now,
    })

    abertas = supa('GET', f'tratativa_historico?card_id=eq.{card_id}&saiu_em=is.null&select=id,entrou_em') or []
    for h in abertas:
        d1 = datetime.fromisoformat(h['entrou_em'].replace('Z', '+00:00'))
        d2 = datetime.fromisoformat(now.replace('Z', '+00:00'))
        dur = round((d2 - d1).total_seconds() / 86400, 1)
        supa('PATCH', f"tratativa_historico?id=eq.{h['id']}", {'saiu_em': now, 'duracao_dias': dur})

    supa('POST', 'tratativa_historico', [{
        'card_id': str(card_id),
        'etapa': fase['name'],
        'ordem_fase': ordem_fase,
        'entrou_em': now,
        'synced_at': now,
    }])

    return {'card_id': str(card_id), 'etapa': fase['name'], 'data_atualizacao_etapa': now}


def sync_tratativas():
    if not ((PIPEFY_CLIENT_ID and PIPEFY_CLIENT_SECRET and PIPEFY_TOKEN_URL) or os.getenv('PIPEFY_TOKEN')):
        raise RuntimeError('Credenciais Pipefy ausentes no .env (CLIENT_ID/SECRET/TOKEN_URL ou TOKEN)')
    if not PIPEFY_PIPE_ID:
        raise RuntimeError('PIPEFY_PIPE_ID ausente no .env')

    log = []
    pipe = fetch_pipe(PIPEFY_PIPE_ID)
    phase_order = {p['id']: i for i, p in enumerate(pipe['phases'])}
    log.append(f'Pipe "{pipe["name"]}" com {len(pipe["phases"])} fases')

    cards = fetch_all_cards(PIPEFY_PIPE_ID)
    log.append(f'{len(cards)} cards encontrados')

    # Modo diagnostico: testa variantes de query e mostra estrutura sem expor valores
    if '--debug' in sys.argv:
        print(f'[DEBUG] Pipe: "{pipe["name"]}" (id={PIPEFY_PIPE_ID})')
        print('[DEBUG] Fases:', [p['name'] for p in pipe['phases']])

        def probe(label, query, variables):
            try:
                d = gql(query, variables)
                conn = next(iter(d.values()))
                n = len(conn['edges']) if conn and conn.get('edges') is not None else -1
                print(f'[DEBUG] {label}: {n} card(s)')
                return conn
            except Exception as e:
                print(f'[DEBUG] {label}: ERRO {e}')
                return None

        probe('cards(pipe_id)', 'query($p: ID!) { cards(pipe_id: $p, first: 50) { edges { node { id } } } }', {'p': PIPEFY_PIPE_ID})
        probe('allCards(pipeId)', 'query($p: ID!) { allCards(pipeId: $p, first: 50) { edges { node { id } } } }', {'p': PIPEFY_PIPE_ID})
        # Caminho alternativo: cards dentro de cada fase
        try:
            d = gql('query($p: ID!) { pipe(id: $p) { phases { name cards(first: 50) { edges { node { id } } } } } }', {'p': PIPEFY_PIPE_ID})
            total = 0
            for ph in d['pipe']['phases']:
                n = len((ph.get('cards') or {}).get('edges') or [])
                total += n
                print(f'[DEBUG] fase "{ph["name"]}": {n} card(s)')
            print(f'[DEBUG] TOTAL via phases->cards: {total}')
        except Exception as e:
            print(f'[DEBUG] phases->cards: ERRO {e}')

        for c in cards[:5]:
            campos = [f.get('name') for f in (c.get('fields') or [])]
            print(f'[DEBUG] Card "{c.get("title")}" | fase atual: {(c.get("current_phase") or {}).get("name")} | campos: {campos}')
            print(f'[DEBUG]   phases_history: {[(h["phase"]["name"], bool(h.get("lastTimeOut"))) for h in (c.get("phases_history") or [])]}')
        return {'ok': True, 'log': log + ['(modo debug: nada foi gravado)'], 'imported': 0, 'total': len(cards)}

    if not cards:
        return {'ok': True, 'log': log, 'imported': 0}

    payloads = [card_to_payload(c, phase_order) for c in cards]

    ok = 0
    for p in payloads:
        row = {k: v for k, v in p.items() if k != '_history'}
        try:
            supa('POST', 'tratativas?on_conflict=card_id', [row])
            ok += 1
        except Exception as e:
            log.append(f'ERRO upsert card {p["card_id"]}: {e}')
    log.append(f'tratativas: {ok}/{len(payloads)} sincronizadas')

    hist_ok = 0
    for p in payloads:
        try:
            supa('DELETE', f'tratativa_historico?card_id=eq.{p["card_id"]}')
            if p['_history']:
                supa('POST', 'tratativa_historico', p['_history'])
            hist_ok += 1
        except Exception as e:
            log.append(f'ERRO historico card {p["card_id"]}: {e}')
    log.append(f'historico: {hist_ok}/{len(payloads)} reconstruidos')

    # Espelha exclusoes: card que saiu do pipe (lixeira) sai do banco.
    # A exclusao SEMPRE acontece no Pipefy; aqui eh apenas reflexo.
    existentes = supa('GET', 'tratativas?select=card_id') or []
    atuais = {p['card_id'] for p in payloads}
    removidos = [e['card_id'] for e in existentes if e['card_id'] not in atuais]
    if removidos:
        supa('DELETE', f"tratativas?card_id=in.({','.join(removidos)})")
        # historico correspondente some por ON DELETE CASCADE
    log.append(f'{len(removidos)} card(s) removido(s) (excluidos no Pipefy)')

    return {'ok': ok == len(payloads), 'log': log, 'imported': ok, 'total': len(payloads)}


if __name__ == '__main__':
    PIPEFY_CLIENT_ID = os.getenv('PIPEFY_CLIENT_ID', '')
    PIPEFY_CLIENT_SECRET = os.getenv('PIPEFY_CLIENT_SECRET', '')
    PIPEFY_TOKEN_URL = os.getenv('PIPEFY_TOKEN_URL', '')
    PIPEFY_PIPE_ID = os.getenv('PIPEFY_PIPE_ID', '')

    print('Sincronizando tratativas...')
    try:
        result = sync_tratativas()
        print('\n'.join(result['log']))
        sys.exit(0 if result['ok'] else 1)
    except Exception as e:
        print(f'[ERRO] {e}')
        sys.exit(1)
