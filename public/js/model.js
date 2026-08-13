/**
 * Model — estado, filtros e agregacoes.
 * Centraliza regras de negocio, separado da View.
 */
import { DB } from './supabase.js'

export const state = {
  user: null,
  profile: null,
  clientes: [],
  filtered: [],
  filters: {
    squad_id: null,
    coordenador: null,
    account: null,
    gt: null,
    tier: null,
    churn: 'Nao',
    data_inicio: null,
    data_fim: null,
    search: '',
  },
  sort: { col: 'nome', dir: 'asc' },
  pagination: { page: 1, perPage: 25 },
  cache: {
    squads: [],
    coordenadores: [],
    accounts: [],
    gts: [],
  },
  // Colunas visiveis (chave: user_id, valor: Set de keys)
  visibleColumns: new Set(),
}

export async function loadUser() {
  state.user = await DB.getUser()
  if (state.user) {
    state.profile = await DB.getProfile(state.user.id)
  }
}

export async function loadAll() {
  // Carrega em paralelo, mas se um falhar, nao derruba tudo
  const safe = async (fn, label) => {
    try {
      return await fn()
    } catch (e) {
      console.error(`[loadAll] erro em ${label}:`, e.message)
      return []
    }
  }
  const [clientes, squads, coordenadores, accounts, gts] = await Promise.all([
    safe(() => DB.getClientes(), 'clientes'),
    safe(() => DB.getSquads(), 'squads'),
    safe(() => DB.getCoordenadores(), 'coordenadores'),
    safe(() => DB.getAccounts(), 'accounts'),
    safe(() => DB.getGTs(), 'gts'),
  ])
  state.clientes = clientes || []
  state.cache.squads = squads || []
  state.cache.coordenadores = coordenadores || []
  state.cache.accounts = accounts || []
  state.cache.gts = gts || []
}

export function applyFilters() {
  const f = state.filters
  let r = state.clientes

  if (f.squad_id) r = r.filter(c => c.squad_id === f.squad_id)
  if (f.coordenador) r = r.filter(c => c.coordenador === f.coordenador)
  if (f.account) r = r.filter(c => c.account === f.account)
  if (f.gt) r = r.filter(c => c.gt === f.gt)
  if (f.tier) r = r.filter(c => c.tier === f.tier)
  if (f.churn) {
    const isChurned = (c) => {
      const v = String(c.churn_realizado ?? '').trim().toLowerCase()
      return v === 'sim' || v === 'true' || v === '1' || v === 'yes'
    }
    r = r.filter(c => f.churn === 'Sim' ? isChurned(c) : !isChurned(c))
  }
  if (f.data_inicio) r = r.filter(c => c.data_atualizacao && c.data_atualizacao >= f.data_inicio)
  if (f.data_fim) r = r.filter(c => c.data_atualizacao && c.data_atualizacao <= f.data_fim)
  if (f.search) {
    const s = f.search.toLowerCase()
    r = r.filter(c => c.nome?.toLowerCase().includes(s) || c.gt?.toLowerCase().includes(s))
  }

  // Sort
  const { col, dir } = state.sort
  r = [...r].sort((a, b) => {
    const va = a[col] ?? ''
    const vb = b[col] ?? ''
    if (typeof va === 'number' && typeof vb === 'number') {
      return dir === 'asc' ? va - vb : vb - va
    }
    return dir === 'asc'
      ? String(va).localeCompare(String(vb), 'pt-BR')
      : String(vb).localeCompare(String(va), 'pt-BR')
  })

  state.filtered = r
  state.pagination.page = 1
}

export function getPage() {
  const { page, perPage } = state.pagination
  const start = (page - 1) * perPage
  return state.filtered.slice(start, start + perPage)
}

export function getTotalPages() {
  return Math.max(1, Math.ceil(state.filtered.length / state.pagination.perPage))
}

export function getKPIs() {
  const r = state.filtered
  const total = r.length
  const totalFee = r.reduce((s, c) => s + (c.fee || 0), 0)
  const totalArr = r.reduce((s, c) => s + (c.arr || 0), 0)
  const ativos = r.filter(c => c.churn_realizado !== 'Sim').length
  const churns = r.filter(c => c.churn_realizado === 'Sim').length
  const porSquad = {}
  for (const c of r) {
    porSquad[c.squad_id] = (porSquad[c.squad_id] || 0) + 1
  }
  return { total, totalFee, totalArr, ativos, churns, porSquad }
}

export function uniqueValues(field) {
  return [...new Set(state.clientes.map(c => c[field]).filter(Boolean))].sort()
}

export function setFilter(key, value) {
  state.filters[key] = value || null
}

export function clearFilters() {
  state.filters = {
    squad_id: null,
    coordenador: null,
    account: null,
    gt: null,
    tier: null,
    churn: 'Nao',
    data_inicio: null,
    data_fim: null,
    search: '',
  }
}

export function setSort(col) {
  if (state.sort.col === col) {
    state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc'
  } else {
    state.sort = { col, dir: 'asc' }
  }
}

export function setPage(n) {
  const tp = getTotalPages()
  state.pagination.page = Math.max(1, Math.min(tp, n))
}

// ── Colunas visiveis ──
const STORAGE_KEY = 'cockpit_visible_columns'

export function getUserKey() {
  return state.profile?.id || 'default'
}

export function loadVisibleColumns() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const all = raw ? JSON.parse(raw) : {}
    const key = getUserKey()
    const saved = all[key]
    if (saved === undefined || saved === null) {
      // Primeira vez: usa defaultVisible de cada coluna
      state.visibleColumns = new Set()  // vazio = usa padrao
    } else {
      state.visibleColumns = new Set(saved)
    }
  } catch (e) {
    state.visibleColumns = new Set()
  }
}

export function saveVisibleColumns() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const all = raw ? JSON.parse(raw) : {}
    all[getUserKey()] = [...state.visibleColumns]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch (e) {}
}

export function toggleColumn(key) {
  if (state.visibleColumns.has(key)) {
    state.visibleColumns.delete(key)
  } else {
    state.visibleColumns.add(key)
  }
  saveVisibleColumns()
}

export function setVisibleColumns(keys) {
  state.visibleColumns = new Set(keys)
  saveVisibleColumns()
}

// COLUMNS_REGISTRY: setado pelo view.js no boot
let COLUMNS_REGISTRY = []

export function setColumnsRegistry(cols) {
  COLUMNS_REGISTRY = cols
}

export function getColumnsRegistry() {
  return COLUMNS_REGISTRY
}

export function isColumnVisible(key) {
  // _actions sempre visivel
  if (key === '_actions') return true
  // Se nunca escolheu (vazio), usa defaultVisible da coluna
  if (state.visibleColumns.size === 0) {
    const col = COLUMNS_REGISTRY.find(c => c.key === key)
    return col?.defaultVisible === true
  }
  return state.visibleColumns.has(key)
}

// Helpers para acoes em massa
export function getDefaultVisibleKeys() {
  return COLUMNS_REGISTRY.filter(c => c.defaultVisible && c.key !== '_actions').map(c => c.key)
}

export function getAllColumnKeys() {
  return COLUMNS_REGISTRY.filter(c => c.key !== '_actions').map(c => c.key)
}

export function isAllColumnsVisible() {
  if (state.visibleColumns.size === 0) {
    // No padrao: so as default visiveis
    return false
  }
  const all = getAllColumnKeys()
  return all.every(k => state.visibleColumns.has(k))
}
