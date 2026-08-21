/**
 * Supabase client + DB helpers.
 *
 * IMPORTANTE: este projeto usa o NOVO formato de chaves do Supabase
 * (sb_publishable_ / sb_secret_) que NAO eh JWT. O cliente padrao
 * @supabase/supabase-js@2 espera JWT (eyJ...). Por isso, usamos um
 * fetch wrapper que faz as requisicoes REST diretamente, sem depender
 * do cliente JS.
 */

const SUPABASE_URL = window.SUPABASE_URL || window.location.origin
const API_KEY = window.SUPABASE_ANON_KEY || 'NAO-PRECISA-USA-PROXY'

if (!SUPABASE_URL) {
  console.error('Supabase: configure window.SUPABASE_URL antes de carregar o app.')
}

const headers = {
  'apikey': API_KEY,
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

async function supabaseFetch(path, options = {}) {
  // Se SUPABASE_URL for a URL do Supabase, chama direto.
  // Se for o origin (window.location.origin), usa o proxy /api.
  const useProxy = SUPABASE_URL.startsWith(window.location.origin) || SUPABASE_URL === window.location.origin
  const url = useProxy
    ? `${window.location.origin}/api${path}`
    : `${SUPABASE_URL}/rest/v1${path}`
  console.log('[fetch]', useProxy ? '(proxy)' : '(direct)', url)
  const opts = {
    headers: { ...headers, ...(options.headers || {}) },
    ...options,
  }
  // timeout de 8s
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    console.error('[fetch] TIMEOUT 8s:', url)
    controller.abort()
  }, 8000)
  opts.signal = controller.signal

  try {
    const resp = await fetch(url, opts)
    clearTimeout(timeout)
    console.log('[fetch]', resp.status, url)
    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`HTTP ${resp.status}: ${text}`)
    }
    if (resp.status === 204) return null
    const ct = resp.headers.get('content-type') || ''
    if (ct.includes('json')) return resp.json()
    return null
  } catch (err) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') {
      throw new Error('Timeout ao conectar (8s)')
    }
    throw err
  }
}

/**
 * DB helper - encapsula queries REST ao Supabase.
 */
export const DB = {
  // ── Clientes ──
  async getClientes(filters = {}) {
    const params = new URLSearchParams()
    params.set('select', '*')
    if (filters.squad_id) params.append('squad_id', `eq.${filters.squad_id}`)
    if (filters.coordenador) params.append('coordenador', `eq.${filters.coordenador}`)
    if (filters.account) params.append('account', `eq.${filters.account}`)
    if (filters.gt) params.append('gt', `eq.${filters.gt}`)
    if (filters.tier) params.append('tier', `eq.${filters.tier}`)
    if (filters.search) params.append('nome', `ilike.*${filters.search}*`)
    if (filters.data_inicio) params.append('data_atualizacao', `gte.${filters.data_inicio}`)
    if (filters.data_fim) params.append('data_atualizacao', `lte.${filters.data_fim}`)
    params.append('order', 'nome.asc')
    return supabaseFetch(`/clientes?${params.toString()}`)
  },

  async getCliente(id) {
    return supabaseFetch(`/clientes?id=eq.${id}&select=*`)
      .then(rows => rows?.[0])
  },

  async createCliente(payload) {
    return supabaseFetch('/clientes', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(payload),
    }).then(rows => rows?.[0])
  },

  async updateCliente(id, payload) {
    return supabaseFetch(`/clientes?id=eq.${id}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(payload),
    }).then(rows => rows?.[0])
  },

  async deleteCliente(id) {
    return supabaseFetch(`/clientes?id=eq.${id}`, { method: 'DELETE' })
  },

  // ── Tratativas (espelho Pipefy) ──
  async getTratativas(filters = {}) {
    const params = new URLSearchParams()
    params.set('select', '*')
    if (filters.squad_id) params.append('squad_id', `eq.${filters.squad_id}`)
    if (filters.etapa) params.append('etapa', `eq.${filters.etapa}`)
    if (filters.search) params.append('titulo', `ilike.*${filters.search}*`)
    params.append('order', 'data_atualizacao_etapa.desc')
    return supabaseFetch(`/tratativas?${params.toString()}`)
  },

  async getTratativaHistorico(cardId) {
    return supabaseFetch(`/tratativa_historico?card_id=eq.${cardId}&order=entrou_em.asc`)
  },

  // ── Dimensoes (cache) ──
  async getSquads() {
    return supabaseFetch('/squads?ativo=eq.true&order=label.asc')
  },

  async getCoordenadores(squadId = null) {
    const q = squadId ? `&squad_id=eq.${squadId}` : ''
    return supabaseFetch(`/coordenadores?ativo=eq.true&order=nome.asc${q}`)
  },

  async getAccounts(squadId = null) {
    const q = squadId ? `&squad_id=eq.${squadId}` : ''
    return supabaseFetch(`/accounts?ativo=eq.true&order=nome.asc${q}`)
  },

  async getGTs(squadId = null) {
    const q = squadId ? `&squad_id=eq.${squadId}` : ''
    return supabaseFetch(`/gts?ativo=eq.true&order=nome.asc${q}`)
  },

  // ── User (sempre retorna null: nao usamos auth neste modo) ──
  async getUser() { return null },
  async getProfile() { return null },
  async signIn() { throw new Error('Login desabilitado no modo dev (use anon/service key)') },
  async signOut() {},
}
