/**
 * Sincroniza cards do pipe de Tratativas (Pipefy) -> Supabase.
 * - Upsert em tratativas (chave: card_id)
 * - Reconstrui historico de fases em tratativa_historico
 *
 * Uso:
 *   Vercel: POST/GET /api/sync_tratativas  (cron ou botao)
 *   Local:  node api/sync_tratativas.js    (le .env da raiz)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { fetchPipePhases, fetchAllCards } = require('./pipefy');

// ── Mini loader de .env (sem dependencias) ──
function loadEnvLocal() {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch (_) {}
}
if (!process.env.VERCEL) loadEnvLocal();

const PIPEFY_PIPE_ID = process.env.PIPEFY_PIPE_ID || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// ── Normalizacao ──
function normKey(k) {
  return String(k || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Candidatos de nome do campo no formulario do Pipefy -> coluna do banco.
// Cada campo e uma lista de matchers (sobre o nome normalizado), testados em ordem.
const eq = t => k => k === t;
const starts = p => k => k.startsWith(p);
const has = f => k => k.includes(f);

const FIELD_MATCHERS = {
  cliente: [eq('cliente'), starts('cliente')],          // 'Cliente'
  squad: [eq('squad')],                                  // 'Squad'
  categoria_step: [eq('produto'), has('produto')],       // 'Produto' (Categoria STEP)
  churn: [has('churn')],                                 // 'Solicitou churn'
  thread_criada: [has('thread')],                        // 'AGORA CRIE UMA THREAD NA WORKSPACE DE CS'
};

/** Pipefy retorna selects/conectores como lista ou JSON-em-string: '["X"]'. */
function unwrapValue(v) {
  if (Array.isArray(v)) v = v[0] ?? '';
  let s = String(v ?? '').trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr) && arr.length) return String(arr[0]);
    } catch (_) {}
  }
  return s;
}

const SQUAD_ENUM = [
  { test: v => v.includes('wall'), id: 'wall-street' },
  { test: v => v.includes('roman'), id: 'romans' },
  { test: v => v.includes('legacy'), id: 'legacy' },
  { test: v => v.includes('monster'), id: 'monsters-sa' },
];

function squadToEnum(v) {
  if (!v) return null;
  const s = normKey(v);
  for (const m of SQUAD_ENUM) if (m.test(s)) return m.id;
  return null;
}

function parseBoolPipefy(v) {
  if (v === true) return true;
  if (v === false || v == null || v === '') return false;
  if (Array.isArray(v)) return parseBoolPipefy(v[0]);
  const s = String(v).trim().toLowerCase();
  return ['true', 'sim', 'yes', '1', 'criada'].includes(s);
}

function toIso(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Mapeia os fields do card para colunas do banco. */
function mapFields(fields) {
  const items = (fields || []).map(f => [normKey(f.name), f.value]);

  const find = (matchers) => {
    for (const m of matchers) {
      for (const [k, v] of items) {
        if (v !== null && v !== undefined && v !== '' && m(k)) return unwrapValue(v);
      }
    }
    return null;
  };

  return {
    cliente: find(FIELD_MATCHERS.cliente),
    squad_id: squadToEnum(find(FIELD_MATCHERS.squad)),
    categoria_step: find(FIELD_MATCHERS.categoria_step),
    churn: find(FIELD_MATCHERS.churn),
    thread_criada: parseBoolPipefy(find(FIELD_MATCHERS.thread_criada)),
  };
}

/** Monta o payload de tratativas a partir do node do card. */
function cardToPayload(card, phaseOrder) {
  const mapped = mapFields(card.fields);
  const hist = card.phases_history || [];

  // Fase atual: entrada sem lastTimeOut; fallback current_phase
  let curEntry = hist.find(h => !h.lastTimeOut);
  if (!curEntry && card.current_phase) {
    curEntry = hist.find(h => h.phase && h.phase.id === card.current_phase.id);
  }

  return {
    card_id: String(card.id),
    url: card.url || null,
    titulo: card.title,
    cliente: mapped.cliente,
    squad_id: mapped.squad_id,
    etapa: (curEntry?.phase?.name) || card.current_phase?.name || 'Caixa de entrada',
    categoria_step: mapped.categoria_step,
    churn: mapped.churn,
    thread_criada: mapped.thread_criada,
    data_criacao: toIso(card.created_at),
    data_atualizacao_etapa: toIso(curEntry ? (curEntry.lastTimeIn || curEntry.firstTimeIn) : null),
    pipefy_updated_at: toIso(card.updated_at),
    synced_at: new Date().toISOString(),
    _history: hist
      .filter(h => {
        const nome = normKey(h.phase?.name);
        if (nome === 'start form') return false;                    // pseudo-fase de abertura
        const ein = toIso(h.firstTimeIn), eout = toIso(h.lastTimeOut);
        if (!eout && ein) return true;                              // fase atual
        return !(ein && eout && ein === eout);                      // nunca visitada = timestamps iguais
      })
      .map(h => ({
        card_id: String(card.id),
        etapa: h.phase?.name || '?',
        ordem_fase: h.phase ? (phaseOrder.get(h.phase.id) ?? null) : null,
        entrou_em: toIso(h.firstTimeIn),
        saiu_em: toIso(h.lastTimeOut),
        duracao_dias: (toIso(h.firstTimeIn) && toIso(h.lastTimeOut))
          ? Math.round(((new Date(h.lastTimeOut) - new Date(h.firstTimeIn)) / 86400000) * 10) / 10
          : null,
        synced_at: new Date().toISOString(),
      })),
  };
}

// ── Supabase REST (service_role) ──
function supaRequest(method, tablePath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(`${SUPABASE_URL}/rest/v1/${tablePath}`);
    const req = https.request(url, {
      method,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(text);
        else reject(new Error(`Supabase ${res.statusCode}: ${text.slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function syncTratativas() {
  const hasSimple = !!process.env.PIPEFY_TOKEN;
  const hasOAuth = !!(process.env.PIPEFY_CLIENT_ID && process.env.PIPEFY_CLIENT_SECRET && process.env.PIPEFY_TOKEN_URL);
  if (!hasSimple && !hasOAuth) {
    throw new Error('Credenciais Pipefy ausentes: defina PIPEFY_TOKEN ou PIPEFY_CLIENT_ID/PIPEFY_CLIENT_SECRET/PIPEFY_TOKEN_URL no .env');
  }
  if (!PIPEFY_PIPE_ID) throw new Error('PIPEFY_PIPE_ID nao configurado (.env)');
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('SUPABASE_URL/SERVICE_ROLE ausentes');

  const log = [];
  const pipe = await fetchPipePhases(PIPEFY_PIPE_ID);
  const phaseOrder = new Map(pipe.phases.map((p, i) => [p.id, i]));
  log.push(`Pipe "${pipe.name}" com ${pipe.phases.length} fases`);

  const cards = await fetchAllCards(PIPEFY_PIPE_ID);
  log.push(`${cards.length} cards encontrados`);
  if (cards.length === 0) return { ok: true, log, imported: 0 };

  const payloads = cards.map(c => cardToPayload(c, phaseOrder));

  // Upsert das tratativas (sem o campo _history)
  let ok = 0;
  for (const p of payloads) {
    const { _history, ...row } = p;
    try {
      await supaRequest('POST', 'tratativas?on_conflict=card_id', [row]);
      ok++;
    } catch (e) {
      log.push(`ERRO upsert card ${p.card_id}: ${e.message}`);
    }
  }
  log.push(`tratativas: ${ok}/${payloads.length} sincronizadas`);

  // Historico: reconstruir por card (delete + insert)
  let histOk = 0;
  for (const p of payloads) {
    try {
      await supaRequest('DELETE', `tratativa_historico?card_id=eq.${p.card_id}`, null);
      if (p._history.length) {
        await supaRequest('POST', 'tratativa_historico', p._history);
      }
      histOk++;
    } catch (e) {
      log.push(`ERRO historico card ${p.card_id}: ${e.message}`);
    }
  }
  log.push(`historico: ${histOk}/${payloads.length} reconstruidos`);

  // Espelha exclusoes: card que saiu do pipe (lixeira) sai do banco.
  // A exclusao SEMPRE acontece no Pipefy; aqui eh apenas reflexo.
  const existentes = JSON.parse(await supaRequest('GET', 'tratativas?select=card_id') || '[]');
  const atuais = new Set(payloads.map(p => p.card_id));
  const removidos = existentes.map(e => e.card_id).filter(id => !atuais.has(id));
  if (removidos.length) {
    await supaRequest('DELETE', `tratativas?card_id=in.(${removidos.join(',')})`);
    // historico correspondente some por ON DELETE CASCADE
  }
  log.push(`${removidos.length} card(s) removido(s) (excluidos no Pipefy)`);

  return { ok: ok === payloads.length, log, imported: ok, total: payloads.length };
}

// ── Handler serverless ──
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: 'Use POST ou GET' }));
  }
  try {
    const result = await syncTratativas();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = result.ok ? 200 : 500;
    res.end(JSON.stringify({ ...result, output: result.log.join('\n') }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
};

// ── CLI: node api/sync_tratativas.js ──
if (require.main === module) {
  syncTratativas()
    .then(r => { console.log(r.log.join('\n')); process.exit(r.ok ? 0 : 1); })
    .catch(e => { console.error('[ERRO]', e.message); process.exit(1); });
}
