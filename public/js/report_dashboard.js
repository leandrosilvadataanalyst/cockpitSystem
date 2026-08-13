/**
 * report_dashboard.js - Dashboard estatistico de Notas e Justificativas.
 * Renderiza KPIs, distribuicoes, comparativo por squad, heatmap de medias
 * e analise de palavras-chave das justificativas.
 *
 * Uso: renderDashboard(clientes, container) - destrói e recria os charts.
 */

const CRITERIA = [
  { key: 'nota_mql', label: 'MQL/Demanda', just: 'justificativa_mql', color: '#e34948' },
  { key: 'nota_atrasos', label: 'Atrasos', just: 'justificativa_atrasos', color: '#f57c00' },
  { key: 'nota_qualidade', label: 'Qualidade', just: 'justificativa_qualidade', color: '#fbc02d' },
  { key: 'nota_relacionamento', label: 'Relacionamento', just: 'justificativa_relacionamento', color: '#1baf7a' },
  { key: 'nota_resultado', label: 'Resultado', just: 'justificativa_resultado', color: '#4aa3df' },
]

const SQUAD_COLORS = ['#69dc9e', '#4aa3df', '#fbc02d', '#f57c00', '#e34948', '#c48cf0', '#7ad0d0']

const RANK_KEYS = ['nota_mql', 'nota_atrasos', 'nota_qualidade', 'nota_relacionamento', 'nota_resultado']

const STOPWORDS = new Set([
  'de','da','do','das','dos','em','no','na','nos','nas','para','por','com','que','e','o','a','os','as',
  'um','uma','uns','umas','ao','aos','à','às','pelo','pela','pelos','pelas','se','sua','seu','suas','seus',
  'foi','ser','são','está','estao','está','tem','não','nao','sem','mais','menos','já','ja','ainda','tambem',
  'todo','toda','todos','todas','cliente','clientes','squad','projeto','foi','sendo','entre','até','ate',
  'desde','sobre','pode','muito','bem','mal','ok','estar','sendo','ter','tido','não','sim','nao','q',
])

const charts = {}

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy()
    delete charts[id]
  }
}

function hexAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return `rgba(${r},${g},${b},${alpha})`
}

function validNota(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (Number.isFinite(n) && n >= 0 && n <= 5) return n
  return null
}

function isChurn(c) {
  const v = String(c.churn_realizado ?? '').trim().toLowerCase()
  return v === 'sim' || v === 'true' || v === '1' || v === 'yes'
}

function mean(arr) {
  if (!arr.length) return null
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function median(arr) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function stdev(arr) {
  if (arr.length < 2) return 0
  const m = mean(arr)
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1))
}

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w))
}

function topWords(justificativas, n = 12) {
  const freq = {}
  for (const j of justificativas) {
    for (const w of tokenize(j)) freq[w] = (freq[w] || 0) + 1
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n)
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

const fmtNum = (n) => n == null ? '-' : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

function computeStats(clientes) {
  const squads = [...new Set(clientes.map(c => c.squad_id).filter(Boolean))].sort()

  const perCrit = CRITERIA.map(c => {
    const notas = clientes.map(x => validNota(x[c.key])).filter(n => n !== null)
    return {
      ...c,
      notas,
      media: mean(notas),
      mediana: median(notas),
      desvio: stdev(notas),
      preenchidos: notas.length,
      total: clientes.length,
      dist: [0, 1, 2, 3, 4, 5].map(g => notas.filter(n => Math.round(n) === g).length),
      justCount: clientes.filter(x => x[c.just]).length,
      justs: clientes.map(x => x[c.just]).filter(Boolean),
      baixas: notas.filter(n => n <= 2).length,
    }
  })

  const bySquad = squads.map(squad => {
    const rows = clientes.filter(c => c.squad_id === squad)
    const notas = CRITERIA.map(c => {
      const arr = rows.map(x => validNota(x[c.key])).filter(n => n !== null)
      return {
        key: c.key,
        label: c.label,
        media: mean(arr),
        count: arr.length,
        dist: [0, 1, 2, 3, 4, 5].map(g => arr.filter(n => Math.round(n) === g).length),
      }
    })
    return { squad, rows: rows.length, notas }
  })

  return { perCrit, bySquad, squads }
}

function squadScore(s) {
  const medias = s.notas
    .filter(n => RANK_KEYS.includes(n.key))
    .map(n => n.media)
    .filter(m => m != null)
  if (!medias.length) return null
  return mean(medias)
}

function squadDetail(s) {
  const parts = s.notas
    .filter(n => RANK_KEYS.includes(n.key))
    .map(n => `${n.label.split('/')[0]}: ${fmtNum(n.media)}`)
  return parts.join(' &middot; ')
}

function squadRankingHtml(stats) {
  if (!stats.bySquad.length) return '<div class="empty__sub">Sem dados de squads</div>'
  const ranked = stats.bySquad
    .map(s => ({ squad: s.squad, score: squadScore(s), rows: s.rows, det: squadDetail(s) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  const maxScore = Math.max(...ranked.map(r => r.score ?? 0), 1)
  const rows = ranked.map((r, i) => {
    const pct = r.score != null ? Math.max(4, (r.score / maxScore) * 100) : 0
    const color = r.score == null ? 'var(--gray-300)' : (r.score < 2.5 ? 'var(--red)' : (r.score < 3.5 ? 'var(--status-amarelo)' : 'var(--green)'))
    return `
      <tr>
        <td class="dash-td dash-td--rank">${i + 1}</td>
        <td class="dash-td dash-td--label">${esc(r.squad)}<div class="dash-det">${r.det}</div></td>
        <td class="dash-td">
          <div class="dash-bar" title="${fmtNum(r.score)} de m&eacute;dia">
            <div class="dash-bar__fill" style="width:${pct}%;background:${color}"></div>
          </div>
        </td>
        <td class="dash-td dash-td--num" style="color:${color}">${fmtNum(r.score)}</td>
        <td class="dash-td dash-td--num">${r.rows}</td>
      </tr>`
  }).join('')
  return `
    <table class="dash-heatmap dash-heatmap--rank">
      <thead>
        <tr>
          <th class="dash-th">#</th>
          <th class="dash-th">Squad</th>
          <th class="dash-th">M&eacute;dia geral</th>
          <th class="dash-th">Nota</th>
          <th class="dash-th">Clientes</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`
}

function duoMediaGeral(clients) {
  const medias = RANK_KEYS.map(k => {
    const arr = clients.map(c => validNota(c[k])).filter(n => n !== null)
    return mean(arr)
  }).filter(m => m != null)
  if (!medias.length) return null
  return mean(medias)
}

function duoRankingHtml(clientes, n = 5) {
  const groups = {}
  for (const c of clientes) {
    const key = `${c.account || '?'}\u0000${c.gt || '?'}`
    if (!groups[key]) groups[key] = { duo: `${c.account || '?'} + ${c.gt || '?'}`, clients: [], squads: new Set() }
    groups[key].clients.push(c)
    if (c.squad_id) groups[key].squads.add(c.squad_id)
  }
  const scored = Object.values(groups)
    .map(g => ({
      duo: g.duo,
      squad: [...g.squads].sort().join(', '),
      score: duoMediaGeral(g.clients),
      count: g.clients.length,
    }))
    .filter(x => x.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
  if (!scored.length) return '<div class="empty__sub">Sem duplas avaliadas</div>'
  const maxScore = Math.max(...scored.map(r => r.score), 1)
  const rows = scored.map((r, i) => {
    const pct = Math.max(4, (r.score / maxScore) * 100)
    const color = r.score < 2.5 ? 'var(--red)' : (r.score < 3.5 ? 'var(--status-amarelo)' : 'var(--green)')
    return `
      <tr>
        <td class="dash-td dash-td--rank">${i + 1}</td>
        <td class="dash-td dash-td--duo">${esc(r.duo)}</td>
        <td class="dash-td">${esc(r.squad)}</td>
        <td class="dash-td">
          <div class="dash-bar" title="${fmtNum(r.score)} de m&eacute;dia">
            <div class="dash-bar__fill" style="width:${pct}%;background:${color}"></div>
          </div>
        </td>
        <td class="dash-td dash-td--num" style="color:${color}">${fmtNum(r.score)}</td>
        <td class="dash-td dash-td--num">${r.count}</td>
      </tr>`
  }).join('')
  return `
    <table class="dash-heatmap dash-heatmap--rank">
      <thead>
        <tr>
          <th class="dash-th">#</th>
          <th class="dash-th">Dupla (Account + GT)</th>
          <th class="dash-th">Squad</th>
          <th class="dash-th">M&eacute;dia geral</th>
          <th class="dash-th">Nota</th>
          <th class="dash-th">Clientes</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`
}

function kpiHtml(c) {
  const pctPreench = c.total ? (c.preenchidos / c.total * 100) : 0
  const pctBaixas = c.preenchidos ? (c.baixas / c.preenchidos * 100) : 0
  const color = c.media == null ? 'var(--gray-300)' : (c.media < 2.5 ? 'var(--red)' : (c.media < 3.5 ? 'var(--status-amarelo)' : 'var(--green)'))
  return `
    <div class="dash-kpi" style="--kpi-line:${c.color}">
      <div class="dash-kpi__label">${esc(c.label)}</div>
      <div class="dash-kpi__value" style="color:${color}">${fmtNum(c.media)}</div>
      <div class="dash-kpi__sub">mediana ${fmtNum(c.mediana)} &middot; dp ${fmtNum(c.desvio)}</div>
      <div class="dash-kpi__sub">${c.preenchidos}/${c.total} preenchidos (${pctPreench.toFixed(0)}%)</div>
      <div class="dash-kpi__sub" style="color:${c.baixas ? 'var(--red)' : 'inherit'}">${c.baixas} notas &le; 2 (${pctBaixas.toFixed(0)}%)</div>
    </div>`
}

function heatmapHtml(stats) {
  if (!stats.squads.length) return '<div class="empty__sub">Sem dados de squads</div>'
  const head = `<tr><th class="dash-th">Crit&eacute;rio</th>${stats.squads.map(s => `<th class="dash-th">${esc(s)}</th>`).join('')}<th class="dash-th">Geral</th></tr>`
  const body = stats.perCrit.map(c => {
    const row = stats.bySquad.map(s => {
      const n = s.notas.find(x => x.key === c.key)
      return `<td class="dash-td" style="background:${heatColor(n ? n.media : null)}">${fmtNum(n ? n.media : null)}</td>`
    })
    return `<tr><td class="dash-td dash-td--label">${esc(c.label)}</td>${row.join('')}<td class="dash-td dash-td--total" style="background:${heatColor(c.media)}">${fmtNum(c.media)}</td></tr>`
  }).join('')

  const geral = stats.bySquad.map(s => {
    const medias = s.notas
      .filter(n => RANK_KEYS.includes(n.key))
      .map(n => n.media)
      .filter(m => m != null)
    const g = medias.length ? mean(medias) : null
    return `<td class="dash-td" style="background:${heatColor(g)}"><b>${fmtNum(g)}</b></td>`
  }).join('')
  const mediaGeral = stats.perCrit
    .filter(c => RANK_KEYS.includes(c.key))
    .map(c => c.media)
    .filter(m => m != null)
  const gGeral = mediaGeral.length ? mean(mediaGeral) : null
  const foot = `<tr><td class="dash-td dash-td--label"><b>M&eacute;dia geral</b></td>${geral}<td class="dash-td dash-td--total" style="background:${heatColor(gGeral)}"><b>${fmtNum(gGeral)}</b></td></tr>`

  return `<table class="dash-heatmap"><thead>${head}</thead><tbody>${body}${foot}</tbody></table>`
}

function heatColor(v) {
  if (v == null) return 'rgba(255,255,255,0.03)'
  const t = Math.max(0, Math.min(1, v / 5))
  // verde (v>=3.5) -> amarelo -> vermelho (v<2.5)
  if (t >= 0.5) {
    const a = (t - 0.5) * 2
    return `rgba(27,175,122,${0.08 + a * 0.22})`
  }
  const a = (0.5 - t) * 2
  return `rgba(227,73,72,${0.22 - a * 0.16})`
}

function wordsHtml(perCrit) {
  return perCrit.map(c => {
    const words = topWords(c.justs, 12)
    if (!words.length) return ''
    return `
      <div class="dash-words">
        <div class="dash-words__title" style="border-color:${c.color}">${esc(c.label)} <span class="dash-words__count">(${c.justCount} justificativas)</span></div>
        <div class="dash-words__list">
          ${words.map(([w, n]) => `<span class="dash-words__item" title="${n} ocorrencias">${esc(w)} <b>${n}</b></span>`).join('')}
        </div>
      </div>`
  }).join('')
}

function chartColors() {
  return {
    grid: 'rgba(255,255,255,0.08)',
    ticks: '#aaa',
    border: '#3a3a3a',
  }
}

function buildDistChart(id, stats) {
  destroyChart(id)
  const el = document.getElementById(id)
  if (!el || typeof el.getContext !== 'function') return
  const c = chartColors()
  const datasets = stats.perCrit.map(pc => ({
    label: pc.label,
    data: pc.dist,
    backgroundColor: hexAlpha(pc.color, 0.75),
    borderColor: pc.color,
    borderWidth: 1,
    borderRadius: 3,
  }))
  charts[id] = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: { labels: ['0', '1', '2', '3', '4', '5'], datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: c.ticks, boxWidth: 14, font: { size: 11 }, usePointStyle: true, padding: 12 } },
        title: { display: true, text: 'Distribuicao das notas (0-5)', color: '#fff', font: { size: 13, weight: 'bold' } },
        tooltip: {
          callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y} clientes` }
        }
      },
      scales: {
        x: { stacked: false, grid: { color: c.grid }, ticks: { color: c.ticks } },
        y: { grid: { color: c.grid }, ticks: { color: c.ticks, precision: 0 } },
      },
    },
  })
}

function buildSquadChart(id, stats) {
  destroyChart(id)
  const el = document.getElementById(id)
  if (!el || typeof el.getContext !== 'function') return
  const c = chartColors()
  const labels = CRITERIA.map(x => x.label)
  const datasets = stats.bySquad.map((s, i) => ({
    label: s.squad,
    data: labels.map(l => {
      const n = s.notas.find(x => x.label === l)
      return n ? (n.media == null ? null : n.media) : null
    }),
    borderColor: SQUAD_COLORS[i % SQUAD_COLORS.length],
    backgroundColor: hexAlpha(SQUAD_COLORS[i % SQUAD_COLORS.length], 0.15),
    pointRadius: 4,
    tension: 0.25,
  }))
  charts[id] = new Chart(el.getContext('2d'), {
    type: 'radar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { labels: { color: c.ticks, boxWidth: 12, font: { size: 10 } } },
        title: { display: true, text: 'Perfil medio das notas por squad', color: '#fff', font: { size: 13, weight: 'bold' } },
      },
      scales: {
        r: {
          min: 0,
          max: 5,
          grid: { color: c.grid },
          angleLines: { color: c.grid },
          pointLabels: { color: c.ticks, font: { size: 10 } },
          ticks: { backdropColor: 'transparent', color: c.ticks, stepSize: 1 },
        },
      },
    },
  })
}

function buildStackChart(id, stats) {
  destroyChart(id)
  const el = document.getElementById(id)
  if (!el || typeof el.getContext !== 'function') return
  const c = chartColors()
  const labels = stats.squads.length ? stats.squads : ['(sem squad)']
  const round1 = v => Number((Math.round(v * 10) / 10).toFixed(1))
  const datasets = CRITERIA.map(pc => ({
    label: pc.label,
    data: stats.bySquad.map(s => {
      const n = s.notas.find(x => x.key === pc.key)
      return n && n.media != null ? round1(n.media) : 0
    }),
    backgroundColor: hexAlpha(pc.color, 0.75),
    borderColor: pc.color,
    borderWidth: 1,
  }))
  charts[id] = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { labels: { color: c.ticks, boxWidth: 12, font: { size: 10 } } },
        title: { display: true, text: 'Media das notas por squad', color: '#fff', font: { size: 13, weight: 'bold' } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(1)} (media)`,
            footer: items => {
              if (!items.length) return ''
              const total = items.reduce((acc, it) => acc + (Number(it.parsed.y) || 0), 0)
              return `Total: ${total.toFixed(1)} / 25`
            },
          }
        },
      },
      scales: {
        x: { stacked: true, grid: { color: c.grid }, ticks: { color: c.ticks } },
        y: { stacked: true, min: 0, max: 5, grid: { color: c.grid }, ticks: { color: c.ticks, stepSize: 1, callback: v => Math.round(v * 10) / 10 } },
      },
    },
  })
}

function buildJustChart(id, stats) {
  destroyChart(id)
  const el = document.getElementById(id)
  if (!el || typeof el.getContext !== 'function') return
  const c = chartColors()
  const labels = CRITERIA.map(x => x.label)
  const datasets = stats.bySquad.map((s, i) => ({
    label: s.squad,
    data: labels.map(l => {
      const n = s.notas.find(x => x.label === l)
      return n ? n.count : 0
    }),
    backgroundColor: hexAlpha(SQUAD_COLORS[i % SQUAD_COLORS.length], 0.7),
    borderColor: SQUAD_COLORS[i % SQUAD_COLORS.length],
    borderWidth: 1,
  }))
  charts[id] = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { labels: { color: c.ticks, boxWidth: 12, font: { size: 10 } } },
        title: { display: true, text: 'Notas preenchidas por critério e squad', color: '#fff', font: { size: 13, weight: 'bold' } },
      },
      scales: {
        x: { stacked: true, grid: { color: c.grid }, ticks: { color: c.ticks } },
        y: { stacked: true, grid: { color: c.grid }, ticks: { color: c.ticks, precision: 0 } },
      },
    },
  })
}

export function renderDashboard(clientes, container) {
  if (!container) return
  const ativos = clientes.filter(c => !isChurn(c))
  const stats = computeStats(ativos)

  container.innerHTML = `
    <div class="dash-section">
      <h3 class="dash-section__title">M&eacute;dias gerais</h3>
      <div class="dash-kpis">
        ${stats.perCrit.map(kpiHtml).join('')}
      </div>
    </div>

    <div class="dash-grid">
      <div class="dash-card">
        <div class="dash-chart" style="height:300px"><canvas id="chart-dist"></canvas></div>
        <p class="dash-hint">Como ler: cada barra agrupada mostra quantos clientes receberam cada nota (0 a 5) para cada crit&eacute;rio. Compare o volume de notas baixas (0-2) em vermelho/amarelo: quanto maior, maior o risco no crit&eacute;rio. Nota 3 &eacute; o limiar neutro; notas 4-5 indicam sa&uacute;de.</p>
      </div>
      <div class="dash-card">
        <div class="dash-chart" style="height:300px"><canvas id="chart-squad"></canvas></div>
        <p class="dash-hint">Como ler: cada pol&iacute;gono &eacute; uma squad; quanto mais pr&oacute;ximo do centro, pior a m&eacute;dia. Um pol&iacute;gono "encolhido" num eixo indica o ponto fraco daquela squad. Use para comparar o perfil entre squads e achar onde uma squad est&aacute; abaixo das demais.</p>
      </div>
    </div>

    <div class="dash-grid">
      <div class="dash-card">
        <div class="dash-chart" style="height:300px"><canvas id="chart-stack"></canvas></div>
        <p class="dash-hint">Como ler: a soma das barras de uma squad representa a soma das notas m&eacute;dias nos 5 crit&eacute;rios (m&aacute;x. 25). Barra mais alta = squad mais saud&aacute;vel no geral. Observe qual segmento (cor) &eacute; menor em cada squad para localizar o crit&eacute;rio mais fraco.</p>
      </div>
      <div class="dash-card">
        <div class="dash-chart" style="height:300px"><canvas id="chart-just"></canvas></div>
        <p class="dash-hint">Como ler: quantidade de notas preenchidas por crit&eacute;rio em cada squad. Barras mais altas = mais dados dispon&iacute;veis (mais confi&aacute;vel). Barras baixas ou ausentes indicam lacuna de preenchimento &mdash; m&eacute;dias com poucos dados devem ser lidas com cautela.</p>
      </div>
    </div>

    <div class="dash-section">
      <h3 class="dash-section__title">Ranking de squads e duplas</h3>
      <div class="dash-grid">
        <div class="dash-card">
          <h4 class="dash-card__title">Ranking das squads</h4>
          ${squadRankingHtml(stats)}
          <p class="dash-hint"><strong>Como &eacute; calculado:</strong> cada cliente ativo (churn exclu&iacute;do) recebe 5 notas de 0 a 5. Para cada crit&eacute;rio (MQL, Atrasos, Qualidade, Relacionamento, Resultado) tiramos a m&eacute;dia das notas de todos os clientes da squad &rarr; 5 m&eacute;dias. A <strong>m&eacute;dia geral</strong> da squad &eacute; a m&eacute;dia dessas 5 m&eacute;dias. As squads s&atilde;o ordenadas da maior para a menor m&eacute;dia geral. Barra verde &ge; 3.5, amarela 2.5-3.5, vermelha &lt; 2.5.</p>
        </div>
        <div class="dash-card">
          <h4 class="dash-card__title">Top 5 duplas (Account + GT)</h4>
          ${duoRankingHtml(ativos)}
          <p class="dash-hint"><strong>Como &eacute; calculado:</strong> juntamos todos os clientes ativos (churn exclu&iacute;do) de cada dupla (Account + GT). Para cada um dos 5 crit&eacute;rios, tiramos a m&eacute;dia das notas dos clientes daquela dupla &rarr; 5 m&eacute;dias. A nota da dupla &eacute; a <strong>m&eacute;dia dessas 5 m&eacute;dias</strong>. Cada dupla aparece uma &uacute;nica vez e as 5 com maior nota s&atilde;o mostradas. "Clientes" = quantos clientes a dupla atende; "Squad" = onde atuam.</p>
        </div>
      </div>
    </div>

    <div class="dash-section">
      <h3 class="dash-section__title">Matriz de m&eacute;dias por squad</h3>
      <div class="dash-heatmap-wrap">${heatmapHtml(stats)}</div>
      <p class="dash-hint"><strong>Como &eacute; calculado:</strong> cada c&eacute;lula &eacute; a m&eacute;dia daquele crit&eacute;rio entre os clientes ativos (churn exclu&iacute;do) da squad. A &uacute;ltima linha ("M&eacute;dia geral") &eacute; a m&eacute;dia das 5 m&eacute;dias de cada squad &mdash; o mesmo valor do ranking. Cores: verde &ge; 3.5, amarelo 2.5-3.5, vermelho &lt; 2.5; a coluna "Geral" usa todos os clientes ativos de todas as squads.</p>
    </div>

    <div class="dash-section">
      <h3 class="dash-section__title">Palavras-chave nas justificativas</h3>
      <div class="dash-words-wrap">${wordsHtml(stats.perCrit)}</div>
    </div>
  `

  if (typeof Chart === 'undefined') {
    const note = document.createElement('div')
    note.className = 'flags-note'
    note.innerHTML = 'Chart.js nao carregou (verifique a conexao). Os numeros acima e a matriz de medias ja estao disponiveis.'
    container.appendChild(note)
    return
  }

  buildDistChart('chart-dist', stats)
  buildSquadChart('chart-squad', stats)
  buildStackChart('chart-stack', stats)
  buildJustChart('chart-just', stats)
}

export function destroyDashboard() {
  for (const id of Object.keys(charts)) destroyChart(id)
}
