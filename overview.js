const state = {
  data: null,
  query: '',
  rows: [],
  expanded: new Set(),
  filters: {
    status: ['S4', 'S5', 'S6'],
    squad: [],
    estimateSprint: [],
    cabDate: []
  },
  options: {
    status: [],
    squad: [],
    estimateSprint: [],
    cabDate: []
  },
  searchInFilter: {
    status: '',
    squad: '',
    estimateSprint: '',
    cabDate: ''
  }
}

const filterConfig = {
  status: { host: 'statusFilter', label: 'Status', placeholder: 'เลือก Status' },
  squad: { host: 'squadFilter', label: 'Squad', placeholder: 'เลือก Squad' },
  estimateSprint: { host: 'estimateSprintFilter', label: 'Estimate Sprint', placeholder: 'เลือก Estimate Sprint' },
  cabDate: { host: 'cabDateFilter', label: 'CAB Date', placeholder: 'เลือก CAB Date' }
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
}

function textBlob(row) {
  return [
    row.parent.key,
    row.parent.summary,
    row.parent.status,
    row.parent.squad,
    row.parent.estimateSprint,
    row.parent.cabDate,
    ...(row.workItems || []).flatMap((x) => [x.key, x.summary, x.status, x.assignee])
  ].join(' ').toLowerCase()
}

function formatDate(v) {
  if (!v) return '-'
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return v
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
}

function statusBadgeClass(status) {
  const s = String(status || '')
  const l = s.toLowerCase()
  if (s === 'S7') return 'badge status-s7'
  if (s === 'S6') return 'badge status-s6'
  if (s === 'S5') return 'badge status-s5'
  if (s === 'S4') return 'badge status-s4'
  if (s === 'S3') return 'badge status-s3'
  if (s === 'Cancelled') return 'badge status-cancel'
  if (l.includes('cab approved') || l.includes('approved')) return 'badge status-s7'
  if (l.includes('done') || l.includes('complete') || l.includes('closed') || l.includes('resolved') || l.includes('deliver')) return 'badge status-s7'
  if (l.includes('review') || l.includes('test') || l.includes('uat') || l.includes('sit') || l.includes('qa')) return 'badge status-s6'
  if (l.includes('progress') || l.includes('doing') || l.includes('develop')) return 'badge status-s5'
  if (l.includes('todo') || l.includes('to do') || l.includes('open') || l.includes('backlog')) return 'badge status-s3'
  return 'badge status-default'
}

function workItemStatusClass(item) {
  if (String(item.key || '').startsWith('MISQA-')) return 'badge b-misqa'
  return statusBadgeClass(item.status)
}

function workItemRowClass(item) {
  if (String(item.key || '').startsWith('MISQA-')) return 'misqa-item'
  const s = String(item.status || '').toLowerCase()
  if (s.includes('cab approved') || s.includes('approved')) return 'item-done'
  if (s.includes('done') || s.includes('complete') || s.includes('closed') || s.includes('resolved') || s.includes('deliver') || s === 's7') return 'item-done'
  if (s.includes('test') || s.includes('review') || s.includes('uat') || s.includes('sit') || s.includes('qa') || s === 's6') return 'item-test'
  if (s.includes('progress') || s.includes('doing') || s.includes('develop') || s === 's5' || s === 's4') return 'item-progress'
  if (s.includes('open') || s.includes('todo') || s.includes('to do') || s.includes('backlog') || s === 's3' || s === 's2' || s === 's1' || s === 's0') return 'item-open'
  return 'item-default'
}

function renderKpis(summary, rows) {
  const cards = [
    ['Total FEPMF', rows.length, 'จำนวนตามผลการค้นหา/กรอง'],
    ['Linked Items', rows.reduce((sum, r) => sum + (r.linkedCount || 0), 0), 'รวม Child/Linked ของผลลัพธ์'],
    ['Average Progress', `${rows.length ? Math.round(rows.reduce((sum, r) => sum + (r.progressPercent || 0), 0) / rows.length) : 0}%`, 'คำนวณจาก Status ของ Child'],
    ['Current Sprint', summary.currentSprintName || '-', 'สปรินต์ปัจจุบัน', 'kpi-focus-sprint'],
    ['Working Days Left', summary.workingDaysRemaining ?? 0, 'ไม่นับเสาร์-อาทิตย์', 'kpi-focus-days']
  ]

  document.getElementById('kpis').innerHTML = cards
    .map((c) => `<article class="panel kpi ${esc(c[3] || '')}"><div class="kpi-label">${c[0]}</div><div class="kpi-value">${esc(c[1])}</div><div class="kpi-sub">${c[2]}</div></article>`)
    .join('')
}

function filterRows() {
  const q = state.query.trim().toLowerCase()

  state.rows = (state.data?.parents || []).filter((row) => {
    if (q && !textBlob(row).includes(q)) return false

    if (state.filters.status.length && !state.filters.status.includes(row.parent.status)) return false
    if (state.filters.squad.length && !state.filters.squad.includes(row.parent.squad)) return false
    if (state.filters.estimateSprint.length && !state.filters.estimateSprint.includes(row.parent.estimateSprint || row.parent.sprint || '')) return false
    if (state.filters.cabDate.length && !state.filters.cabDate.includes(row.parent.cabDate || '')) return false

    return true
  })
}

function toggleParent(key) {
  if (state.expanded.has(key)) state.expanded.delete(key)
  else state.expanded.add(key)
  renderRows()
}

function renderRows() {
  const host = document.getElementById('content')
  const rows = state.rows || []

  renderKpis(state.data?.summary || {}, rows)

  if (!rows.length) {
    host.innerHTML = '<div class="panel empty">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</div>'
    return
  }

  host.innerHTML = rows
    .map((row) => {
      const isOpen = state.expanded.has(row.parent.key)
      const childRows = (row.workItems || []).map((item) => {
        const rowClass = workItemRowClass(item)
        return `
          <div class="item-row ${rowClass}">
            <div class="item-top">
              <div><a class="item-key" href="${esc(item.browseUrl)}" target="_blank">${esc(item.key)}</a> ${esc(item.summary || '')}</div>
              <div class="${workItemStatusClass(item)}">${esc(item.status || '-')}</div>
            </div>
            <div class="item-meta">Assignee: ${esc(item.assignee || '-')}</div>
          </div>
        `
      }).join('')

      return `
        <article class="panel parent-card">
          <div class="parent-head">
            <div class="parent-main">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <a class="parent-key" href="${esc(row.parent.browseUrl)}" target="_blank">${esc(row.parent.key)}</a>
                <span class="${statusBadgeClass(row.parent.status)}">${esc(row.parent.status || '-')}</span>
              </div>
              <div>${esc(row.parent.summary || '-')}</div>
              <div class="progress-line"><div style="width:${Math.max(0, Math.min(100, row.progressPercent || 0))}%"></div></div>
              <div class="progress-meta">
                <span><strong>${esc(row.progressPercent || 0)}%</strong></span>
                <span>Based on child status formula</span>
                <span>Children Done: ${esc(row.progress.doneLinked || 0)}/${esc(row.progress.totalLinked || 0)}</span>
              </div>
            </div>
            <div class="badges">
              <button class="expand-btn" data-parent="${esc(row.parent.key)}" type="button" aria-expanded="${isOpen ? 'true' : 'false'}">
                <span class="expand-btn-icon">${isOpen ? '▾' : '▸'}</span>
                <span>${isOpen ? 'Less' : 'More'}</span>
              </button>
            </div>
          </div>

          <div class="meta-grid">
            <div><strong>Squad:</strong> ${esc(row.parent.squad || '-')}</div>
            <div><strong>Estimate Sprint:</strong> ${esc(row.parent.estimateSprint || row.parent.sprint || '-')}</div>
            <div><strong>CAB Date:</strong> ${esc(formatDate(row.parent.cabDate))}</div>
            <div><strong>Child Count:</strong> ${esc(row.linkedCount || 0)}</div>
          </div>

          ${isOpen ? `<div class="work-items">${childRows || '<div class="empty">ไม่มี Child/Linked Items</div>'}</div>` : ''}
        </article>
      `
    })
    .join('')

  host.querySelectorAll('.expand-btn').forEach((btn) => {
    btn.addEventListener('click', () => toggleParent(btn.getAttribute('data-parent')))
  })
}

function selectedText(key) {
  const selected = state.filters[key] || []
  if (!selected.length) return filterConfig[key].placeholder
  if (selected.length === 1) return selected[0]
  return `${selected[0]} +${selected.length - 1}`
}

function renderOneFilter(key) {
  const cfg = filterConfig[key]
  const host = document.getElementById(cfg.host)
  const selected = state.filters[key] || []
  const search = (state.searchInFilter[key] || '').toLowerCase()
  const options = (state.options[key] || []).filter((x) => String(x).toLowerCase().includes(search))

  host.innerHTML = `
    <button class="multi-trigger" type="button">
      <span class="value">${esc(selectedText(key))}</span>
      <span class="muted">▾</span>
    </button>
    <div class="multi-panel">
      <div class="multi-search"><input type="text" value="${esc(state.searchInFilter[key] || '')}" placeholder="ค้นหา ${esc(cfg.label)}" data-role="search" /></div>
      <div class="multi-options">
        ${options.map((value) => `
          <label class="multi-option">
            <input type="checkbox" value="${esc(value)}" ${selected.includes(value) ? 'checked' : ''} />
            <span>${esc(value)}</span>
          </label>
        `).join('') || '<div class="mini-empty">ไม่พบค่า</div>'}
      </div>
      <div class="multi-actions">
        <button type="button" class="btn" data-role="clear" style="padding:6px 10px">ล้าง</button>
        <button type="button" class="btn" data-role="close" style="padding:6px 10px">ปิด</button>
      </div>
    </div>
  `

  host.querySelector('.multi-trigger').addEventListener('click', (e) => {
    e.stopPropagation()
    document.querySelectorAll('.multi.open').forEach((el) => { if (el !== host) el.classList.remove('open') })
    host.classList.toggle('open')
  })

  host.querySelector('[data-role="search"]').addEventListener('input', (e) => {
    state.searchInFilter[key] = e.target.value || ''
    renderOneFilter(key)
    host.classList.add('open')
  })

  host.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.addEventListener('change', () => {
      state.filters[key] = [...host.querySelectorAll('input[type="checkbox"]:checked')].map((x) => x.value)
      renderOneFilter(key)
      host.classList.add('open')
      applyAll()
    })
  })

  host.querySelector('[data-role="clear"]').addEventListener('click', () => {
    state.filters[key] = []
    state.searchInFilter[key] = ''
    renderOneFilter(key)
    host.classList.add('open')
    applyAll()
  })

  host.querySelector('[data-role="close"]').addEventListener('click', () => host.classList.remove('open'))
}

function renderFilters() {
  renderOneFilter('status')
  renderOneFilter('squad')
  renderOneFilter('estimateSprint')
  renderOneFilter('cabDate')
}

function applyAll() {
  filterRows()
  renderRows()
}

async function load() {
  try {
    const response = await fetch('/api/dashboard')
    const data = await response.json()
    if (data.error) throw new Error(data.error)

    state.data = data
    state.options.status = data.meta?.available?.statuses || []
    state.options.squad = data.meta?.available?.squads || []
    state.options.estimateSprint = [...new Set((data.parents || []).map((x) => x.parent.estimateSprint || x.parent.sprint || '').filter(Boolean))]
      .sort((a, b) => {
        const na = Number((String(a).match(/\d+/) || [])[0] || Number.MAX_SAFE_INTEGER)
        const nb = Number((String(b).match(/\d+/) || [])[0] || Number.MAX_SAFE_INTEGER)
        if (na !== nb) return na - nb
        return String(a).localeCompare(String(b))
      })
    state.options.cabDate = data.meta?.available?.cabDates || []

    const defaults = ['S4', 'S5', 'S6'].filter((s) => state.options.status.includes(s))
    state.filters.status = defaults.length ? defaults : []

    renderFilters()
    applyAll()

    document.getElementById('syncTime').textContent = `อัปเดตล่าสุด: ${new Date(data.generatedAt || Date.now()).toLocaleString('th-TH')}`
  } catch (error) {
    document.getElementById('content').innerHTML = `<div class="panel empty">โหลดข้อมูลไม่สำเร็จ: ${esc(error.message || error)}</div>`
    document.getElementById('syncTime').textContent = 'โหลดข้อมูลล้มเหลว'
  }
}

function bindEvents() {
  document.getElementById('search').addEventListener('input', (e) => {
    state.query = e.target.value || ''
    applyAll()
  })

  document.getElementById('clearBtn').addEventListener('click', () => {
    state.query = ''
    document.getElementById('search').value = ''
    state.filters.status = ['S4', 'S5', 'S6'].filter((s) => state.options.status.includes(s))
    state.filters.squad = []
    state.filters.estimateSprint = []
    state.filters.cabDate = []
    state.searchInFilter.status = ''
    state.searchInFilter.squad = ''
    state.searchInFilter.estimateSprint = ''
    state.searchInFilter.cabDate = ''
    state.expanded.clear()
    renderFilters()
    applyAll()
  })

  document.getElementById('refreshBtn').addEventListener('click', load)

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.multi')) {
      document.querySelectorAll('.multi.open').forEach((el) => el.classList.remove('open'))
    }
  })
}

bindEvents()
load()
