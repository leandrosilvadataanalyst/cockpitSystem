"""
Servidor local de API para desenvolvimento (XAMPP nao executa serverless).

Expoe os mesmos endpoints da Vercel:
    POST /sync_tratativas
    POST /move_tratativa   { "card_id": "...", "to_etapa": "..." }

Uso (deixe rodando em um terminal enquanto testa):
    python scripts\\local_api.py

O front (tratativas.js) detecta a ausencia do endpoint no Apache e usa
este servidor automaticamente via http://127.0.0.1:5099.
"""
import json
import re
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
sys.path.insert(0, str(BASE / 'scripts'))

for _line in (BASE / '.env').read_text(encoding='utf-8').splitlines():
    _m = re.match(r'^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$', _line)
    if _m and _m.group(1) not in os.environ:
        os.environ[_m.group(1)] = _m.group(2).strip('"\'')

import sync_tratativas as st  # noqa: E402

HOST, PORT = '127.0.0.1', 5099


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(200, {'ok': True})

    def do_GET(self):
        if self.path.startswith('/health'):
            self._send(200, {'ok': True, 'service': 'local_api'})
        else:
            self._send(404, {'ok': False, 'error': 'Endpoint inexistente'})

    def do_POST(self):
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length else b'{}'
        try:
            body = json.loads(raw.decode('utf-8') or '{}')
        except Exception:
            return self._send(400, {'ok': False, 'error': 'JSON invalido'})

        try:
            if self.path.startswith('/sync_tratativas'):
                result = st.sync_tratativas()
                return self._send(200 if result.get('ok') else 500, result)

            if self.path.startswith('/move_tratativa'):
                card_id = body.get('card_id')
                to_etapa = body.get('to_etapa')
                if not card_id or not to_etapa:
                    return self._send(400, {'ok': False, 'error': 'Informe card_id e to_etapa'})
                result = st.move_tratativa(card_id, to_etapa)
                return self._send(200, {'ok': True, **result})

            self._send(404, {'ok': False, 'error': 'Endpoint inexistente'})
        except Exception as e:
            print(f'[ERRO] {self.path}: {e}')
            self._send(500, {'ok': False, 'error': str(e)})

    def log_message(self, fmt, *args):
        print(f'[{self.command}] {fmt % args}')


if __name__ == '__main__':
    print(f'API local de tratativas em http://{HOST}:{PORT}')
    print('Endpoints: POST /sync_tratativas | POST /move_tratativa | GET /health')
    try:
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print('\nEncerrado.')
