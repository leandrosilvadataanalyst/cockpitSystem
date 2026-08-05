const https = require('https');
const http = require('http');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const SQUADS = [
  { id: 'wall-street', sheetId: '1zMpTklO0jLCZcMFan_KKTctbgMySRqd_pVxsrHdsz5U' },
  { id: 'monsters-sa', sheetId: '1Oj971TOsgJQ_3A5sBRGHcEgx53y2r-PuZeOd_E002Ao' },
  { id: 'romans', sheetId: '1U7ciY_zNsbb6esFMMgwSOC-R16kFO5Z4ddACdBNhDtA' },
  { id: 'legacy', sheetId: '17y3rdmRMO3moQP9haBJOg5Z8bv-4T4BVtfvMowm3jv8' },
];
const GID = 330387776;

const COL_MAP = {
  'name': 'cliente',
  'Nome do Projeto': 'cliente',
  'Churn realizado': 'churn_realizado',
  'Coordenador': 'coordenador',
  'Coodernador': 'coordenador',
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
  'Data da Atualizacao': 'data_atualizacao',
  'Data de inicio do contrato': 'data_inicio_contrato',
  'Data de vencimento do contrato': 'data_vencimento_contrato',
  'Data de vencimento do Contrato': 'data_vencimento_contrato',
  'Flag calculada': 'flag_calculada',
  'Flag media': 'flag_media',
  'Pontuacao ponderada': 'pontuacao_ponderada',
  'Resumo historico (4 semanas)': 'resumo_historico',
  'Resumo Historico (4 semanas)': 'resumo_historico',
  'Customer Care Status': 'customer_care_status',
  'Tem Loop Aberto': 'tem_loop_aberto',
  'Auditado pelo Gerente': 'auditado',
  'Auditado pelo Gerente?': 'auditado',
  'Auditado?': 'auditado_flag',
  'Meta de MQL': 'meta_mql',
  'Entregas prazo': 'entregas_prazo',
  'Entregas qualidade': 'entregas_qualidade',
  'Relacionamento': 'relacionamento',
  'Health Medio': 'health_medio',
  'Resultados': 'resultados',
  'Objetivo Smart': 'objetivo_smart',
  'Definicao de MQL': 'criterio_mql',
  'Qual Criterio de MQL?': 'criterio_mql',
  'Qual Criterio de SQL?': 'criterio_sql',
  'Replanjamento do Q3': 'replanejamentos_q3',
  'KR 1': 'kr1',
  'Realizado KR1': 'realizado_kr1',
  'Pacing KR1': 'pacing_kr1',
  'KR 2': 'kr2',
  'Realizado KR2': 'realizado_kr2',
  'Pacing KR2': 'pacing_kr2',
  'KR 3': 'kr3',
  'Realizado KR3': 'realizado_kr3',
  'Pacing KR3': 'pacing_kr3',
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
  'Plano Acao': 'plano_acao',
  'Total Media Plan': 'total_media_plan',
  'Meta Media Plan': 'meta_media_plan',
  'Google Media Plan': 'google_media_plan',
  'Saldo em Conta Meta': 'saldo_conta_meta',
  'Saldo em Conta Google': 'saldo_conta_google',
  'Verba investida': 'verba_investida',
  'Last CSAT Matriz (m/ano)': 'last_csat_matriz',
  'CSAT atendimento': 'csat_atendimento',
  'CSAT prazo': 'csat_prazo',
  'CSAT resultados': 'csat_resultados',
  'CSAT Copy': 'csat_copy',
  'CSAT Design': 'csat_design',
  'CSAT campanhas': 'csat_campanhas',
  'MHS': 'mhs',
  'NPS': 'nps',
  'Link do Loop (doc)': 'link_loop',
  'Start Plano': 'start_plano',
  'Link projeto Ekyte': 'link_ekyte',
  'Deadline Plano': 'deadline_plano',
  'Link CAC Mapeado': 'link_cac_mapeado',
  'Link do Growthpack': 'link_growthpack',
  'Link PIC': 'link_pic',
  'Link Contrato': 'link_contrato',
  'Link Replanejamento': 'link_replanejamento',
  'Drive do Cliente': 'drive_cliente',
};

const MONEY_COLS = new Set(['fee', 'arr', 'total_media_plan', 'meta_media_plan', 'google_media_plan', 'saldo_conta_meta', 'saldo_conta_google', 'verba_investida']);
const DATE_COLS = new Set(['data_atualizacao', 'data_inicio_contrato', 'data_vencimento_contrato', 'start_plano', 'deadline_plano', 'last_csat_matriz', 'data_ultima_auditoria']);

const DB_COL_MAP = {
  'cliente': 'nome',
  'segment': 'segmento',
  'relacionamento': 'relacionamento_ok',
};
const BOOL_COLS = new Set(['entregas_prazo', 'entregas_qualidade', 'relacionamento']);

function clean(s) {
  if (s === null || s === undefined) return null;
  s = String(s).trim();
  if (!s || ['nan', 'none', 'null', '#ref!'].includes(s.toLowerCase())) return null;
  return s;
}

function parseBrl(s) {
  if (!s) return null;
  s = String(s).trim();
  if (!s) return null;
  s = s.replace(/[R$\s]/g, '');
  if (!/^[\d.,]+$/.test(s)) return null;
  s = s.replace(/\.(?=\d{3})/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseDateBr(s) {
  if (!s) return null;
  s = String(s).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s;
}

function parseBool(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toUpperCase();
  if (s === 'TRUE') return true;
  if (s === 'FALSE') return false;
  return null;
}

function parseCSV(text) {
  const rows = [];
  let i = 0;
  let field = '';
  let row = [];
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++;
    } else {
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.length > 0 && r.some(c => c !== '')).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] || ''; });
    return obj;
  });
}

function normalizeKey(k) {
  return String(k).trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function supabaseUpsert(table, rows) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(rows);
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    const proto = SUPABASE_URL.startsWith('https') ? https : http;
    const req = proto.request(url, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') });
        } else {
          reject(new Error(`Supabase ${res.statusCode}: ${Buffer.concat(chunks).toString('utf-8')}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function rowToPayload(row, squadId) {
  const payload = { squad_id: squadId };
  const nome = clean(row['name'] || row['Nome do Projeto']);
  if (!nome) return null;
  payload.cliente = nome;

  for (const [sheetCol, dbCol] of Object.entries(COL_MAP)) {
    const v = clean(row[sheetCol]);
    if (v === null) continue;
    if (MONEY_COLS.has(dbCol)) {
      const n = parseBrl(v);
      if (n !== null) payload[dbCol] = n;
    } else if (DATE_COLS.has(dbCol)) {
      payload[dbCol] = parseDateBr(v);
    } else {
      payload[dbCol] = v;
    }
  }

  const out = { squad_id: payload.squad_id };
  for (const [k, v] of Object.entries(payload)) {
    const dbCol = DB_COL_MAP[k] || k;
    if (BOOL_COLS.has(k)) {
      out[dbCol] = parseBool(v);
    } else {
      out[dbCol] = v;
    }
  }
  if (!out.nome) throw new Error('cliente sem nome');
  return out;
}

async function fetchSquad(squad) {
  const url = `https://docs.google.com/spreadsheets/d/${squad.sheetId}/export?format=csv&gid=${GID}`;
  const csv = await fetchUrl(url);
  const rows = parseCSV(csv);
  const normalized = rows.map(r => {
    const o = {};
    for (const [k, v] of Object.entries(r)) o[normalizeKey(k)] = v;
    return o;
  });
  const payloads = [];
  for (const r of normalized) {
    try {
      const p = rowToPayload(r, squad.id);
      if (p) payloads.push(p);
    } catch (_) {}
  }
  return payloads;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: 'Use POST ou GET' }));
  }

  const log = [];
  try {
    const all = [];
    for (const squad of SQUADS) {
      log.push(`Buscando ${squad.id}...`);
      try {
        const rows = await fetchSquad(squad);
        log.push(`  ${squad.id}: ${rows.length} clientes`);
        all.push(...rows);
      } catch (e) {
        log.push(`  ${squad.id} ERRO: ${e.message}`);
      }
    }

    if (all.length === 0) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: 'Nenhum dado encontrado', output: log.join('\n') }));
    }

    const bySquad = {};
    for (const r of all) {
      (bySquad[r.squad_id] = bySquad[r.squad_id] || []).push(r);
    }

    let totalOk = 0;
    let totalErr = 0;
    for (const [squadId, rows] of Object.entries(bySquad)) {
      log.push(`Upsert ${squadId}: ${rows.length}`);
      const allKeys = new Set();
      for (const r of rows) for (const k of Object.keys(r)) allKeys.add(k);
      const keyList = Array.from(allKeys);
      const normalized = rows.map(r => {
        const o = {};
        for (const k of keyList) o[k] = k in r ? r[k] : null;
        return o;
      });
      try {
        for (let i = 0; i < normalized.length; i += 50) {
          await supabaseUpsert('clientes', normalized.slice(i, i + 50));
        }
        totalOk += rows.length;
        log.push(`  OK`);
      } catch (e) {
        totalErr += rows.length;
        log.push(`  ERRO: ${e.message}`);
      }
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = totalErr === 0 ? 200 : 500;
    res.end(JSON.stringify({
      ok: totalErr === 0,
      output: log.join('\n'),
      imported: totalOk,
      errors: totalErr,
    }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: e.message, output: log.join('\n') }));
  }
};
