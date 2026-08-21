'''
Busca dados das 4 planilhas das squads (Google Sheets publicas),
normaliza colunas para o formato canonico do Cockpit e gera
tmp/cockpit_normalizado.csv.
'''
import csv
import io
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

BASE = Path(__file__).parent.parent
CSV_OUT = BASE / 'tmp' / 'cockpit_normalizado.csv'

SQUADS = [
    ('wall-street', 'Wall Street', '1zMpTklO0jLCZcMFan_KKTctbgMySRqd_pVxsrHdsz5U'),
    ('monsters-sa', 'Monsters SA', '1Oj971TOsgJQ_3A5sBRGHcEgx53y2r-PuZeOd_E002Ao'),
    ('romans',     'Romans',      '1U7ciY_zNsbb6esFMMgwSOC-R16kFO5Z4ddACdBNhDtA'),
    ('legacy',     'Legacy',      '17y3rdmRMO3moQP9haBJOg5Z8bv-4T4BVtfvMowm3jv8'),
]
GID = 330387776

# Mapeamento: coluna da planilha -> coluna canonica do CSV normalizado
COL_MAP = {
    # --- Colunas comuns (todas as sheets) ---
    'name': 'cliente',
    'Nome do Projeto': 'cliente',           # Legacy
    'Churn realizado': 'churn_realizado',
    'Coordenador': 'coordenador',
    'Coodernador': 'coordenador',           # Legacy (typo)
    'Account': 'account',
    'GT': 'gt',
    'Fee': 'fee',
    'LT ': 'lt',
    'LT': 'lt',
    'Tier': 'tier',
    'ARR': 'arr',
    'Cidade': 'cidade',
    'Segment': 'segment',
    'Modalidade de Vendas': 'modalidade_vendas',
    'Step': 'step',
    'Data Atualizacao dos Dados': 'data_atualizacao',
    'Data Atualizacao dos Dados ': 'data_atualizacao',
    'Data da Atualizacao': 'data_atualizacao',  # Legacy
    'Data de inicio do contrato': 'data_inicio_contrato',
    'Data de vencimento do contrato': 'data_vencimento_contrato',
    'Data de vencimento do Contrato': 'data_vencimento_contrato',  # Legacy

    # --- Flags ---
    'Flag calculada': 'flag_calculada',
    'Flag media': 'flag_media',            # Legacy tem esta coluna
    'Pontuacao ponderada': 'pontuacao_ponderada',
    'Resumo historico (4 semanas)': 'resumo_historico',
    'Resumo Historico (4 semanas)': 'resumo_historico',  # Legacy
    'Customer Care Status': 'customer_care_status',
    'Tem Loop Aberto': 'tem_loop_aberto',
    'Auditado pelo Gerente': 'auditado',
    'Auditado pelo Gerente?': 'auditado',   # Legacy
    'Auditado?': 'auditado_flag',           # Legacy (booleano)

    # --- KRs / MQL ---
    'Meta de MQL': 'meta_mql',             # Legacy
    'Entregas prazo': 'entregas_prazo',    # Legacy
    'Entregas qualidade': 'entregas_qualidade',  # Legacy
    'Relacionamento': 'relacionamento',  # Legacy (booleano)
    'Health Medio': 'health_medio',        # Legacy
    'Resultados': 'resultados',            # Legacy
    'Objetivo Smart': 'objetivo_smart',
    'Definicao de MQL': 'criterio_mql',
    'Qual Criterio de MQL?': 'criterio_mql',  # Legacy
    'Qual Criterio de SQL?': 'criterio_sql',  # Legacy
    'Replanjamento do Q3': 'replanejamentos_q3',  # Legacy
    'KR 1': 'kr1',
    'Realizado KR1': 'realizado_kr1',
    'Pacing KR1': 'pacing_kr1',
    'KR 2': 'kr2',
    'Realizado KR2': 'realizado_kr2',
    'Pacing KR2': 'pacing_kr2',
    'KR 3': 'kr3',
    'Realizado KR3': 'realizado_kr3',
    'Pacing KR3': 'pacing_kr3',

    # --- Notas ---
    'Nota MQL/Demanda': 'nota_mql',
    'Justificativa MQL/Demanda': 'justificativa_mql',
    'Nota Atrasos': 'nota_atrasos',
    'Justificativa Atrasos': 'justificativa_atrasos',
    'Nota Qualidade': 'nota_qualidade',
    'Justificativa Qualidade': 'justificativa_qualidade',
    'Nota Relacionamento': 'nota_relacionamento',
    'Justificativa Relacionamento': 'justificativa_relacionamento',
    'Nota Resultado': 'nota_resultado',
    'Justificativa Resultado': 'justificativa_resultado',

    # --- Planos ---
    'Plano Acao': 'plano_acao',

    # --- Midia ---
    'Total Media Plan': 'total_media_plan',
    'Meta Media Plan': 'meta_media_plan',
    'Google Media Plan': 'google_media_plan',
    'Saldo em Conta Meta': 'saldo_conta_meta',
    'Saldo em Conta Google': 'saldo_conta_google',
    'Verba investida': 'verba_investida',   # Legacy

    # --- CSAT / NPS ---
    'Last CSAT Matriz (m/ano)': 'last_csat_matriz',
    'CSAT atendimento': 'csat_atendimento',
    'CSAT prazo': 'csat_prazo',
    'CSAT resultados': 'csat_resultados',
    'CSAT Copy': 'csat_copy',
    'CSAT Design': 'csat_design',
    'CSAT campanhas': 'csat_campanhas',
    'MHS': 'mhs',
    'NPS': 'nps',

    # --- Links ---
    'Link do Loop (doc)': 'link_loop',
    'Start Plano': 'start_plano',
    'Link projeto Ekyte': 'link_ekyte',
    'Deadline Plano': 'deadline_plano',
    'Link CAC Mapeado': 'link_cac_mapeado',
    'Link do Growthpack': 'link_growthpack',
    'Link PIC': 'link_pic',
    'Link Contrato': 'link_contrato',
    'Link Replanejamento': 'link_replanejamento',
    'Drive do Cliente': 'drive_cliente',     # Legacy
}


# Nomes canonicos: variacoes da mesma pessoa -> nome unico.
# Aplicado aos campos de pessoa (coordenador, account, gt).
NAME_ALIASES = {
    'giullio cesar da silva barbosa': 'Giullio Barbosa',
}


def normalize_person_name(s):
    """Normaliza nome de pessoa via NAME_ALIASES (case-insensitive)."""
    if not s:
        return s
    key = ' '.join(s.lower().split())
    return NAME_ALIASES.get(key, s)


def clean(s):
    """String vazia ou placeholder -> None."""
    if s is None:
        return None
    s = str(s).strip()
    if not s or s.lower() in ('nan', 'none', 'null', '#ref!', '-', '--', 'n/a', '#n/a', 'sem data'):
        return None
    return s


def parse_brl(s):
    """R$ 5.077,00 -> 5077.00 (float)."""
    if not s:
        return None
    s = str(s).strip()
    if not s or s in ('-', '--'):
        return None
    # Remove R$, espacos e substitui , por .
    s = re.sub(r'[R$\s]', '', s)
    # Se tem milhar com ponto (ex: 5.077,00)
    if re.match(r'^[\d.,]+$', s):
        # Remove pontos de milhar, troca virgula decimal por ponto
        s = re.sub(r'\.(?=\d{3})', '', s).replace(',', '.')
        try:
            return float(s)
        except ValueError:
            return None
    return None


def parse_date_br(s):
    """dd/MM/yyyy -> yyyy-MM-dd. Invalido -> None."""
    if not s:
        return None
    s = str(s).strip()
    if not s or s in ('-', '--'):
        return None
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', s)
    if m:
        day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if month < 1 or month > 12:
            return None
        import calendar
        if day < 1 or day > calendar.monthrange(year, month)[1]:
            return None
        return f'{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}'
    return None


# Colunas que sao monetarias e precisam de parse_brl
MONEY_COLS = {
    'fee', 'arr', 'total_media_plan', 'meta_media_plan', 'google_media_plan',
    'saldo_conta_meta', 'saldo_conta_google', 'verba_investida'
}
NUMERIC_COLS = {
    'health_medio', 'pontuacao_ponderada', 'nota_mql', 'nota_atrasos',
    'nota_qualidade', 'nota_relacionamento', 'nota_resultado',
    'csat_atendimento', 'csat_prazo', 'csat_resultados', 'csat_copy',
    'csat_design', 'csat_campanhas', 'nps'
}
DATE_COLS = {
    'data_atualizacao', 'data_inicio_contrato', 'data_vencimento_contrato',
    'start_plano', 'deadline_plano', 'last_csat_matriz', 'data_ultima_auditoria'
}


def normalize_key(k):
    """Normaliza header: strip, remove acentos, subst ç→c."""
    s = k.strip()
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return s


def fetch_all():
    all_rows = []
    total = 0

    for squad_id, squad_label, sheet_id in SQUADS:
        url = f'https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={GID}'
        print(f'  {squad_label}... ', end='', flush=True)
        try:
            resp = urllib.request.urlopen(url, timeout=30)
            body = resp.read().decode('utf-8')
            reader = csv.DictReader(io.StringIO(body))
            # Normaliza as chaves do header
            reader.fieldnames = [normalize_key(fn) for fn in reader.fieldnames]

            count = 0
            for row in reader:
                payload = {'squad_id': squad_id}
                nome = clean(row.get('name') or row.get('Nome do Projeto'))
                if not nome:
                    continue
                payload['cliente'] = nome

                for sheet_col, db_col in COL_MAP.items():
                    v = clean(row.get(sheet_col))
                    if v is None:
                        continue
                    if db_col in MONEY_COLS:
                        parsed = parse_brl(v)
                        if parsed is not None:
                            payload[db_col] = parsed
                        # Se parse falhou, mantem original
                    elif db_col in NUMERIC_COLS:
                        parsed = parse_brl(v)
                        if parsed is not None:
                            payload[db_col] = parsed
                    elif db_col in DATE_COLS:
                        payload[db_col] = parse_date_br(v)
                    elif db_col in ('coordenador', 'account', 'gt'):
                        payload[db_col] = normalize_person_name(v)
                    else:
                        payload[db_col] = v

                all_rows.append(payload)
                count += 1

            print(f'{count} linhas ok')
            total += count

        except Exception as e:
            print(f'ERRO: {e}')

    return all_rows


def save_csv(rows):
    """Salva todas as linhas no CSV normalizado."""
    # Coleta todas as colunas presentes
    cols = set()
    for r in rows:
        cols.update(r.keys())
    cols = ['squad_id', 'cliente'] + sorted(c for c in cols if c not in ('squad_id', 'cliente'))

    with open(CSV_OUT, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)

    print(f'\n  Total: {len(rows)} clientes salvos em {CSV_OUT}')


if __name__ == '__main__':
    print('Buscando planilhas...')
    data = fetch_all()
    if data:
        save_csv(data)
    else:
        print('Nenhum dado encontrado!')
        sys.exit(1)
