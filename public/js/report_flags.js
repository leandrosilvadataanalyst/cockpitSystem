/**
 * report_flags.js - Relatorio de Flags por Squad.
 * Pagina standalone (relatorio-flags.html) que reusa o DB do supabase.js.
 * Mostra 2 tabelas (Flag Calculada e Flag Media) com totais, percentuais
 * e resumo de clientes Ativos vs Churn. Suporta filtros por squad/flag
 * e exportacao em CSV e Excel.
 */
import { DB } from './supabase.js'
import { renderDashboard, destroyDashboard } from './report_dashboard.js?v=7'

const $ = (sel) => document.querySelector(sel)

let allClientes = []
let squadsList = []
let state = { squad: '', flag: '' }
let tables = {}

function normalizeFlag(value) {
  if (!value) return 'SEM FLAG'
  const s = String(value).toLowerCase()
  if (/critic|danger|vermelho|red/.test(s)) return 'VERMELHO'
  if (/care|amarelo|yellow/.test(s)) return 'AMARELO'
  if (/safe|verde|green/.test(s)) return 'VERDE'
  if (/preenchido/.test(s)) return 'PREENCHIDO'
  return 'OUTROS'
}

function isChurn(c) {
  const v = String(c.churn_realizado ?? '').trim().toLowerCase()
  return v === 'sim' || v === 'true' || v === '1' || v === 'yes'
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

const fmtPct = (n, total) => {
  if (!total) return '0%'
  return (n / total * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'
}

const FLAG_ORDER = ['VERMELHO', 'AMARELO', 'VERDE', 'SEM FLAG']
const FLAG_LABELS = {
  'VERMELHO': 'Danger (Vermelho)',
  'AMARELO': 'Care (Amarelo)',
  'VERDE': 'Safe (Verde)',
  'SEM FLAG': 'Sem Flag',
}
const flagLabel = (k) => FLAG_LABELS[k] || k

function buildTable(clientes, getFlag) {
  const ativos = clientes.filter(c => !isChurn(c))
  const squads = squadsList.filter(s => ativos.some(c => c.squad_id === s))

  const rows = squads.map(squad => {
    const counts = {}
    for (const k of FLAG_ORDER) counts[k] = 0
    for (const c of ativos) {
      if (c.squad_id !== squad) continue
      counts[normalizeFlag(getFlag(c))] += 1
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    return { squad, counts, total }
  })

  const totals = {}
  for (const k of FLAG_ORDER) totals[k] = 0
  for (const r of rows) {
    for (const k of FLAG_ORDER) totals[k] += r.counts[k]
  }
  totals.total = Object.values(totals).reduce((a, b) => a + b, 0)

  return { rows, totals, flagKinds: FLAG_ORDER }
}

function getFiltered() {
  let list = allClientes
  if (state.squad) list = list.filter(c => c.squad_id === state.squad)
  if (state.flag) list = list.filter(c => normalizeFlag(c.flag_media) === state.flag)
  return list
}

function render() {
  const clientes = getFiltered()
  tables.calculada = buildTable(clientes, c => c.flag_calculada)
  tables.media = buildTable(clientes, c => c.flag_media)
  const container = $('#flags-report-container')

  container.innerHTML = `
    ${renderCard({
      title: 'Flag Calculada',
      badge: '<span class="flags-badge flags-badge--legado">Legada</span>',
      note: 'Esta tabela &eacute; <strong>legada</strong>. Futuramente o sistema considerar&aacute; apenas a <strong>Flag M&eacute;dia</strong>.',
      table: tables.calculada,
      exportKey: 'calculada',
    })}
    ${renderCard({
      title: 'Flag Media',
      table: tables.media,
      exportKey: 'media',
    })}
  `

  renderDashboardSafe()
}

function renderDashboardSafe() {
  const dashEl = $('#flags-dashboard-container')
  if (!dashEl) return
  try {
    destroyDashboard()
    renderDashboard(getFiltered(), dashEl)
  } catch (err) {
    console.error('[dashboard] erro:', err)
    dashEl.innerHTML = `
      <div class="empty">
        <div class="empty__icon">&#9888;</div>
        <div class="empty__title">Erro no dashboard de notas</div>
        <div class="empty__sub">${esc(err.message)}</div>
      </div>`
  }
}

function renderCard({ title, badge, note, table, exportKey }) {
  const head = `
    <tr>
      <th class="flags-sticky">Squad</th>
      ${table.flagKinds.map(k => `<th class="flags-col">${esc(flagLabel(k))}</th>`).join('')}
      <th class="flags-total">Total Ativos</th>
    </tr>`
  const body = table.rows.map(r => {
    return `
    <tr>
      <td class="flags-sticky flags-squad">${esc(r.squad)}</td>
      ${table.flagKinds.map(k => `<td class="flags-col flags-cell">${r.counts[k]} <span class="flags-sub">${fmtPct(r.counts[k], r.total)}</span></td>`).join('')}
      <td class="flags-total flags-cell flags-total-cell flags-ativos">${r.total}</td>
    </tr>`
  }).join('')
  const foot = `
    <tr>
      <td class="flags-sticky">Total Geral</td>
      ${table.flagKinds.map(k => `<td class="flags-col flags-cell">${table.totals[k]} <span class="flags-sub">${fmtPct(table.totals[k], table.totals.total)}</span></td>`).join('')}
      <td class="flags-total flags-cell flags-total-cell flags-ativos">${table.totals.total}</td>
    </tr>`
  return `
    <div class="flags-card">
      <div class="flags-card__title">${esc(title)}${badge ? ` ${badge}` : ''}
        <span class="flags-card__export">
          <button class="flags-export-btn" data-export="csv" data-key="${exportKey}" type="button">CSV</button>
          <button class="flags-export-btn" data-export="excel" data-key="${exportKey}" type="button">Excel</button>
        </span>
      </div>
      <div class="table-scroll flags-scroll">
        <table class="flags-table">
          <thead>${head}</thead>
          <tbody>${body}</tbody>
          <tfoot>${foot}</tfoot>
        </table>
      </div>
      ${note ? `<div class="flags-note">${note}</div>` : ''}
    </div>`
}

function tableToMatrix(table) {
  const rows = []
  rows.push(['Squad', ...table.flagKinds.map(flagLabel), 'Total Ativos'])
  for (const r of table.rows) {
    rows.push([
      r.squad,
      ...table.flagKinds.map(k => `${r.counts[k]} (${fmtPct(r.counts[k], r.total)})`),
      r.total,
    ])
  }
  rows.push([
    'Total Geral',
    ...table.flagKinds.map(k => `${table.totals[k]} (${fmtPct(table.totals[k], table.totals.total)})`),
    table.totals.total,
  ])
  return rows
}

function downloadFile(filename, content, mime) {
  const blob = new Blob(['\uFEFF' + content], { type: mime + ';charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function exportCsv(table, label) {
  const rows = tableToMatrix(table)
  const csv = rows.map(r => r.map(v => {
    const s = String(v ?? '')
    return /[";,;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }).join(';')).join('\r\n')
  downloadFile(`flags_${label}.csv`, csv, 'text/csv')
}

function exportExcel(table, label) {
  const rows = tableToMatrix(table)
  const sheet = rows.map(r =>
    '<Row>' + r.map(v => {
      const s = String(v ?? '')
      const isNum = /^-?\d+(\.\d+)?%?$/.test(s.trim())
      if (isNum && !s.endsWith('%')) {
        return `<Cell><Data ss:Type="Number">${s.trim()}</Data></Cell>`
      }
      return `<Cell><Data ss:Type="String">${esc(s)}</Data></Cell>`
    }).join('') + '</Row>'
  ).join('\n')
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Worksheet ss:Name="Flags">
  <Table>${sheet}</Table>
 </Worksheet>
</Workbook>`
  downloadFile(`flags_${label}.xls`, xml, 'application/vnd.ms-excel')
}

function bindEvents() {
  const squadSel = $('#filtro-squad')
  const flagSel = $('#filtro-flag')

  squadSel.addEventListener('change', () => {
    state.squad = squadSel.value
    render()
  })
  flagSel.addEventListener('change', () => {
    state.flag = flagSel.value
    render()
  })

  document.getElementById('btn-export-csv').addEventListener('click', () => {
    exportCsv(tables.media, 'media')
    exportCsv(tables.calculada, 'calculada')
  })
  document.getElementById('btn-export-excel').addEventListener('click', () => {
    exportExcel(tables.media, 'media')
    exportExcel(tables.calculada, 'calculada')
  })

  document.getElementById('flags-report-container').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-export]')
    if (!btn) return
    const table = tables[btn.dataset.key]
    if (!table) return
    if (btn.dataset.export === 'csv') exportCsv(table, btn.dataset.key)
    else exportExcel(table, btn.dataset.key)
  })
}

function populateFilters() {
  const squadSel = $('#filtro-squad')
  const flagSel = $('#filtro-flag')
  squadsList.forEach(s => {
    const opt = document.createElement('option')
    opt.value = s
    opt.textContent = s
    squadSel.appendChild(opt)
  })
  FLAG_ORDER.forEach(f => {
    const opt = document.createElement('option')
    opt.value = f
    opt.textContent = flagLabel(f)
    flagSel.appendChild(opt)
  })
}

async function init() {
  const container = $('#flags-report-container')
  if (!container) return

  const loader = $('#loader')
  if (loader) loader.classList.remove('hidden')

  try {
    allClientes = await DB.getClientes()
    squadsList = [...new Set(allClientes.map(c => c.squad_id).filter(Boolean))].sort()
    populateFilters()
    bindEvents()
    render()
  } catch (err) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty__icon">&#9888;</div>
        <div class="empty__title">Erro ao carregar dados</div>
        <div class="empty__sub">${esc(err.message)}</div>
      </div>`
  } finally {
    if (loader) loader.classList.add('hidden')
  }
}

init()
