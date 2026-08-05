"""Carrega variaveis de ambiente do .env (uso: from config import env)."""
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    BASE = Path(__file__).parent
    load_dotenv(BASE / ".env")
except ImportError:
    pass


class Env:
    SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
    SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "").strip()
    SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    @classmethod
    def validate_public(cls):
        missing = []
        if not cls.SUPABASE_URL:
            missing.append("SUPABASE_URL")
        if not cls.SUPABASE_ANON_KEY:
            missing.append("SUPABASE_ANON_KEY")
        if missing:
            raise RuntimeError(
                f"Configure as variaveis no .env: {', '.join(missing)}"
            )

    @classmethod
    def validate_service(cls):
        cls.validate_public()
        if not cls.SUPABASE_SERVICE_ROLE_KEY:
            raise RuntimeError(
                "SUPABASE_SERVICE_ROLE_KEY nao configurada (necessaria para migracoes)"
            )


env = Env()
