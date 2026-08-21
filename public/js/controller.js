/**
 * Controller - eventos, CRUD, integracao Model <-> View.
 */
console.log('[controller.js] carregando...')
import { state, loadUser, loadAll, applyFilters, setFilter, clearFilters, setSort, setPage, loadVisibleColumns, saveVisibleColumns, setVisibleColumns, getAllColumnKeys, isAllColumnsVisible } from './model.js'
console.log('[controller.js] model.js OK')
import { DB } from './supabase.js'
console.log('[controller.js] supabase.js OK')
import { render, showModal, hideModal, showToast, showLoader, exportTableData, showClientDetailModal, showColumnsModal, loadColumnWidths, confirmDialog } from './view.js'
console.log('[controller.js] view.js OK')

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)

// -- Auth local (temporario) --
// Em prod, troque por Supabase Auth + RLS policies.
// Aqui, validacao client-side: habilita CRUD se login OK.
const VALID_CREDS = { admin: 'admin', gerente: 'admin', coordenador: 'admin' }

function doLogin(username, password) {
  if (VALID_CREDS[username] && VALID_CREDS[username] === password) {
    const role = username === 'admin' ? 'gerente_operacoes' : 'coordenador'
    state.user = { id: username, email: `${username}@local` }
    state.profile = { id: username, nome: username, role, squad_id: null }
    try { sessionStorage.setItem('cockpit_auth', JSON.stringify(state.profile)) } catch (e) {}
    return state.profile
  }
  return null
}

function restoreSession() {
  try {
    const raw = sessionStorage.getItem('cockpit_auth')
    if (!raw) return null
    const profile = JSON.parse(raw)
    state.user = { id: profile.id, email: `${profile.id}@local` }
    state.profile = profile
    return profile
  } catch (e) {
    return null
  }
}

function logout() {
  state.user = null
  state.profile = null
  try { sessionStorage.removeItem('cockpit_auth') } catch (e) {}
}

function isAuthed() { return !!state.profile }

function showLogin() {
  const html = `
    <div class="login-card">
      <div class="login-card__brand">
        <img class="login-card__mark" src="assets/v4companykloh_logotipo.png" alt="V4 Company" />
        <div class="login-card__brand-text">Gestao de squads | Klohckpit</div>
      </div>
      <form class="login-card__form" id="login-form" autocomplete="on">
        <div id="login-error" class="login-card__error" style="display:none"></div>
        <div class="login-card__field">
          <label class="login-card__label" for="login-user">Usuario</label>
          <input class="login-card__input" type="text" id="login-user" name="username" autocomplete="username" required autofocus />
        </div>
        <div class="login-card__field">
          <label class="login-card__label" for="login-pass">Senha</label>
          <input class="login-card__input" type="password" id="login-pass" name="password" autocomplete="current-password" required />
        </div>
        <button type="submit" class="login-card__submit" id="login-submit">Entrar</button>
      </form>
    </div>
  `
  $('#login-container').innerHTML = html
  $('#login-container').classList.remove('hidden')

  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const user = $('#login-user').value.trim()
    const pass = $('#login-pass').value
    const profile = doLogin(user, pass)
    if (profile) {
      $('#login-container').classList.add('hidden')
      render()
      showToast(`Bem-vindo, ${profile.nome}!`, 'success')
    } else {
      const err = $('#login-error')
      err.textContent = 'Usuario ou senha invalidos'
      err.style.display = ''
    }
  })
}

// -- Filtros --
function bindFilters() {
  $('#filter-squad').addEventListener('change', (e) => {
    setFilter('squad_id', e.target.value)
    // limpa filtros dependentes
    setFilter('coordenador', null)
    setFilter('account', null)
    setFilter('gt', null)
    applyFilters()
    render()
  })
  $('#filter-coordenador').addEventListener('change', (e) => {
    setFilter('coordenador', e.target.value)
    applyFilters(); render()
  })
  $('#filter-account').addEventListener('change', (e) => {
    setFilter('account', e.target.value)
    applyFilters(); render()
  })
  $('#filter-gt').addEventListener('change', (e) => {
    setFilter('gt', e.target.value)
    applyFilters(); render()
  })
  $('#filter-tier').addEventListener('change', (e) => {
    setFilter('tier', e.target.value)
    applyFilters(); render()
  })
  $('#filter-churn').addEventListener('change', (e) => {
    setFilter('churn', e.target.value)
    applyFilters(); render()
  })
  $('#filter-data-inicio').addEventListener('change', (e) => {
    setFilter('data_inicio', e.target.value)
    applyFilters(); render()
  })
  $('#filter-data-fim').addEventListener('change', (e) => {
    setFilter('data_fim', e.target.value)
    applyFilters(); render()
  })

  // search com debounce
  let t
  $('#filter-search').addEventListener('input', (e) => {
    clearTimeout(t)
    t = setTimeout(() => {
      setFilter('search', e.target.value)
      applyFilters(); render()
    }, 300)
  })

  $('#btn-clear-filters').addEventListener('click', () => {
    clearFilters()
    applyFilters(); render()
  })

  $('#btn-novo').addEventListener('click', () => openCreateModal())
  $('#btn-columns').addEventListener('click', () => openColumnsModal())
  $('#btn-import-sheets').addEventListener('click', () => triggerImportFromSheets())
}

// -- Exportacao (Excel / CSV / JSON) --
function bindExports() {
  const btn = $('#btn-export')
  const menu = $('#export-menu')
  if (!btn || !menu) return

  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    menu.classList.toggle('hidden')
  })

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-export]')
    if (!item) return
    menu.classList.add('hidden')
    exportTableData(item.dataset.export)
  })

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#export-dropdown')) menu.classList.add('hidden')
  })

  // Item "Exportar CSV" da sidebar
  const sbc = $('#sidebar-export-csv')
  if (sbc) {
    sbc.addEventListener('click', (e) => {
      e.preventDefault()
      exportTableData('csv')
    })
  }
}

// -- Sidebar collapse --
const SIDEBAR_KEY = 'cockpit_sidebar_collapsed'

function bindSidebarCollapse() {
  const btn = $('#btn-toggle-sidebar')
  if (!btn) return

  // Restaura estado
  try {
    if (localStorage.getItem(SIDEBAR_KEY) === '1') {
      document.body.classList.add('app--sidebar-collapsed')
      updateCollapseBtn(true)
    }
  } catch (e) {}

  btn.addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('app--sidebar-collapsed')
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0') } catch (e) {}
    updateCollapseBtn(collapsed)
  })
}

function updateCollapseBtn(collapsed) {
  const btn = $('#btn-toggle-sidebar')
  if (!btn) return
  const icon = btn.querySelector('.sidebar__collapse-icon')
  const label = btn.querySelector('.sidebar__collapse-label')
  if (icon) icon.innerHTML = collapsed ? '&#9654;' : '&#9664;'
  if (label) label.textContent = collapsed ? 'Expandir' : 'Recolher'
  btn.title = collapsed ? 'Expandir menu' : 'Recolher menu'
}

// -- Importacao via planilhas --
// Mesmo padrao de tratativas.js: tenta o endpoint relativo (Vercel) e,
// sob o XAMPP (404/HTML), cai para o servidor local de dev.
const LOCAL_API = 'http://127.0.0.1:5099'

async function apiPost(path, body) {
  try {
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const ct = resp.headers.get('content-type') || ''
    if (resp.status === 404 || !ct.includes('json')) throw { fallback: true }
    return await resp.json().catch(() => ({ ok: false, error: 'Resposta invalida da API' }))
  } catch (e) {
    if (!e || !e.fallback) console.warn('Fallback para API local:', e)
  }
  const endpoint = path.split('/').pop()
  const resp = await fetch(`${LOCAL_API}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return resp.json()
}

async function triggerImportFromSheets() {
  const btn = $('#btn-import-sheets')
  if (btn) {
    btn.disabled = true
    btn.textContent = 'Importando...'
  }
  try {
    const data = await apiPost('api/import', {})
    if (data.ok) {
      showToast('Importacao concluida! Recarregando...', 'success', 4000)
      await loadAll()
      applyFilters()
      render()
      showToast(`${state.clientes.length} clientes carregados`, 'success')
    } else {
      showToast('Erro: ' + (data.error || data.output || 'Verifique o console'), 'error')
      console.error('Import error:', data)
    }
  } catch (err) {
    showToast('Erro ao conectar: ' + err.message + '. Dica local: rode "python scripts\\local_api.py"', 'error')
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = 'Atualizar via planilhas'
    }
  }
}

// -- Sort --
function bindSort() {
  $$('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      setSort(th.dataset.sort)
      applyFilters(); render()
    })
  })
}

// -- Paginacao --
function bindPagination() {
  $('#btn-prev').addEventListener('click', () => {
    setPage(state.pagination.page - 1)
    render()
  })
  $('#btn-next').addEventListener('click', () => {
    setPage(state.pagination.page + 1)
    render()
  })
}

// -- Table actions (edit/delete/row-click) --
function bindTableActions() {
  $('#table-body').addEventListener('click', async (e) => {
    // Botao de acao (editar/excluir) tem prioridade
    const btn = e.target.closest('button[data-action]')
    if (btn) {
      const id = btn.dataset.id
      if (btn.dataset.action === 'edit') {
        const cliente = state.clientes.find(c => c.id === id)
        if (cliente) openEditModal(cliente)
      } else if (btn.dataset.action === 'delete') {
        const ok = await confirmDialog('Excluir este cliente?', {
          title: 'Excluir cliente',
          okLabel: 'Excluir',
          hint: 'Esta acao nao pode ser desfeita.'
        })
        if (ok) {
          try {
            await DB.deleteCliente(id)
            state.clientes = state.clientes.filter(c => c.id !== id)
            applyFilters(); render()
            showToast('Cliente excluido', 'success')
          } catch (err) {
            showToast('Erro ao excluir: ' + err.message, 'error')
          }
        }
      }
      return
    }

    // Clique em link -> deixa o navegador abrir (nao abre o modal)
    if (e.target.closest('a[href]')) return

    // Clique na linha (mas nao em botao) -> abre detalhes
    const tr = e.target.closest('tr[data-id]')
    if (tr) {
      const id = tr.dataset.id
      const cliente = state.clientes.find(c => c.id === id)
      if (cliente) openClientDetail(cliente)
    }
  })
}

function openClientDetail(cliente) {
  showClientDetailModal(cliente)
  const cancelBtn = document.getElementById('detail-cancel')
  const saveBtn = document.getElementById('detail-save')
  if (cancelBtn) cancelBtn.addEventListener('click', hideModal)
  if (saveBtn) saveBtn.addEventListener('click', () => saveClientDetail(cliente.id))
}

async function saveClientDetail(id) {
  const form = document.getElementById('detail-form')
  if (!form) return
  // Campos booleanos armazenados como TEXT no banco ('Sim'/'Nao')
  const TEXT_BOOL = new Set(['churn_realizado', 'auditado', 'tem_loop_aberto'])
  const payload = {}
  form.querySelectorAll('[data-field]').forEach(el => {
    const key = el.dataset.field
    let val
    if (el.type === 'number') {
      val = el.value === '' ? null : parseFloat(el.value)
    } else if (el.tagName === 'SELECT' && (el.value === 'true' || el.value === 'false')) {
      val = el.value === 'true'
      if (TEXT_BOOL.has(key)) val = val ? 'Sim' : 'Nao'
    } else if (el.tagName === 'SELECT') {
      val = el.value || null
    } else if (el.dataset.format === 'date-br') {
      // Converte dd-MM-yyyy -> yyyy-MM-dd
      const s = el.value.trim()
      const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/)
      val = m ? `${m[3]}-${m[2]}-${m[1]}` : (s === '' ? null : s)
    } else {
      val = el.value
      if (typeof val === 'string') val = val.trim()
      if (val === '') val = null
    }
    payload[key] = val
  })

  if (!payload.nome) {
    showToast('Preencha o nome do cliente', 'error')
    return
  }

  try {
    const updated = await DB.updateCliente(id, payload)
    const idx = state.clientes.findIndex(c => c.id === id)
    if (idx >= 0 && updated) state.clientes[idx] = updated
    hideModal()
    applyFilters(); render()
    showToast('Cliente atualizado', 'success')
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message, 'error')
  }
}

// -- Modal --
function bindModal() {
  $('#modal-close').addEventListener('click', hideModal)
  $('#modal-backdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideModal()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideModal()
  })
}

// -- Create / Edit --
function openCreateModal() {
  const squadsOpts = state.cache.squads.map(s => `<option value="${s.id}">${s.label}</option>`).join('')
  const html = `
    <form id="form-cliente" class="form">
      <div class="form__field">
        <label class="form__label" for="f-squad">Squad *</label>
        <select class="form__select" id="f-squad" required>
          <option value="">Selecione...</option>
          ${squadsOpts}
        </select>
      </div>
      <div class="form__field">
        <label class="form__label" for="f-nome">Cliente *</label>
        <input class="form__input" id="f-nome" required />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-coordenador">Coordenador</label>
        <input class="form__input" id="f-coordenador" />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-account">Account</label>
        <input class="form__input" id="f-account" />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-gt">GT</label>
        <input class="form__input" id="f-gt" />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-fee">Fee (R$)</label>
        <input class="form__input" id="f-fee" type="number" step="0.01" />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-tier">Tier</label>
        <input class="form__input" id="f-tier" />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-arr">ARR (R$)</label>
        <input class="form__input" id="f-arr" type="number" step="0.01" />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-step">Step</label>
        <input class="form__input" id="f-step" />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-flag">Flag</label>
        <input class="form__input" id="f-flag" />
      </div>
      <div class="form__field form__field--full">
        <label class="form__label" for="f-resultados">Resultados / Observacoes</label>
        <textarea class="form__textarea" id="f-resultados"></textarea>
      </div>
    </form>
  `
  const footer = `
    <button class="form__btn form__btn--secondary" onclick="document.getElementById('modal-close').click()">Cancelar</button>
    <button class="form__btn form__btn--primary" id="btn-save">Salvar</button>
  `
  showModal('Novo Cliente', html, footer)
  $('#btn-save').addEventListener('click', () => saveCliente(null))
}

function openEditModal(c) {
  const html = `
    <form id="form-cliente" class="form">
      <div class="form__field">
        <label class="form__label">Squad</label>
        <input class="form__input" value="${c.squad_id}" disabled />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-nome">Cliente</label>
        <input class="form__input" id="f-nome" value="${escapeAttr(c.nome)}" required />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-coordenador">Coordenador</label>
        <input class="form__input" id="f-coordenador" value="${escapeAttr(c.coordenador || '')}" />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-account">Account</label>
        <input class="form__input" id="f-account" value="${escapeAttr(c.account || '')}" />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-gt">GT</label>
        <input class="form__input" id="f-gt" value="${escapeAttr(c.gt || '')}" />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-fee">Fee (R$)</label>
        <input class="form__input" id="f-fee" type="number" step="0.01" value="${c.fee ?? ''}" />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-tier">Tier</label>
        <input class="form__input" id="f-tier" value="${escapeAttr(c.tier || '')}" />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-arr">ARR (R$)</label>
        <input class="form__input" id="f-arr" type="number" step="0.01" value="${c.arr ?? ''}" />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-step">Step</label>
        <input class="form__input" id="f-step" value="${escapeAttr(c.step || '')}" />
      </div>
      <div class="form__field">
        <label class="form__label" for="f-flag">Flag</label>
        <input class="form__input" id="f-flag" value="${escapeAttr(c.flag_calculada || '')}" />
      </div>
      <div class="form__field form__field--full">
        <label class="form__label" for="f-resultados">Resultados / Observacoes</label>
        <textarea class="form__textarea" id="f-resultados">${escapeAttr(c.resultados || '')}</textarea>
      </div>
    </form>
  `
  const footer = `
    <button class="form__btn form__btn--secondary" onclick="document.getElementById('modal-close').click()">Cancelar</button>
    <button class="form__btn form__btn--primary" id="btn-save">Salvar alteracoes</button>
  `
  showModal('Editar Cliente', html, footer)
  $('#btn-save').addEventListener('click', () => saveCliente(c.id))
}

function escapeAttr(s) {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

async function saveCliente(id) {
  const payload = {
    nome: $('#f-nome')?.value?.trim(),
    coordenador: $('#f-coordenador')?.value?.trim() || null,
    account: $('#f-account')?.value?.trim() || null,
    gt: $('#f-gt')?.value?.trim() || null,
    fee: parseFloat($('#f-fee')?.value) || null,
    arr: parseFloat($('#f-arr')?.value) || null,
    tier: $('#f-tier')?.value?.trim() || null,
    step: $('#f-step')?.value?.trim() || null,
    flag_calculada: $('#f-flag')?.value?.trim() || null,
    resultados: $('#f-resultados')?.value?.trim() || null,
  }
  if (id) payload.squad_id = state.clientes.find(c => c.id === id)?.squad_id
  else payload.squad_id = $('#f-squad')?.value

  if (!payload.nome || !payload.squad_id) {
    showToast('Preencha nome e squad', 'error')
    return
  }

  try {
    if (id) {
      const updated = await DB.updateCliente(id, payload)
      const idx = state.clientes.findIndex(c => c.id === id)
      state.clientes[idx] = updated
      showToast('Cliente atualizado', 'success')
    } else {
      const created = await DB.createCliente(payload)
      state.clientes.push(created)
      showToast('Cliente criado', 'success')
    }
    hideModal()
    applyFilters(); render()
  } catch (err) {
    showToast('Erro: ' + err.message, 'error')
  }
}

// -- Auth --
function bindAuth() {
  $('#btn-logout').addEventListener('click', () => {
    logout()
    render()
    showLogin()
    showToast('Voce saiu', 'info')
  })
}

// -- Boot --
export async function boot() {
  console.log('[boot] chamado')
  showLoader(true)
  console.log('[boot] iniciando...')

  const safetyTimeout = setTimeout(() => {
    console.warn('[boot] safety timeout 5s - escondendo loader')
    showLoader(false)
  }, 5000)

  // Declara fora do try para o catch poder usar
  let restored = null

  try {
    // Tenta restaurar sessao anterior
    const restored = restoreSession()
    console.log('[boot] sessao:', restored)

    // Carrega visibilidade de colunas deste usuario
    loadVisibleColumns()
    loadColumnWidths()
    console.log('[boot] colunas visiveis:', state.visibleColumns.size || 'padrao (todas)')

    // Carrega dados sempre (modo leitura funciona sem login)
    console.log('[boot] loadAll...')
    await Promise.race([
      loadAll(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('loadAll timeout 8s')), 8000))
    ])
    console.log('[boot] loadAll OK, clientes:', state.clientes.length)

    bindFilters()
    bindExports()
    bindSidebarCollapse()
    bindSort()
    bindPagination()
    bindTableActions()
    bindModal()
    bindAuth()
    applyFilters()
    render()
    console.log('[boot] render OK')

    // Se nao tinha sessao, mostra tela de login
    if (!restored) {
      showLogin()
    } else {
      showToast(`Sessao restaurada: ${restored.nome}`, 'info', 2000)
    }
  } catch (err) {
    console.error('[boot] ERRO:', err)
    showToast('Erro ao carregar: ' + err.message, 'error', 8000)
    // Mesmo com erro, mostra login para nao travar
    if (!restored) showLogin()
  } finally {
    clearTimeout(safetyTimeout)
    showLoader(false)
    // Garante que o modal generico esta escondido (defesa contra texto estatico "Modal")
    const m = document.getElementById('modal')
    const mb = document.getElementById('modal-backdrop')
    if (m) m.classList.add('hidden')
    if (mb) mb.classList.add('hidden')
    console.log('[boot] loader escondido')
  }
}

// -- Columns modal --
function openColumnsModal() {
  showColumnsModal()

  // Acoes em massa
  $('#cols-select-all').addEventListener('click', () => {
    $$('#modal-body input[data-col]').forEach(cb => cb.checked = true)
  })
  $('#cols-select-none').addEventListener('click', () => {
    $$('#modal-body input[data-col]').forEach(cb => cb.checked = false)
  })
  $('#cols-reset').addEventListener('click', () => {
    setVisibleColumns([])  // vazio = mostra tudo
    hideModal()
    render()
    showToast('Colunas resetadas para o padrao', 'success')
  })

  // Cancelar
  $('#cols-cancel').addEventListener('click', hideModal)

  // Aplicar
  $('#cols-apply').addEventListener('click', () => {
    const keys = []
    $$('#modal-body input[data-col]').forEach(cb => {
      if (cb.checked) keys.push(cb.dataset.col)
    })
    if (keys.length === 0) {
      showToast('Selecione pelo menos uma coluna', 'warning')
      return
    }
    setVisibleColumns(keys)
    hideModal()
    render()
    showToast(`${keys.length} colunas selecionadas`, 'success')
  })
}

// Auto-boot se rodando direto no browser
if (typeof window !== 'undefined') {
  console.log('[controller.js] chamando boot() automaticamente')
  boot()
}

function showLoginPrompt() {
  // Mantida por compat - agora delega para showLogin
  showLogin()
}
