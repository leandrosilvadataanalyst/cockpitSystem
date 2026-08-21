/**
 * Tratativas - espelho do pipe Pipefy.
 * Kanban por etapa + tabela detalhada + relatorio de aging + historico do card.
 */
import { DB } from './supabase.js'

const $ = (sel) => document.querySelector(sel)

// Etapas do pipe (ordem fixa). Novas etapas vindas do Pipefy entram no fim.
const ETAPAS = [
  'Caixa de entrada',
  'Diagnóstico interno',
  'Reunião com o cliente',
  'Plano de ação com o time',
  'Concluído',
]

const state = {
  all: [],
  squads: [],
  filtroSquad: '',
  filtroEtapa: '',
  busca: '',
}

// ── Utils ──
function esc(s) {
  if (s == null) return ''
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
}

function etapaIndex(nome) {
  const i = ETAPAS.findIndex(e => e.toLowerCase() === String(nome || '').toLowerCase())
  return i >= 0 ? i : ETAPAS.length // etapas desconhecidas ficam no fim
}

function diasDesde(iso) {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

function fmtData(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('pt-BR')
}

function fmtDataHora(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function squadLabel(id) {
  const s = state.squads.find(x => x.id === id)
  return s ? s.label : (id || '-')
}

// ── Filtros ──
function filtrados() {
  let list = state.all
  if (state.filtroSquad) list = list.filter(t => t.squad_id === state.filtroSquad)
  if (state.filtroEtapa) list = list.filter(t => t.etapa === state.filtroEtapa)
  if (state.busca) {
    const q = state.busca.toLowerCase()
    list = list.filter(t =>
      (t.titulo || '').toLowerCase().includes(q) ||
      (t.cliente || '').toLowerCase().includes(q))
  }
  return list
}

// ── Kanban ──
function renderKanban() {
  const list = filtrados()
  const cols = [...ETAPAS]
  // garante colunas para etapas desconhecidas presentes nos dados
  for (const t of list) {
    if (!cols.some(c => c.toLowerCase() === String(t.etapa || '').toLowerCase())) cols.push(t.etapa)
  }

  $('#kanban').innerHTML = cols.map(etapa => {
    const cards = list.filter(t => t.etapa === etapa)
    const idx = etapaIndex(etapa)
    const done = idx === ETAPAS.length - 1
    const cardsHtml = cards.map(t => {
      const dias = diasDesde(t.data_atualizacao_etapa)
      const agingCls = done ? '' : (dias == null ? '' : dias > 14 ? 'kan-card__aging--late' : dias > 7 ? 'kan-card__aging--warn' : '')
      return `
        <div class="kan-card" draggable="true" data-card="${esc(t.card_id)}" style="--kpi-line: var(--${done ? 'green' : 'red'})">
          <div class="kan-card__title">${esc(t.titulo)}</div>
          <div class="kan-card__client">${esc(t.cliente || '-')}</div>
          <div class="kan-card__meta">
            <span class="kan-card__tag">${esc(squadLabel(t.squad_id))}</span>
            ${t.categoria_step ? `<span class="kan-card__tag">${esc(t.categoria_step)}</span>` : ''}
            ${t.churn ? `<span class="kan-card__tag kan-card__tag--churn">churn</span>` : ''}
            ${t.thread_criada ? `<span class="kan-card__tag kan-card__tag--thread">thread</span>` : ''}
            <span class="kan-card__aging ${agingCls}">${dias != null && !done ? `${dias}d` : ''}</span>
          </div>
        </div>`
    }).join('')

    return `
      <div class="kanban__col">
        <div class="kanban__col-header">
          <span class="kanban__col-title">${esc(etapa)}</span>
          <span class="kanban__col-count">${cards.length}</span>
        </div>
        <div class="kanban__col-body" data-etapa="${esc(etapa)}">${cardsHtml || '<div style="text-align:center;color:var(--txt-muted);font-size:12px;padding:var(--s-3)">vazio</div>'}</div>
      </div>`
  }).join('')
}

// ── Tabela ──
function renderTabela() {
  const list = filtrados().slice().sort((a, b) => etapaIndex(a.etapa) - etapaIndex(b.etapa) || (a.titulo || '').localeCompare(b.titulo || ''))
  $('#tbody-tratativas').innerHTML = list.map(t => {
    const dias = diasDesde(t.data_atualizacao_etapa)
    const idx = etapaIndex(t.etapa)
    return `
      <tr data-card="${esc(t.card_id)}" style="cursor:pointer">
        <td title="${esc(t.titulo)}"><a href="${esc(t.url || '#')}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(t.titulo)}</a></td>
        <td>${esc(t.cliente || '-')}</td>
        <td>${esc(squadLabel(t.squad_id))}</td>
        <td><span class="etapa-badge etapa-${Math.min(idx, 4)}">${esc(t.etapa)}</span></td>
        <td>${esc(t.categoria_step || '-')}</td>
        <td>${esc(t.churn || '-')}</td>
        <td>${t.thread_criada ? '<span class="pill pill--verde">SIM</span>' : '<span class="pill pill--neutro">NAO</span>'}</td>
        <td>${dias != null ? `${dias} dia(s)` : '-'}</td>
      </tr>`
  }).join('') || '<tr><td colspan="8" style="text-align:center;padding:var(--s-5);color:var(--txt-muted)">Nenhuma tratativa encontrada</td></tr>'
}

// ── Relatorio de aging ──
function renderAging() {
  const list = filtrados().filter(t => etapaIndex(t.etapa) < ETAPAS.length - 1) // exclui concluidas
  const bySquad = {}
  for (const t of list) {
    const k = t.squad_id || '(sem squad)'
    bySquad[k] = bySquad[k] || {}
    bySquad[k][t.etapa] = bySquad[k][t.etapa] || []
    bySquad[k][t.etapa].push(diasDesde(t.data_atualizacao_etapa) ?? 0)
  }

  const maxDias = Math.max(14, ...list.map(t => diasDesde(t.data_atualizacao_etapa) ?? 0))

  $('#aging-grid').innerHTML = Object.entries(bySquad).map(([squad, etapas]) => {
    const rows = ETAPAS.slice(0, -1).map(etapa => {
      const arr = etapas[etapa] || []
      const media = arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : null
      const cor = media == null ? 'var(--gray-500)' : media > 14 ? 'var(--red)' : media > 7 ? 'var(--status-amarelo)' : 'var(--green)'
      return `
        <tr>
          <td style="font-family:var(--font-family)">${esc(etapa)}</td>
          <td>${arr.length}</td>
          <td>${media != null ? `${media.toFixed(1)} d` : '-'}</td>
          <td><div class="aging-bar"><div class="aging-bar__fill" style="width:${media ? Math.min(100, (media / maxDias) * 100) : 0}%;background:${cor}"></div></div></td>
        </tr>`
    }).join('')
    const total = Object.values(etapas).reduce((a, x) => a + x.length, 0)
    return `
      <div class="dash-card">
        <div class="dash-card__title">${esc(squadLabel(squad))} &mdash; ${total} tratativa(s) em andamento</div>
        <table class="aging-table">
          <thead><tr><th>Etapa</th><th>Cards</th><th>Pacing</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
  }).join('') || '<div class="dash-card">Nenhuma tratativa em andamento</div>'
}

// ── Mover card (drag & drop -> Pipefy + banco) ──
let dragCardId = null

function onDragStart(e) {
  const card = e.target.closest('.kan-card')
  if (!card) return
  dragCardId = card.dataset.card
  card.classList.add('dragging')
  e.dataTransfer.effectAllowed = 'move'
  try { e.dataTransfer.setData('text/plain', dragCardId) } catch (_) {}
}

function onDragEnd() {
  dragCardId = null
  document.querySelectorAll('.kan-card.dragging').forEach(el => el.classList.remove('dragging'))
  document.querySelectorAll('.kanban__col-body.drag-over').forEach(el => el.classList.remove('drag-over'))
}

function onDragOver(e) {
  const body = e.target.closest('.kanban__col-body')
  if (!body || !dragCardId) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  document.querySelectorAll('.kanban__col-body.drag-over').forEach(el => { if (el !== body) el.classList.remove('drag-over') })
  body.classList.add('drag-over')
}

async function onDrop(e) {
  const body = e.target.closest('.kanban__col-body')
  if (!body || !dragCardId) return
  e.preventDefault()
  body.classList.remove('drag-over')

  const cardId = dragCardId
  const toEtapa = body.dataset.etapa
  const trat = state.all.find(t => t.card_id === cardId)
  if (!trat || trat.etapa === toEtapa) return

  // Otimista: aplica na hora, reverte se falhar
  const anterior = { etapa: trat.etapa, data_atualizacao_etapa: trat.data_atualizacao_etapa }
  trat.etapa = toEtapa
  trat.data_atualizacao_etapa = new Date().toISOString()
  renderKanban(); renderTabela(); renderAging()
  setSyncInfo(`Movendo "${trat.titulo}" para ${toEtapa}...`)

  try {
    const data = await apiPost('api/move_tratativa', { card_id: cardId, to_etapa: toEtapa })
    if (!data.ok) throw new Error(data.error || 'Erro desconhecido')
    setSyncInfo(`"${trat.titulo}" movido para ${toEtapa}`)
  } catch (err) {
    trat.etapa = anterior.etapa
    trat.data_atualizacao_etapa = anterior.data_atualizacao_etapa
    renderKanban(); renderTabela(); renderAging()
    console.error('[tratativas] erro ao mover:', err)
    setSyncInfo(`Falha ao mover: ${err.message}`)
  }
}

function setSyncInfo(msg) {
  $('#sync-info').textContent = msg
}

// ── Exportacao (Excel / CSV / JSON) ──
function exportRows() {
  return filtrados()
    .slice()
    .sort((a, b) => etapaIndex(a.etapa) - etapaIndex(b.etapa) || (a.titulo || '').localeCompare(b.titulo || ''))
    .map(t => ({
      'Titulo': t.titulo || '',
      'Cliente': t.cliente || '',
      'Squad': squadLabel(t.squad_id),
      'Etapa': t.etapa || '',
      'Categoria STEP': t.categoria_step || '',
      'Churn': t.churn || '',
      'Thread': t.thread_criada ? 'SIM' : 'NAO',
      'Data criacao': fmtData(t.data_criacao),
      'Na etapa ha (dias)': diasDesde(t.data_atualizacao_etapa) ?? '',
      'Url Pipefy': t.url || '',
    }))
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function stamp() {
  return new Date().toISOString().slice(0, 10)
}

function exportCSV() {
  const rows = exportRows()
  if (!rows.length) return setSyncInfo('Nada para exportar')
  const headers = Object.keys(rows[0])
  const csvEsc = v => {
    const s = String(v ?? '')
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = '\uFEFF' + [headers.join(';'), ...rows.map(r => headers.map(h => csvEsc(r[h])).join(';'))].join('\r\n')
  downloadFile(`tratativas_${stamp()}.csv`, csv, 'text/csv;charset=utf-8')
  setSyncInfo(`CSV exportado (${rows.length} linha(s))`)
}

function exportJSON() {
  const rows = exportRows()
  if (!rows.length) return setSyncInfo('Nada para exportar')
  downloadFile(`tratativas_${stamp()}.json`, JSON.stringify(rows, null, 2), 'application/json;charset=utf-8')
  setSyncInfo(`JSON exportado (${rows.length} linha(s))`)
}

function exportExcel() {
  const rows = exportRows()
  if (!rows.length) return setSyncInfo('Nada para exportar')
  const filename = `tratativas_${stamp()}`

  if (window.XLSX) {
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Object.keys(rows[0]).map(h => ({ wch: Math.max(12, h.length + 2) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Tratativas')
    XLSX.writeFile(wb, `${filename}.xlsx`)
    setSyncInfo(`Excel exportado (${rows.length} linha(s))`)
    return
  }

  // Fallback sem CDN: tabela HTML com extensao .xls (abre no Excel)
  const headers = Object.keys(rows[0])
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body>
    <table border="1"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${headers.map(h => `<td>${esc(r[h])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`
  downloadFile(`${filename}.xls`, html, 'application/vnd.ms-excel')
  setSyncInfo(`Excel exportado (${rows.length} linha(s))`)
}

// ── Modal historico ──
async function abrirHistorico(cardId) {
  const t = state.all.find(x => x.card_id === cardId)
  $('#modal-title').textContent = t ? t.titulo : 'Historico'
  $('#modal-body').innerHTML = '<div class="empty"><div class="empty__title">Carregando historico...</div></div>'
  $('#modal-footer').innerHTML = t?.url ? `<a class="filter-bar__btn filter-bar__btn--primary" href="${esc(t.url)}" target="_blank" rel="noopener">Abrir no Pipefy</a>` : ''
  $('#modal-backdrop').classList.remove('hidden')
  $('#modal').classList.remove('hidden')

  try {
    const hist = await DB.getTratativaHistorico(cardId)
    const atual = t?.etapa
    const items = (hist || []).map(h => {
      const isCurrent = !h.saiu_em && h.etapa === atual
      const dotCls = h.saiu_em ? 'hist-dot--done' : (isCurrent ? 'hist-dot--current' : '')
      return `
        <li class="hist-item">
          <span class="hist-dot ${dotCls}"></span>
          <div class="hist-main">
            <div class="hist-etapa">${esc(h.etapa)}</div>
            <div class="hist-dates">entrou ${fmtDataHora(h.entrou_em)} &middot; ${h.saiu_em ? `saiu ${fmtDataHora(h.saiu_em)}` : 'em aberto'}</div>
          </div>
          <span class="hist-dur">${h.duracao_dias != null ? `${h.duracao_dias} d` : (isCurrent ? `${diasDesde(h.entrou_em) ?? 0} d` : '')}</span>
        </li>`
    }).join('')
    $('#modal-body').innerHTML = `<ul class="hist-list">${items || '<li>Nenhum historico registrado</li>'}</ul>`
  } catch (e) {
    $('#modal-body').innerHTML = `<p>Erro ao carregar historico: ${esc(e.message)}</p>`
  }
}

function fecharModal() {
  $('#modal-backdrop').classList.add('hidden')
  $('#modal').classList.add('hidden')
}

// ── API helper ──
// Tenta o caminho relativo (funciona na Vercel). Sob o XAMPP os endpoints
// serverless nao existem (404/HTML): cai para o servidor local de dev
// (scripts/local_api.py em http://127.0.0.1:5099).
const LOCAL_API = 'http://127.0.0.1:5099'

async function apiPost(path, body) {
  let firstError = null
  try {
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const ct = resp.headers.get('content-type') || ''
    if (resp.status === 404 || !ct.includes('json')) throw { fallback: true }
    const data = await resp.json().catch(() => ({ ok: false, error: 'Resposta invalida da API' }))
    return data
  } catch (e) {
    if (!e || !e.fallback) firstError = e
  }
  // Fallback: servidor local
  const endpoint = path.split('/').pop()
  try {
    const resp = await fetch(`${LOCAL_API}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await resp.json()
  } catch (e) {
    const detalhe = firstError ? ` (${firstError.message})` : ''
    throw new Error(`API indisponivel${detalhe}. Dica local: rode "python scripts\\local_api.py"`)
  }
}

// ── Sincronizacao ──
async function sincronizar(auto = false) {
  const btn = $('#btn-sync')
  btn.disabled = true
  setSyncInfo(auto ? 'Sincronizando (auto)...' : 'Sincronizando...')
  try {
    const data = await apiPost('api/sync_tratativas', {})
    if (data.ok) {
      setSyncInfo(`Ultima sync: ${new Date().toLocaleTimeString('pt-BR')} (${data.imported}/${data.total} cards)`)
      await load()
    } else {
      setSyncInfo(`Falha na sincronizacao: ${data.error || '?'}`)
      console.error('Sync error:', data)
    }
  } catch (e) {
    setSyncInfo(`Erro: ${e.message}`)
  } finally {
    btn.disabled = false
  }
}

// Auto-sync no maximo 1x a cada 10 min (evita estourar quota do Pipefy)
function maybeAutoSync() {
  try {
    const last = Number(localStorage.getItem('trat_last_sync') || 0)
    if (Date.now() - last > 10 * 60 * 1000) {
      localStorage.setItem('trat_last_sync', String(Date.now()))
      sincronizar(true)
    }
  } catch (_) {}
}

// ── Load ──
async function load() {
  const [squads, tratativas] = await Promise.all([
    DB.getSquads(),
    DB.getTratativas(),
  ])
  state.squads = squads || []
  state.all = tratativas || []

  // popula filtros uma vez
  const selSquad = $('#filtro-squad')
  if (selSquad.options.length <= 1) {
    for (const s of state.squads) {
      selSquad.insertAdjacentHTML('beforeend', `<option value="${esc(s.id)}">${esc(s.label)}</option>`)
    }
    const selEtapa = $('#filtro-etapa')
    for (const e of ETAPAS) {
      selEtapa.insertAdjacentHTML('beforeend', `<option value="${esc(e)}">${esc(e)}</option>`)
    }
  }

  renderKanban()
  renderTabela()
  renderAging()

  const maxSync = state.all.reduce((acc, t) => Math.max(acc, new Date(t.synced_at || 0).getTime()), 0)
  if (maxSync) $('#sync-info').textContent = `Ultima sync: ${new Date(maxSync).toLocaleString('pt-BR')}`
}

// ── Boot ──
function esconderLoader() {
  const l = document.getElementById('loader')
  if (l) l.classList.add('hidden')
}

document.addEventListener('DOMContentLoaded', () => {
  $('#btn-voltar').addEventListener('click', () => { window.location.href = 'index.html' })
  $('#btn-sync').addEventListener('click', () => sincronizar(false))
  $('#btn-exp-xlsx').addEventListener('click', exportExcel)
  $('#btn-exp-csv').addEventListener('click', exportCSV)
  $('#btn-exp-json').addEventListener('click', exportJSON)

  $('#filtro-squad').addEventListener('change', e => { state.filtroSquad = e.target.value; renderKanban(); renderTabela(); renderAging() })
  $('#filtro-etapa').addEventListener('change', e => { state.filtroEtapa = e.target.value; renderKanban(); renderTabela(); renderAging() })
  let debounce
  $('#filtro-busca').addEventListener('input', e => {
    clearTimeout(debounce)
    debounce = setTimeout(() => { state.busca = e.target.value.trim(); renderKanban(); renderTabela(); renderAging() }, 250)
  })

  // Drag & drop entre colunas
  const kanban = $('#kanban')
  kanban.addEventListener('dragstart', onDragStart)
  kanban.addEventListener('dragend', onDragEnd)
  kanban.addEventListener('dragover', onDragOver)
  kanban.addEventListener('dragleave', e => {
    const body = e.target.closest('.kanban__col-body')
    if (body && !body.contains(e.relatedTarget)) body.classList.remove('drag-over')
  })
  kanban.addEventListener('drop', onDrop)

  document.addEventListener('click', e => {
    const card = e.target.closest('[data-card]')
    if (card) abrirHistorico(card.dataset.card)
    if (e.target.id === 'modal-backdrop' || e.target.id === 'modal-close') fecharModal()
  })
  document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModal() })

  // Safety: nunca deixa o loader preso por mais de 8s
  setTimeout(esconderLoader, 8000)

  load()
    .then(esconderLoader)
    .catch(err => { console.error('[tratativas] erro ao carregar:', err); esconderLoader() })
  maybeAutoSync()
})
