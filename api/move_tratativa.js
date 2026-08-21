/**
 * Move um card de tratativa para outra etapa:
 *   1. Mutation moveCardToPhase no Pipefy (fonte da verdade)
 *   2. Atualiza tratativas (etapa + data_atualizacao_etapa)
 *   3. Fecha a entrada atual do historico e abre a nova
 *
 * Uso: POST /api/move_tratativa  { card_id, to_etapa }
 */
const https = require('https');
const { fetchPipePhases, moveCardToPhase } = require('./pipefy');

// Mini loader de .env (fora da Vercel)
function loadEnvLocal() {
  if (process.env.VERCEL) return;
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) {}
}
loadEnvLocal();

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function supa(method, tablePath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(`${SUPABASE_URL}/rest/v1/${tablePath}`, {
      method,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(text ? JSON.parse(text) : null);
        else reject(new Error(`Supabase ${res.statusCode}: ${text.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function moveTratativa(cardId, toEtapa) {
  if (!cardId || !toEtapa) throw new Error('Parametros obrigatorios: card_id, to_etapa');
  const pipeId = process.env.PIPEFY_PIPE_ID;
  if (!pipeId) throw new Error('PIPEFY_PIPE_ID nao configurado');

  // 1. Resolve fase destino pelo nome
  const pipe = await fetchPipePhases(pipeId);
  const fase = pipe.phases.find(p => p.name.toLowerCase() === String(toEtapa).toLowerCase());
  if (!fase) throw new Error(`Etapa "${toEtapa}" nao existe no pipe`);
  const ordemFase = pipe.phases.indexOf(fase);

  // 2. Move no Pipefy (fonte da verdade; falha aborta tudo)
  await moveCardToPhase(cardId, fase.id);

  // 3. Reflete no banco
  const now = new Date().toISOString();
  await supa('PATCH', `tratativas?card_id=eq.${cardId}`, {
    etapa: fase.name,
    data_atualizacao_etapa: now,
    synced_at: now,
  });

  // Fecha entrada aberta do historico
  const aberta = await supa('GET', `tratativa_historico?card_id=eq.${cardId}&saiu_em=is.null&select=id,entrou_em`);
  if (Array.isArray(aberta) && aberta.length) {
    for (const h of aberta) {
      const dur = Math.round(((new Date(now) - new Date(h.entrou_em)) / 86400000) * 10) / 10;
      await supa('PATCH', `tratativa_historico?id=eq.${h.id}`, { saiu_em: now, duracao_dias: dur });
    }
  }

  // Abre nova entrada
  await supa('POST', 'tratativa_historico', [{
    card_id: String(cardId),
    etapa: fase.name,
    ordem_fase: ordemFase,
    entrou_em: now,
    synced_at: now,
  }]);

  return { card_id: String(cardId), etapa: fase.name, data_atualizacao_etapa: now };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: 'Use POST' }));
  }

  const chunks = [];
  req.on('data', d => chunks.push(d));
  req.on('end', async () => {
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}'); } catch (_) {}
    try {
      const result = await moveTratativa(body.card_id, body.to_etapa);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (e) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
};
