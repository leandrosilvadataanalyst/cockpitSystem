/**
 * Cliente GraphQL do Pipefy.
 *
 * Suporta dois modos de autenticacao:
 *   1. Token simples:      PIPEFY_TOKEN
 *   2. OAuth2 (recomendado): PIPEFY_CLIENT_ID + PIPEFY_CLIENT_SECRET + PIPEFY_TOKEN_URL
 *      (fluxo client_credentials: troca credenciais por access token temporario,
 *       com cache em memoria e renovacao automatica ao expirar)
 *
 * Em ambos os casos: PIPEFY_PIPE_ID identifica o pipe.
 */
const https = require('https');

const GRAPHQL_URL = 'https://api.pipefy.com/graphql';

// ── Cache do access token OAuth ──
let oauthCache = { token: null, expiresAt: 0 };

function env(name) {
  return process.env[name] || '';
}

async function postForm(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString();
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          // Nao ecoa credenciais: mensagem curta sem corpo sensivel
          return reject(new Error(`OAuth HTTP ${res.statusCode}`));
        }
        try { resolve(JSON.parse(text)); }
        catch (e) { reject(new Error('Resposta OAuth invalida')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Timeout OAuth')));
    req.write(data);
    req.end();
  });
}

/** Obtem um Bearer token (direto ou via OAuth client_credentials). */
async function getBearerToken() {
  const simpleToken = env('PIPEFY_TOKEN');
  if (simpleToken) return simpleToken;

  const clientId = env('PIPEFY_CLIENT_ID');
  const clientSecret = env('PIPEFY_CLIENT_SECRET');
  const tokenUrl = env('PIPEFY_TOKEN_URL');
  if (!clientId || !clientSecret || !tokenUrl) {
    throw new Error('Credenciais Pipefy ausentes: defina PIPEFY_TOKEN ou PIPEFY_CLIENT_ID/PIPEFY_CLIENT_SECRET/PIPEFY_TOKEN_URL');
  }

  // Renova se expira em menos de 60s
  if (oauthCache.token && Date.now() < oauthCache.expiresAt - 60000) {
    return oauthCache.token;
  }

  let resp;
  try {
    // Padrao RFC 6749: credenciais no corpo form-encoded
    resp = await postForm(tokenUrl, {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
  } catch (e) {
    // Fallback: Basic Auth no header (alguns provedores exigem)
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    resp = await postForm(tokenUrl, { grant_type: 'client_credentials' }, { Authorization: `Basic ${basic}` });
  }

  if (!resp.access_token) throw new Error('OAuth nao retornou access_token');

  oauthCache = {
    token: resp.access_token,
    expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
  };
  return oauthCache.token;
}

function gqlRequest(query, variables = {}) {
  return getBearerToken().then(token => new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode === 401) {
          // Token pode ter revogado: limpa cache para forcar renovacao na proxima
          oauthCache = { token: null, expiresAt: 0 };
          return reject(new Error(`Pipefy HTTP 401 (token invalido/expirado)`));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Pipefy HTTP ${res.statusCode}: ${text.slice(0, 300)}`));
        }
        let json;
        try { json = JSON.parse(text); } catch (e) { return reject(new Error('Resposta invalida do Pipefy')); }
        if (json.errors && json.errors.length) {
          return reject(new Error(`Pipefy GraphQL: ${json.errors.map(e => e.message).join('; ')}`));
        }
        resolve(json.data);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Timeout Pipefy')));
    req.write(body);
    req.end();
  }));
}

const CARD_NODE = `
  id
  title
  url
  created_at
  updated_at
  current_phase { id name }
  fields { name value }
  phases_history {
    phase { id name }
    firstTimeIn
    lastTimeIn
    lastTimeOut
  }
`;

async function fetchPipePhases(pipeId) {
  const data = await gqlRequest(`
    query($id: ID!) {
      pipe(id: $id) { id name phases { id name } }
    }
  `, { id: pipeId });
  if (!data || !data.pipe) throw new Error(`Pipe ${pipeId} nao encontrado`);
  return data.pipe;
}

/** Busca TODOS os cards do pipe (paginado).
 *  Usa a query `cards` (documentada); se vier vazia, tenta `allCards` como fallback. */
async function fetchAllCards(pipeId) {
  const runPaged = async (fieldName) => {
    const cards = [];
    let after = null;
    do {
      const data = await gqlRequest(`
        query($pipe_id: ID!, $after: String) {
          ${fieldName}(pipe_id: $pipe_id, first: 50, after: $after) {
            pageInfo { endCursor hasNextPage }
            edges { node { ${CARD_NODE} } }
          }
        }
      `, { pipe_id: pipeId, after });
      const conn = data[fieldName];
      if (!conn || !Array.isArray(conn.edges)) return null; // campo inexistente na resposta
      for (const edge of conn.edges) cards.push(edge.node);
      after = conn.pageInfo && conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    } while (after);
    return cards;
  };

  let cards = await runPaged('cards');
  if (cards === null || cards.length === 0) {
    const fallback = await runPaged('allCards');
    if (fallback !== null && fallback.length > 0) return fallback;
  }
  return cards || [];
}

/** Move um card para uma fase do pipe (requer escopo de escrita no token). */
function moveCardToPhase(cardId, phaseId) {
  return gqlRequest(`
    mutation($cardId: ID!, $phaseId: ID!) {
      moveCardToPhase(input: { card_id: $cardId, destination_phase_id: $phaseId }) {
        card { id current_phase { id name } }
      }
    }
  `, { cardId: String(cardId), phaseId: String(phaseId) }).then(data => {
    if (!data || !data.moveCardToPhase || !data.moveCardToPhase.card) {
      throw new Error('Pipefy nao confirmou a movimentacao do card');
    }
    return data.moveCardToPhase.card;
  });
}

module.exports = { gqlRequest, fetchPipePhases, fetchAllCards, moveCardToPhase };
