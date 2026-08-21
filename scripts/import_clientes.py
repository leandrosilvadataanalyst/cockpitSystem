"""
Importa os 140 clientes do CSV normalizado para o Supabase.

Uso:
    1. Preencha o .env (copia de .env.example) com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
    2. Execute os arquivos SQL 01, 02 e 03 no SQL Editor do Supabase (nessa ordem)
    3. Rode: python scripts/import_clientes.py
"""
import os
import sys
import csv
import json
import logging
from pathlib import Path
from datetime import datetime

# Adiciona raiz do projeto ao path
BASE = Path(__file__).parent.parent
sys.path.insert(0, str(BASE))

try:
    from supabase import create_client
except ImportError:
    print("Instale: pip install supabase python-dotenv")
    sys.exit(1)

from config import Env

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("import")


# Mapeamento: coluna CSV (snake_case canonico) -> coluna tabela clientes
COL_MAP = {
    "id_externo": "id_externo",
    "cliente": "nome",
    "data_atualizacao": "data_atualizacao",
    "coordenador": "coordenador",
    "account": "account",
    "gt": "gt",
    "fee": "fee",
    "lt": "lt",
    "tier": "tier",
    "arr": "arr",
    "cidade": "cidade",
    "segment": "segmento",
    "modalidade_vendas": "modalidade_vendas",
    "step": "step",
    "status": "status",
    "prioridade": "prioridade",
    "produto_2": "produto_2",
    "produto_3": "produto_3",
    "tempo_contrato": "tempo_contrato",
    "data_inicio_contrato": "data_inicio_contrato",
    "data_vencimento_contrato": "data_vencimento_contrato",
    "churn_realizado": "churn_realizado",
    "flag_calculada": "flag_calculada",
    "flag_media": "flag_media",
    "health_medio": "health_medio",
    "pontuacao_ponderada": "pontuacao_ponderada",
    "nota_mql": "nota_mql",
    "nota_atrasos": "nota_atrasos",
    "nota_qualidade": "nota_qualidade",
    "nota_relacionamento": "nota_relacionamento",
    "nota_resultado": "nota_resultado",
    "justificativa_mql": "justificativa_mql",
    "justificativa_atrasos": "justificativa_atrasos",
    "justificativa_qualidade": "justificativa_qualidade",
    "justificativa_relacionamento": "justificativa_relacionamento",
    "justificativa_resultado": "justificativa_resultado",
    "objetivo_smart": "objetivo_smart",
    "meta_mql": "meta_mql",
    "kr1": "kr1",
    "realizado_kr1": "realizado_kr1",
    "pacing_kr1": "pacing_kr1",
    "kr2": "kr2",
    "realizado_kr2": "realizado_kr2",
    "pacing_kr2": "pacing_kr2",
    "kr3": "kr3",
    "realizado_kr3": "realizado_kr3",
    "pacing_kr3": "pacing_kr3",
    "plano_acao": "plano_acao",
    "resumo_historico": "resumo_historico",
    "resultados": "resultados",
    "customer_care_status": "customer_care_status",
    "tem_loop_aberto": "tem_loop_aberto",
    "link_loop": "link_loop",
    "start_plano": "start_plano",
    "link_ekyte": "link_ekyte",
    "deadline_plano": "deadline_plano",
    "auditado": "auditado",
    "auditado_flag": "auditado_flag",
    "total_media_plan": "total_media_plan",
    "verba_investida": "verba_investida",
    "meta_media_plan": "meta_media_plan",
    "google_media_plan": "google_media_plan",
    "saldo_conta_meta": "saldo_conta_meta",
    "saldo_conta_google": "saldo_conta_google",
    "forma_pagamento_meta": "forma_pagamento_meta",
    "forma_pagamento_google": "forma_pagamento_google",
    "tem_crm": "tem_crm",
    "gmv_mensal": "gmv_mensal",
    "last_csat_matriz": "last_csat_matriz",
    "csat_atendimento": "csat_atendimento",
    "csat_prazo": "csat_prazo",
    "csat_resultados": "csat_resultados",
    "csat_copy": "csat_copy",
    "csat_design": "csat_design",
    "csat_campanhas": "csat_campanhas",
    "mhs": "mhs",
    "csat_geral": "csat_geral",
    "nps": "nps",
    "link_cac_mapeado": "link_cac_mapeado",
    "link_growthpack": "link_growthpack",
    "link_pic": "link_pic",
    "link_contrato": "link_contrato",
    "link_replanejamento": "link_replanejamento",
    "replanejamentos_q3": "replanejamentos_q3",
    "criterio_mql": "criterio_mql",
    "criterio_sql": "criterio_sql",
    "drive_cliente": "drive_cliente",
    "planejamento_q3": "planejamento_q3",
    "data_ultima_auditoria": "data_ultima_auditoria",
    "entregas_prazo": "entregas_prazo",
    "entregas_qualidade": "entregas_qualidade",
    "relacionamento": "relacionamento_ok",  # renomeado
}

# Colunas booleanas (CSV: 'TRUE'/'FALSE'/vazio)
BOOL_COLS = {"entregas_prazo", "entregas_qualidade", "relacionamento"}

# Nomes canonicos: variacoes da mesma pessoa -> nome unico.
NAME_ALIASES = {
    "giullio cesar da silva barbosa": "Giullio Barbosa",
}


def normalize_person_name(s):
    """Normaliza nome de pessoa via NAME_ALIASES (case-insensitive)."""
    if not s:
        return s
    key = " ".join(str(s).lower().split())
    return NAME_ALIASES.get(key, s)


def parse_bool(v):
    """Converte 'TRUE'/'FALSE'/vazio para booleano Python."""
    if v is None:
        return None
    s = str(v).strip().upper()
    if s == "TRUE":
        return True
    if s == "FALSE":
        return False
    return None


def clean(v):
    """Limpa string vazia/placeholder -> None."""
    if v is None:
        return None
    s = str(v).strip()
    if not s or s.lower() in ('nan', 'none', 'null', '#ref!', '-', '--', 'n/a', '#n/a', 'sem data'):
        return None
    return s


def row_to_payload(row):
    """Converte uma linha do CSV em payload para insert no Supabase."""
    payload = {"squad_id": clean(row.get("squad_id"))}

    for csv_col, db_col in COL_MAP.items():
        v = row.get(csv_col)
        if v is None:
            continue
        if csv_col in BOOL_COLS:
            payload[db_col] = parse_bool(v)
        elif db_col in ("coordenador", "account", "gt"):
            payload[db_col] = normalize_person_name(v)
        else:
            payload[db_col] = clean(v)

    # Validacoes basicas
    if not payload.get("nome"):
        raise ValueError("cliente sem nome")
    if not payload.get("squad_id"):
        raise ValueError("squad_id vazio")

    return payload


def import_clientes(csv_path: Path, batch_size: int = 50):
    """Importa clientes em batches usando UPSERT."""
    Env.validate_service()

    supabase = create_client(Env.SUPABASE_URL, Env.SUPABASE_SERVICE_ROLE_KEY)

    log.info(f"Lendo CSV: {csv_path}")
    if not csv_path.exists():
        log.error(f"Arquivo nao encontrado: {csv_path}")
        sys.exit(1)

    rows = []
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                payload = row_to_payload(row)
                rows.append(payload)
            except ValueError as e:
                log.warning(f"Linha ignorada: {e}  (cliente={row.get('cliente')!r})")

    log.info(f"Total de linhas validas: {len(rows)}")
    if not rows:
        log.warning("Nada para importar")
        return

    # Agrupa por squad
    by_squad = {}
    for r in rows:
        by_squad.setdefault(r["squad_id"], []).append(r)

    for squad_id, squad_rows in sorted(by_squad.items()):
        log.info(f"Importando squad={squad_id}: {len(squad_rows)} registros")

        # UPSERT em batches (chave: squad_id + nome)
        total_ok = 0
        total_err = 0
        for i in range(0, len(squad_rows), batch_size):
            batch = squad_rows[i:i + batch_size]
            try:
                resp = supabase.table("clientes").upsert(
                    batch, on_conflict="squad_id,nome"
                ).execute()
                total_ok += len(batch)
                log.info(f"  Batch {i // batch_size + 1}: {len(batch)} inseridos")
            except Exception as e:
                total_err += len(batch)
                log.error(f"  Batch {i // batch_size + 1} falhou: {e}")
                # Detalhe do primeiro item que falhou
                for item in batch[:1]:
                    log.error(f"    Exemplo: {item.get('nome')!r}")

        log.info(f"  squad={squad_id}: {total_ok} OK, {total_err} erros")

    # Resumo final
    log.info("Resumo:")
    total = 0
    for squad_id, rows_list in sorted(by_squad.items()):
        n = len(rows_list)
        total += n
        log.info(f"  {squad_id:15s} {n:4d} clientes")
    log.info(f"  TOTAL: {total}")


if __name__ == "__main__":
    csv_path = BASE / "tmp" / "cockpit_normalizado.csv"
    if len(sys.argv) > 1:
        csv_path = Path(sys.argv[1])

    log.info(f"Iniciando importacao em {datetime.now().isoformat()}")
    import_clientes(csv_path)
    log.info("Concluido!")
