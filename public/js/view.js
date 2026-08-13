/**
 * View - DOM rendering.
 * Responsabilidade: pegar dados do model e renderizar.
 * NAO tem regras de negocio aqui.
 */
import { state, getPage, getTotalPages, getKPIs, uniqueValues, isColumnVisible, setColumnsRegistry } from './model.js'

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)

const fmt = {
  money(v) {
    if (v == null) return '-'
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
  },
  num(v, d = 0) {
    if (v == null) return '-'
    return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v)
  },
  date(v) {
    if (!v) return '-'
    const d = new Date(v + 'T00:00:00')
    return d.toLocaleDateString('pt-BR')
  },
  bool(v) {
    if (v === true) return '<span class="pill pill--verde">SIM</span>'
    if (v === false) return '<span class="pill pill--neutro">NAO</span>'
    return '-'
  },
}

function pillForSquad(s) {
  if (!s) return '-'
  return `<span class="pill pill--${s}">${s.toUpperCase()}</span>`
}

function pillForTier(t) {
  if (!t) return '-'
  return `<span class="pill pill--tier-${t}">${t}</span>`
}

// Nomenclatura padrao de flags conforme a planilha Monsters SA.
// Ordem importa: verifica do mais especifico ao generico.
const FLAG_LABELS = [
  { match: /critical/,      label: 'CRITICAL',   cls: 'pill--critico' },
  { match: /danger/,        label: 'DANGER',     cls: 'pill--danger' },
  { match: /vermelho/,      label: 'VERMELHO',   cls: 'pill--critico' },
  { match: /care/,          label: 'CARE',       cls: 'pill--amarelo' },
  { match: /amarelo|yellow/,label: 'AMARELO',    cls: 'pill--amarelo' },
  { match: /safe/,          label: 'SAFE',       cls: 'pill--verde' },
  { match: /verde|green/,   label: 'VERDE',      cls: 'pill--verde' },
  { match: /preenchido/,    label: 'PREENCHIDO', cls: 'pill--preenchido' },
]

function pillForStatus(s) {
  if (!s) return '<span class="pill pill--neutro">-</span>'
  const norm = String(s).toLowerCase().trim()
  for (const f of FLAG_LABELS) {
    if (f.match.test(norm)) return `<span class="pill ${f.cls}">${f.label}</span>`
  }
  return `<span class="pill pill--neutro">${esc(s)}</span>`
}

function esc(s) {
  if (s == null) return ''
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
}

function truncate(s, n = 30) {
  if (!s) return '-'
  s = String(s)
  return s.length > n ? s.slice(0, n - 1) + '...' : s
}

// ═══ COLUNAS (ordem exata da planilha Monsters SA) ═══
// Cada coluna: { key, label, render?, type, width, defaultVisible }
const COLUMNS = [
  // Identificacao
  { key: 'squad_id', label: 'Squad', render: r => pillForSquad(r.squad_id), width: 62, defaultVisible: true },
  { key: 'nome', label: 'Cliente', render: r => `<strong>${esc(r.nome)}</strong>`, width: 200, defaultVisible: true },
  { key: 'fee', label: 'Fee', render: r => fmt.money(r.fee), type: 'numeric', width: 70, defaultVisible: true },
  { key: 'churn_realizado', label: 'Churn', render: r => esc(r.churn_realizado), width: 50, defaultVisible: true },
  { key: 'coordenador', label: 'Coordenador', width: 91, defaultVisible: true },
  { key: 'account', label: 'Account', width: 91, defaultVisible: true },
  { key: 'gt', label: 'GT', width: 91, defaultVisible: true },
  { key: 'data_atualizacao', label: 'Data Atuali.', render: r => fmt.date(r.data_atualizacao), width: 62, defaultVisible: true },
  // KRs / MQL
  { key: 'meta_mql', label: 'Meta MQL', width: 56, defaultVisible: false },
  { key: 'entregas_prazo', label: 'Entr. Prazo', render: r => fmt.bool(r.entregas_prazo), width: 52, defaultVisible: false },
  { key: 'entregas_qualidade', label: 'Entr. Quali.', render: r => fmt.bool(r.entregas_qualidade), width: 52, defaultVisible: false },
  { key: 'relacionamento', label: 'Relac.', render: r => fmt.bool(r.relacionamento_ok), width: 50, defaultVisible: false },
  { key: 'flag_calculada', label: 'Flag Calc.', render: r => pillForStatus(r.flag_calculada), width: 62, defaultVisible: false },
  { key: 'health_medio', label: 'Health', render: r => fmt.num(r.health_medio), type: 'numeric', width: 50, defaultVisible: false },
  { key: 'resultados', label: 'Resultados', render: r => truncate(r.resultados, 40), width: 110, defaultVisible: false },
  { key: 'objetivo_smart', label: 'Obj. Smart', render: r => truncate(r.objetivo_smart, 30), width: 125, defaultVisible: false },
  { key: 'kr1', label: 'KR 1', width: 50, defaultVisible: false },
  { key: 'realizado_kr1', label: 'Real. KR1', width: 56, defaultVisible: false },
  { key: 'pacing_kr1', label: 'Pacing KR1', width: 56, defaultVisible: false },
  { key: 'kr2', label: 'KR 2', width: 50, defaultVisible: false },
  { key: 'realizado_kr2', label: 'Real. KR2', width: 56, defaultVisible: false },
  { key: 'pacing_kr2', label: 'Pacing KR2', width: 56, defaultVisible: false },
  { key: 'kr3', label: 'KR 3', width: 50, defaultVisible: false },
  { key: 'realizado_kr3', label: 'Real. KR3', width: 56, defaultVisible: false },
  { key: 'pacing_kr3', label: 'Pacing KR3', width: 56, defaultVisible: false },
  { key: 'criterio_mql', label: 'Crit. MQL', render: r => truncate(r.criterio_mql, 25), width: 105, defaultVisible: false },
  { key: 'criterio_sql', label: 'Crit. SQL', render: r => truncate(r.criterio_sql, 25), width: 105, defaultVisible: false },
  { key: 'replanejamentos_q3', label: 'Repl. Q3', render: r => truncate(r.replanejamentos_q3, 25), width: 105, defaultVisible: false },
  { key: 'auditado_flag', label: 'Auditado?', width: 50, defaultVisible: false },
  // Notas (DEFAULT VISIVEL - usuario pediu)
  { key: 'nota_mql', label: 'N. MQL', render: r => fmt.num(r.nota_mql, 1), type: 'numeric', width: 50, defaultVisible: true },
  { key: 'justificativa_mql', label: 'Just. MQL', render: r => truncate(r.justificativa_mql, 30), width: 125, defaultVisible: true },
  { key: 'nota_atrasos', label: 'N. Atr.', render: r => fmt.num(r.nota_atrasos, 1), type: 'numeric', width: 50, defaultVisible: true },
  { key: 'justificativa_atrasos', label: 'Just. Atr.', render: r => truncate(r.justificativa_atrasos, 30), width: 125, defaultVisible: true },
  { key: 'nota_qualidade', label: 'N. Quali.', render: r => fmt.num(r.nota_qualidade, 1), type: 'numeric', width: 50, defaultVisible: true },
  { key: 'justificativa_qualidade', label: 'Just. Quali.', render: r => truncate(r.justificativa_qualidade, 30), width: 125, defaultVisible: true },
  { key: 'nota_relacionamento', label: 'N. Relac.', render: r => fmt.num(r.nota_relacionamento, 1), type: 'numeric', width: 50, defaultVisible: true },
  { key: 'justificativa_relacionamento', label: 'Just. Relac.', render: r => truncate(r.justificativa_relacionamento, 30), width: 125, defaultVisible: true },
  { key: 'nota_resultado', label: 'N. Res.', render: r => fmt.num(r.nota_resultado, 1), type: 'numeric', width: 50, defaultVisible: true },
  { key: 'justificativa_resultado', label: 'Just. Res.', render: r => truncate(r.justificativa_resultado, 30), width: 125, defaultVisible: true },
  { key: 'flag_media', label: 'Flag Media', render: r => pillForStatus(r.flag_media), width: 62, defaultVisible: true },
  { key: 'pontuacao_ponderada', label: 'Pont. Pond.', render: r => fmt.num(r.pontuacao_ponderada), type: 'numeric', width: 56, defaultVisible: true },
  { key: 'resumo_historico', label: 'Resumo Hist.', render: r => truncate(r.resumo_historico, 30), width: 125, defaultVisible: true },
  // Loop / Customer care
  { key: 'customer_care_status', label: 'Cust. Care', width: 77, defaultVisible: true },
  { key: 'tem_loop_aberto', label: 'Loop?', width: 50, defaultVisible: false },
  { key: 'link_loop', label: 'Link Loop', render: r => r.link_loop ? `<a href="${esc(r.link_loop)}" target="_blank" rel="noopener">abrir</a>` : '-', width: 50, defaultVisible: false },
  { key: 'start_plano', label: 'Start Plano', render: r => fmt.date(r.start_plano), width: 62, defaultVisible: false },
  { key: 'link_ekyte', label: 'Ekyte', render: r => r.link_ekyte ? `<a href="${esc(r.link_ekyte)}" target="_blank" rel="noopener">abrir</a>` : '-', width: 50, defaultVisible: false },
  { key: 'deadline_plano', label: 'Deadline', render: r => fmt.date(r.deadline_plano), width: 62, defaultVisible: false },
  { key: 'auditado', label: 'Auditado Ger.', width: 70, defaultVisible: false },
  { key: 'step', label: 'Step', width: 50, defaultVisible: false },
  // Midia
  { key: 'total_media_plan', label: 'Total MP', render: r => fmt.money(r.total_media_plan), type: 'numeric', width: 70, defaultVisible: false },
  { key: 'verba_investida', label: 'Verba Inv.', render: r => fmt.money(r.verba_investida), type: 'numeric', width: 70, defaultVisible: false },
  { key: 'meta_media_plan', label: 'Meta MP', render: r => fmt.money(r.meta_media_plan), type: 'numeric', width: 70, defaultVisible: false },
  { key: 'google_media_plan', label: 'Google MP', render: r => fmt.money(r.google_media_plan), type: 'numeric', width: 70, defaultVisible: false },
  { key: 'saldo_conta_meta', label: 'Saldo Meta', render: r => fmt.money(r.saldo_conta_meta), type: 'numeric', width: 70, defaultVisible: false },
  { key: 'saldo_conta_google', label: 'Saldo Google', render: r => fmt.money(r.saldo_conta_google), type: 'numeric', width: 70, defaultVisible: false },
  { key: 'lt', label: 'LT', width: 62, defaultVisible: false },
  // Contrato
  { key: 'data_inicio_contrato', label: 'Inicio Contr.', render: r => fmt.date(r.data_inicio_contrato), width: 70, defaultVisible: false },
  { key: 'data_vencimento_contrato', label: 'Venc. Contr.', render: r => fmt.date(r.data_vencimento_contrato), width: 70, defaultVisible: false },
  // CSAT / NPS
  { key: 'last_csat_matriz', label: 'Last CSAT', width: 56, defaultVisible: false },
  { key: 'csat_atendimento', label: 'CSAT Atend.', render: r => fmt.num(r.csat_atendimento, 1), type: 'numeric', width: 56, defaultVisible: false },
  { key: 'csat_campanhas', label: 'CSAT Camp.', render: r => fmt.num(r.csat_campanhas, 1), type: 'numeric', width: 56, defaultVisible: false },
  { key: 'csat_copy', label: 'CSAT Copy', render: r => fmt.num(r.csat_copy, 1), type: 'numeric', width: 56, defaultVisible: false },
  { key: 'csat_design', label: 'CSAT Des.', render: r => fmt.num(r.csat_design, 1), type: 'numeric', width: 56, defaultVisible: false },
  { key: 'csat_prazo', label: 'CSAT Prazo', render: r => fmt.num(r.csat_prazo, 1), type: 'numeric', width: 56, defaultVisible: false },
  { key: 'csat_resultados', label: 'CSAT Res.', render: r => fmt.num(r.csat_resultados, 1), type: 'numeric', width: 56, defaultVisible: false },
  { key: 'mhs', label: 'MHS', width: 77, defaultVisible: false },
  { key: 'nps', label: 'NPS', render: r => fmt.num(r.nps, 1), type: 'numeric', width: 50, defaultVisible: false },
  // Financeiro
  { key: 'arr', label: 'ARR', render: r => fmt.money(r.arr), type: 'numeric', width: 77, defaultVisible: false },
  { key: 'tier', label: 'Tier', render: r => pillForTier(r.tier), width: 50, defaultVisible: false },
  // Outros
  { key: 'cidade', label: 'Cidade', width: 91, defaultVisible: false },
  { key: 'modalidade_vendas', label: 'Mod. Vendas', width: 77, defaultVisible: false },
  { key: 'segmento', label: 'Segmento', width: 91, defaultVisible: false },
  { key: 'link_cac_mapeado', label: 'CAC Map.', render: r => r.link_cac_mapeado ? `<a href="${esc(r.link_cac_mapeado)}" target="_blank" rel="noopener">abrir</a>` : '-', width: 50, defaultVisible: false },
  { key: 'link_growthpack', label: 'Growthpack', render: r => r.link_growthpack ? `<a href="${esc(r.link_growthpack)}" target="_blank" rel="noopener">abrir</a>` : '-', width: 56, defaultVisible: false },
  { key: 'link_pic', label: 'PIC', render: r => r.link_pic ? `<a href="${esc(r.link_pic)}" target="_blank" rel="noopener">abrir</a>` : '-', width: 50, defaultVisible: false },
  { key: 'link_contrato', label: 'Contrato', render: r => r.link_contrato ? `<a href="${esc(r.link_contrato)}" target="_blank" rel="noopener">abrir</a>` : '-', width: 50, defaultVisible: false },
  // Acoes (sempre no fim)
  { key: '_actions', label: '', width: 76, sortable: false, defaultVisible: true },
]

// Registra colunas no model (para isColumnVisible saber o defaultVisible)
setColumnsRegistry(COLUMNS)


export function render() {
  renderHeader()
  renderFilters()
  renderKPIs()
  renderTable()
  renderPagination()
}

export { loadColumnWidths }

function renderHeader() {
  const u = state.user
  const p = state.profile
  const roleEl = $('#user-role')
  if (u && p) {
    $('#user-name').textContent = p.nome
    roleEl.textContent = p.role.replace('_', ' ')
    roleEl.className = `app-header__role app-header__role--${p.role.split('_')[0]}`
    $('#btn-logout').style.display = ''
    // Sidebar
    const sa = $('#sidebar-user-name')
    const sav = $('#sidebar-avatar')
    if (sa) sa.textContent = p.nome
    if (sav) sav.textContent = (p.nome || '?').charAt(0).toUpperCase()
  } else {
    $('#user-name').textContent = 'Modo dev'
    roleEl.textContent = 'SEM AUTH'
    roleEl.className = 'app-header__role'
    $('#btn-logout').style.display = 'none'
  }
}

function renderFilters() {
  const selSquad = $('#filter-squad')
  selSquad.innerHTML = `<option value="">Todas as squads</option>` +
    state.cache.squads.map(s => `<option value="${esc(s.id)}" ${state.filters.squad_id === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')

  const selCoord = $('#filter-coordenador')
  const coords = state.filters.squad_id
    ? state.cache.coordenadores.filter(c => c.squad_id === state.filters.squad_id)
    : state.cache.coordenadores
  selCoord.innerHTML = `<option value="">Todos</option>` +
    coords.map(c => `<option value="${esc(c.nome)}" ${state.filters.coordenador === c.nome ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')

  const selAcc = $('#filter-account')
  const accs = state.filters.squad_id
    ? state.cache.accounts.filter(a => a.squad_id === state.filters.squad_id)
    : state.cache.accounts
  selAcc.innerHTML = `<option value="">Todas</option>` +
    accs.map(a => `<option value="${esc(a.nome)}" ${state.filters.account === a.nome ? 'selected' : ''}>${esc(a.nome)}</option>`).join('')

  const selGT = $('#filter-gt')
  const gts = state.filters.squad_id
    ? state.cache.gts.filter(g => g.squad_id === state.filters.squad_id)
    : state.cache.gts
  selGT.innerHTML = `<option value="">Todos</option>` +
    gts.map(g => `<option value="${esc(g.nome)}" ${state.filters.gt === g.nome ? 'selected' : ''}>${esc(g.nome)}</option>`).join('')

  const selTier = $('#filter-tier')
  const tiers = uniqueValues('tier')
  selTier.innerHTML = `<option value="">Todos</option>` +
    tiers.map(t => `<option value="${esc(t)}" ${state.filters.tier === t ? 'selected' : ''}>${esc(t)}</option>`).join('')

  const selChurn = $('#filter-churn')
  if (selChurn) selChurn.value = state.filters.churn || ''

  $('#filter-data-inicio').value = state.filters.data_inicio || ''
  $('#filter-data-fim').value = state.filters.data_fim || ''
  $('#filter-search').value = state.filters.search || ''
}

function renderKPIs() {
  const k = getKPIs()
  $('#kpi-total').textContent = fmt.num(k.total)
  $('#kpi-total-sub').textContent = `${k.ativos} ativos - ${k.churns} churn`
  $('#kpi-fee').textContent = fmt.money(k.totalFee)
  $('#kpi-arr').textContent = fmt.money(k.totalArr)
  const parts = Object.entries(k.porSquad)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s.toUpperCase()}: ${n}`)
  $('#kpi-squads').textContent = parts.join(' - ') || '-'
  // Sidebar count
  const scc = $('#sidebar-count-clientes')
  if (scc) scc.textContent = k.total
}

// ── Larguras customizadas das colunas (persistidas) ──
let columnWidths = {}

function loadColumnWidths() {
  try {
    const raw = localStorage.getItem('cockpit_column_widths')
    columnWidths = raw ? JSON.parse(raw) : {}
  } catch (e) {
    columnWidths = {}
  }
}

function saveColumnWidths() {
  try {
    localStorage.setItem('cockpit_column_widths', JSON.stringify(columnWidths))
  } catch (e) {}
}

function getColWidth(col) {
  return columnWidths[col.key] || col.width
}

function renderTable() {
  const page = getPage()
  const total = state.filtered.length
  $('#table-count').textContent = `${total} registro${total !== 1 ? 's' : ''}`

  // Filtra colunas visiveis
  const visibleCols = COLUMNS.filter(col => col.key === '_actions' || isColumnVisible(col.key))

  // Sempre modo tabela (o "expandir/cards" foi removido)
  const scroll = $('.table-scroll')
  if (scroll) {
    scroll.classList.remove('cards-view')
  }

  // Colgroup com larguras explicitas (table-layout: fixed)
  const tableEl = $('.table-scroll table')
  if (tableEl) {
    const colsHtml = visibleCols.map(col => `<col style="width:${getColWidth(col)}px">`).join('')
    let cg = tableEl.querySelector('colgroup')
    if (!cg) {
      cg = document.createElement('colgroup')
      tableEl.insertBefore(cg, tableEl.firstChild)
    }
    cg.innerHTML = colsHtml
  }

  // Cabecalho
  const thead = $('#table-head')
  thead.innerHTML = `<tr>
    ${visibleCols.map(col => {
      const sortable = col.sortable !== false && col.key !== '_actions'
      const sortAttr = sortable ? `data-sort="${esc(col.key)}"` : ''
      const handle = col.key !== '_actions'
        ? `<span class="col-resize" data-col-key="${esc(col.key)}"></span>`
        : ''
      return `<th ${sortAttr} data-col-key="${esc(col.key)}">${esc(col.label)}${handle}</th>`
    }).join('')}
  </tr>`

  // Corpo
  const tbody = $('#table-body')
  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${visibleCols.length}"><div class="empty"><div class="empty__icon">-</div><div class="empty__title">Nenhum registro encontrado</div><div>Ajuste os filtros acima</div></div></td></tr>`
    return
  }

  tbody.innerHTML = page.map(c => `<tr data-id="${esc(c.id)}">${
    visibleCols.map(col => {
      if (col.key === '_actions') {
        return `<td data-label="Acoes"><button class="row-action" data-action="edit" data-id="${esc(c.id)}" title="Editar">&#9998;</button><button class="row-action row-action--danger" data-action="delete" data-id="${esc(c.id)}" title="Excluir">&#128465;</button></td>`
      }
      const val = col.render ? col.render(c) : esc(c[col.key])
      const cls = col.type === 'numeric' ? ' class="numeric"' : ''
      return `<td${cls} data-label="${esc(col.label)}">${val}</td>`
    }).join('')
  }</tr>`).join('')

  // aria-sort
  $$('th[data-sort]').forEach(th => {
    const col = th.dataset.sort
    if (col === state.sort.col) {
      th.setAttribute('aria-sort', state.sort.dir === 'asc' ? 'ascending' : 'descending')
    } else {
      th.removeAttribute('aria-sort')
    }
  })

  // Bind resize handles
  bindColumnResize()
}

// ── Resize de colunas (estilo Excel) ──
function bindColumnResize() {
  const handles = $$('.col-resize')
  handles.forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const key = handle.dataset.colKey
      const th = handle.closest('th')
      const startX = e.clientX
      const startWidth = th.offsetWidth
      const minWidth = 40

      handle.classList.add('col-resize--active')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMove = (ev) => {
        const newWidth = Math.max(minWidth, startWidth + (ev.clientX - startX))
        // Atualiza a largura no objeto
        columnWidths[key] = newWidth
        // Atualiza o <col> correspondente
        const tableEl = $('.table-scroll table')
        const colgroup = tableEl?.querySelector('colgroup')
        const cols = colgroup ? colgroup.querySelectorAll('col') : []
        const ths = tableEl.querySelectorAll('thead th')
        const idx = Array.from(ths).findIndex(t => t.dataset.colKey === key)
        if (idx >= 0 && cols[idx]) {
          cols[idx].style.width = newWidth + 'px'
        }
      }

      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        handle.classList.remove('col-resize--active')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        saveColumnWidths()
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })
  })
}

function renderPagination() {
  const tp = getTotalPages()
  const p = state.pagination.page
  $('#pagination-info').textContent = `Pagina ${p} de ${tp}`
  $('#btn-prev').disabled = p <= 1
  $('#btn-next').disabled = p >= tp
}

export function showModal(title, content, footer = '') {
  console.log('[showModal]', title)
  $('#modal-title').textContent = title
  $('#modal-body').innerHTML = content
  $('#modal-footer').innerHTML = footer
  $('#modal').classList.remove('hidden')
  $('#modal-backdrop').classList.remove('hidden')
  setTimeout(() => {
    const first = $('#modal-body').querySelector('input, select, textarea, button')
    if (first) first.focus()
  }, 50)
}

export function hideModal() {
  $('#modal').classList.add('hidden')
  $('#modal-backdrop').classList.add('hidden')
}

export function showToast(message, type = 'info', duration = 3500) {
  const container = $('#toast-container')
  const t = document.createElement('div')
  t.className = `toast toast--${type}`
  t.textContent = message
  container.appendChild(t)
  setTimeout(() => {
    t.style.opacity = '0'
    setTimeout(() => t.remove(), 300)
  }, duration)
}

export function showLoader(show) {
  $('#loader').classList.toggle('hidden', !show)
}

export function showColumnsModal() {
  // Agrupa colunas por secao (heuristica simples)
  const sections = [
    { title: 'Identificacao', keys: ['squad_id', 'nome', 'fee', 'churn_realizado', 'coordenador', 'account', 'gt', 'data_atualizacao'] },
    { title: 'KRs / MQL', keys: ['meta_mql', 'entregas_prazo', 'entregas_qualidade', 'relacionamento', 'flag_calculada', 'health_medio', 'resultados', 'objetivo_smart', 'kr1', 'realizado_kr1', 'pacing_kr1', 'kr2', 'realizado_kr2', 'pacing_kr2', 'kr3', 'realizado_kr3', 'pacing_kr3', 'criterio_mql', 'criterio_sql', 'replanejamentos_q3', 'auditado_flag'] },
    { title: 'Notas (0-5)', keys: ['nota_mql', 'justificativa_mql', 'nota_atrasos', 'justificativa_atrasos', 'nota_qualidade', 'justificativa_qualidade', 'nota_relacionamento', 'justificativa_relacionamento', 'nota_resultado', 'justificativa_resultado', 'flag_media', 'pontuacao_ponderada', 'resumo_historico'] },
    { title: 'Loop / Customer Care', keys: ['customer_care_status', 'tem_loop_aberto', 'link_loop', 'start_plano', 'link_ekyte', 'deadline_plano', 'auditado', 'step'] },
    { title: 'Midia', keys: ['total_media_plan', 'verba_investida', 'meta_media_plan', 'google_media_plan', 'saldo_conta_meta', 'saldo_conta_google', 'lt'] },
    { title: 'Contrato', keys: ['data_inicio_contrato', 'data_vencimento_contrato'] },
    { title: 'CSAT / NPS', keys: ['last_csat_matriz', 'csat_atendimento', 'csat_campanhas', 'csat_copy', 'csat_design', 'csat_prazo', 'csat_resultados', 'mhs', 'nps'] },
    { title: 'Financeiro / Outros', keys: ['arr', 'tier', 'cidade', 'modalidade_vendas', 'segmento', 'link_cac_mapeado', 'link_growthpack', 'link_pic', 'link_contrato'] },
  ]
  const colByKey = Object.fromEntries(COLUMNS.map(c => [c.key, c]))
  const checked = state.visibleColumns

  const sectionsHtml = sections.map(sec => {
    const items = sec.keys.filter(k => colByKey[k]).map(k => {
      const col = colByKey[k]
      const isChecked = checked.size === 0 ? true : checked.has(k)
      return `<label class="cols-item">
        <input type="checkbox" data-col="${k}" ${isChecked ? 'checked' : ''} />
        <span>${esc(col.label)}</span>
      </label>`
    }).join('')
    return `<div class="cols-section">
      <div class="cols-section__title">${esc(sec.title)}</div>
      <div class="cols-grid">${items}</div>
    </div>`
  }).join('')

  const html = `
    <p style="color: var(--txt-muted); font-size: var(--fs-sm); margin-bottom: var(--s-3)">
      Selecione quais colunas deseja ver. Sua escolha fica salva para este usuario.
    </p>
    <div class="cols-actions">
      <button type="button" class="filter-bar__btn" id="cols-select-all">Marcar todas</button>
      <button type="button" class="filter-bar__btn" id="cols-select-none">Desmarcar todas</button>
      <button type="button" class="filter-bar__btn" id="cols-reset">Resetar (padrao)</button>
    </div>
    ${sectionsHtml}
  `
  const footer = `
    <button class="form__btn form__btn--secondary" id="cols-cancel">Cancelar</button>
    <button class="form__btn form__btn--primary" id="cols-apply">Aplicar</button>
  `
  showModal('Escolher Colunas', html, footer)
}

// ═══ Modal de detalhes / edicao do cliente ═══
export function showClientDetailModal(cliente) {
  const T = (s) => String(s ?? '')

  const field = (key, label, type, opts = {}) => {
    const raw = cliente[key]
    let val
    if (type === 'bool') {
      const s = T(raw).toLowerCase().trim()
      val = (s === 'sim' || s === 'true' || s === '1' || raw === true)
    } else {
      val = raw ?? ''
    }
    // Para campos de data, garante formato yyyy-MM-dd ou string vazia
    if (type === 'date') {
      const s = T(val).trim()
      val = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
    }
    let input
    if (type === 'textarea') {
      input = `<textarea class="detail-input" data-field="${esc(key)}" rows="${opts.rows || 2}">${esc(val)}</textarea>`
    } else if (type === 'select') {
      const options = (opts.options || []).map(o => {
        const ov = typeof o === 'string' ? o : o.value
        const ol = typeof o === 'string' ? o : o.label
        const sel = T(val) === T(ov) ? ' selected' : ''
        return `<option value="${esc(ov)}"${sel}>${esc(ol)}</option>`
      }).join('')
      input = `<select class="detail-input" data-field="${esc(key)}"><option value=""></option>${options}</select>`
    } else if (type === 'bool') {
      input = `<select class="detail-input" data-field="${esc(key)}">
        <option value="false"${!val ? ' selected' : ''}>Nao</option>
        <option value="true"${val ? ' selected' : ''}>Sim</option>
      </select>`
    } else if (type === 'number') {
      input = `<input class="detail-input" type="number" step="${opts.step || '1'}" data-field="${esc(key)}" value="${esc(val)}" />`
    } else if (type === 'date') {
      // Exibe como dd-MM-yyyy, internamente usa yyyy-MM-dd
      const s = T(val).trim()
      const ymd = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
      const dmy = ymd ? `${ymd.slice(8,10)}-${ymd.slice(5,7)}-${ymd.slice(0,4)}` : ''
      input = `<input class="detail-input" type="text" data-field="${esc(key)}" data-format="date-br" value="${esc(dmy)}" placeholder="dd-MM-yyyy" pattern="\\d{2}-\\d{2}-\\d{4}" maxlength="10" />`
    } else if (type === 'url') {
      input = `<input class="detail-input" type="url" data-field="${esc(key)}" value="${esc(val)}" placeholder="https://..." />`
    } else {
      input = `<input class="detail-input" type="text" data-field="${esc(key)}" value="${esc(val)}" />`
    }
    return `<div class="detail-field"><label class="detail-field__label">${esc(label)}</label>${input}</div>`
  }

  const squadOpts = (state.cache.squads || []).map(s => ({ value: s.id, label: s.label }))

  const sections = [
    {
      title: 'Identificacao',
      fields: [
        field('squad_id', 'Squad', 'select', { options: squadOpts }),
        field('nome', 'Cliente', 'text'),
        field('coordenador', 'Coordenador', 'text'),
        field('account', 'Account', 'text'),
        field('gt', 'GT', 'text'),
        field('tier', 'Tier', 'select', { options: ['SMALL', 'MEDIUM', 'LARGE'] }),
        field('data_atualizacao', 'Data atualizacao', 'date'),
      ]
    },
    {
      title: 'Financeiro',
      fields: [
        field('fee', 'Fee (mensal)', 'number', { step: '0.01' }),
        field('arr', 'ARR', 'number', { step: '0.01' }),
        field('churn_realizado', 'Churn', 'bool'),
      ]
    },
    {
      title: 'Status & Flags',
      fields: [
        field('flag_calculada', 'Flag calculada', 'text'),
        field('flag_media', 'Flag media', 'text'),
        field('customer_care_status', 'Customer care', 'text'),
        field('auditado', 'Auditado', 'bool'),
        field('auditado_flag', 'Auditado flag', 'text'),
        field('step', 'Step', 'text'),
        field('tem_loop_aberto', 'Tem loop aberto', 'bool'),
      ]
    },
    {
      title: 'KRs & MQL',
      fields: [
        field('meta_mql', 'Meta MQL', 'text'),
        field('entregas_prazo', 'Entr. prazo', 'bool'),
        field('entregas_qualidade', 'Entr. qualidade', 'bool'),
        field('relacionamento_ok', 'Relacionamento', 'bool'),
        field('health_medio', 'Health medio', 'number', { step: '0.1' }),
        field('kr1', 'KR 1', 'text'),
        field('realizado_kr1', 'Real. KR1', 'text'),
        field('pacing_kr1', 'Pacing KR1', 'text'),
        field('kr2', 'KR 2', 'text'),
        field('realizado_kr2', 'Real. KR2', 'text'),
        field('pacing_kr2', 'Pacing KR2', 'text'),
        field('kr3', 'KR 3', 'text'),
        field('realizado_kr3', 'Real. KR3', 'text'),
        field('pacing_kr3', 'Pacing KR3', 'text'),
        field('criterio_mql', 'Criterio MQL', 'textarea', { rows: 2 }),
        field('criterio_sql', 'Criterio SQL', 'textarea', { rows: 2 }),
        field('replanejamentos_q3', 'Replanejamentos Q3', 'textarea', { rows: 2 }),
      ]
    },
    {
      title: 'Notas (0-5)',
      fields: [
        field('nota_mql', 'N. MQL', 'number', { step: '0.1' }),
        field('justificativa_mql', 'Just. MQL', 'textarea', { rows: 2 }),
        field('nota_atrasos', 'N. Atrasos', 'number', { step: '0.1' }),
        field('justificativa_atrasos', 'Just. Atrasos', 'textarea', { rows: 2 }),
        field('nota_qualidade', 'N. Qualidade', 'number', { step: '0.1' }),
        field('justificativa_qualidade', 'Just. Qualidade', 'textarea', { rows: 2 }),
        field('nota_relacionamento', 'N. Relacionamento', 'number', { step: '0.1' }),
        field('justificativa_relacionamento', 'Just. Relacionamento', 'textarea', { rows: 2 }),
        field('nota_resultado', 'N. Resultado', 'number', { step: '0.1' }),
        field('justificativa_resultado', 'Just. Resultado', 'textarea', { rows: 2 }),
        field('pontuacao_ponderada', 'Pontuacao ponderada', 'number', { step: '0.1' }),
        field('resumo_historico', 'Resumo historico', 'textarea', { rows: 2 }),
      ]
    },
    {
      title: 'Midia',
      fields: [
        field('total_media_plan', 'Total MP', 'number', { step: '0.01' }),
        field('verba_investida', 'Verba investida', 'number', { step: '0.01' }),
        field('meta_media_plan', 'Meta MP', 'number', { step: '0.01' }),
        field('google_media_plan', 'Google MP', 'number', { step: '0.01' }),
        field('saldo_conta_meta', 'Saldo Meta', 'number', { step: '0.01' }),
        field('saldo_conta_google', 'Saldo Google', 'number', { step: '0.01' }),
        field('lt', 'LT', 'text'),
      ]
    },
    {
      title: 'Contrato',
      fields: [
        field('data_inicio_contrato', 'Inicio', 'date'),
        field('data_vencimento_contrato', 'Vencimento', 'date'),
      ]
    },
    {
      title: 'CSAT / NPS',
      fields: [
        field('last_csat_matriz', 'Last CSAT matriz', 'text'),
        field('csat_atendimento', 'CSAT atendimento', 'number', { step: '0.1' }),
        field('csat_campanhas', 'CSAT campanhas', 'number', { step: '0.1' }),
        field('csat_copy', 'CSAT copy', 'number', { step: '0.1' }),
        field('csat_design', 'CSAT design', 'number', { step: '0.1' }),
        field('csat_prazo', 'CSAT prazo', 'number', { step: '0.1' }),
        field('csat_resultados', 'CSAT resultados', 'number', { step: '0.1' }),
        field('mhs', 'MHS', 'text'),
        field('nps', 'NPS', 'number', { step: '0.1' }),
      ]
    },
    {
      title: 'Outros',
      fields: [
        field('resultados', 'Resultados', 'textarea', { rows: 2 }),
        field('objetivo_smart', 'Objetivo smart', 'textarea', { rows: 2 }),
        field('cidade', 'Cidade', 'text'),
        field('modalidade_vendas', 'Modalidade vendas', 'text'),
        field('segmento', 'Segmento', 'text'),
      ]
    },
    {
      title: 'Links',
      fields: [
        field('link_loop', 'Loop', 'url'),
        field('start_plano', 'Start plano', 'date'),
        field('link_ekyte', 'Ekyte', 'url'),
        field('deadline_plano', 'Deadline', 'date'),
        field('link_cac_mapeado', 'CAC mapeado', 'url'),
        field('link_growthpack', 'Growthpack', 'url'),
        field('link_pic', 'PIC', 'url'),
        field('link_contrato', 'Contrato', 'url'),
      ]
    },
  ]

  const sectionsHtml = sections.map(sec => `
    <div class="detail-section">
      <h4 class="detail-section__title">${esc(sec.title)}</h4>
      <div class="detail-fields">${sec.fields.join('')}</div>
    </div>
  `).join('')

  const html = `<form class="detail-grid" id="detail-form" autocomplete="off">${sectionsHtml}</form>`

  const footer = `
    <button class="form__btn form__btn--secondary" id="detail-cancel" type="button">Cancelar</button>
    <button class="form__btn form__btn--primary" id="detail-save" type="button">Salvar</button>
  `

  showModal(`Editar — ${esc(cliente.nome || 'Cliente')}`, html, footer)

  // Auto-formata campos de data no formato dd-MM-yyyy enquanto o usuario digita
  document.querySelectorAll('#detail-form [data-format="date-br"]').forEach(input => {
    input.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '').slice(0, 8)
      if (v.length >= 5) v = v.slice(0, 2) + '-' + v.slice(2, 4) + '-' + v.slice(4)
      else if (v.length >= 3) v = v.slice(0, 2) + '-' + v.slice(2)
      e.target.value = v
    })
  })
}

// ═══ Exportacao (Excel / CSV / JSON) ═══

export function exportTableData(format) {
  const cols = COLUMNS.filter(col => col.key !== '_actions' && isColumnVisible(col.key))
  if (state.filtered.length === 0) {
    showToast('Nenhum registro para exportar', 'warning')
    return
  }

  const headers = cols.map(c => c.label)
  const rows = state.filtered.map(cl => cols.map(c => {
    const v = cl[c.key]
    return v == null ? '' : String(v)
  }))

  if (format === 'json') {
    const data = rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])))
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'cockpit_clientes.json')
    showToast(`Exportado ${data.length} registros em JSON`, 'success')
    return
  }

  if (format === 'csv') {
    const csv = [headers.join(';')]
      .concat(rows.map(r => r.map(csvCell).join(';')))
      .join('\r\n')
    downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), 'cockpit_clientes.csv')
    showToast(`Exportado ${rows.length} registros em CSV`, 'success')
    return
  }

  if (format === 'excel') {
    exportExcel([headers].concat(rows))
  }
}

function exportExcel(aoa) {
  if (window.XLSX) {
    writeXlsx(aoa)
    return
  }
  const s = document.createElement('script')
  s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
  s.onload = () => writeXlsx(aoa)
  s.onerror = () => showToast('Falha ao carregar a biblioteca de Excel. Verifique a internet.', 'error')
  document.head.appendChild(s)
}

function writeXlsx(aoa) {
  const ws = window.XLSX.utils.aoa_to_sheet(aoa)
  const wb = window.XLSX.utils.book_new()
  window.XLSX.utils.book_append_sheet(wb, ws, 'Clientes')
  window.XLSX.writeFile(wb, 'cockpit_clientes.xlsx')
  showToast(`Exportado ${aoa.length - 1} registros em Excel`, 'success')
}

function csvCell(v) {
  const s = String(v)
  if (/[";\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
