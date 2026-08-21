"""Gera public/api/config.js estatico a partir do .env (para XAMPP/Apache).

No Vercel a funcao serverless api/config.js injeta as env vars.
No XAMPP o Apache nao executa serverless: geramos um arquivo estatico
que define window.SUPABASE_URL e window.SUPABASE_ANON_KEY.

Uso:
    python scripts/gen_config.py
"""
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

try:
    from config import Env
    SUPABASE_URL = Env.SUPABASE_URL.rstrip("/")
    ANON_KEY = Env.SUPABASE_ANON_KEY
except Exception as e:
    print(f"[ERRO] config: {e}")
    sys.exit(1)

if not SUPABASE_URL or not ANON_KEY:
    print("[ERRO] .env incompleto (SUPABASE_URL e SUPABASE_ANON_KEY)")
    sys.exit(1)

out = Path(BASE) / "public" / "api" / "config.js"
out.parent.mkdir(parents=True, exist_ok=True)

content = (
    "// Gerado por scripts/gen_config.py a partir do .env (nao commitar).\n"
    f"window.SUPABASE_URL = {SUPABASE_URL!r};\n"
    f"window.SUPABASE_ANON_KEY = {ANON_KEY!r};\n"
)
out.write_text(content, encoding="utf-8")
print(f"[OK] {out.relative_to(BASE)} gerado ({len(content)} bytes)")