const state = {
  data: null,
  query: '',
  rows: [],
  timelineSprint: 'all',
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

const FIXED_STATUSES = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']

const filterConfig = {
  status: { host: 'boardStatusFilter', label: 'Status', placeholder: 'เลือก Status' },
  squad: { host: 'boardSquadFilter', label: 'Squad', placeholder: 'เลือก Squad' },
  estimateSprint: { host: 'boardEstimateSprintFilter', label: 'Estimate Sprint', placeholder: 'เลือก Estimate Sprint' },
  cabDate: { host: 'boardCabDateFilter', label: 'CAB Date', placeholder: 'เลือก CAB Date' }
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

function toIsoDate(v) {
  if (!v) return ''
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function addDays(iso, delta) {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

function parseSprintNumber(v) {
  const m = String(v || '').match(/(\d+)/)
  return m ? Number(m[1]) : null
}

function overlapsRange(startA, endA, startB, endB) {
  return startA <= endB && endA >= startB
}

function getSprintMap() {
  const items = state.data?.sprintCalendar || []
  return new Map(items.map((x) => [Number(x.sprint), x]))
}

function getTimelineModel(row, sprintMap) {
  const estimateNum = parseSprintNumber(row.parent.estimateSprint || '')
  const actualNum = parseSprintNumber(row.parent.sprint || '')
  const estimateSprint = estimateNum ? sprintMap.get(estimateNum) : null
  const actualSprint = actualNum ? sprintMap.get(actualNum) : null

  let estimateStart = estimateSprint?.start || ''
  let estimateEnd = estimateSprint?.end || ''
  if (!estimateStart && row.parent.estimateSprint) {
    estimateStart = row.parent.created?.slice(0, 10) || ''
    estimateEnd = row.parent.cabDate || estimateStart
  }

  let actualStart = row.parent.sprintStart || actualSprint?.start || estimateStart || row.parent.created?.slice(0, 10) || ''
  let actualEnd = row.parent.sprintEnd || actualSprint?.end || row.parent.cabDate || actualStart
  if (!actualStart) actualStart = estimateStart
  if (!actualEnd) actualEnd = actualStart
  if (estimateStart && !estimateEnd) estimateEnd = estimateStart

  return {
    estimateStart: toIsoDate(estimateStart),
    estimateEnd: toIsoDate(estimateEnd),
    actualStart: toIsoDate(actualStart),
    actualEnd: toIsoDate(actualEnd)
  }
}

function renderSprintAnalysis(rows) {
  const host = document.getElementById('boardSprintAnalysis')
  if (!host) return

  const normalized = (rows || []).map((row) => {
    const estimate = parseSprintNumber(row.parent.estimateSprint || '')
    const actual = parseSprintNumber(row.parent.sprint || '')
    if (!Number.isFinite(estimate) || !Number.isFinite(actual)) return null
    return {
      row,
      diff: actual - estimate
    }
  }).filter(Boolean)

  const total = normalized.length || 1
  const buckets = [
    { key: 'ontime', title: 'ACTUAL = ESTIMATE', sub: 'เริ่มตรงตาม Estimate Sprint', pick: (x) => x.diff === 0 },
    { key: 'ahead', title: 'ACTUAL เร็วกว่า ESTIMATE', sub: 'เริ่มก่อนแผน', pick: (x) => x.diff < 0 },
    { key: 'delay', title: 'ACTUAL ช้ากว่า ESTIMATE', sub: 'เริ่มช้ากว่าแผน', pick: (x) => x.diff > 0 }
  ]

  const cards = buckets.map((bucket) => {
    const items = normalized.filter(bucket.pick)
    const squadMap = new Map()
    for (const item of items) {
      const squad = item.row.parent.squad || 'No Squad'
      squadMap.set(squad, (squadMap.get(squad) || 0) + 1)
    }

    const squads = [...squadMap.entries()]
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .slice(0, 4)

    const maxSquadCount = squads.length ? Math.max(...squads.map((x) => x[1])) : 1
    const pct = Math.round((items.length / total) * 100)

    return `
      <article class="board-analysis-card ${bucket.key}">
        <div class="board-analysis-key">${bucket.title}</div>
        <div class="board-analysis-value-row">
          <div class="board-analysis-value">${items.length}</div>
          <div class="board-analysis-caption">${bucket.sub}</div>
        </div>
        <div class="board-analysis-chip">${pct}% ของรายการที่กำลังดู</div>
        <div class="board-analysis-squads">
          ${squads.map(([name, count]) => `
            <div class="board-analysis-squad-row">
              <div class="board-analysis-squad-head">
                <span>${esc(name)}</span>
                <span>${count} งาน</span>
              </div>
              <div class="board-analysis-squad-bar">
                <span style="width:${Math.max(10, Math.round((count / maxSquadCount) * 100))}%"></span>
              </div>
            </div>
          `).join('') || '<div class="board-analysis-empty">ไม่มีรายการ</div>'}
        </div>
        <div class="board-analysis-sparkline"></div>
      </article>
    `
  }).join('')

  host.innerHTML = cards
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
  if (l.includes('done') || l.includes('complete') || l.includes('closed') || l.includes('resolved') || l.includes('deliver')) return 'badge status-s7'
  if (l.includes('review') || l.includes('test') || l.includes('uat') || l.includes('sit') || l.includes('qa')) return 'badge status-s6'
  if (l.includes('progress') || l.includes('doing') || l.includes('develop')) return 'badge status-s5'
  if (l.includes('todo') || l.includes('open') || l.includes('backlog')) return 'badge status-s3'
  return 'badge status-default'
}

function workItemStatusClass(item) {
  if (String(item.key || '').startsWith('MISQA-')) return 'badge b-misqa'
  return statusBadgeClass(item.status)
}

function workItemRowClass(item) {
  if (String(item.key || '').startsWith('MISQA-')) return 'misqa-item'
  const s = String(item.status || '').toLowerCase()
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

  document.getElementById('boardKpis').innerHTML = cards
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
  renderBoard()
}

function syncBoardScroll() {
  const content = document.getElementById('boardContent')
  const top = document.getElementById('boardTopScroll')
  const inner = document.getElementById('boardTopScrollInner')
  if (!content || !top || !inner) return
  inner.style.width = `${content.scrollWidth}px`
}

function renderBoard() {
  const host = document.getElementById('boardContent')
  const rows = state.rows || []
  renderKpis(state.data?.summary || {}, rows)

  if (!rows.length) {
    host.innerHTML = '<div class="panel empty">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</div>'
    syncBoardScroll()
    return
  }

  const grouped = new Map()
  for (const row of rows) {
    const dateKey = row.parent.cabDate || 'NO_DATE'
    if (!grouped.has(dateKey)) grouped.set(dateKey, [])
    grouped.get(dateKey).push(row)
  }

  const orderedDates = [...grouped.keys()].sort((a, b) => {
    if (a === 'NO_DATE') return 1
    if (b === 'NO_DATE') return -1
    return String(a).localeCompare(String(b))
  })

  host.innerHTML = orderedDates.map((dateKey) => {
    const list = grouped.get(dateKey) || []
    const title = dateKey === 'NO_DATE' ? 'No CAB Date' : formatDate(dateKey)
    const linkedTotal = list.reduce((sum, r) => sum + (r.linkedCount || 0), 0)
    const cards = list.map((row) => {
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
        <article class="panel board-card">
          <div class="board-card-head">
            <div class="board-card-head-left">
              <a class="parent-key" href="${esc(row.parent.browseUrl)}" target="_blank">${esc(row.parent.key)}</a>
              <span class="${statusBadgeClass(row.parent.status)}">${esc(row.parent.status || '-')}</span>
            </div>
            <button class="expand-btn" data-parent="${esc(row.parent.key)}" type="button" aria-expanded="${isOpen ? 'true' : 'false'}">
              <span class="expand-btn-icon">${isOpen ? '▾' : '▸'}</span>
              <span>${isOpen ? 'Less' : 'More'}</span>
            </button>
          </div>
          <div class="board-summary">${esc(row.parent.summary || '-')}</div>
          <div class="progress-line"><div style="width:${Math.max(0, Math.min(100, row.progressPercent || 0))}%"></div></div>
          <div class="progress-meta">
            <span><strong>${esc(row.progressPercent || 0)}%</strong></span>
            <span>Children Done: ${esc(row.progress.doneLinked || 0)}/${esc(row.progress.totalLinked || 0)}</span>
          </div>
          <div class="board-meta">
            <span><strong>Squad:</strong> ${esc(row.parent.squad || '-')}</span>
            <span><strong>Estimate:</strong> ${esc(row.parent.estimateSprint || '-')}</span>
            <span><strong>CAB:</strong> ${esc(formatDate(row.parent.cabDate))}</span>
          </div>
          ${isOpen ? `<div class="work-items">${childRows || '<div class="empty">ไม่มี Child/Linked Items</div>'}</div>` : ''}
        </article>
      `
    }).join('')

    return `
      <section class="panel board-column">
        <div class="board-column-head">
          <div class="board-group-title-wrap">
            <span class="board-group-title">${esc(title)}</span>
            <span class="board-group-sub">Linked ${esc(linkedTotal)} items</span>
          </div>
          <span class="board-group-count">${list.length} งาน</span>
        </div>
        <div class="board-column-body">${cards}</div>
      </section>
    `
  }).join('')

  host.querySelectorAll('.expand-btn').forEach((btn) => {
    btn.addEventListener('click', () => toggleParent(btn.getAttribute('data-parent')))
  })

  syncBoardScroll()
}

function renderSprintTimeline() {
  const host = document.getElementById('boardTimelineGrid')
  if (!host) return

  const rows = state.rows || []
  renderSprintAnalysis(rows)
  const sprintMap = getSprintMap()
  const sprintList = state.data?.sprintCalendar || []
  const selectedSprint = state.timelineSprint
  const selectedSprintItem = selectedSprint === 'all'
    ? null
    : sprintList.find((x) => String(x.sprint) === String(selectedSprint))

  const timelineRows = rows
    .map((row) => ({
      row,
      model: getTimelineModel(row, sprintMap)
    }))
    .filter((x) => x.model.estimateStart || x.model.actualStart)

  if (!timelineRows.length) {
    host.innerHTML = '<div class="empty">ไม่พบข้อมูล Timeline ของรายการที่เลือก</div>'
    return
  }

  let rangeStart = selectedSprintItem?.start || ''
  let rangeEnd = selectedSprintItem?.end || ''

  if (!rangeStart || !rangeEnd) {
    const starts = timelineRows.map((x) => [x.model.estimateStart, x.model.actualStart]).flat().filter(Boolean).sort()
    const ends = timelineRows.map((x) => [x.model.estimateEnd, x.model.actualEnd]).flat().filter(Boolean).sort()
    rangeStart = starts[0] || toIsoDate(new Date().toISOString().slice(0, 10))
    rangeEnd = ends[ends.length - 1] || rangeStart
  }

  rangeStart = addDays(rangeStart, -3)
  rangeEnd = addDays(rangeEnd, 3)

  const startDate = new Date(`${rangeStart}T00:00:00Z`)
  const endDate = new Date(`${rangeEnd}T00:00:00Z`)
  const days = Math.floor((endDate - startDate) / 86400000) + 1
  if (!Number.isFinite(days) || days <= 0) {
    host.innerHTML = '<div class="empty">ไม่สามารถคำนวณช่วงวันที่ได้</div>'
    return
  }

  const visibleRows = timelineRows
    .filter((x) => {
      const start = x.model.estimateStart || x.model.actualStart
      const end = x.model.actualEnd || x.model.estimateEnd || start
      return start && end && overlapsRange(start, end, rangeStart, rangeEnd)
    })
    .slice(0, 30)

  if (!visibleRows.length) {
    host.innerHTML = '<div class="empty">ไม่พบงานในช่วง Sprint ที่เลือก</div>'
    return
  }

  const todayIso = new Date().toISOString().slice(0, 10)
  const todayDate = new Date(`${todayIso}T00:00:00Z`)
  const todayVisible = todayDate >= startDate && todayDate <= endDate
  const todayOffset = todayVisible ? Math.floor((todayDate - startDate) / 86400000) : -1

  function toColumn(iso) {
    const d = new Date(`${iso}T00:00:00Z`)
    if (Number.isNaN(d.getTime())) return null
    return Math.floor((d - startDate) / 86400000) + 2
  }

  function makeBar(startIso, endIso, cssClass, text, tooltip, top) {
    if (!startIso || !endIso) return ''
    if (!overlapsRange(startIso, endIso, rangeStart, rangeEnd)) return ''
    const clampedStart = startIso < rangeStart ? rangeStart : startIso
    const clampedEnd = endIso > rangeEnd ? rangeEnd : endIso
    const startCol = toColumn(clampedStart)
    const endCol = toColumn(clampedEnd)
    if (!startCol || !endCol) return ''
    return `<div class="event-bar grid-bar ${cssClass}" style="grid-column:${startCol} / ${endCol + 1};grid-row:1;top:${top}px" title="${esc(tooltip)}">${esc(text)}</div>`
  }

  const dayHeaders = Array.from({ length: days }, (_, i) => {
    const d = new Date(startDate.getTime())
    d.setUTCDate(d.getUTCDate() + i)
    return `<div class="day-cell ${todayVisible && i === todayOffset ? 'today-cell' : ''}" style="grid-column:${i + 2};grid-row:1;">${d.getUTCDate()}</div>`
  }).join('')

  const rowsHtml = visibleRows.map(({ row, model }) => {
    const estimateTip = `${row.parent.key} Estimate Sprint\n${row.parent.summary}\n${model.estimateStart || '-'} - ${model.estimateEnd || '-'}`
    const actualTip = `${row.parent.key} Actual Sprint\n${row.parent.summary}\n${model.actualStart || '-'} - ${model.actualEnd || '-'}`
    const currentLine = todayVisible
      ? `<div class="board-timeline-current-line" style="grid-column:${todayOffset + 2};grid-row:1;"></div>`
      : ''

    return `
      <div class="timeline-row board-timeline-row" style="grid-template-columns:220px repeat(${days}, minmax(14px, 1fr));">
        <div class="row-label board-timeline-label" style="grid-column:1;grid-row:1;">
          <div><strong><a href="${esc(row.parent.browseUrl)}" target="_blank">${esc(row.parent.key)}</a></strong></div>
          <div class="calendar-item-summary">${esc(row.parent.summary || '-')}</div>
        </div>
        ${Array.from({ length: days }, (_, i) => `<div class="row-day ${todayVisible && i === todayOffset ? 'today-day' : ''}" style="grid-column:${i + 2};grid-row:1;"></div>`).join('')}
        ${currentLine}
        ${makeBar(model.estimateStart, model.estimateEnd, 'board-bar-estimate', 'Estimate', estimateTip, 6)}
        ${makeBar(model.actualStart, model.actualEnd, 'board-bar-actual', 'Actual', actualTip, 30)}
      </div>
    `
  }).join('')

  const currentLineHead = todayVisible
    ? `<div class="board-timeline-current-line board-timeline-current-line-head" style="grid-column:${todayOffset + 2};grid-row:1;"></div>`
    : ''

  const sprintLabel = selectedSprintItem ? `${selectedSprintItem.name}: ${selectedSprintItem.start} - ${selectedSprintItem.end}` : `${rangeStart} - ${rangeEnd}`

  host.innerHTML = `
    <div class="timeline-head board-timeline-head-row" style="grid-template-columns:220px repeat(${days}, minmax(14px, 1fr));">
      <div class="time-label" style="grid-column:1;grid-row:1;"><strong>Sprint Timeline</strong><div style="font-size:11px;color:var(--muted)">${esc(sprintLabel)}</div></div>
      ${dayHeaders}
      ${currentLineHead}
    </div>
    ${rowsHtml}
  `
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
  renderSprintTimeline()
  renderBoard()
}

async function load() {
  try {
    const response = await fetch('/api/dashboard')
    const data = await response.json()
    if (data.error) throw new Error(data.error)

    state.data = data
    const fromApi = data.meta?.available?.statuses || []
    state.options.status = [...new Set([...FIXED_STATUSES, ...fromApi])]
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
    state.filters.estimateSprint = []

    const sprintSelect = document.getElementById('boardTimelineSprint')
    if (sprintSelect) {
      const sprintOptions = (data.sprintCalendar || []).map((x) => `<option value="${esc(x.sprint)}">${esc(x.name)} (${esc(x.start)} - ${esc(x.end)})</option>`).join('')
      sprintSelect.innerHTML = `<option value="all">All Sprints</option>${sprintOptions}`
      state.timelineSprint = 'all'
      sprintSelect.value = state.timelineSprint
    }

    renderFilters()
    applyAll()

    document.getElementById('boardSyncTime').textContent = `อัปเดตล่าสุด: ${new Date(data.generatedAt || Date.now()).toLocaleString('th-TH')}`
  } catch (error) {
    document.getElementById('boardContent').innerHTML = `<div class="panel empty">โหลดข้อมูลไม่สำเร็จ: ${esc(error.message || error)}</div>`
    document.getElementById('boardSyncTime').textContent = 'โหลดข้อมูลล้มเหลว'
  }
}

function bindEvents() {
  document.getElementById('boardSearch').addEventListener('input', (e) => {
    state.query = e.target.value || ''
    applyAll()
  })

  document.getElementById('boardClearBtn').addEventListener('click', () => {
    state.query = ''
    document.getElementById('boardSearch').value = ''
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

  document.getElementById('boardRefreshBtn').addEventListener('click', load)

  const sprintFilter = document.getElementById('boardTimelineSprint')
  if (sprintFilter) {
    sprintFilter.addEventListener('change', (e) => {
      state.timelineSprint = e.target.value || 'all'
      renderSprintTimeline()
    })
  }

  const content = document.getElementById('boardContent')
  const top = document.getElementById('boardTopScroll')
  if (content && top) {
    top.addEventListener('scroll', () => {
      content.scrollLeft = top.scrollLeft
    })
    content.addEventListener('scroll', () => {
      top.scrollLeft = content.scrollLeft
    })
    window.addEventListener('resize', syncBoardScroll)
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.multi')) {
      document.querySelectorAll('.multi.open').forEach((el) => el.classList.remove('open'))
    }
  })
}

bindEvents()
load()
