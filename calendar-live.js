const LAB_DEFAULT_COLOR = '#b66a00'
const LAB_AUTH_SESSION_KEY = 'planner_actor_session_v1'

const state = {
  plans: [],
  dashboard: null,
  dashboardLoaded: false,
  prefetchedDashboard: null,
  dashboardPrefetchStarted: false,
  backgroundWarmupScheduled: false,
  loadingProjects: false,
  includeProjects: false,
  selectedMonth: '',
  search: '',
  selectedEventId: '',
  inspectorEditingId: '',
  editingId: '',
  todoPlannerTaskMap: new Map(),
  authPending: null,
  inspectorDonePendingId: '',
  filters: {
    status: ['Manual']
  },
  statusOptions: ['Manual'],
  statusSearch: ''
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
}

function setNotice(el, message, type = 'info') {
  if (!el) return
  el.textContent = message || ''
  el.classList.remove('notice-success', 'notice-error')
  if (type === 'success') el.classList.add('notice-success')
  if (type === 'error') el.classList.add('notice-error')
}

function byId(id) {
  return document.getElementById(id)
}

function apiFetch(url, options = {}) {
  return fetch(url, { cache: 'no-store', ...options })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.error) throw new Error(data?.error || 'Request failed')
      return data
    })
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function getStoredActor() {
  try {
    const raw = sessionStorage.getItem(LAB_AUTH_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const email = normalizeEmail(parsed?.email)
    if (!email) return null
    return {
      email,
      displayName: String(parsed?.displayName || '').trim(),
      accountId: String(parsed?.accountId || '').trim()
    }
  } catch {
    return null
  }
}

function storeActor(actor) {
  const email = normalizeEmail(actor?.email)
  if (!email) return
  sessionStorage.setItem(LAB_AUTH_SESSION_KEY, JSON.stringify({
    email,
    displayName: String(actor?.displayName || '').trim(),
    accountId: String(actor?.accountId || '').trim()
  }))
}

function clearStoredActor() {
  sessionStorage.removeItem(LAB_AUTH_SESSION_KEY)
}

async function validateJiraEmail(email) {
  return apiFetch(`/api/jira?action=validate_email&email=${encodeURIComponent(normalizeEmail(email))}`)
}

function closeAuthModal() {
  const modal = byId('labAuthModal')
  if (modal) modal.hidden = true
}

function cancelAuthModal(message = 'Auth cancelled') {
  const pending = state.authPending
  state.authPending = null
  closeAuthModal()
  if (pending?.reject) pending.reject(new Error(message))
}

function openAuthModal(actionLabel = 'do this action') {
  const modal = byId('labAuthModal')
  const subtitle = byId('labAuthSubtitle')
  const emailInput = byId('labAuthEmail')
  const remember = byId('labAuthRemember')
  const status = byId('labAuthStatus')
  if (!modal || !subtitle || !emailInput || !remember || !status) {
    throw new Error('Auth dialog is unavailable on this page')
  }

  const saved = getStoredActor()
  subtitle.textContent = `กรอกอีเมล Jira เพื่อยืนยันก่อน${actionLabel}`
  emailInput.value = saved?.email || ''
  remember.checked = Boolean(saved)
  setNotice(status, '')
  modal.hidden = false
  setTimeout(() => emailInput.focus(), 0)
}

function requestActorAuth(actionLabel) {
  const saved = getStoredActor()
  if (saved) return Promise.resolve(saved)

  return new Promise((resolve, reject) => {
    state.authPending = { actionLabel, resolve, reject }
    openAuthModal(actionLabel)
  })
}

function getBangkokDateParts(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d)
  const read = (type) => parts.find((p) => p.type === type)?.value || ''
  return { year: Number(read('year')), month: Number(read('month')), day: Number(read('day')) }
}

function toIsoDate(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function toBangkokIsoDate(value = new Date()) {
  const parts = getBangkokDateParts(value)
  if (!parts) return ''
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function formatThaiDate(value) {
  if (!value) return '-'
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function formatThaiDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getTwoMonthRange() {
  let year
  let month
  if (state.selectedMonth && /^\d{4}-\d{2}$/.test(state.selectedMonth)) {
    const [yy, mm] = state.selectedMonth.split('-').map(Number)
    year = yy
    month = mm - 1
  } else {
    const today = getBangkokDateParts(new Date())
    year = today?.year || new Date().getUTCFullYear()
    month = (today?.month || (new Date().getUTCMonth() + 1)) - 1
  }
  const start = new Date(Date.UTC(year, month, 1))
  const end = new Date(Date.UTC(year, month + 2, 0))
  return { start: toIsoDate(start), end: toIsoDate(end) }
}

function prefetchAsset(href, as) {
  if (!href || typeof document === 'undefined') return
  if (document.head.querySelector(`link[rel="prefetch"][href="${href}"]`)) return
  const link = document.createElement('link')
  link.rel = 'prefetch'
  if (as) link.as = as
  link.href = href
  document.head.appendChild(link)
}

function applyDashboardData(data) {
  state.dashboard = data
  state.dashboardLoaded = true
  state.prefetchedDashboard = null
  const jiraStatuses = data.meta?.available?.statuses || []
  state.statusOptions = ['Manual', ...jiraStatuses.filter((status) => status !== 'Manual')]
  if (state.filters.status.length === 1 && state.filters.status[0] === 'Manual' && state.includeProjects) {
    state.filters.status = ['Manual']
  }
  buildStatusFilter()
}

async function prefetchDashboardData() {
  if (state.dashboardLoaded || state.prefetchedDashboard || state.dashboardPrefetchStarted) return
  state.dashboardPrefetchStarted = true
  try {
    const response = await fetch('/api/dashboard')
    const data = await response.json()
    if (data?.error) throw new Error(data.error)
    state.prefetchedDashboard = data
  } catch (_error) {
  } finally {
    state.dashboardPrefetchStarted = false
  }
}

function scheduleBackgroundWarmup() {
  if (state.backgroundWarmupScheduled) return
  if (navigator.connection?.saveData) return
  state.backgroundWarmupScheduled = true
  const run = () => {
    prefetchDashboardData()
    ;[
      ['/list.html', 'document'],
      ['/board.html', 'document'],
      ['/misqa-watch.html', 'document'],
      ['/shift-planner.html', 'document'],
      ['/overview.js', 'script'],
      ['/board.js', 'script'],
      ['/misqa-watch.js', 'script'],
      ['/shift-planner.js', 'script']
    ].forEach(([href, as]) => prefetchAsset(href, as))
  }
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 1600 })
  } else {
    window.setTimeout(run, 900)
  }
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd
}

function durationDays(start, end) {
  if (!start || !end) return 0
  const a = new Date(`${start}T00:00:00Z`)
  const b = new Date(`${end}T00:00:00Z`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0
  return Math.floor((b - a) / 86400000) + 1
}

function normalizeHexColor(value, fallback = LAB_DEFAULT_COLOR) {
  const raw = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback
}

function hexToRgba(hex, alpha) {
  const normalized = normalizeHexColor(hex)
  const base = normalized.slice(1)
  const r = Number.parseInt(base.slice(0, 2), 16)
  const g = Number.parseInt(base.slice(2, 4), 16)
  const b = Number.parseInt(base.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function inspectorThemeForStatus(selected) {
  if (selected.source === 'manual') {
    const manualColor = normalizeHexColor(selected.color, LAB_DEFAULT_COLOR)
    return {
      accent: manualColor,
      accentSoft: hexToRgba(manualColor, 0.3),
      accentSurface: hexToRgba(manualColor, 0.16),
      accentBorder: hexToRgba(manualColor, 0.42)
    }
  }

  const palettes = {
    S3: { accent: '#c56b1f', accentSoft: 'rgba(197, 107, 31, 0.3)', accentSurface: 'rgba(255, 233, 205, 0.96)', accentBorder: 'rgba(197, 107, 31, 0.42)' },
    S4: { accent: '#d89418', accentSoft: 'rgba(216, 148, 24, 0.32)', accentSurface: 'rgba(255, 244, 201, 0.96)', accentBorder: 'rgba(216, 148, 24, 0.44)' },
    S5: { accent: '#00a7c4', accentSoft: 'rgba(0, 167, 196, 0.34)', accentSurface: 'rgba(220, 250, 255, 0.98)', accentBorder: 'rgba(0, 167, 196, 0.48)' },
    S6: { accent: '#4667c8', accentSoft: 'rgba(70, 103, 200, 0.3)', accentSurface: 'rgba(226, 233, 255, 0.97)', accentBorder: 'rgba(70, 103, 200, 0.42)' },
    S7: { accent: '#2b9a43', accentSoft: 'rgba(43, 154, 67, 0.34)', accentSurface: 'rgba(224, 250, 228, 0.97)', accentBorder: 'rgba(43, 154, 67, 0.46)' },
    Cancelled: { accent: '#bc4a5f', accentSoft: 'rgba(188, 74, 95, 0.3)', accentSurface: 'rgba(255, 225, 232, 0.96)', accentBorder: 'rgba(188, 74, 95, 0.42)' }
  }

  return palettes[selected.status] || {
    accent: '#4677c8',
    accentSoft: 'rgba(70, 119, 200, 0.3)',
    accentSurface: 'rgba(226, 238, 255, 0.97)',
    accentBorder: 'rgba(70, 119, 200, 0.42)'
  }
}

function statusBadgeClass(status) {
  const s = String(status || '')
  if (s === 'Manual') return 'badge status-manual'
  if (s === 'S7') return 'badge status-s7'
  if (s === 'S6') return 'badge status-s6'
  if (s === 'S5') return 'badge status-s5'
  if (s === 'S4') return 'badge status-s4'
  if (s === 'S3') return 'badge status-s3'
  if (s === 'Cancelled') return 'badge status-cancel'
  return 'badge status-default'
}

function buildMultiFilter(hostId, selected, options, searchText, placeholder, onChange, onSearch, getLabel) {
  const host = document.getElementById(hostId)
  const filtered = (options || []).filter((value) => String(value).toLowerCase().includes(searchText.toLowerCase()))
  const normalizedOptions = [...new Set((options || []).map((value) => String(value)))]
  const normalizedSelected = [...new Set((selected || []).map((value) => String(value)))]
  const label = typeof getLabel === 'function'
    ? getLabel(normalizedSelected, normalizedOptions, placeholder)
    : normalizedSelected.length
      ? `${normalizedSelected[0]}${normalizedSelected.length > 1 ? ` +${normalizedSelected.length - 1}` : ''}`
      : placeholder

  host.innerHTML = `
    <button class="multi-trigger" type="button"><span class="value">${esc(label)}</span><span class="muted">▼</span></button>
    <div class="multi-panel">
      <div class="multi-search"><input data-role="search" value="${esc(searchText)}" placeholder="ค้นหา status" /></div>
      <div class="multi-options">
        ${filtered.map((value) => `
          <label class="multi-option"><input type="checkbox" value="${esc(value)}" ${selected.includes(value) ? 'checked' : ''} /><span>${esc(value)}</span></label>
        `).join('') || '<div class="mini-empty">ไม่พบค่า</div>'}
      </div>
      <div class="multi-actions">
        <button class="btn" data-role="clear" type="button" style="padding:6px 10px">ล้าง</button>
        <button class="btn" data-role="close" type="button" style="padding:6px 10px">ปิด</button>
      </div>
    </div>
  `

  host.querySelector('.multi-trigger').addEventListener('click', (event) => {
    event.stopPropagation()
    host.classList.toggle('open')
  })
  host.querySelector('[data-role="search"]').addEventListener('input', (event) => {
    onSearch(event.target.value || '')
    host.classList.add('open')
  })
  host.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.addEventListener('change', () => {
      const next = [...host.querySelectorAll('input[type="checkbox"]:checked')].map((x) => x.value)
      onChange(next)
      host.classList.add('open')
    })
  })
  host.querySelector('[data-role="clear"]').addEventListener('click', () => {
    onSearch('')
    onChange([])
    host.classList.add('open')
  })
  host.querySelector('[data-role="close"]').addEventListener('click', () => host.classList.remove('open'))
}

function buildStatusFilter() {
  buildMultiFilter(
    'labStatusFilter',
    state.filters.status,
    state.statusOptions,
    state.statusSearch,
    'เลือก Status',
    (next) => {
      state.filters.status = next
      renderAll()
      buildStatusFilter()
    },
    (nextSearch) => {
      state.statusSearch = nextSearch
      buildStatusFilter()
    },
    (selected, options, placeholder) => {
      const optionSet = new Set(options)
      const knownSelected = selected.filter((value) => optionSet.has(value))
      const ratio = options.length ? knownSelected.length / options.length : 0
      if (options.length > 0 && (knownSelected.length >= options.length - 1 || ratio >= 0.85)) {
        return 'All Statuses'
      }
      if (knownSelected.length > 2) return `${knownSelected.length} statuses`
      if (knownSelected.length > 0) return `${knownSelected[0]}${knownSelected.length > 1 ? ` +${knownSelected.length - 1}` : ''}`
      return placeholder
    }
  )
}

function buildManualEvents() {
  return (state.plans || []).map((item) => {
    const plannerTask = state.todoPlannerTaskMap.get(item.id)
    return ({
    id: item.id,
    key: item.key || '-',
    title: item.title,
    status: 'Manual',
    owner: item.owner || '-',
    squad: item.owner || '-',
    start: item.start,
    end: item.end,
    note: item.note || '',
    sprint: item.sprint || '',
    color: item.color || LAB_DEFAULT_COLOR,
    source: 'manual',
    isDone: Boolean(plannerTask?.isDone),
    doneAt: plannerTask?.doneAt || '',
    doneByEmail: plannerTask?.doneByEmail || '',
    todoTaskId: plannerTask?.id || ''
  })
  })
}

function buildProjectEvents() {
  if (!state.dashboard) return []
  const timelineByKey = new Map((state.dashboard.timelineItems || []).map((item) => [item.key, item]))
  return (state.dashboard.parents || []).map((row) => {
    const timeline = timelineByKey.get(row.parent.key)
    if (!timeline) return null
    return {
      id: row.parent.key,
      key: row.parent.key,
      title: row.parent.summary || '',
      status: row.parent.status || '',
      owner: row.parent.assignee || '-',
      squad: row.parent.squad || '-',
      start: timeline.start,
      end: timeline.end,
      note: row.parent.summary || '',
      sprint: row.parent.estimateSprint || row.parent.sprint || '',
      source: 'project',
      url: row.parent.browseUrl || ''
    }
  }).filter(Boolean)
}

function getVisibleEvents() {
  const { start, end } = getTwoMonthRange()
  const q = state.search.trim().toLowerCase()
  const pool = [...buildManualEvents(), ...(state.includeProjects ? buildProjectEvents() : [])]
  return pool.filter((item) => overlaps(item.start, item.end, start, end)).filter((item) => {
    if (state.filters.status.length && !state.filters.status.includes(item.status)) return false
    if (!q) return true
    const haystack = `${item.key} ${item.title} ${item.owner} ${item.note} ${item.squad} ${item.status}`.toLowerCase()
    return haystack.includes(q)
  }).sort((a, b) => {
    if (a.start !== b.start) return String(a.start || '').localeCompare(String(b.start || ''))
    if (a.source !== b.source) return a.source === 'manual' ? -1 : 1
    return String(a.title || '').localeCompare(String(b.title || ''))
  })
}

function getSelectedEvent(events) {
  const selected = events.find((item) => item.id === state.selectedEventId)
  if (selected) return selected
  const fallback = events[0] || null
  state.selectedEventId = fallback?.id || ''
  return fallback
}

async function saveManualPlan(payload, editingId = '') {
  const body = editingId ? { ...payload, id: editingId } : payload
  const response = await fetch('/api/planner', {
    method: editingId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error)
  return data
}

async function loadTodoPlannerTasks() {
  try {
    const data = await apiFetch('/api/todo')
    const items = Array.isArray(data.items) ? data.items : []
    const byPlannerRef = new Map()
    items.forEach((item) => {
      const plannerRefId = String(item.plannerRefId || '').trim()
      if (!plannerRefId) return
      const sourceType = String(item.sourceType || 'todo').trim().toLowerCase()
      const existing = byPlannerRef.get(plannerRefId)
      const existingSource = String(existing?.sourceType || 'todo').trim().toLowerCase()
      const shouldPreferCurrent = !existing || (existingSource === 'planner' && sourceType === 'todo')
      if (shouldPreferCurrent) byPlannerRef.set(plannerRefId, item)
    })
    state.todoPlannerTaskMap = byPlannerRef
  } catch (_error) {
    state.todoPlannerTaskMap = new Map()
  }
}

async function setPlannerDone(selected, nextChecked, actorEmail) {
  const plannerRefId = String(selected?.id || '').trim()
  if (!plannerRefId) throw new Error('Missing planner item id')

  const existingTask = state.todoPlannerTaskMap.get(plannerRefId)
  const doneAt = nextChecked ? new Date().toISOString() : ''
  const doneByEmail = nextChecked ? normalizeEmail(actorEmail) : ''

  if (existingTask) {
    await apiFetch('/api/todo', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: existingTask.id,
        isDone: nextChecked,
        doneAt,
        doneByEmail,
        actorEmail: normalizeEmail(actorEmail)
      })
    })
    return
  }

  if (!nextChecked) return

  await apiFetch('/api/todo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plannerRefId,
      sourceType: 'planner',
      title: selected.title || '',
      key: selected.key || '',
      owner: selected.owner || '',
      note: selected.note || '',
      color: normalizeHexColor(selected.color, LAB_DEFAULT_COLOR),
      start: selected.start || '',
      end: selected.end || '',
      isDone: true,
      doneAt,
      doneByEmail,
      actorEmail: normalizeEmail(actorEmail)
    })
  })
}

async function rebuildCalendarFromTodo() {
  const syncTag = document.getElementById('labSync')
  const btn = document.getElementById('labRebuildTodoBtn')
  if (btn) btn.disabled = true
  setNotice(syncTag, 'Rebuilding calendar from ToDo...')
  try {
    const response = await fetch('/api/planner?action=rebuild_todo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    const data = await response.json()
    if (data.error) throw new Error(data.error)
    await reloadPageData()
    const summary = `Rebuild done | created ${Number(data.created || 0)} | updated ${Number(data.updated || 0)} | deleted ${Number(data.deleted || 0)}`
    setNotice(syncTag, summary, 'success')
  } catch (error) {
    setNotice(syncTag, `Rebuild failed: ${error.message || error}`, 'error')
  } finally {
    if (btn) btn.disabled = false
  }
}

function renderSummary(events) {
  const { start, end } = getTwoMonthRange()
  const message = `${events.length} items | ${start} ถึง ${end} | ${state.includeProjects ? (state.dashboardLoaded ? 'projects loaded' : 'loading projects...') : 'manual fast path'}`
  document.getElementById('labSummary').textContent = message
  document.getElementById('labModeTag').textContent = `Mode: ${state.includeProjects ? 'Manual + Projects' : 'Manual only'}`
}

function renderTimeline(events) {
  const host = document.getElementById('labTimeline')
  if (!events.length) {
    host.innerHTML = '<div class="empty">ไม่พบรายการในช่วงเวลาหรือคำค้นที่เลือก</div>'
    return
  }

  const { start, end } = getTwoMonthRange()
  const startDate = new Date(`${start}T00:00:00Z`)
  const endDate = new Date(`${end}T00:00:00Z`)
  const days = Math.floor((endDate - startDate) / 86400000) + 1
  const todayIso = toBangkokIsoDate(new Date())
  const todayDate = new Date(`${todayIso}T00:00:00Z`)
  const todayOffset = todayDate >= startDate && todayDate <= endDate ? Math.floor((todayDate - startDate) / 86400000) : -1

  const weekCells = []
  let cursor = 0
  while (cursor < days) {
    const d = new Date(startDate.getTime())
    d.setUTCDate(d.getUTCDate() + cursor)
    const weekday = (d.getUTCDay() + 6) % 7
    const span = Math.min(7 - weekday, days - cursor)
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    weekCells.push(`<div class="planner-lab-week" style="grid-column:${cursor + 1} / span ${span}">Week of ${esc(label)}</div>`)
    cursor += span
  }

  const dayHeaders = Array.from({ length: days }, (_, index) => {
    const d = new Date(startDate.getTime())
    d.setUTCDate(d.getUTCDate() + index)
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6
    const weekdayLabel = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).slice(0, 2)
    return `
      <div class="planner-lab-day ${weekend ? 'is-weekend' : ''} ${todayOffset === index ? 'is-today' : ''}" style="grid-column:${index + 1}">
        <span>${weekdayLabel}</span>
        <strong>${d.getUTCDate()}</strong>
      </div>
    `
  }).join('')

  const weekendColumns = Array.from({ length: days }, (_, index) => {
    const d = new Date(startDate.getTime())
    d.setUTCDate(d.getUTCDate() + index)
    return (d.getUTCDay() === 0 || d.getUTCDay() === 6)
      ? `<div class="planner-lab-weekend-column" style="left:calc(var(--lab-col-width) * ${index});width:var(--lab-col-width);"></div>`
      : ''
  }).join('')

  const rows = events.map((item) => {
    const eventStart = new Date(`${item.start}T00:00:00Z`)
    const eventEnd = new Date(`${item.end}T00:00:00Z`)
    const clampedStart = eventStart < startDate ? startDate : eventStart
    const clampedEnd = eventEnd > endDate ? endDate : eventEnd
    const startOffset = Math.floor((clampedStart - startDate) / 86400000)
    const endOffset = Math.floor((clampedEnd - startDate) / 86400000)
    const startColumn = startOffset + 1
    const span = Math.max(1, endOffset - startOffset + 1)
    const isSelected = item.id === state.selectedEventId
    const barStyle = item.source === 'manual'
      ? `style="grid-column:${startColumn} / span ${span};--lab-bar:${esc(item.color || LAB_DEFAULT_COLOR)}"`
      : `style="grid-column:${startColumn} / span ${span}"`
    const barLabel = item.key && item.key !== '-' ? `${item.key} : ${item.title}` : item.title

    return `
      <div class="planner-lab-row ${isSelected ? 'selected' : ''}">
        <div class="planner-lab-track">
          ${Array.from({ length: days }, (_, dayIndex) => {
            return `<div class="planner-lab-track-day"></div>`
          }).join('')}
          ${weekendColumns}
          ${todayOffset >= 0 ? `<div class="planner-lab-today-column" style="left:calc(var(--lab-col-width) * ${todayOffset});width:var(--lab-col-width);"></div>` : ''}
          <button class="planner-lab-bar ${item.source === 'manual' ? 'manual' : 'project'} ${isSelected ? 'selected' : ''}" type="button" data-event-id="${esc(item.id)}" ${barStyle}><span>${esc(barLabel)}</span></button>
        </div>
      </div>
    `
  }).join('')

  host.innerHTML = `
    <div class="planner-lab-timeline-shell" style="--lab-days:${days}">
      <div class="planner-lab-head">
        ${weekCells.join('')}
        ${dayHeaders}
      </div>
      <div class="planner-lab-body">${rows}</div>
    </div>
  `

  host.querySelectorAll('[data-event-id]').forEach((node) => {
    node.addEventListener('click', () => {
      state.selectedEventId = node.getAttribute('data-event-id') || ''
      renderAll()
    })
  })
}

function renderInspector(selected) {
  const host = document.getElementById('labInspector')
  if (!selected) {
    host.innerHTML = '<div class="empty">เลือกรายการจาก timeline เพื่อดูรายละเอียด</div>'
    return
  }

  const isEditingInline = selected.source === 'manual' && state.inspectorEditingId === selected.id
  const theme = inspectorThemeForStatus(selected)
  const themeStyle = `style="--inspector-accent:${esc(theme.accent)};--inspector-accent-soft:${esc(theme.accentSoft)};--inspector-surface:${esc(theme.accentSurface)};--inspector-border:${esc(theme.accentBorder)}"`
  if (isEditingInline) {
    host.innerHTML = `
      <div class="planner-lab-inspector-card manual" ${themeStyle}>
        <div class="planner-lab-inspector-top">
          <div>
            <div class="planner-lab-inspector-key">${esc(selected.key || '-')}</div>
            <div class="planner-lab-inspector-title">Edit Manual Plan</div>
          </div>
          <span class="${statusBadgeClass(selected.status)}">${esc(selected.status)}</span>
        </div>
        <form id="labInspectorForm" class="planner-lab-inspector-form">
          <label class="field"><span>Project Title *</span><input name="title" value="${esc(selected.title || '')}" required /></label>
          <label class="field"><span>Key</span><input name="key" value="${esc(selected.key === '-' ? '' : (selected.key || ''))}" /></label>
          <label class="field"><span>Owner</span><input name="owner" value="${esc(selected.owner || '')}" /></label>
          <label class="field"><span>Sprint</span><input name="sprint" value="${esc(selected.sprint || '')}" /></label>
          <label class="field"><span>Start Date *</span><input type="date" name="start" value="${esc(selected.start || '')}" required /></label>
          <label class="field"><span>End Date *</span><input type="date" name="end" value="${esc(selected.end || '')}" required /></label>
          <label class="field full"><span>Color</span><input type="color" name="color" value="${esc(selected.color || LAB_DEFAULT_COLOR)}" /></label>
          <label class="field full"><span>Note</span><textarea name="note">${esc(selected.note || '')}</textarea></label>
          <div class="planner-lab-inspector-actions">
            <button class="btn primary" type="submit">บันทึก</button>
            <button class="btn" type="button" id="labInspectorCancelBtn">ยกเลิก</button>
            <span id="labInspectorStatus" class="notice"></span>
          </div>
        </form>
      </div>
    `

    document.getElementById('labInspectorCancelBtn')?.addEventListener('click', () => {
      state.inspectorEditingId = ''
      renderAll()
    })

    document.getElementById('labInspectorForm')?.addEventListener('submit', async (event) => {
      event.preventDefault()
      const status = document.getElementById('labInspectorStatus')
      setNotice(status, 'กำลังบันทึก...')
      try {
        const payload = Object.fromEntries(new FormData(event.currentTarget).entries())
        await saveManualPlan(payload, selected.id)
        state.inspectorEditingId = ''
        await loadManualPlans()
        renderAll()
      } catch (error) {
        setNotice(status, `ไม่สำเร็จ: ${error.message || error}`, 'error')
      }
    })
    return
  }

  host.innerHTML = `
    <div class="planner-lab-inspector-card ${selected.source}" ${themeStyle}>
      <div class="planner-lab-inspector-top">
        <div>
          <div class="planner-lab-inspector-title">${esc(selected.title)}</div>
          <div class="planner-lab-inspector-key">${esc(selected.key || '-')}</div>
        </div>
        <span class="${statusBadgeClass(selected.status)}">${esc(selected.status)}</span>
      </div>
      <div class="planner-lab-inspector-note planner-lab-inspector-note-compact">${esc(formatThaiDate(selected.start))} - ${esc(formatThaiDate(selected.end))} | ${esc(String(durationDays(selected.start, selected.end)))} วัน | ${esc(selected.source === 'manual' ? (selected.owner || '-') : (selected.squad || '-'))}</div>
      <div class="planner-lab-inspector-grid">
        <div><span>Source</span><strong>${esc(selected.source)}</strong></div>
        <div><span>Duration</span><strong>${esc(String(durationDays(selected.start, selected.end)))} วัน</strong></div>
        <div><span>Start</span><strong>${esc(formatThaiDate(selected.start))}</strong></div>
        <div><span>End</span><strong>${esc(formatThaiDate(selected.end))}</strong></div>
        <div><span>Owner / Squad</span><strong>${esc(selected.source === 'manual' ? (selected.owner || '-') : (selected.squad || '-'))}</strong></div>
        <div><span>Sprint</span><strong>${esc(selected.sprint || '-')}</strong></div>
      </div>
      <div class="planner-lab-inspector-note">${esc(selected.note || 'ไม่มี note เพิ่มเติม')}</div>
      ${selected.source === 'manual' && selected.isDone ? `<div class="planner-lab-inspector-note">Done ${esc(formatThaiDateTime(selected.doneAt))}${selected.doneByEmail ? ` | By ${esc(selected.doneByEmail)}` : ''}</div>` : ''}
      <div class="planner-lab-inspector-actions">
        ${selected.source === 'manual' ? `<button class="btn ${selected.isDone ? '' : 'primary'}" type="button" id="labInspectorDoneBtn">${selected.isDone ? 'Undo Done' : 'Done'}</button>` : ''}
        ${selected.source === 'manual' ? `<button class="btn" type="button" id="labInspectorEditBtn">แก้ไขแผนงาน</button>` : ''}
        ${selected.url ? `<a class="btn primary" href="${esc(selected.url)}" target="_blank" rel="noopener noreferrer">Open Jira</a>` : ''}
        ${selected.source === 'manual' ? '<span id="labInspectorActionStatus" class="notice"></span>' : ''}
      </div>
    </div>
  `

  if (selected.source === 'manual') {
    const doneBtn = document.getElementById('labInspectorDoneBtn')
    doneBtn?.addEventListener('click', async () => {
      if (state.inspectorDonePendingId === selected.id) return
      const status = byId('labInspectorActionStatus')
      doneBtn.disabled = true
      state.inspectorDonePendingId = selected.id
      setNotice(status, selected.isDone ? 'Updating done status...' : 'Marking as done...')
      try {
        const actor = await requestActorAuth(selected.isDone ? 'ยกเลิก done' : 'เปลี่ยนสถานะ done')
        const actorEmail = normalizeEmail(actor?.email)
        if (!actorEmail) throw new Error('Jira email is required')
        await setPlannerDone(selected, !selected.isDone, actorEmail)
        await loadTodoPlannerTasks()
        renderAll()
      } catch (error) {
        setNotice(status, error.message || 'Unable to update done status', 'error')
      } finally {
        state.inspectorDonePendingId = ''
        doneBtn.disabled = false
      }
    })

    const editBtn = document.getElementById('labInspectorEditBtn')
    editBtn?.addEventListener('click', () => {
      state.inspectorEditingId = selected.id
      renderAll()
    })
  }
}

function setEditMode(item) {
  const form = document.getElementById('labPlanForm')
  const cancelBtn = document.getElementById('labCancelBtn')
  const saveBtn = document.getElementById('labSaveBtn')

  if (!item) {
    state.editingId = ''
    form.reset()
    form.elements.color.value = LAB_DEFAULT_COLOR
    cancelBtn.style.display = 'none'
    saveBtn.textContent = 'บันทึกแผนงาน'
    return
  }

  state.editingId = item.id
  form.elements.title.value = item.title || ''
  form.elements.key.value = item.key || ''
  form.elements.owner.value = item.owner || ''
  form.elements.start.value = item.start || ''
  form.elements.end.value = item.end || ''
  form.elements.color.value = item.color || LAB_DEFAULT_COLOR
  form.elements.sprint.value = item.sprint || ''
  form.elements.note.value = item.note || ''
  cancelBtn.style.display = ''
  saveBtn.textContent = 'อัปเดตแผนงาน'
}

function renderManualList() {
  const host = document.getElementById('labManualList')
  if (!state.plans.length) {
    host.innerHTML = '<div class="empty">ยังไม่มี Manual plan ในช่วงเวลาที่เลือก</div>'
    return
  }

  host.innerHTML = state.plans.map((item) => `
    <div class="item-row planner-lab-manual-card">
      <div class="item-top">
        <div>
          <strong>${esc(item.title)}</strong>
          ${item.key ? `<span class="planner-lab-inline-key" style="--lab-key-color:${esc(item.color || LAB_DEFAULT_COLOR)}">${esc(item.key)}</span>` : ''}
        </div>
        <span class="badge status-default">${esc(item.start)} - ${esc(item.end)}</span>
      </div>
      <div class="item-meta">Owner: ${esc(item.owner || '-')} | Sprint: ${esc(item.sprint || '-')} | ${esc(durationDays(item.start, item.end))} วัน</div>
      <div class="item-meta">${esc(item.note || '')}</div>
      <div class="planner-lab-manual-foot">
        <span class="planner-lab-color-chip" style="background:${esc(item.color || LAB_DEFAULT_COLOR)}"></span>
        <div class="planner-lab-manual-actions">
          <button class="btn" type="button" data-action="select" data-id="${esc(item.id)}">ดูบน timeline</button>
          <button class="btn" type="button" data-action="edit" data-id="${esc(item.id)}">แก้ไข</button>
          <button class="btn" type="button" data-action="delete" data-id="${esc(item.id)}">ลบ</button>
        </div>
      </div>
    </div>
  `).join('')

  host.querySelectorAll('button[data-action="select"]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedEventId = button.getAttribute('data-id') || ''
      renderAll()
    })
  })

  host.querySelectorAll('button[data-action="edit"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-id')
      const item = state.plans.find((plan) => plan.id === id)
      if (item) setEditMode(item)
    })
  })

  host.querySelectorAll('button[data-action="delete"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-id')
      if (!id || !confirm('ยืนยันลบรายการนี้?')) return
      const status = document.getElementById('labFormStatus')
      setNotice(status, 'กำลังลบ...')
      try {
        const response = await fetch('/api/planner', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        })
        const data = await response.json()
        if (data.error) throw new Error(data.error)
        setNotice(status, 'ลบเรียบร้อย', 'success')
        await loadManualPlans()
        renderAll()
      } catch (error) {
        setNotice(status, `ลบไม่สำเร็จ: ${error.message || error}`, 'error')
      }
    })
  })
}

async function loadManualPlans() {
  const { start, end } = getTwoMonthRange()
  const response = await fetch(`/api/planner?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&entityType=manual`)
  const data = await response.json()
  if (data.error) throw new Error(data.error)
  state.plans = Array.isArray(data.items) ? data.items : []
  document.getElementById('labSync').textContent = `Manual synced ${new Date().toLocaleString('th-TH')}`
}

async function ensureDashboardLoaded() {
  if (state.dashboardLoaded || state.loadingProjects) return
  if (state.prefetchedDashboard) {
    applyDashboardData(state.prefetchedDashboard)
    return
  }
  state.loadingProjects = true
  document.getElementById('labModeTag').textContent = 'Mode: Loading projects...'
  try {
    const response = await fetch('/api/dashboard')
    const data = await response.json()
    if (data.error) throw new Error(data.error)
    applyDashboardData(data)
  } finally {
    state.loadingProjects = false
  }
}

function renderAll() {
  const events = getVisibleEvents()
  const selected = getSelectedEvent(events)
  renderSummary(events)
  renderTimeline(events)
  renderInspector(selected)
  renderManualList()
  document.getElementById('labManualOnlyBtn').classList.toggle('primary', !state.includeProjects)
  document.getElementById('labBlendBtn').classList.toggle('primary', state.includeProjects)
}

async function reloadPageData() {
  await loadManualPlans()
  await loadTodoPlannerTasks()
  if (state.includeProjects) await ensureDashboardLoaded()
  renderAll()
  scheduleBackgroundWarmup()
}

function bindEvents() {
  byId('labAuthCancel')?.addEventListener('click', () => cancelAuthModal())
  byId('labAuthBackdrop')?.addEventListener('click', () => cancelAuthModal())
  byId('labAuthForm')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const pending = state.authPending
    if (!pending) return

    const email = normalizeEmail(byId('labAuthEmail')?.value)
    const remember = Boolean(byId('labAuthRemember')?.checked)
    const status = byId('labAuthStatus')
    const confirmBtn = byId('labAuthConfirm')

    if (!email) {
      setNotice(status, 'กรุณากรอกอีเมล Jira', 'error')
      return
    }

    try {
      if (confirmBtn) confirmBtn.disabled = true
      setNotice(status, 'กำลังตรวจสอบอีเมลกับ Jira...')
      const result = await validateJiraEmail(email)
      if (!result?.valid) throw new Error(result?.reason || 'ไม่พบอีเมลนี้ใน Jira')

      const actor = {
        email: normalizeEmail(result?.user?.email || email),
        displayName: String(result?.user?.displayName || '').trim(),
        accountId: String(result?.user?.accountId || '').trim()
      }

      if (remember) storeActor(actor)
      else clearStoredActor()

      state.authPending = null
      closeAuthModal()
      pending.resolve(actor)
    } catch (error) {
      setNotice(status, error.message || 'ยืนยันตัวตนไม่สำเร็จ', 'error')
    } finally {
      if (confirmBtn) confirmBtn.disabled = false
    }
  })

  const picker = document.getElementById('labMonthPicker')
  const today = getBangkokDateParts(new Date())
  const currentMonth = `${today.year}-${String(today.month).padStart(2, '0')}`
  state.selectedMonth = currentMonth
  picker.value = currentMonth
  buildStatusFilter()

  picker.addEventListener('change', async (event) => {
    state.selectedMonth = event.target.value || currentMonth
    await reloadPageData()
  })

  document.getElementById('labSearch').addEventListener('input', (event) => {
    state.search = event.target.value || ''
    renderAll()
  })

  document.getElementById('labRebuildTodoBtn')?.addEventListener('click', async () => {
    if (!confirm('Rebuild Calendar from ToDo now?')) return
    await rebuildCalendarFromTodo()
  })

  document.getElementById('labManualOnlyBtn').addEventListener('click', () => {
    state.includeProjects = false
    state.statusOptions = ['Manual']
    state.filters.status = state.filters.status.filter((status) => status === 'Manual')
    if (!state.filters.status.length) state.filters.status = ['Manual']
    buildStatusFilter()
    renderAll()
  })

  document.getElementById('labBlendBtn').addEventListener('click', async () => {
    state.includeProjects = true
    renderAll()
    try {
      await ensureDashboardLoaded()
      renderAll()
    } catch (error) {
      state.includeProjects = false
      setNotice(document.getElementById('labSummary'), `โหลด project timeline ไม่สำเร็จ: ${error.message || error}`, 'error')
      renderAll()
    }
  })

  document.getElementById('labCancelBtn').addEventListener('click', () => {
    setEditMode(null)
    setNotice(document.getElementById('labFormStatus'), '')
  })

  document.getElementById('labPlanForm').addEventListener('submit', async (event) => {
    event.preventDefault()
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries())
    const status = document.getElementById('labFormStatus')
    setNotice(status, state.editingId ? 'กำลังอัปเดต...' : 'กำลังบันทึก...')

    try {
      const data = await saveManualPlan(payload, state.editingId)
      setNotice(status, state.editingId ? 'อัปเดตเรียบร้อย' : 'บันทึกเรียบร้อย', 'success')
      setEditMode(null)
      await loadManualPlans()
      if (!state.selectedEventId) state.selectedEventId = data.item?.id || ''
      renderAll()
    } catch (error) {
      setNotice(status, `ไม่สำเร็จ: ${error.message || error}`, 'error')
    }
  })

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.multi')) {
      document.querySelectorAll('.multi.open').forEach((el) => el.classList.remove('open'))
    }
  })
}

bindEvents()
setEditMode(null)
reloadPageData().catch((error) => {
  document.getElementById('labTimeline').innerHTML = `<div class="empty">โหลดข้อมูลไม่สำเร็จ: ${esc(error.message || error)}</div>`
  document.getElementById('labSync').textContent = 'โหลดข้อมูลล้มเหลว'
})
