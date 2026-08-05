"""
Servidor de desenvolvimento com PROXY REVERSO para Supabase.
O browser chama /api/* e o Python repassa para o Supabase com a service_role,
contornando a restricao de "secret key in browser" do Supabase.

Inclui workaround para DNS quebrado em Python no Windows: se getaddrinfo
falhar, resolve o hostname via PowerShell e usa IP + Host header.
"""
import http.server
import socketserver
import sys
import json
import urllib.request
import urllib.parse
import socket
import subprocess
from pathlib import Path

BASE = Path(__file__).parent.parent
sys.path.insert(0, str(BASE))

try:
    from config import Env
    Env.validate_service()  # precisa de URL + service_role
    SUPABASE_URL = Env.SUPABASE_URL.rstrip("/")
    SERVICE_KEY = Env.SUPABASE_SERVICE_ROLE_KEY
    print(f"[OK] .env carregado")
    print(f"  URL: {SUPABASE_URL}")
except Exception as e:
    print(f"[ERRO] .env: {e}")
    print(f"  Cele o .env com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

from urllib.parse import urlparse
_supabase_parsed = urlparse(SUPABASE_URL)
SUPABASE_HOST = _supabase_parsed.hostname
SUPABASE_PORT = 443

def _resolve_host_via_powershell(host):
    try:
        cmd = f'(Resolve-DnsName -Name {host} -Type A -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress'
        r = subprocess.run(
            ['powershell', '-NoProfile', '-Command', cmd],
            capture_output=True, text=True, timeout=10
        )
        ip = r.stdout.strip()
        return ip if ip else None
    except Exception:
        return None

SUPABASE_IP = None
try:
    SUPABASE_IP = socket.gethostbyname(SUPABASE_HOST)
except Exception:
    SUPABASE_IP = _resolve_host_via_powershell(SUPABASE_HOST)
    if SUPABASE_IP:
        print(f"  [DNS] resolvido via PowerShell: {SUPABASE_HOST} -> {SUPABASE_IP}")
    else:
        print(f"  [DNS] AVISO: nao foi possivel resolver {SUPABASE_HOST}")


def proxy_supabase(path):
    """
    Faz proxy do request para o Supabase com service_role.
    Com retry em caso de erro transitorio (401 clock skew, etc).
    Se SUPABASE_IP foi resolvido manualmente, usa IP + Host header.
    """
    print(f"  [proxy] {path[:80]}")

    import time
    for attempt in range(5):
        try:
            status = 500
            body = b''
            ct = 'application/json'

            if SUPABASE_IP:
                import http.client
                import ssl
                import socket as _socket
                ctx = ssl.create_default_context()
                sock = _socket.create_connection((SUPABASE_IP, SUPABASE_PORT), timeout=10)
                ssock = ctx.wrap_socket(sock, server_hostname=SUPABASE_HOST)
                conn = http.client.HTTPSConnection(SUPABASE_HOST, SUPABASE_PORT, timeout=10)
                conn.sock = ssock
                conn.putrequest("GET", f"/rest/v1{path}")
                conn.putheader("Host", SUPABASE_HOST)
                conn.putheader("apikey", SERVICE_KEY)
                conn.putheader("Authorization", f"Bearer {SERVICE_KEY}")
                conn.endheaders()
                resp = conn.getresponse()
                body = resp.read()
                ct = resp.getheader("Content-Type", "application/json")
                status = resp.status
                conn.close()
            else:
                target_url = f"{SUPABASE_URL}/rest/v1{path}"
                req = urllib.request.Request(target_url, method="GET")
                req.add_header("apikey", SERVICE_KEY)
                req.add_header("Authorization", f"Bearer {SERVICE_KEY}")
                with urllib.request.urlopen(req, timeout=10) as resp:
                    status = resp.status
                    body = resp.read()
                    ct = resp.headers.get("Content-Type", "application/json")

            # Se 401 por clock skew, espera e tenta de novo
            if status == 401 and attempt < 4:
                delay = 1 + attempt * 1.5
                print(f"  [proxy] 401 (clock skew?), retry {attempt + 1}/5 em {delay:.1f}s...")
                time.sleep(delay)
                continue

            return status, body, ct

        except urllib.error.HTTPError as e:
            if e.code == 401 and attempt < 4:
                delay = 1 + attempt * 1.5
                print(f"  [proxy] 401 (clock skew?), retry {attempt + 1}/5 em {delay:.1f}s...")
                time.sleep(delay)
                continue
            return e.code, e.read(), "application/json"
        except Exception as e:
            if attempt < 4:
                print(f"  [proxy] erro {e}, retry {attempt + 1}/5...")
                time.sleep(0.5)
                continue
            return 500, json.dumps({"error": str(e)}).encode(), "application/json"

    return 500, json.dumps({"error": "max retries"}).encode(), "application/json"


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass  # silencia log

    def do_GET(self):
        # Endpoint de importacao (deve vir ANTES do proxy /api/*)
        if self.path == "/api/import":
            self.handle_import()
            return

        # Servir arquivos estaticos
        if self.path.startswith("/api/"):
            # /api/clientes?select=* -> /clientes?select=*
            api_path = self.path[4:]  # remove /api
            status, body, ct = proxy_supabase(api_path)
            self.send_response(status)
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
            return

        if self.path in ("/", "/index.html"):
            html = (BASE / "index.html").read_text(encoding="utf-8")
            # Aponta o frontend para /api (proxy) em vez de Supabase direto
            html = html.replace(
                "'https://wmjmcrmpsnibwcbmwdig.supabase.co'",
                "window.location.origin"
            )
            html = html.replace("'COLE_SUA_ANON_KEY_AQUI'", "'NAO-PRECISA-USA-PROXY'")

            data = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        # Servir arquivo estatico
        path = (BASE / self.path.lstrip("/")).resolve()
        try:
            if not str(path).startswith(str(BASE.resolve())):
                self.send_response(403)
                self.end_headers()
                return
            if not path.is_file():
                self.send_response(404)
                self.end_headers()
                return
            data = path.read_bytes()
            ext = path.suffix.lower()
            ct = {
                ".js": "application/javascript; charset=utf-8",
                ".mjs": "application/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".html": "text/html; charset=utf-8",
                ".svg": "image/svg+xml",
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".ico": "image/x-icon",
                ".json": "application/json",
            }.get(ext, "application/octet-stream")
            self.send_response(200)
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        except BrokenPipeError:
            pass
        except Exception as e:
            try:
                self.send_response(500)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(str(e).encode())
            except Exception:
                pass


            except Exception:
                pass

    def handle_import(self):
        """Executa o fetch das planilhas + importacao para o Supabase."""
        import subprocess as _sp
        try:
            output_parts = []
            base_dir = str(BASE)

            # 1. Busca dados das planilhas (gera CSV normalizado)
            result1 = _sp.run(
                ["python", str(BASE / "scripts" / "fetch_sheets.py")],
                capture_output=True, text=True, timeout=60,
                cwd=base_dir
            )
            output_parts.append(result1.stdout)
            if result1.stderr:
                output_parts.append("[fetch stderr] " + result1.stderr)

            if result1.returncode != 0:
                data = json.dumps({
                    "ok": False,
                    "output": "\n".join(output_parts).strip(),
                    "error": "Falha ao buscar planilhas"
                }).encode("utf-8")
                status = 500
            else:
                # 2. Importa CSV para o Supabase
                csv_path = str(BASE / "tmp" / "cockpit_normalizado.csv")
                result2 = _sp.run(
                    ["python", str(BASE / "scripts" / "import_clientes.py"), csv_path],
                    capture_output=True, text=True, timeout=60,
                    cwd=base_dir
                )
                output_parts.append(result2.stdout)
                if result2.stderr:
                    output_parts.append("[import stderr] " + result2.stderr)

                ok = result2.returncode == 0
                data = json.dumps({
                    "ok": ok,
                    "output": "\n".join(output_parts).strip()
                }).encode("utf-8")
                status = 200 if ok else 500

        except Exception as e:
            status = 500
            data = json.dumps({"ok": False, "error": str(e)}).encode("utf-8")

        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    socketserver.TCPServer.allow_reuse_address = True
    print(f"\n  Cockpit em http://localhost:{PORT}")
    print(f"  Proxy: /api/* -> {SUPABASE_URL}/rest/v1/*")
    print(f"  Ctrl+C para parar\n")
    try:
        with socketserver.ThreadingTCPServer(("", PORT), H) as srv:
            srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  Bye.")
