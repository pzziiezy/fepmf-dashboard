const state = {
  dashboard: null,
  rows: [],
  filtered: [],
  selectedMonth: '',
  visibleCount: 30,
  plans: {},
  selectedKeys: new Set(),
  pickerSearch: '',
  pickerSprintSearch: '',
  pickerSprint: [],
  filters: {
    q: '',
    status: ['S3', 'S4', 'S5']
  },
  sort: {
    key: 'item',
    dir: 'asc'
  },
  statusOptions: [],
  statusSearch: ''
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
}

function toIsoDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function parseSprintNumber(v) {
  const m = String(v || '').match(/\d+/)
  return m ? Number(m[0]) : null
}

function formatDate(v) {
  if (!v) return '-'
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return v
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
}

function statusBadgeClass(status) {
  const s = String(status || '')
  if (s === 'S7') return 'badge status-s7'
  if (s === 'S6') return 'badge status-s6'
  if (s === 'S5') return 'badge status-s5'
  if (s === 'S4') return 'badge status-s4'
  if (s === 'S3') return 'badge status-s3'
  if (s === 'Cancelled') return 'badge status-cancel'
  return 'badge status-default'
}

function getThreeMonthRange() {
  let y
  let m

  if (state.selectedMonth && /^\d{4}-\d{2}$/.test(state.selectedMonth)) {
    const [yy, mm] = state.selectedMonth.split('-').map(Number)
    y = yy
    m = mm - 1
  } else {
    const now = new Date()
    y = now.getUTCFullYear()
    m = now.getUTCMonth()
  }

  const start = new Date(Date.UTC(y, m, 1))
  const end = new Date(Date.UTC(y, m + 3, 0))
  return { start: toIsoDate(start), end: toIsoDate(end) }
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd
}

function addDays(iso, days) {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() + days)
  return toIsoDate(d)
}

function workingDayDiff(fromIso, toIso) {
  if (!fromIso || !toIso) return 0
  const from = new Date(`${fromIso}T00:00:00Z`)
  const to = new Date(`${toIso}T00:00:00Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0
  if (fromIso === toIso) return 0

  const step = from < to ? 1 : -1
  const cur = new Date(from.getTime())
  let count = 0

  while (cur.getTime() !== to.getTime()) {
    cur.setUTCDate(cur.getUTCDate() + step)
    const day = cur.getUTCDay()
    if (day !== 0 && day !== 6) count += step
  }

  return count
}

function sortByKey(a, b) {
  const pa = String(a.parent.key || '').match(/^([A-Z0-9_]+)-(\d+)$/) || []
  const pb = String(b.parent.key || '').match(/^([A-Z0-9_]+)-(\d+)$/) || []
  const ap = pa[1] || String(a.parent.key || '')
  const bp = pb[1] || String(b.parent.key || '')
  if (ap !== bp) return ap.localeCompare(bp)
  const an = Number(pa[2] || Number.MAX_SAFE_INTEGER)
  const bn = Number(pb[2] || Number.MAX_SAFE_INTEGER)
  if (an !== bn) return an - bn
  return String(a.parent.key || '').localeCompare(String(b.parent.key || ''))
}

function buildStatusFilter() {
  const hosts = [document.getElementById('shiftStatusFilter'), document.getElementById('pickerStatusFilter')].filter(Boolean)
  const selected = state.filters.status
  const options = state.statusOptions.filter((v) => String(v).toLowerCase().includes(state.statusSearch.toLowerCase()))
  const label = selected.length ? `${selected[0]}${selected.length > 1 ? ` +${selected.length - 1}` : ''}` : 'เลือก Status'

  function onFilterChanged(keepOpenHost) {
    state.visibleCount = 30
    buildStatusFilter()
    if (keepOpenHost) keepOpenHost.classList.add('open')
    renderProjectPicker()
    applyFilters()
  }

  for (const host of hosts) {
    host.innerHTML = `
      <button class="multi-trigger" type="button"><span class="value">${esc(label)}</span><span class="muted">▾</span></button>
      <div class="multi-panel">
        <div class="multi-search"><input data-role="search" value="${esc(state.statusSearch)}" placeholder="ค้นหา Status" /></div>
        <div class="multi-options">
          ${options.map((value) => `
            <label class="multi-option"><input type="checkbox" value="${esc(value)}" ${selected.includes(value) ? 'checked' : ''} /><span>${esc(value)}</span></label>
          `).join('') || '<div class="mini-empty">ไม่พบค่า</div>'}
        </div>
        <div class="multi-actions">
          <button class="btn" data-role="clear" type="button" style="padding:6px 10px">ล้าง</button>
          <button class="btn" data-role="close" type="button" style="padding:6px 10px">ปิด</button>
        </div>
      </div>
    `

    host.querySelector('.multi-trigger').addEventListener('click', (e) => {
      e.stopPropagation()
      host.classList.toggle('open')
    })

    host.querySelector('[data-role="search"]').addEventListener('input', (e) => {
      state.statusSearch = e.target.value || ''
      buildStatusFilter()
      host.classList.add('open')
    })

    host.querySelectorAll('input[type="checkbox"]').forEach((el) => {
      el.addEventListener('change', () => {
        state.filters.status = [...host.querySelectorAll('input[type="checkbox"]:checked')].map((x) => x.value)
        onFilterChanged(host)
      })
    })

    host.querySelector('[data-role="clear"]').addEventListener('click', () => {
      state.filters.status = []
      state.statusSearch = ''
      onFilterChanged(host)
    })

    host.querySelector('[data-role="close"]').addEventListener('click', () => host.classList.remove('open'))
  }
}

function getSprintMap() {
  return new Map((state.dashboard?.sprintCalendar || []).map((x) => [Number(x.sprint), x]))
}

function sortSprintValues(values = []) {
  return [...values].sort((a, b) => {
    const na = parseSprintNumber(a)
    const nb = parseSprintNumber(b)
    if (na != null && nb != null && na !== nb) return na - nb
    return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' })
  })
}

function sortIndicator(key) {
  if (state.sort.key !== key) return '↕'
  return state.sort.dir === 'asc' ? '↑' : '↓'
}

function renderTableHead() {
  const head = document.getElementById('shiftTableHead')
  if (!head) return

  const cols = [
    { key: 'item', label: 'Item' },
    { key: 'status', label: 'Status' },
    { key: 'currentEstimate', label: 'Current Estimate' },
    { key: 'currentDue', label: 'Current Due' },
    { key: 'newEstimate', label: 'New Estimate Sprint' },
    { key: 'newDue', label: 'New Due Date' },
    { key: 'shiftSprint', label: 'Shift (Sprint)' },
    { key: 'shiftManDay', label: 'Shift (Man-day)' }
  ]

  head.innerHTML = cols.map((c) => `
    <th>
      <button class="sort-btn" type="button" data-sort="${esc(c.key)}">
        <span>${esc(c.label)}</span>
        <span class="sort-mark">${sortIndicator(c.key)}</span>
      </button>
    </th>
  `).join('')
}

function buildPickerSprintFilter() {
  const host = document.getElementById('pickerSprintFilter')
  if (!host) return
  const allValues = sortSprintValues([...new Set(state.rows.map((r) => r.parent.estimateSprint).filter(Boolean))])
  const options = allValues.filter((v) => String(v).toLowerCase().includes(state.pickerSprintSearch.toLowerCase()))
  const selected = state.pickerSprint
  const label = selected.length ? `${selected[0]}${selected.length > 1 ? ` +${selected.length - 1}` : ''}` : 'เลือก Estimate Sprint'

  host.innerHTML = `
    <button class="multi-trigger picker-control" type="button"><span class="value">${esc(label)}</span><span class="muted">▾</span></button>
    <div class="multi-panel">
      <div class="multi-search"><input data-role="search" value="${esc(state.pickerSprintSearch)}" placeholder="ค้นหา Sprint" /></div>
      <div class="multi-options">
        ${options.map((value) => `
          <label class="multi-option"><input type="checkbox" value="${esc(value)}" ${selected.includes(value) ? 'checked' : ''} /><span>${esc(value)}</span></label>
        `).join('') || '<div class="mini-empty">ไม่พบค่า</div>'}
      </div>
      <div class="multi-actions">
        <button class="btn" data-role="clear" type="button" style="padding:6px 10px">ล้าง</button>
        <button class="btn" data-role="close" type="button" style="padding:6px 10px">ปิด</button>
      </div>
    </div>
  `

  host.querySelector('.multi-trigger').addEventListener('click', (e) => {
    e.stopPropagation()
    host.classList.toggle('open')
  })

  host.querySelector('[data-role="search"]').addEventListener('input', (e) => {
    state.pickerSprintSearch = e.target.value || ''
    buildPickerSprintFilter()
    host.classList.add('open')
  })

  host.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.addEventListener('change', () => {
      state.pickerSprint = [...host.querySelectorAll('input[type="checkbox"]:checked')].map((x) => x.value)
      state.visibleCount = 30
      buildPickerSprintFilter()
      host.classList.add('open')
      renderProjectPicker()
      applyFilters()
    })
  })

  host.querySelector('[data-role="clear"]').addEventListener('click', () => {
    state.pickerSprint = []
    state.pickerSprintSearch = ''
    state.visibleCount = 30
    buildPickerSprintFilter()
    host.classList.add('open')
    renderProjectPicker()
    applyFilters()
  })

  host.querySelector('[data-role="close"]').addEventListener('click', () => host.classList.remove('open'))
}

function getPickerVisibleRows() {
  const q = state.pickerSearch.toLowerCase().trim()
  return state.rows.filter((row) => {
    if (state.filters.status.length && !state.filters.status.includes(row.parent.status)) return false
    if (state.pickerSprint.length && !state.pickerSprint.includes(row.parent.estimateSprint || '')) return false
    if (!q) return true
    const blob = `${row.parent.key} ${row.parent.summary} ${row.parent.squad} ${row.parent.status}`.toLowerCase()
    return blob.includes(q)
  })
}

function renderProjectPicker() {
  const list = document.getElementById('pickerList')
  const summary = document.getElementById('pickerSummary')
  const rows = getPickerVisibleRows()
  const selectedCount = state.selectedKeys.size

  summary.textContent = `เลือกแล้ว ${selectedCount} โปรเจ็ค | แสดงใน list ${rows.length}`

  if (!rows.length) {
    list.innerHTML = '<div class="empty">ไม่พบ FEPMF ตามเงื่อนไข</div>'
    return
  }

  list.innerHTML = rows.map((row) => {
    const key = row.parent.key
    const checked = state.selectedKeys.has(key) ? 'checked' : ''
    return `
      <label class="picker-item">
        <input type="checkbox" data-role="pick-project" data-key="${esc(key)}" ${checked} />
        <div>
          <div>
            <strong>${esc(key)}</strong>
            <span class="${statusBadgeClass(row.parent.status)}">${esc(row.parent.status || '-')}</span>
            <span class="picker-estimate">${esc(row.parent.estimateSprint || '-')}</span>
          </div>
          <div class="picker-sub">${esc(row.parent.summary || '-')}</div>
        </div>
      </label>
    `
  }).join('')
}

function ensurePlan(key, row) {
  if (!state.plans[key]) {
    state.plans[key] = {
      newEstimateSprint: row.parent.estimateSprint || '',
      newDueDate: row.parent.cabDate || ''
    }
  }
  return state.plans[key]
}

function computeRowModel(row) {
  const key = row.parent.key
  const sprintMap = getSprintMap()
  const oldSprintNum = parseSprintNumber(row.parent.estimateSprint)
  const oldSprint = oldSprintNum ? sprintMap.get(oldSprintNum) : null

  const baselineStart = oldSprint?.start || row.parent.sprintStart || row.parent.created?.slice(0, 10) || ''
  const baselineEnd = row.parent.cabDate || oldSprint?.end || row.parent.sprintEnd || baselineStart
  const plan = ensurePlan(key, row)
  const newSprintNum = parseSprintNumber(plan.newEstimateSprint)
  const newSprint = newSprintNum ? sprintMap.get(newSprintNum) : null

  const baseDurationDays = (() => {
    if (!baselineStart || !baselineEnd) return 0
    const s = new Date(`${baselineStart}T00:00:00Z`)
    const e = new Date(`${baselineEnd}T00:00:00Z`)
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0
    return Math.max(0, Math.round((e - s) / 86400000))
  })()

  const plannedStart = newSprint?.start || baselineStart
  let plannedEnd = plan.newDueDate || ''
  if (!plannedEnd) {
    plannedEnd = newSprint?.end || addDays(plannedStart, baseDurationDays) || plannedStart
  }

  const sprintShift = oldSprintNum != null && newSprintNum != null ? newSprintNum - oldSprintNum : 0
  const manDayShift = workingDayDiff(baselineStart, plannedStart)

  return {
    row,
    key,
    oldSprintNum,
    baselineStart,
    baselineEnd,
    plannedStart,
    plannedEnd,
    sprintShift,
    manDayShift,
    plan
  }
}

function applyFilters() {
  const { start, end } = getThreeMonthRange()
  const q = state.filters.q.toLowerCase().trim()

  const selectedRows = state.rows
    .filter((row) => {
      if (state.filters.status.length && !state.filters.status.includes(row.parent.status)) return false

      if (q) {
        const blob = `${row.parent.key} ${row.parent.summary} ${row.parent.status} ${row.parent.squad}`.toLowerCase()
        if (!blob.includes(q)) return false
      }

      if (!state.selectedKeys.has(row.parent.key)) return false

      const model = computeRowModel(row)
      const hasBaseline = model.baselineStart && model.baselineEnd && overlaps(model.baselineStart, model.baselineEnd, start, end)
      const hasPlan = model.plannedStart && model.plannedEnd && overlaps(model.plannedStart, model.plannedEnd, start, end)
      return hasBaseline || hasPlan
    })
    .sort(sortByKey)

  state.filtered = state.selectedKeys.size ? selectedRows : []

  renderTimeline()
  renderTable()
}

function renderTimeline() {
  const host = document.getElementById('shiftTimelineGrid')
  const { start, end } = getThreeMonthRange()
  const startDate = new Date(`${start}T00:00:00Z`)
  const endDate = new Date(`${end}T00:00:00Z`)
  const days = Math.floor((endDate - startDate) / 86400000) + 1
  const todayIso = toIsoDate(new Date())
  const todayDate = new Date(`${todayIso}T00:00:00Z`)
  const todayVisible = todayDate >= startDate && todayDate <= endDate
  const todayOffset = todayVisible ? Math.floor((todayDate - startDate) / 86400000) : -1
  const todayLeft = todayVisible ? (todayOffset / days) * 100 : -1
  const todayWidth = 100 / days

  const visible = state.filtered.slice(0, state.visibleCount)

  const dayHeaders = Array.from({ length: days }, (_, i) => {
    const d = new Date(startDate.getTime())
    d.setUTCDate(d.getUTCDate() + i)
    return `<div class="day-cell ${todayVisible && i === todayOffset ? 'today-cell' : ''}">${d.getUTCDate()}</div>`
  }).join('')

  const rowsHtml = visible.map((row) => {
    const model = computeRowModel(row)

    function makeBar(startIso, endIso, cssClass, text, tooltipText, rowTop) {
      if (!startIso || !endIso) return ''
      const s = new Date(`${startIso}T00:00:00Z`)
      const e = new Date(`${endIso}T00:00:00Z`)
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return ''
      if (!overlaps(startIso, endIso, start, end)) return ''

      const clampedStart = s < startDate ? startDate : s
      const clampedEnd = e > endDate ? endDate : e
      const offset = Math.floor((clampedStart - startDate) / 86400000)
      const endOffset = Math.floor((clampedEnd - startDate) / 86400000)
      const left = (offset / days) * 100
      const width = (Math.max(1, endOffset - offset + 1) / days) * 100

      return `<div class="event-bar ${cssClass}" style="left:${left}%;width:${width}%;top:${rowTop}px" title="${esc(tooltipText)}">${esc(text)}</div>`
    }

    const baseTip = `${row.parent.key} Baseline\n${row.parent.summary}\n${model.baselineStart} - ${model.baselineEnd}`
    const planTip = `${row.parent.key} New Plan\n${row.parent.summary}\n${model.plannedStart} - ${model.plannedEnd}`

    return `
      <div class="timeline-row shift-row" style="grid-template-columns:180px repeat(${days}, minmax(14px, 1fr));">
        <div class="row-label">
          <div><strong><a href="${esc(row.parent.browseUrl)}" target="_blank">${esc(row.parent.key)}</a></strong></div>
          <div style="font-size:11px;color:var(--muted)">${esc(row.parent.summary || '-')}</div>
        </div>
        <div class="row-track shift-track" style="grid-column:2 / -1;grid-row:1;">
          ${todayVisible ? `<div class="today-bg" style="left:${todayLeft}%;width:${todayWidth}%"></div>` : ''}
          ${makeBar(model.baselineStart, model.baselineEnd, 'bar-baseline', 'Baseline', baseTip, 4)}
          ${makeBar(model.plannedStart, model.plannedEnd, 'bar-plan', 'New', planTip, 22)}
        </div>
        ${Array.from({ length: days }, () => '<div class="row-day"></div>').join('')}
      </div>
    `
  }).join('')

  host.innerHTML = `
    <div class="timeline-head" style="grid-template-columns:180px repeat(${days}, minmax(14px, 1fr));">
      <div class="time-label"><strong>Timeline</strong><div style="font-size:11px;color:var(--muted)">${start} ถึง ${end}</div></div>
      ${dayHeaders}
    </div>
    ${rowsHtml || '<div class="empty">ไม่พบรายการตามเงื่อนไข</div>'}
  `

  if (!state.selectedKeys.size) {
    document.getElementById('shiftSummary').textContent = `ยังไม่ได้เลือกโปรเจ็คจากฝั่งซ้าย | ช่วง ${start} ถึง ${end}`
  } else {
    document.getElementById('shiftSummary').textContent = `แสดง ${visible.length}/${state.filtered.length} รายการ | ช่วง ${start} ถึง ${end} | Baseline เทียบ New Plan`
  }

  const controls = document.getElementById('shiftControls')
  if (!controls) return

  if (visible.length < state.filtered.length) {
    controls.innerHTML = `<button id="shiftLoadMoreBtn" class="btn" type="button">Load more (${state.filtered.length - visible.length} remaining)</button>`
    document.getElementById('shiftLoadMoreBtn').addEventListener('click', () => {
      state.visibleCount += 30
      renderTimeline()
      renderTable()
    })
  } else if (state.filtered.length > 30) {
    controls.innerHTML = `<button id="shiftShowLessBtn" class="btn" type="button">Show less</button>`
    document.getElementById('shiftShowLessBtn').addEventListener('click', () => {
      state.visibleCount = 30
      renderTimeline()
      renderTable()
    })
  } else {
    controls.innerHTML = ''
  }
}

function renderTable() {
  const body = document.getElementById('shiftTableBody')
  const sprintOptions = state.dashboard?.sprintCalendar || []
  const models = state.filtered.map((row) => computeRowModel(row))

  function cmpText(a, b) {
    return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' })
  }

  function cmpNum(a, b) {
    return Number(a || 0) - Number(b || 0)
  }

  models.sort((a, b) => {
    let diff = 0
    switch (state.sort.key) {
      case 'status':
        diff = cmpText(a.row.parent.status, b.row.parent.status)
        break
      case 'currentEstimate':
        diff = cmpNum(parseSprintNumber(a.row.parent.estimateSprint), parseSprintNumber(b.row.parent.estimateSprint))
        break
      case 'currentDue':
        diff = cmpText(a.row.parent.cabDate, b.row.parent.cabDate)
        break
      case 'newEstimate':
        diff = cmpNum(parseSprintNumber(a.plan.newEstimateSprint), parseSprintNumber(b.plan.newEstimateSprint))
        break
      case 'newDue':
        diff = cmpText(a.plan.newDueDate, b.plan.newDueDate)
        break
      case 'shiftSprint':
        diff = cmpNum(a.sprintShift, b.sprintShift)
        break
      case 'shiftManDay':
        diff = cmpNum(a.manDayShift, b.manDayShift)
        break
      case 'item':
      default:
        diff = cmpText(a.row.parent.key, b.row.parent.key)
        break
    }
    return state.sort.dir === 'asc' ? diff : -diff
  })

  const visible = models.slice(0, state.visibleCount)

  if (!visible.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">${state.selectedKeys.size ? 'ไม่พบข้อมูล' : 'ยังไม่ได้เลือกโปรเจ็คจากฝั่งซ้าย'}</td></tr>`
    renderTableHead()
    return
  }

  body.innerHTML = visible.map((model) => {
    const row = model.row
    const sprintShiftText = model.sprintShift > 0 ? `+${model.sprintShift}` : `${model.sprintShift}`
    const dayShiftText = model.manDayShift > 0 ? `+${model.manDayShift}` : `${model.manDayShift}`
    const sprintClass = model.sprintShift > 0 ? 'impact-bad' : model.sprintShift < 0 ? 'impact-good' : 'impact-neutral'
    const dayClass = model.manDayShift > 0 ? 'impact-bad' : model.manDayShift < 0 ? 'impact-good' : 'impact-neutral'

    return `
      <tr>
        <td>
          <div><strong><a href="${esc(row.parent.browseUrl)}" target="_blank">${esc(row.parent.key)}</a></strong></div>
          <div style="font-size:12px;color:var(--muted)">${esc(row.parent.summary || '-')}</div>
        </td>
        <td><span class="${statusBadgeClass(row.parent.status)}">${esc(row.parent.status || '-')}</span></td>
        <td>${esc(row.parent.estimateSprint || '-')}</td>
        <td>${esc(formatDate(row.parent.cabDate))}</td>
        <td>
          <select data-role="new-sprint" data-key="${esc(row.parent.key)}">
            <option value="">-</option>
            ${sprintOptions.map((sp) => {
              const val = `Sprint${sp.sprint}`
              return `<option value="${esc(val)}" ${model.plan.newEstimateSprint === val ? 'selected' : ''}>${esc(val)} (${esc(sp.start)} - ${esc(sp.end)})</option>`
            }).join('')}
          </select>
        </td>
        <td><input data-role="new-due" data-key="${esc(row.parent.key)}" type="date" value="${esc(model.plan.newDueDate || '')}" /></td>
        <td><span class="shift-pill ${sprintClass}">${esc(sprintShiftText)} Sprint</span></td>
        <td><span class="shift-pill ${dayClass}">${esc(dayShiftText)} Man-day</span></td>
      </tr>
    `
  }).join('')

  renderTableHead()
}

function bindEvents() {
  const monthPicker = document.getElementById('shiftMonthPicker')
  const now = new Date()
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  state.selectedMonth = currentMonth
  monthPicker.value = currentMonth

  monthPicker.addEventListener('change', (e) => {
    state.selectedMonth = e.target.value || currentMonth
    state.visibleCount = 30
    applyFilters()
  })

  document.getElementById('shiftSearch').addEventListener('input', (e) => {
    state.filters.q = e.target.value || ''
    state.visibleCount = 30
    applyFilters()
  })

  document.getElementById('pickerSearch').addEventListener('input', (e) => {
    state.pickerSearch = e.target.value || ''
    renderProjectPicker()
  })

  document.getElementById('pickerSelectAll').addEventListener('click', () => {
    for (const row of getPickerVisibleRows()) state.selectedKeys.add(row.parent.key)
    state.visibleCount = 30
    renderProjectPicker()
    applyFilters()
  })

  document.getElementById('pickerClear').addEventListener('click', () => {
    state.selectedKeys.clear()
    state.visibleCount = 30
    renderProjectPicker()
    applyFilters()
  })

  document.getElementById('pickerList').addEventListener('change', (e) => {
    const role = e.target.getAttribute('data-role')
    const key = e.target.getAttribute('data-key')
    if (role !== 'pick-project' || !key) return

    if (e.target.checked) state.selectedKeys.add(key)
    else state.selectedKeys.delete(key)

    state.visibleCount = 30
    renderProjectPicker()
    applyFilters()
  })

  document.getElementById('shiftTableBody').addEventListener('change', (e) => {
    const role = e.target.getAttribute('data-role')
    const key = e.target.getAttribute('data-key')
    if (!role || !key) return

    if (!state.plans[key]) state.plans[key] = { newEstimateSprint: '', newDueDate: '' }
    if (role === 'new-sprint') state.plans[key].newEstimateSprint = e.target.value || ''
    if (role === 'new-due') state.plans[key].newDueDate = e.target.value || ''

    renderTimeline()
    renderTable()
  })

  document.getElementById('shiftTableHead').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-sort]')
    if (!btn) return
    const key = btn.getAttribute('data-sort')
    if (!key) return

    if (state.sort.key === key) {
      state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc'
    } else {
      state.sort.key = key
      state.sort.dir = 'asc'
    }
    renderTable()
  })

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.multi')) {
      document.querySelectorAll('.multi.open').forEach((el) => el.classList.remove('open'))
    }
  })
}

async function load() {
  const response = await fetch('/api/dashboard')
  const data = await response.json()
  if (data.error) throw new Error(data.error)

  state.dashboard = data
  state.rows = (data.parents || []).filter((row) => ['S3', 'S4', 'S5'].includes(row?.parent?.status)).sort(sortByKey)
  state.statusOptions = (data.meta?.available?.statuses || []).filter((x) => x === 'S3' || x === 'S4' || x === 'S5')
  state.filters.status = ['S3', 'S4', 'S5'].filter((x) => state.statusOptions.includes(x))
  state.visibleCount = 30
  state.selectedKeys.clear()
  state.sort.key = 'item'
  state.sort.dir = 'asc'
  state.pickerSprint = []
  state.pickerSprintSearch = ''

  for (const row of state.rows) ensurePlan(row.parent.key, row)

  buildStatusFilter()
  buildPickerSprintFilter()
  renderProjectPicker()
  applyFilters()
  document.getElementById('shiftSync').textContent = `อัปเดตล่าสุด: ${new Date(data.generatedAt || Date.now()).toLocaleString('th-TH')}`
}

bindEvents()
load().catch((error) => {
  document.getElementById('shiftTimelineGrid').innerHTML = `<div class="empty">โหลดข้อมูลไม่สำเร็จ: ${esc(error.message || error)}</div>`
  document.getElementById('shiftSync').textContent = 'โหลดข้อมูลล้มเหลว'
})
