const state = {
  data: null,
  query: '',
  rows: [],
  filters: {
    status: ['S4', 'S5', 'S6'],
    squad: [],
    cabDate: []
  },
  options: {
    status: [],
    squad: [],
    cabDate: []
  },
  searchInFilter: {
    status: '',
    squad: '',
    cabDate: ''
  }
}

const filterConfig = {
  status: { host: 'statusFilter', label: 'Status', placeholder: 'เลือก Status' },
  squad: { host: 'squadFilter', label: 'Squad', placeholder: 'เลือก Squad' },
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

function kpiCards(summary) {
  return [
    ['Total FEPMF', summary.totalParents, 'จำนวน FEPMF ทั้งหมด'],
    ['Linked Items', summary.totalLinkedItems, 'รวม Child/Linked'],
    ['Average Progress', `${summary.avgProgress || 0}%`, 'ภาพรวมทั้งพอร์ต'],
    ['Current Sprint', summary.currentSprintName || '-', 'สปรินต์ปัจจุบัน'],
    ['Working Days Left', summary.workingDaysRemaining ?? 0, 'ไม่นับเสาร์-อาทิตย์']
  ]
}

function renderKpis(summary) {
  document.getElementById('kpis').innerHTML = kpiCards(summary)
    .map((c) => `<article class="panel kpi"><div class="kpi-label">${c[0]}</div><div class="kpi-value">${esc(c[1])}</div><div class="kpi-sub">${c[2]}</div></article>`)
    .join('')
}

function filterRows() {
  const q = state.query.trim().toLowerCase()

  state.rows = (state.data?.parents || []).filter((row) => {
    if (q && !textBlob(row).includes(q)) return false

    const statusSelected = state.filters.status
    if (statusSelected.length && !statusSelected.includes(row.parent.status)) return false

    const squadSelected = state.filters.squad
    if (squadSelected.length && !squadSelected.includes(row.parent.squad)) return false

    const cabSelected = state.filters.cabDate
    if (cabSelected.length && !cabSelected.includes(row.parent.cabDate || '')) return false

    return true
  })
}

function badgeStatus(status) {
  if (status === 'S7') return 'badge b-safe'
  if (status === 'Cancelled') return 'badge b-risk'
  return 'badge b-status'
}

function workItemBadge(item) {
  if (String(item.key || '').startsWith('MISQA-')) return 'badge b-misqa'
  if (item.status === 'S7') return 'badge b-safe'
  return 'badge b-status'
}

function renderRows() {
  const host = document.getElementById('content')
  const rows = state.rows || []

  if (!rows.length) {
    host.innerHTML = '<div class="panel empty">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</div>'
    return
  }

  host.innerHTML = rows
    .map((row) => {
      const childRows = (row.workItems || []).map((item) => `
        <div class="item-row">
          <div class="item-top">
            <div><a class="item-key" href="${esc(item.browseUrl)}" target="_blank">${esc(item.key)}</a> ${esc(item.summary || '')}</div>
            <div class="${workItemBadge(item)}">${esc(item.status || '-')}</div>
          </div>
          <div class="item-meta">Assignee: ${esc(item.assignee || '-')}</div>
        </div>
      `).join('')

      return `
        <article class="panel parent-card">
          <div class="parent-head">
            <div class="parent-main">
              <a class="parent-key" href="${esc(row.parent.browseUrl)}" target="_blank">${esc(row.parent.key)}</a>
              <div>${esc(row.parent.summary || '-')}</div>
              <div class="progress-line"><div style="width:${Math.max(0, Math.min(100, row.progressPercent || 0))}%"></div></div>
              <div class="progress-meta">
                <span><strong>${esc(row.progressPercent || 0)}%</strong></span>
                <span>Source: ${esc(row.progress.source === 'jira_field' ? 'Jira Field' : 'Calculated')}</span>
                <span>Jira: ${esc(row.progress.jiraPercent ?? '-')}</span>
                <span>Children Done: ${esc(row.progress.doneLinked || 0)}/${esc(row.progress.totalLinked || 0)}</span>
              </div>
            </div>
            <div class="badges">
              <span class="${badgeStatus(row.parent.status)}">${esc(row.parent.status || '-')}</span>
            </div>
          </div>

          <div class="meta-grid">
            <div><strong>Squad:</strong> ${esc(row.parent.squad || '-')}</div>
            <div><strong>Estimate Sprint:</strong> ${esc(row.parent.estimateSprint || row.parent.sprint || '-')}</div>
            <div><strong>CAB Date:</strong> ${esc(formatDate(row.parent.cabDate))}</div>
            <div><strong>Child Count:</strong> ${esc(row.linkedCount || 0)}</div>
          </div>

          <div class="work-items">
            ${childRows || '<div class="empty">ไม่มี Child/Linked Items</div>'}
          </div>
        </article>
      `
    })
    .join('')
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
    state.options.cabDate = data.meta?.available?.cabDates || []

    const allowedDefault = ['S4', 'S5', 'S6'].filter((s) => state.options.status.includes(s))
    state.filters.status = allowedDefault.length ? allowedDefault : []

    renderKpis(data.summary || {})
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
    state.filters.cabDate = []
    state.searchInFilter.status = ''
    state.searchInFilter.squad = ''
    state.searchInFilter.cabDate = ''
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
