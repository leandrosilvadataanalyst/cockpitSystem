/**
 * report_flags.js - Relatorio de Flags por Squad.
 * Pagina standalone (relatorio-flags.html) que reusa o DB do supabase.js.
 * Mostra 2 tabelas (Flag Calculada e Flag Media) com totais, percentuais
 * e resumo de clientes Ativos vs Churn no rodape.
 */
import { DB } from './supabase.js'

const $ = (sel) => document.querySelector(sel)

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

const FLAG_ORDER = ['VERMELHO', 'AMARELO', 'VERDE', 'PREENCHIDO', 'OUTROS', 'SEM FLAG']

function buildTable(clientes, getFlag) {
  const squads = [...new Set(clientes.map(c => c.squad_id).filter(Boolean))].sort()

  const rows = squads.map(squad => {
    const counts = {}
    for (const k of FLAG_ORDER) counts[k] = 0
    let ativos = 0
    let churn = 0
    for (const c of clientes) {
      if (c.squad_id !== squad) continue
      counts[normalizeFlag(getFlag(c))] += 1
      if (isChurn(c)) churn += 1
      else ativos += 1
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    return { squad, counts, total, ativos, churn }
  })

  const totals = {}
  for (const k of FLAG_ORDER) totals[k] = 0
  let totalAtivos = 0
  let totalChurn = 0
  for (const r of rows) {
    for (const k of FLAG_ORDER) totals[k] += r.counts[k]
    totalAtivos += r.ativos
    totalChurn += r.churn
  }
  totals.total = Object.values(totals).reduce((a, b) => a + b, 0)

  return { rows, totals, totalAtivos, totalChurn, flagKinds: FLAG_ORDER }
}

function renderCard({ title, badge, note, table }) {
  const head = `
    <tr>
      <th class="flags-sticky">Squad</th>
      ${table.flagKinds.map(k => `<th class="flags-col">${esc(k)}</th>`).join('')}
      <th class="flags-total">Total</th>
      <th class="flags-total">%</th>
    </tr>`
  const body = table.rows.map(r => {
    const pct = r.total ? (r.total / table.totals.total * 100) : 0
    return `
    <tr>
      <td class="flags-sticky flags-squad">${esc(r.squad)}</td>
      ${table.flagKinds.map(k => `<td class="flags-col flags-cell">${r.counts[k]} <span class="flags-sub">${fmtPct(r.counts[k], r.total)}</span></td>`).join('')}
      <td class="flags-total flags-cell flags-total-cell">${r.total}</td>
      <td class="flags-total flags-cell flags-total-cell">${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</td>
    </tr>`
  }).join('')
  const foot = `
    <tr>
      <td class="flags-sticky">Total Geral</td>
      ${table.flagKinds.map(k => `<td class="flags-col flags-cell">${table.totals[k]} <span class="flags-sub">${fmtPct(table.totals[k], table.totals.total)}</span></td>`).join('')}
      <td class="flags-total flags-cell flags-total-cell">${table.totals.total}</td>
      <td class="flags-total flags-cell flags-total-cell">100%</td>
    </tr>
    <tr class="flags-summary flags-summary--ativos">
      <td class="flags-sticky">Clientes Ativos <span class="flags-sub">(churn: N&atilde;o)</span></td>
      ${table.flagKinds.map(() => `<td class="flags-col flags-cell">&mdash;</td>`).join('')}
      <td class="flags-total flags-cell flags-total-cell">${table.totalAtivos}</td>
      <td class="flags-total flags-cell flags-total-cell">${fmtPct(table.totalAtivos, table.totals.total)}</td>
    </tr>
    <tr class="flags-summary flags-summary--churn">
      <td class="flags-sticky">Clientes Churn <span class="flags-sub">(churn: Sim)</span></td>
      ${table.flagKinds.map(() => `<td class="flags-col flags-cell">&mdash;</td>`).join('')}
      <td class="flags-total flags-cell flags-total-cell">${table.totalChurn}</td>
      <td class="flags-total flags-cell flags-total-cell">${fmtPct(table.totalChurn, table.totals.total)}</td>
    </tr>`
  return `
    <div class="flags-card">
      <div class="flags-card__title">${esc(title)}${badge ? ` ${badge}` : ''}</div>
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

async function init() {
  const container = $('#flags-report-container')
  if (!container) return

  const loader = $('#loader')
  if (loader) loader.classList.remove('hidden')

  try {
    const clientes = await DB.getClientes()
    const calculada = buildTable(clientes, c => c.flag_calculada)
    const media = buildTable(clientes, c => c.flag_media)

    container.innerHTML = `
      ${renderCard({
        title: 'Flag Calculada',
        badge: '<span class="flags-badge flags-badge--legado">Legada</span>',
        note: 'Esta tabela &eacute; <strong>legada</strong>. Futuramente o sistema considerar&aacute; apenas a <strong>Flag M&eacute;dia</strong>.',
        table: calculada,
      })}
      ${renderCard({
        title: 'Flag Media',
        table: media,
      })}
    `
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
