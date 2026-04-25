const state = {
  data: null,
  rows: [],
  query: '',
  status: 'all',
  compare: 'all',
  statusSelections: [],
  compareSelections: [],
  businessTypes: [],
  businessPartners: [],
  statusView: 'bar',
  kpiModalStatus: null,
  kpiModalSort: { key: 'fepmf', dir: 'asc' },
  riskItcmTab: 'all',
  riskSort: { key: 'itcm', dir: 'asc' },
  tableQuery: '',
  partnerFocus: 'ALL',
  typeFocus: 'ALL',
  partnerSort: { key: 'fepmf', dir: 'asc' },
  typeSort: { key: 'fepmf', dir: 'asc' },
  bizDateSort: { key: 'evaluate', dir: 'asc' },
  bizDateQuery: '',
  smartDateFrom: '',
  smartDateTo: '',
  partnerViz: 'pie',
  typeViz: 'pie'
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
}

function formatDate(value) {
  if (!value) return '-'
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
}

function safeDate(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function dateKeyBkk(value) {
  const d = safeDate(value)
  if (!d) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d)
}

function todayIsoLocal() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function firstDayPrevMonthIsoLocal() {
  const now = new Date()
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const y = prevMonthDate.getFullYear()
  const m = String(prevMonthDate.getMonth() + 1).padStart(2, '0')
  const d = String(prevMonthDate.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function badgeClass(status) {
  const s = String(status || '')
  if (s === 'S7') return 'badge status-s7'
  if (s === 'S6') return 'badge status-s6'
  if (s === 'S5') return 'badge status-s5'
  if (s === 'S4') return 'badge status-s4'
  if (s === 'S3') return 'badge status-s3'
  if (s === 'Cancelled') return 'badge status-cancel'
  return 'badge status-default'
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeMultiValues(value) {
  if (value == null) return []
  if (Array.isArray(value)) return [...new Set(value.flatMap(normalizeMultiValues).filter(Boolean))]
  if (typeof value === 'object') {
    const preferred = [value.value, value.name, value.displayName, value.label]
      .flatMap((v) => normalizeMultiValues(v))
      .filter(Boolean)
    if (preferred.length) return [...new Set(preferred)]
    return [...new Set(Object.values(value).flatMap(normalizeMultiValues).filter(Boolean))]
  }
  return String(value)
    .split(/[|,]/)
    .map((v) => String(v || '').trim())
    .filter(Boolean)
}

function parseSprintNumber(value) {
  const text = String(value || '')
  const m = text.match(/sprint\s*([0-9]+)/i)
  return m ? Number(m[1]) : null
}

function deriveCompareType(estimate, actual) {
  if (estimate == null || actual == null) return 'na'
  if (actual === estimate) return 'equal'
  if (actual < estimate) return 'early'
  return 'late'
}

function isS7Status(status) {
  return String(status || '').trim().toUpperCase().startsWith('S7')
}

function isCompletedCurrentSprintStatus(status) {
  const text = String(status || '').trim().toUpperCase()
  return text.startsWith('S6') || text.startsWith('S7')
}

function isCancelledStatus(status) {
  const text = String(status || '').trim().toUpperCase()
  return text === 'CANCELLED' || text === 'CANCELED'
}

function compareLabel(type) {
  if (type === 'equal') return 'Equal'
  if (type === 'early') return 'Actual เร็วกว่า'
  if (type === 'late') return 'Actual ช้ากว่า'
  return 'N/A'
}

function itcmItems(row) {
  return (row.workItems || []).filter((item) => String(item.key || '').toUpperCase().startsWith('ITCM-'))
}

function enrichRow(row) {
  const estimateNum = parseSprintNumber(row.parent.estimateSprint)
  const actualNum = parseSprintNumber(row.parent.actualStartSprint)
  const compareType = deriveCompareType(estimateNum, actualNum)
  const itcms = itcmItems(row)
  const itcmKeys = [...new Set(itcms.map((item) => item.key).filter(Boolean))]
  const itcmStatuses = [...new Set(itcms.map((item) => item.status || '-'))]
  const businessTypes = normalizeMultiValues(row.parent.businessType)
  const businessPartners = normalizeMultiValues(row.parent.businessPartner)

  return {
    ...row,
    derived: {
      estimateNum,
      actualNum,
      compareType,
      itcmKeys,
      itcmStatuses,
      businessTypes,
      businessPartners
    }
  }
}

function rowBlob(row) {
  return [
    row.parent.key,
    row.parent.summary,
    row.parent.status,
    row.parent.squad,
    row.parent.estimateSprint,
    row.derived.actualNum != null ? `Sprint${row.derived.actualNum}` : '',
    ...row.derived.businessTypes,
    ...row.derived.businessPartners,
    ...row.derived.itcmKeys,
    ...row.derived.itcmStatuses,
    row.parent.businessDate,
    ...(row.workItems || []).flatMap((item) => [item.key, item.summary, item.status, item.assignee])
  ].join(' ').toLowerCase()
}

function filterRows() {
  const terms = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  state.rows = (state.data?.parents || []).map(enrichRow).filter((row) => {
    if (state.statusSelections.length && !state.statusSelections.includes(row.parent.status || 'Unknown')) return false
    if (state.compareSelections.length && !state.compareSelections.includes(row.derived.compareType)) return false
    if (state.businessTypes.length && !row.derived.businessTypes.some((v) => state.businessTypes.includes(v))) return false
    if (state.businessPartners.length && !row.derived.businessPartners.some((v) => state.businessPartners.includes(v))) return false
    if (!terms.length) return true
    const blob = rowBlob(row)
    return terms.every((term) => blob.includes(term))
  })
}

function squadCountByType(rows, type) {
  const map = new Map()
  for (const row of rows) {
    if (row.derived.compareType !== type) continue
    const squad = row.parent.squad || 'No Squad'
    map.set(squad, (map.get(squad) || 0) + 1)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([squad, count]) => ({ squad, count }))
}

function quantile(sortedValues, q) {
  if (!sortedValues.length) return 0
  const pos = (sortedValues.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const next = sortedValues[base + 1] ?? sortedValues[base]
  return sortedValues[base] + rest * (next - sortedValues[base])
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return quantile(sorted, 0.5)
}

function formatSigned(value) {
  if (value > 0) return `+${value}`
  if (value < 0) return String(value)
  return '0'
}

function renderKpis() {
  const host = document.getElementById('dashKpis')
  if (!host) return
  const rows = state.rows || []
  const totalLinked = rows.reduce((sum, row) => sum + (row.linkedCount || 0), 0)
  const avgProgress = rows.length ? Math.round(rows.reduce((sum, row) => sum + (row.progressPercent || 0), 0) / rows.length) : 0
  const equal = rows.filter((row) => row.derived.compareType === 'equal').length
  const early = rows.filter((row) => row.derived.compareType === 'early').length
  const late = rows.filter((row) => row.derived.compareType === 'late').length

  const cards = [
    { label: 'Filtered FEPMF', value: rows.length, sub: 'Current selected scope', cls: 'gradient' },
    { label: 'Linked Work Items', value: totalLinked, sub: 'Children and linked issues', cls: '' },
    { label: 'Average Progress', value: `${avgProgress}%`, sub: 'Calculated from child statuses', cls: '' },
    { label: 'Actual = Estimate', value: equal, sub: 'Started as planned', cls: 'soft-green' },
    { label: 'Actual < Estimate', value: early, sub: 'Started earlier than plan', cls: 'gradient' },
    { label: 'Actual > Estimate', value: late, sub: 'Started later than plan', cls: 'soft-red' }
  ]

  host.innerHTML = cards.map((card) => `
    <article class="dash-kpi ${esc(card.cls)}">
      <div class="dash-kpi-label">${esc(card.label)}</div>
      <div class="dash-kpi-value">${esc(card.value)}</div>
      <div class="dash-kpi-sub">${esc(card.sub)}</div>
    </article>
  `).join('')
}

function renderCurrentSprintPendingMetric() {
  const percentNode = document.getElementById('dashPendingPercent')
  const pendingCountNode = document.getElementById('dashPendingCount')
  const totalNode = document.getElementById('dashPendingTotal')
  const ringNode = document.getElementById('dashPendingRing')
  const bentoNode = document.getElementById('dashPendingStatusBento')
  if (!percentNode || !pendingCountNode || !totalNode || !ringNode) return

  const rows = state.rows || []
  const currentSprintNum = parseSprintNumber(state.data?.summary?.currentSprintName)
  if (currentSprintNum == null) {
    percentNode.textContent = '0'
    pendingCountNode.textContent = '0'
    totalNode.textContent = '0'
    ringNode.style.setProperty('--pct', '0')
    if (bentoNode) bentoNode.innerHTML = '<span class="dash-pending-empty">No current sprint context</span>'
    return
  }

  const currentSprintRows = rows.filter((row) => row.derived.actualNum === currentSprintNum)
  const pendingRows = currentSprintRows.filter((row) => !isCompletedCurrentSprintStatus(row.parent.status))
  const totalCurrent = currentSprintRows.length
  const pendingCount = pendingRows.length
  const pct = totalCurrent ? Math.round((pendingCount / totalCurrent) * 100) : 0

  percentNode.textContent = String(pct)
  pendingCountNode.textContent = String(pendingCount)
  totalNode.textContent = String(totalCurrent)
  ringNode.style.setProperty('--pct', String(pct))

  if (bentoNode) {
    if (!pendingRows.length) {
      bentoNode.innerHTML = '<span class="dash-pending-empty">No pending items</span>'
    } else {
      const counts = new Map()
      for (const row of pendingRows) {
        const status = row.parent.status || 'Unknown'
        counts.set(status, (counts.get(status) || 0) + 1)
      }
      const statusOrder = state.data?.meta?.statusOrder || []
      const ordered = [
        ...statusOrder.filter((s) => counts.has(s)),
        ...[...counts.keys()].filter((s) => !statusOrder.includes(s)).sort((a, b) => String(a).localeCompare(String(b)))
      ]
      bentoNode.innerHTML = ordered.map((status) => `
        <span class="dash-pending-chip">${esc(status)} <b>${esc(counts.get(status) || 0)}</b></span>
      `).join('')
    }
  }
}

function hexToRgb(color) {
  const text = String(color || '').trim()
  const hex = text.startsWith('#') ? text.slice(1) : text
  if (!/^[0-9a-f]{6}$/i.test(hex)) return { r: 90, g: 120, b: 170 }
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16)
  }
}

function rgbToHex({ r, g, b }) {
  const toHex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function mixColor(baseColor, targetColor, ratio) {
  const a = hexToRgb(baseColor)
  const b = hexToRgb(targetColor)
  const t = Math.max(0, Math.min(1, Number(ratio) || 0))
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t
  })
}

function polarPoint(cx, cy, radius, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad)
  }
}

function pieSlicePath(cx, cy, radius, startDeg, endDeg) {
  const start = polarPoint(cx, cy, radius, startDeg)
  const end = polarPoint(cx, cy, radius, endDeg)
  const largeArc = endDeg - startDeg > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`
}

function renderStatusBars() {
  const rows = state.rows || []
  const host = document.getElementById('dashStatusBars')
  const meta = document.getElementById('dashStatusBarsMeta')
  const barBtn = document.getElementById('dashViewBar')
  const pieBtn = document.getElementById('dashViewPie')
  if (!host || !meta) return

  if (barBtn) barBtn.classList.toggle('active', state.statusView === 'bar')
  if (pieBtn) pieBtn.classList.toggle('active', state.statusView === 'pie')

  const counts = new Map()
  for (const row of rows) {
    const status = row.parent.status || 'Unknown'
    counts.set(status, (counts.get(status) || 0) + 1)
  }

  const statusOrder = state.data?.meta?.statusOrder || []
  const orderedStatuses = [
    ...statusOrder.filter((status) => counts.has(status)),
    ...[...counts.keys()].filter((status) => !statusOrder.includes(status)).sort((a, b) => String(a).localeCompare(String(b)))
  ]

  if (!orderedStatuses.length) {
    host.innerHTML = '<div class="dash-empty">No status data</div>'
    meta.innerHTML = ''
    return
  }

  const palette = [
    { bar: 'linear-gradient(180deg,#6eb8ff 0%,#2b72de 100%)', pie: '#8d63d3' },
    { bar: 'linear-gradient(180deg,#79d9d1 0%,#2a93b8 100%)', pie: '#f2c55f' },
    { bar: 'linear-gradient(180deg,#8ca8ff 0%,#4f69df 100%)', pie: '#52c3e4' },
    { bar: 'linear-gradient(180deg,#ff9cc2 0%,#e35493 100%)', pie: '#46ad6a' },
    { bar: 'linear-gradient(180deg,#ffc28f 0%,#f08337 100%)', pie: '#e95f99' },
    { bar: 'linear-gradient(180deg,#b8df89 0%,#62a83b 100%)', pie: '#7095ff' },
    { bar: 'linear-gradient(180deg,#cfb6ff 0%,#7a5ad8 100%)', pie: '#f09041' },
    { bar: 'linear-gradient(180deg,#9ec2cb 0%,#4b7987 100%)', pie: '#5a8f9c' }
  ]

  const rowsByCount = [...orderedStatuses]
    .map((status) => ({ status, count: counts.get(status) || 0 }))

  if (state.statusView === 'pie') {
    const total = rowsByCount.reduce((sum, item) => sum + item.count, 0) || 1
    const cx = 130
    const cy = 124
    const radius = 92
    const depth = 10
    const gapDeg = 2.2
    let start = -100
    const slices = rowsByCount.map((item, index) => {
      const pct = (item.count / total) * 100
      const sweepRaw = (pct / 100) * 360
      const sweep = Math.max(3.8, sweepRaw - gapDeg)
      const end = start + sweep
      const mid = start + sweep / 2
      const explode = 5.5
      const shift = polarPoint(0, 0, explode, mid)
      const color = palette[index % palette.length].pie
      const sideColor = mixColor(color, '#0b1a35', 0.27)
      const hiColor = mixColor(color, '#ffffff', 0.22)
      const loColor = mixColor(color, '#0b1a35', 0.1)
      const path = pieSlicePath(cx, cy, radius, start, end)
      const gradId = `dashStatusPieGrad${index}`
      start += sweepRaw
      return {
        ...item,
        pct,
        color,
        sideColor,
        path,
        gradId,
        dx: shift.x,
        dy: shift.y,
        hiColor,
        loColor
      }
    })

    host.innerHTML = `
      <div class="dash-pie-wrap">
        <div class="dash-pie-left">
          <svg class="dash-pie-svg" viewBox="0 0 260 250" aria-label="Status pie chart">
            <defs>
              ${slices.map((slice) => `
                <linearGradient id="${slice.gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="${slice.hiColor}" />
                  <stop offset="55%" stop-color="${slice.color}" />
                  <stop offset="100%" stop-color="${slice.loColor}" />
                </linearGradient>
              `).join('')}
              <filter id="dashPieDrop" x="-30%" y="-30%" width="160%" height="180%">
                <feDropShadow dx="0" dy="8" stdDeviation="5" flood-color="#1f3e78" flood-opacity="0.24"/>
              </filter>
            </defs>
            <ellipse class="dash-pie-shadow" cx="${cx}" cy="${cy + depth + 22}" rx="${radius + 16}" ry="22"></ellipse>
            ${slices.map((slice, idx) => `
              <g class="dash-pie-slice" data-idx="${idx}" transform="translate(${slice.dx.toFixed(2)} ${slice.dy.toFixed(2)})">
                <path class="dash-pie-slice-side" d="${slice.path}" transform="translate(0 ${depth})" fill="${slice.sideColor}"></path>
                <path class="dash-pie-slice-top" d="${slice.path}" fill="url(#${slice.gradId})" filter="url(#dashPieDrop)"></path>
              </g>
            `).join('')}
          </svg>
          <div id="dashPieFocus" class="dash-pie-focus">
            <div class="dash-pie-focus-top">
              <span id="dashPieFocusMark" class="dash-pie-focus-mark"></span>
              <span id="dashPieFocusValue">0.0%</span>
            </div>
            <div id="dashPieFocusSub" class="dash-pie-focus-sub">-</div>
          </div>
        </div>
        <div class="dash-pie-legend">
          ${slices.map((slice, idx) => `
            <article class="dash-pie-item" data-idx="${idx}">
              <span class="dash-pie-icon" style="border-color:${slice.color};color:${slice.color}">${esc(String(slice.status).slice(0, 2).toUpperCase())}</span>
              <div class="dash-pie-copy">
                <div class="dash-pie-name">${esc(slice.status)}</div>
              </div>
              <div class="dash-pie-stat">
                <div class="dash-pie-value">${slice.pct.toFixed(1)}%</div>
                <div class="dash-pie-count">${slice.count} FEPMF</div>
              </div>
            </article>
          `).join('')}
        </div>
      </div>
    `

    const pieLeftEl = host.querySelector('.dash-pie-left')
    const focusEl = host.querySelector('#dashPieFocus')
    const focusMarkEl = host.querySelector('#dashPieFocusMark')
    const focusValueEl = host.querySelector('#dashPieFocusValue')
    const focusSubEl = host.querySelector('#dashPieFocusSub')
    const segs = host.querySelectorAll('.dash-pie-slice')
    const items = host.querySelectorAll('.dash-pie-item')

    const positionFocus = (clientX, clientY) => {
      if (!focusEl || !pieLeftEl || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return
      const rect = pieLeftEl.getBoundingClientRect()
      const w = focusEl.offsetWidth || 140
      const h = focusEl.offsetHeight || 42
      const pad = 8
      let x = clientX - rect.left + 12
      let y = clientY - rect.top - h - 12
      if (x + w > rect.width - pad) x = rect.width - w - pad
      if (x < pad) x = pad
      if (y < pad) y = clientY - rect.top + 14
      if (y + h > rect.height - pad) y = rect.height - h - pad
      focusEl.style.left = `${x}px`
      focusEl.style.top = `${y}px`
    }

    const applyFocus = (idx, event) => {
      const slice = slices[idx]
      if (!slice || !focusEl || !focusMarkEl || !focusValueEl || !focusSubEl) return
      focusMarkEl.style.background = slice.color
      focusValueEl.textContent = `${slice.pct.toFixed(1)}%`
      focusSubEl.textContent = `${slice.status} | ${slice.count} FEPMF`
      focusEl.classList.add('active')
      if (event) positionFocus(event.clientX, event.clientY)
    }
    const clearFocus = () => {
      if (focusEl) focusEl.classList.remove('active')
    }

    segs.forEach((seg) => {
      seg.addEventListener('mouseenter', (event) => applyFocus(Number(seg.getAttribute('data-idx')), event))
      seg.addEventListener('mousemove', (event) => {
        applyFocus(Number(seg.getAttribute('data-idx')), event)
      })
      seg.addEventListener('mouseleave', clearFocus)
    })
    items.forEach((item) => {
      item.addEventListener('mouseenter', (event) => applyFocus(Number(item.getAttribute('data-idx')), event))
      item.addEventListener('mousemove', (event) => {
        applyFocus(Number(item.getAttribute('data-idx')), event)
      })
      item.addEventListener('mouseleave', clearFocus)
    })

    meta.innerHTML = ''
    return
  }

  const maxCount = Math.max(...orderedStatuses.map((status) => counts.get(status) || 0), 1)
  const barsHtml = orderedStatuses.map((status, index) => {
    const count = counts.get(status) || 0
    const pct = Math.max(0, Math.round((count / maxCount) * 100))
    const share = rows.length ? Math.round((count / rows.length) * 100) : 0
    const gradient = palette[index % palette.length].bar
    return `
      <div class="dash-bar-col" title="${esc(status)}: ${esc(count)}">
        <div class="dash-bar-val">${esc(count)}</div>
        <div class="dash-bar-canvas">
          <div class="dash-bar-fill" style="height:${pct}%;background:${gradient}"></div>
        </div>
        <div class="dash-bar-label">${esc(status)}</div>
        <div class="dash-bar-share">${esc(share)}%</div>
      </div>
    `
  }).join('')

  const minGridWidth = Math.max(orderedStatuses.length * 66, 520)
  host.innerHTML = `
    <div class="dash-vbar-layout">
      <div class="dash-y-axis">
        <span>${esc(maxCount)}</span>
        <span>${esc(Math.round(maxCount * 0.75))}</span>
        <span>${esc(Math.round(maxCount * 0.5))}</span>
        <span>${esc(Math.round(maxCount * 0.25))}</span>
        <span>0</span>
      </div>
      <div class="dash-vbar-scroll">
        <div class="dash-vbar-grid" style="grid-template-columns:repeat(${orderedStatuses.length}, minmax(58px,58px));min-width:${minGridWidth}px;">${barsHtml}</div>
      </div>
    </div>
  `

  meta.innerHTML = ''
}

function renderSmartReading() {
  const summary = document.getElementById('dashStatusSummary')
  const recentList = document.getElementById('dashStatusRecentList')
  const fromNode = document.getElementById('dashSmartDateFrom')
  const toNode = document.getElementById('dashSmartDateTo')
  const bpCountNode = document.getElementById('dashSmartBpCount')
  const typeCountNode = document.getElementById('dashSmartTypeCount')
  if (!summary || !recentList || !fromNode || !toNode) return

  const defaultFrom = firstDayPrevMonthIsoLocal()
  const defaultTo = todayIsoLocal()
  if (!state.smartDateFrom) state.smartDateFrom = defaultFrom
  if (!state.smartDateTo) state.smartDateTo = defaultTo
  if (!fromNode.value) fromNode.value = state.smartDateFrom
  if (!toNode.value) toNode.value = state.smartDateTo

  const fromIso = String(state.smartDateFrom || fromNode.value || defaultFrom)
  const toIso = String(state.smartDateTo || toNode.value || defaultTo)
  const rangeStart = fromIso <= toIso ? fromIso : toIso
  const rangeEnd = fromIso <= toIso ? toIso : fromIso

  const allDelivered = (state.data?.deliveredRecent || []).filter((item) => item?.key)
  const recent = allDelivered.filter((item) => {
    const d = dateKeyBkk(item.updated)
    return d && d >= rangeStart && d <= rangeEnd
  })

  const rowByParentKey = new Map((state.rows || []).map((row) => [String(row.parent.key || ''), row]))
  const uniqueDeliveredKeys = [...new Set(recent.map((item) => String(item.key || '').trim()).filter(Boolean))]
  const bpSet = new Set()
  const typeSet = new Set()
  for (const key of uniqueDeliveredKeys) {
    const row = rowByParentKey.get(key)
    const partners = normalizeMultiValues(row?.derived?.businessPartners || row?.parent?.businessPartner || [])
    const types = normalizeMultiValues(row?.derived?.businessTypes || row?.parent?.businessType || [])
    for (const partner of (partners.length ? partners : ['Not specified'])) bpSet.add(String(partner))
    for (const type of (types.length ? types : ['Not specified'])) typeSet.add(String(type))
  }
  if (bpCountNode) bpCountNode.textContent = String(bpSet.size || 0)
  if (typeCountNode) typeCountNode.textContent = String(typeSet.size || 0)

  const fromLabel = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${rangeStart}T00:00:00Z`))
  const toLabel = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${rangeEnd}T00:00:00Z`))

  if (!recent.length) {
    summary.textContent = `${fromLabel} - ${toLabel}: ไม่พบงานที่เปลี่ยนเป็น S7`
    recentList.innerHTML = '<li>ยังไม่มีรายการ FEPMF ที่เข้าเงื่อนไขในช่วงเวลานี้</li>'
    return
  }

  const grouped = new Map()
  for (const item of recent) {
    const key = dateKeyBkk(item.updated) || 'unknown'
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(item)
  }

  const dateKeys = [...grouped.keys()].sort((a, b) => String(b).localeCompare(String(a)))
  const totalRows = recent.length
  const totalDates = dateKeys.filter((k) => k !== 'unknown').length
  summary.textContent = `${fromLabel} - ${toLabel}: ${totalRows} งาน ครอบคลุม ${totalDates} วันที่มีการเปลี่ยนสถานะเป็น S7`

  const accent = ['#2f74de', '#2aa0bf', '#7b64e2', '#e15893', '#ef8b3a', '#4e9e55']
  const groupsHtml = dateKeys.map((dateKey, groupIndex) => {
    const items = grouped.get(dateKey) || []
    const byKey = new Map()
    for (const item of items) {
      if (!byKey.has(item.key)) byKey.set(item.key, item)
    }

    const uniqueRows = [...byKey.values()]
      .sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')))

    const label = dateKey === 'unknown'
      ? 'ไม่ระบุวันที่'
      : new Intl.DateTimeFormat('th-TH', {
          timeZone: 'Asia/Bangkok',
          weekday: 'short',
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        }).format(new Date(`${dateKey}T00:00:00+07:00`))

    return `
      <li class="dash-smart-group">
        <div class="dash-smart-group-head">
          <span class="dash-smart-date-chip">${esc(label)}</span>
          <span class="dash-smart-count-chip">${uniqueRows.length} FEPMF</span>
        </div>
        <div class="dash-smart-items">
          ${uniqueRows.map((item, itemIndex) => {
            const url = item.browseUrl || `https://dgtbigc.atlassian.net/browse/${item.key}`
            const squad = item.squad || 'No Squad'
            const updated = safeDate(item.updated)
            const timeText = updated
              ? updated.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
              : '-'
            const summaryText = item.summary || '-'
            const color = accent[(groupIndex + itemIndex) % accent.length]
            const avatarText = String(squad || item.key || 'F').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'F'
            return `
              <article class="dash-smart-note" style="--smart-accent:${color}">
                <span class="dash-smart-avatar">${esc(avatarText)}</span>
                <div class="dash-smart-note-main">
                  <div class="dash-smart-note-top">
                    <a class="dash-smart-mini-key" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(item.key)}</a>
                    <span class="dash-smart-mini-squad">${esc(squad)}</span>
                    <span class="dash-smart-mini-time">${esc(timeText)}</span>
                  </div>
                  <div class="dash-smart-mini-summary">${esc(summaryText)}</div>
                </div>
                <a class="dash-smart-open-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open</a>
              </article>
            `
          }).join('')}
        </div>
      </li>
    `
  }).join('')

  recentList.innerHTML = groupsHtml
}

function groupRowsByDimension(rows, accessor) {
  const groups = new Map()
  for (const row of rows) {
    const vals = (accessor(row) || []).map((v) => String(v || '').trim()).filter(Boolean)
    const labels = vals.length ? vals : ['Not specified']
    for (const label of labels) {
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label).push(row)
    }
  }
  return [...groups.entries()]
    .map(([label, list]) => ({ label, rows: list, count: list.length }))
    .sort((a, b) => {
      const aUnspecified = a.label === 'Not specified' ? 1 : 0
      const bUnspecified = b.label === 'Not specified' ? 1 : 0
      if (aUnspecified !== bUnspecified) return aUnspecified - bUnspecified
      return (b.count - a.count) || a.label.localeCompare(b.label)
    })
}

function bentoSortValue(row, key) {
  if (key === 'fepmf') return String(row.parent.key || '').toLowerCase()
  if (key === 'summary') return String(row.parent.summary || '').toLowerCase()
  if (key === 'status') return String(row.parent.status || '').toLowerCase()
  if (key === 'squad') return String(row.parent.squad || '').toLowerCase()
  if (key === 'cabDate') {
    const d = safeDate(`${row.parent.cabDate || ''}T00:00:00Z`)
    return d ? d.getTime() : Number.POSITIVE_INFINITY
  }
  return ''
}

function bentoCategorySlices(groups, totalRows) {
  const palette = ['#4ea0f5', '#ec4f90', '#24bf6b', '#9a9cf2', '#f8ab1f', '#5a6be2', '#23a8bf', '#c85395', '#7dba43', '#3d8fd4']
  const total = totalRows || 1
  return (groups || []).map((group, idx) => {
    const count = Number(group?.count || 0)
    const pct = (count / total) * 100
    return { label: String(group?.label || '-'), count, pct, color: palette[idx % palette.length] }
  }).filter((x) => x.count > 0)
}

function renderBentoPie(groups, totalRows, hostId, totalId, focusLabel, dimensionLabel) {
  const host = document.getElementById(hostId)
  const totalNode = document.getElementById(totalId)
  if (!host) return
  if (totalNode) totalNode.textContent = `${totalRows} FEPMF`

  if (!groups.length) {
    host.innerHTML = '<div class="dash-empty">No data</div>'
    return
  }

  const slicesRaw = bentoCategorySlices(groups, totalRows)
    .sort((a, b) => b.count - a.count)
  const slices = slicesRaw.slice(0, 5)
  const radius = 52
  const c = 2 * Math.PI * radius
  const gapPct = 5.6
  let currentPct = 0
  const palette = ['#49a2f6', '#ea4f92', '#f3aa1f', '#9ea0f4', '#24be6a']
  const ringSlices = slices.map((slice, idx) => {
    const pct = slice.pct
    const usablePct = Math.max(2.4, pct - gapPct)
    const length = (usablePct / 100) * c
    const offset = -((currentPct + (gapPct / 2)) / 100) * c
    currentPct += pct
    return { ...slice, color: palette[idx % palette.length], length, offset }
  })
  const subtitle = String(dimensionLabel || '').toLowerCase().includes('partner')
    ? 'partners in total'
    : 'types in total'

  host.innerHTML = `
    <div class="dash-bento-donut-shell">
      <svg class="dash-bento-pie-svg donut-pro" viewBox="0 0 180 180" aria-label="Bento category pie chart">
        <circle class="dash-bento-pie-bg" cx="90" cy="90" r="${radius}"></circle>
        ${ringSlices.map((slice) => `
          <circle
            class="dash-bento-pie-seg"
            cx="90"
            cy="90"
            r="${radius}"
            stroke="${slice.color}"
            stroke-dasharray="${slice.length.toFixed(2)} ${c.toFixed(2)}"
            stroke-dashoffset="${slice.offset.toFixed(2)}"
          ></circle>
        `).join('')}
      </svg>
      <div class="dash-bento-pie-center">
        <strong>${totalRows}</strong>
        <span>${esc(subtitle)}</span>
      </div>
    </div>
  `
}

function renderBentoHorizontalBars(groups, totalRows, hostId, totalId) {
  const host = document.getElementById(hostId)
  const totalNode = document.getElementById(totalId)
  if (!host) return
  if (totalNode) totalNode.textContent = `${totalRows} FEPMF`
  if (!groups.length) {
    host.innerHTML = '<div class="dash-empty">No data</div>'
    return
  }
  const slices = bentoCategorySlices(groups, totalRows).sort((a, b) => b.count - a.count).slice(0, 6)
  host.innerHTML = `
    <div class="dash-bento-hbars">
      ${slices.map((slice) => `
        <div class="dash-bento-hrow">
          <div class="dash-bento-hmeta">
            <span class="dash-bento-hlab">${esc(slice.label)}</span>
            <span class="dash-bento-hval">${Math.round(slice.pct)}% (${slice.count})</span>
          </div>
          <div class="dash-bento-htrack">
            <span class="dash-bento-hfill" style="width:${slice.pct.toFixed(2)}%;background:${slice.color}"></span>
          </div>
        </div>
      `).join('')}
    </div>
  `
}

function renderBentoVerticalBars(groups, totalRows, hostId, totalId) {
  const host = document.getElementById(hostId)
  const totalNode = document.getElementById(totalId)
  if (!host) return
  if (totalNode) totalNode.textContent = `${totalRows} FEPMF`
  if (!groups.length) {
    host.innerHTML = '<div class="dash-empty">No data</div>'
    return
  }
  const slices = bentoCategorySlices(groups, totalRows).sort((a, b) => b.count - a.count).slice(0, 6)
  const maxCount = Math.max(...slices.map((s) => s.count), 1)
  host.innerHTML = `
    <div class="dash-bento-vbars">
      ${slices.map((slice) => {
        const h = Math.max(8, Math.round((slice.count / maxCount) * 100))
        return `
          <div class="dash-bento-vcol">
            <div class="dash-bento-vval">${slice.count}</div>
            <div class="dash-bento-vtrack">
              <span class="dash-bento-vfill" style="height:${h}%;background:${slice.color}"></span>
            </div>
            <div class="dash-bento-vlab">${esc(slice.label)}</div>
            <div class="dash-bento-vpct">${Math.round(slice.pct)}%</div>
          </div>
        `
      }).join('')}
    </div>
  `
}

function renderBentoViz(groups, totalRows, hostId, totalId, focusLabel, vizMode, dimensionLabel) {
  const mode = String(vizMode || 'pie')
  if (mode === 'hbar') return renderBentoHorizontalBars(groups, totalRows, hostId, totalId)
  if (mode === 'vbar') return renderBentoVerticalBars(groups, totalRows, hostId, totalId)
  return renderBentoPie(groups, totalRows, hostId, totalId, focusLabel, dimensionLabel)
}

function renderBentoBlock(options) {
  const {
    rows,
    groupAccessor,
    focusKey,
    focusStateKey,
    sortStateKey,
    totalId,
    gridId,
    listId,
    pieHostId,
    pieTotalId,
    vizMode,
    dimensionLabel
  } = options
  const totalNode = document.getElementById(totalId)
  const gridNode = document.getElementById(gridId)
  const listNode = document.getElementById(listId)
  if (!totalNode || !gridNode || !listNode) return

  totalNode.textContent = `${rows.length} FEPMF`
  const groups = [
    { label: 'ALL', rows: [...rows], count: rows.length },
    ...groupRowsByDimension(rows, groupAccessor).filter((g) => g.label !== 'ALL')
  ]

  if (!groups.length) {
    gridNode.innerHTML = '<div class="dash-empty">No data</div>'
    listNode.innerHTML = '<div class="dash-empty">ไม่พบ FEPMF ในเงื่อนไขนี้</div>'
    state[focusStateKey] = 'ALL'
    renderBentoViz([], rows.length, pieHostId, pieTotalId, 'ALL', vizMode, dimensionLabel)
    return
  }

  let activeLabel = focusKey || 'ALL'
  if (!groups.some((g) => g.label === activeLabel)) activeLabel = groups[0].label
  state[focusStateKey] = activeLabel

  gridNode.innerHTML = groups.map((group) => `
    <button class="dash-bento-chip ${group.label === activeLabel ? 'active' : ''}" type="button" data-bento-kind="${esc(focusStateKey)}" data-bento-label="${esc(group.label)}">
      <span class="dash-bento-label">${esc(group.label)}</span>
      <span class="dash-bento-count">${esc(group.count)}</span>
    </button>
  `).join('')

  const activeGroup = groups.find((g) => g.label === activeLabel) || groups[0]
  const chartGroups = groups.filter((g) => g.label !== 'ALL')
  if (!state[sortStateKey]) state[sortStateKey] = { key: 'fepmf', dir: 'asc' }
  const sortState = state[sortStateKey]
  const listRows = [...(activeGroup?.rows || [])]
    .sort((a, b) => {
      const av = bentoSortValue(a, sortState.key)
      const bv = bentoSortValue(b, sortState.key)
      if (av < bv) return sortState.dir === 'asc' ? -1 : 1
      if (av > bv) return sortState.dir === 'asc' ? 1 : -1
      return String(a.parent.key || '').localeCompare(String(b.parent.key || ''))
    })

  if (!listRows.length) {
    listNode.innerHTML = '<div class="dash-empty">ไม่พบ FEPMF ในหมวดที่เลือก</div>'
    renderBentoViz(chartGroups, rows.length, pieHostId, pieTotalId, activeLabel, vizMode, dimensionLabel)
    return
  }

  const sortIcon = (key) => {
    if (sortState.key !== key) return '↕'
    return sortState.dir === 'asc' ? '↑' : '↓'
  }

  listNode.innerHTML = `
    <table class="dash-table dash-bento-table">
      <thead>
        <tr>
          <th><button class="dash-sort-btn ${sortState.key === 'fepmf' ? 'active' : ''}" type="button" data-bento-sort-kind="${esc(sortStateKey)}" data-bento-sort-key="fepmf"><span>FEPMF</span><span class="dash-sort-icon">${sortIcon('fepmf')}</span></button></th>
          <th><button class="dash-sort-btn ${sortState.key === 'summary' ? 'active' : ''}" type="button" data-bento-sort-kind="${esc(sortStateKey)}" data-bento-sort-key="summary"><span>Summary</span><span class="dash-sort-icon">${sortIcon('summary')}</span></button></th>
          <th><button class="dash-sort-btn ${sortState.key === 'status' ? 'active' : ''}" type="button" data-bento-sort-kind="${esc(sortStateKey)}" data-bento-sort-key="status"><span>Status</span><span class="dash-sort-icon">${sortIcon('status')}</span></button></th>
          <th><button class="dash-sort-btn ${sortState.key === 'squad' ? 'active' : ''}" type="button" data-bento-sort-kind="${esc(sortStateKey)}" data-bento-sort-key="squad"><span>Squad</span><span class="dash-sort-icon">${sortIcon('squad')}</span></button></th>
          <th><button class="dash-sort-btn ${sortState.key === 'cabDate' ? 'active' : ''}" type="button" data-bento-sort-kind="${esc(sortStateKey)}" data-bento-sort-key="cabDate"><span>CAB Date</span><span class="dash-sort-icon">${sortIcon('cabDate')}</span></button></th>
        </tr>
      </thead>
      <tbody>
        ${listRows.map((row) => `
          <tr>
            <td><a class="dash-item-key" href="${esc(row.parent.browseUrl || '#')}" target="_blank" rel="noopener noreferrer">${esc(row.parent.key || '-')}</a></td>
            <td>${esc(row.parent.summary || '-')}</td>
            <td>${esc(row.parent.status || '-')}</td>
            <td>${esc(row.parent.squad || '-')}</td>
            <td>${esc(formatDate(row.parent.cabDate))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
  renderBentoViz(chartGroups, rows.length, pieHostId, pieTotalId, activeLabel, vizMode, dimensionLabel)
}

function renderBusinessBentoSections() {
  const setActiveView = (id, active) => {
    const node = document.getElementById(id)
    if (node) node.classList.toggle('active', !!active)
  }
  setActiveView('dashPartnerViewPie', state.partnerViz === 'pie')
  setActiveView('dashPartnerViewHBar', state.partnerViz === 'hbar')
  setActiveView('dashPartnerViewVBar', state.partnerViz === 'vbar')
  setActiveView('dashTypeViewPie', state.typeViz === 'pie')
  setActiveView('dashTypeViewHBar', state.typeViz === 'hbar')
  setActiveView('dashTypeViewVBar', state.typeViz === 'vbar')

  const rows = state.rows || []
  renderBentoBlock({
    rows,
    groupAccessor: (row) => row.derived.businessPartners || [],
    focusKey: state.partnerFocus,
    focusStateKey: 'partnerFocus',
    sortStateKey: 'partnerSort',
    totalId: 'dashPartnerTotal',
    gridId: 'dashPartnerBentoGrid',
    listId: 'dashPartnerList',
    pieHostId: 'dashPartnerPie',
    pieTotalId: 'dashPartnerPieTotal',
    vizMode: state.partnerViz,
    dimensionLabel: 'Business Partner'
  })
  renderBentoBlock({
    rows,
    groupAccessor: (row) => row.derived.businessTypes || [],
    focusKey: state.typeFocus,
    focusStateKey: 'typeFocus',
    sortStateKey: 'typeSort',
    totalId: 'dashTypeTotal',
    gridId: 'dashTypeBentoGrid',
    listId: 'dashTypeList',
    pieHostId: 'dashTypePie',
    pieTotalId: 'dashTypePieTotal',
    vizMode: state.typeViz,
    dimensionLabel: 'Business Type'
  })
}

function renderCompareAnalysis() {
  const host = document.getElementById('dashCompareAnalysis')
  const compareMeta = document.getElementById('dashCompareMeta')
  const rows = state.rows || []

  const comparableRows = rows.filter((row) => row.derived.estimateNum != null && row.derived.actualNum != null)
  const comparable = comparableRows.length
  const coverage = rows.length ? Math.round((comparable / rows.length) * 100) : 0

  if (!comparable) {
    host.innerHTML = '<div class="dash-empty">ไม่พบข้อมูลที่มีทั้ง Estimate และ Actual Sprint</div>'
    if (compareMeta) compareMeta.textContent = 'Comparable Items: 0'
    return
  }

  const deltas = comparableRows.map((row) => row.derived.actualNum - row.derived.estimateNum)
  const onTime = deltas.filter((x) => x === 0).length
  const early = deltas.filter((x) => x < 0).length
  const late = deltas.filter((x) => x > 0).length

  const onTimeRate = Math.round((onTime / comparable) * 100)
  const earlyRate = Math.round((early / comparable) * 100)
  const lateRate = Math.max(0, 100 - onTimeRate - earlyRate)

  const compareSegments = [
    { key: 'early', label: 'เริ่มก่อนแผน', color: '#2f6bff' },
    { key: 'equal', label: 'ตรงแผน', color: '#19a974' },
    { key: 'late', label: 'เริ่มช้ากว่าแผน', color: '#ff6b35' }
  ]

  const squadMap = new Map()
  for (const row of comparableRows) {
    const squad = String(row.parent.squad || '').trim()
    if (!squad || /^no squad$/i.test(squad)) continue
    if (!squadMap.has(squad)) squadMap.set(squad, [])
    squadMap.get(squad).push(row)
  }

  const squadMix = [...squadMap.entries()].map(([squad, list]) => {
    const byCompare = {
      early: list.filter((r) => r.derived.compareType === 'early').length,
      equal: list.filter((r) => r.derived.compareType === 'equal').length,
      late: list.filter((r) => r.derived.compareType === 'late').length
    }
    const segments = compareSegments.map((seg) => {
      const count = byCompare[seg.key] || 0
      const pct = list.length ? (count / list.length) * 100 : 0
      return {
        key: seg.key,
        label: seg.label,
        pct,
        color: seg.color
      }
    })
    return {
      squad,
      n: list.length,
      share: comparable ? Math.round((list.length / comparable) * 100) : 0,
      segments
    }
  }).sort((a, b) => b.n - a.n || String(a.squad).localeCompare(String(b.squad)))

  const metricCards = [
    { key: 'ตรงแผน', value: `${onTimeRate}%`, detail: `${onTime}/${comparable}`, meaning: 'เริ่มงานตรงกับ Estimate Sprint' },
    { key: 'เริ่มก่อนแผน', value: `${earlyRate}%`, detail: `${early}/${comparable}`, meaning: 'เริ่มงานเร็วกว่าที่ประเมินไว้' },
    { key: 'เริ่มช้ากว่าแผน', value: `${lateRate}%`, detail: `${late}/${comparable}`, meaning: 'สัดส่วนงานที่เริ่มช้ากว่า Estimate Sprint', risk: true }
  ]

  host.innerHTML = `
    <div class="exec-analytics">
      <div class="exec-kpi-row">
        ${metricCards.map((m) => `
          <article class="exec-kpi-card ${m.risk ? 'risk' : ''}">
            <div class="k">${m.key}</div>
            <div class="v">${m.value}</div>
            <div class="s">${m.detail}</div>
            <div class="m">${m.meaning}</div>
          </article>
        `).join('')}
      </div>

      <div class="exec-viz-grid">
        <article class="exec-viz-card benchmark-card" style="grid-column:1 / -1;">
          <h4>Squad Benchmark</h4>
          <div class="exec-squad-list">
            ${squadMix.map((s) => `
              <div class="sq-row">
                <div class="sq-head">
                  <span>${esc(s.squad)}</span>
                  <span>${s.n} FEPMF (${s.share}%)</span>
                </div>
                <div class="sq-stack">
                  ${s.segments.map((seg) => `
                    <span class="sq-seg" style="width:${seg.pct.toFixed(2)}%;background:${seg.color}" title="${esc(seg.label)} ${seg.pct.toFixed(1)}%"></span>
                  `).join('')}
                </div>
                <div class="sq-meta">
                  ${s.segments.map((seg) => `${seg.label} ${seg.pct.toFixed(1)}%`).join(' | ')}
                </div>
              </div>
            `).join('') || '<div class="dash-empty">No squad benchmark</div>'}
          </div>
        </article>
      </div>
    </div>
  `

  if (compareMeta) compareMeta.textContent = `Comparable Items: ${comparable} (${coverage}% coverage)`
}

function renderStatusKpiCards() {
  const host = document.getElementById('dashStatusKpiCards')
  const totalNode = document.getElementById('dashStatusTotal')
  const rows = state.rows || []
  if (!host || !totalNode) return

  const total = rows.length
  totalNode.textContent = String(total)

  if (!total) {
    host.innerHTML = '<div class="dash-empty" style="border:1px dashed #c8d9ee;border-radius:12px;background:#fff;">No FEPMF in current filter</div>'
    return
  }

  const counts = new Map()
  for (const row of rows) {
    const status = row.parent.status || 'Unknown'
    counts.set(status, (counts.get(status) || 0) + 1)
  }

  const statusOrder = state.data?.meta?.statusOrder || []
  const orderedStatuses = [
    ...statusOrder.filter((status) => counts.has(status)),
    ...[...counts.keys()].filter((status) => !statusOrder.includes(status)).sort((a, b) => String(a).localeCompare(String(b)))
  ]
  const ordered = orderedStatuses.map((status) => [status, counts.get(status) || 0])

  const tones = [
    { bgA: '#e8c6ff', bgB: '#d7a2f8', accent: '#a755e5' },
    { bgA: '#ffc897', bgB: '#f7a868', accent: '#ea7e37' },
    { bgA: '#bdf0d7', bgB: '#8fdab5', accent: '#239b68' },
    { bgA: '#ffd5e5', bgB: '#f5abc8', accent: '#d44f88' },
    { bgA: '#cbe6ff', bgB: '#9dcdf9', accent: '#2f74de' },
    { bgA: '#fff0b8', bgB: '#f9dd7f', accent: '#c89a14' }
  ]

  host.innerHTML = ordered.map(([status, count], idx) => {
    const share = Math.round((count / total) * 100)
    const tone = tones[idx % tones.length]
    return `
      <article class="dash-status-kpi-item" style="--kpi-bg-a:${tone.bgA};--kpi-bg-b:${tone.bgB};--kpi-accent:${tone.accent};">
        <div class="dash-status-kpi-icon">${esc(status || '?')}</div>
        <div class="dash-status-kpi-count">${esc(count)}</div>
        <div class="dash-status-kpi-name">${esc(status)} Tasks</div>
        <div class="dash-status-kpi-note">${share}% ของ FEPMF ทั้งหมด</div>
        <button class="dash-status-kpi-cta" type="button" data-status="${esc(status)}" aria-label="Explore ${esc(status)} status">
          <span class="dash-status-kpi-eye" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img" focusable="false">
              <path d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6-10-6-10-6z"></path>
              <circle cx="12" cy="12" r="3.2"></circle>
            </svg>
          </span>
        </button>
      </article>
    `
  }).join('')
}

function renderList(hostId, rows, emptyText) {
  const host = document.getElementById(hostId)
  if (!host) return
  if (!rows.length) {
    host.innerHTML = `<div class="dash-empty">${esc(emptyText)}</div>`
    return
  }

  host.innerHTML = rows.map((row) => {
    const itcm = row.derived.itcmKeys[0] || '-'
    return `
      <article class="dash-item">
        <div class="dash-item-top">
          <a class="dash-item-key" href="${esc(row.parent.browseUrl)}" target="_blank" rel="noopener noreferrer">${esc(row.parent.key)}</a>
          <span class="${badgeClass(row.parent.status)}">${esc(row.parent.status || '-')}</span>
        </div>
        <div class="dash-item-summary">${esc(row.parent.summary || '-')}</div>
        <div class="dash-item-meta">
          <span>Squad: ${esc(row.parent.squad || '-')}</span>
          <span>CAB: ${esc(formatDate(row.parent.cabDate))}</span>
          <span>ITCM: ${esc(itcm)}</span>
          <span>Compare: ${esc(compareLabel(row.derived.compareType))}</span>
        </div>
        <div class="dash-item-bar"><div style="width:${Math.max(0, Math.min(100, row.progressPercent || 0))}%"></div></div>
      </article>
    `
  }).join('')
}

function normalizeItcmStatus(value) {
  const text = String(value || '').trim()
  return text || 'Unknown'
}

function riskSortValue(item, key) {
  if (key === 'itcm') return String(item.key || '').toLowerCase()
  if (key === 'summary') return String(item.summary || '').toLowerCase()
  if (key === 'status') return String(item.status || '').toLowerCase()
  if (key === 'fepmf') return String(item.parentKey || '').toLowerCase()
  if (key === 'squad') return String(item.squad || '').toLowerCase()
  if (key === 'cabDate') {
    const d = safeDate(`${item.cabDate || ''}T00:00:00Z`)
    return d ? d.getTime() : Number.POSITIVE_INFINITY
  }
  return ''
}

function renderRiskByItcmStatus(rows) {
  const host = document.getElementById('dashRisk')
  const tabsHost = document.getElementById('dashRiskTabs')
  const countChip = document.getElementById('dashRiskCount')
  if (!host || !tabsHost || !countChip) return

  const itcmMap = new Map()
  for (const row of rows) {
    const items = itcmItems(row)
    for (const item of items) {
      const key = String(item?.key || '').trim()
      if (!key) continue
      if (itcmMap.has(key)) continue
      itcmMap.set(key, {
        key,
        summary: item?.summary || '',
        status: normalizeItcmStatus(item?.status),
        browseUrl: item?.browseUrl || (key ? `https://dgtbigc.atlassian.net/browse/${key}` : '#'),
        parentKey: row.parent.key || '-',
        parentUrl: row.parent.browseUrl || '#',
        squad: row.parent.squad || '-',
        cabDate: row.parent.cabDate || '',
        progressPercent: Number(row.progressPercent || 0)
      })
    }
  }

  const allItcms = [...itcmMap.values()]
  if (!allItcms.length) {
    tabsHost.innerHTML = '<button class="dash-risk-tab active" type="button" data-tab="all">All (0)</button>'
    countChip.textContent = '0 ITCM'
    host.innerHTML = '<div class="dash-empty">ไม่พบรายการ ITCM ในเงื่อนไขที่เลือก</div>'
    state.riskItcmTab = 'all'
    return
  }

  const statusBuckets = new Map()
  for (const item of allItcms) {
    const status = item.status || 'Unknown'
    if (!statusBuckets.has(status)) statusBuckets.set(status, [])
    statusBuckets.get(status).push(item)
  }

  const orderedStatuses = [...statusBuckets.entries()]
    .sort((a, b) => (b[1].length - a[1].length) || String(a[0]).localeCompare(String(b[0])))
    .map(([status]) => status)

  const tabDefs = [
    { key: 'all', label: 'All', count: allItcms.length },
    ...orderedStatuses.map((status) => ({ key: status, label: status, count: (statusBuckets.get(status) || []).length }))
  ]

  if (!tabDefs.some((tab) => tab.key === state.riskItcmTab)) {
    state.riskItcmTab = 'all'
  }

  tabsHost.innerHTML = tabDefs.map((tab) => `
    <button
      class="dash-risk-tab ${state.riskItcmTab === tab.key ? 'active' : ''}"
      type="button"
      data-tab="${esc(tab.key)}"
      title="${esc(tab.label)}"
    >${esc(tab.label)} (${esc(tab.count)})</button>
  `).join('')

  const tabRows = state.riskItcmTab === 'all'
    ? allItcms
    : (statusBuckets.get(state.riskItcmTab) || [])

  countChip.textContent = `${tabRows.length} ITCM`
  if (!tabRows.length) {
    host.innerHTML = `<div class="dash-empty">ไม่พบรายการ ITCM ที่มีสถานะ: ${esc(state.riskItcmTab)}</div>`
    return
  }

  if (!state.riskSort) state.riskSort = { key: 'itcm', dir: 'asc' }
  const sortedRows = [...tabRows].sort((a, b) => {
    const av = riskSortValue(a, state.riskSort.key)
    const bv = riskSortValue(b, state.riskSort.key)
    if (av < bv) return state.riskSort.dir === 'asc' ? -1 : 1
    if (av > bv) return state.riskSort.dir === 'asc' ? 1 : -1
    return String(a.key || '').localeCompare(String(b.key || ''))
  })

  const sortIcon = (key) => {
    if (state.riskSort.key !== key) return '↕'
    return state.riskSort.dir === 'asc' ? '↑' : '↓'
  }

  host.className = 'dash-table-wrap'
  host.innerHTML = `
    <table class="dash-table dash-risk-table">
      <thead>
        <tr>
          <th><button class="dash-sort-btn ${state.riskSort.key === 'itcm' ? 'active' : ''}" type="button" data-risk-sort-key="itcm"><span>ITCM</span><span class="dash-sort-icon">${sortIcon('itcm')}</span></button></th>
          <th><button class="dash-sort-btn ${state.riskSort.key === 'summary' ? 'active' : ''}" type="button" data-risk-sort-key="summary"><span>Summary</span><span class="dash-sort-icon">${sortIcon('summary')}</span></button></th>
          <th><button class="dash-sort-btn ${state.riskSort.key === 'status' ? 'active' : ''}" type="button" data-risk-sort-key="status"><span>ITCM Status</span><span class="dash-sort-icon">${sortIcon('status')}</span></button></th>
          <th><button class="dash-sort-btn ${state.riskSort.key === 'fepmf' ? 'active' : ''}" type="button" data-risk-sort-key="fepmf"><span>FEPMF</span><span class="dash-sort-icon">${sortIcon('fepmf')}</span></button></th>
          <th><button class="dash-sort-btn ${state.riskSort.key === 'squad' ? 'active' : ''}" type="button" data-risk-sort-key="squad"><span>Squad</span><span class="dash-sort-icon">${sortIcon('squad')}</span></button></th>
          <th><button class="dash-sort-btn ${state.riskSort.key === 'cabDate' ? 'active' : ''}" type="button" data-risk-sort-key="cabDate"><span>CAB Date</span><span class="dash-sort-icon">${sortIcon('cabDate')}</span></button></th>
        </tr>
      </thead>
      <tbody>
        ${sortedRows.map((item) => `
          <tr>
            <td><a class="dash-item-key" href="${esc(item.browseUrl)}" target="_blank" rel="noopener noreferrer">${esc(item.key)}</a></td>
            <td>${esc(item.summary || '-')}</td>
            <td><span class="dash-itcm-pill">${esc(item.status)}</span></td>
            <td><a class="dash-item-key" href="${esc(item.parentUrl)}" target="_blank" rel="noopener noreferrer">${esc(item.parentKey)}</a></td>
            <td>${esc(item.squad || '-')}</td>
            <td>${esc(formatDate(item.cabDate))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}

function cabDateObj(value) {
  if (!value) return null
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function businessDateObj(value) {
  if (!value) return null
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function evaluateBusinessDate(dateObj, today) {
  if (!dateObj) return { text: 'No Business Date', cls: '' }
  const msDay = 24 * 60 * 60 * 1000
  const diff = Math.round((dateObj.getTime() - today.getTime()) / msDay)
  if (diff > 0) return { text: `เหลือ ${diff} วัน`, cls: 'upcoming' }
  if (diff < 0) return { text: `เกิน ${Math.abs(diff)} วัน`, cls: 'overdue' }
  return { text: 'ครบกำหนดวันนี้', cls: 'today' }
}

function renderUpcomingCabCards(rows) {
  const host = document.getElementById('dashCab')
  const sub = document.getElementById('dashCabSub')
  const countChip = document.getElementById('dashCabCount')
  if (!host) return
  host.className = 'cab-list'

  const candidates = rows
    .filter((row) => !isS7Status(row.parent.status))
    .map((row) => ({ row, cab: cabDateObj(row.parent.cabDate) }))
    .sort((a, b) => {
      if (a.cab && b.cab) return a.cab - b.cab
      if (a.cab && !b.cab) return -1
      if (!a.cab && b.cab) return 1
      return String(a.row.parent.key || '').localeCompare(String(b.row.parent.key || ''))
    })

  if (sub) {
    sub.textContent = ''
    sub.style.display = 'none'
  }
  if (countChip) countChip.textContent = `${candidates.length} งาน`

  if (!candidates.length) {
    host.innerHTML = '<div class="dash-empty">ไม่พบงานที่เข้าเงื่อนไข</div>'
    return
  }

  host.innerHTML = candidates.map(({ row, cab }, idx) => {
    const dateText = cab
      ? cab.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : '-'
    const dayText = cab ? cab.toLocaleDateString('en-GB', { day: '2-digit' }) : '--'
    const monText = cab ? cab.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() : '---'
    const url = row.parent.browseUrl || '#'
    const itcm = row.derived.itcmKeys[0] || '-'
    const status = row.parent.status || '-'
    const width = Math.min(100, 60 + ((idx % 4) * 12))
    return `
      <article class="cab-item">
        <div class="cab-date-pill">
          <div>${esc(dayText)}</div>
          <div>${esc(monText)}</div>
        </div>
        <div class="cab-main">
          <div class="cab-head">
            <a class="cab-key" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(row.parent.key)}</a>
            <span class="cab-status">${esc(status)}</span>
          </div>
          <div class="cab-summary">${esc(row.parent.summary || '-')}</div>
          <div class="cab-meta">
            <span>Squad: ${esc(row.parent.squad || '-')}</span>
            <span>CAB: ${esc(dateText)}</span>
            <span>ITCM: ${esc(itcm)}</span>
          </div>
          <div class="cab-line"><span style="width:${width}%"></span></div>
        </div>
      </article>
    `
  }).join('')
}

function renderBusinessDateSorting(rows) {
  const host = document.getElementById('dashBusinessDateRows')
  const countChip = document.getElementById('dashBusinessDateCount')
  const searchNode = document.getElementById('dashBusinessDateSearch')
  if (!host) return

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const scopedRows = (rows || []).filter((row) => !isS7Status(row.parent.status) && !isCancelledStatus(row.parent.status))
  const mapped = scopedRows.map((row) => {
    const businessDate = row.parent.businessDate || ''
    const bd = businessDateObj(businessDate)
    const bp = normalizeMultiValues(row.parent.businessPartner || []).join(', ') || '-'
    const bt = normalizeMultiValues(row.parent.businessType || []).join(', ') || '-'
    const evalInfo = evaluateBusinessDate(bd, today)
    const diffDays = bd ? Math.round((bd.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)) : Number.POSITIVE_INFINITY
    return {
      row,
      businessDate,
      bd,
      bp,
      bt,
      evalInfo,
      diffDays
    }
  })

  const query = String(state.bizDateQuery || '').trim().toLowerCase()
  const filtered = !query ? mapped : mapped.filter((item) => {
    const blob = [
      item.row.parent.key,
      item.row.parent.summary,
      item.bp,
      item.bt,
      item.row.parent.assignee,
      item.row.parent.status,
      item.businessDate,
      item.evalInfo.text
    ].join(' ').toLowerCase()
    return query.split(/\s+/).filter(Boolean).every((term) => blob.includes(term))
  })

  if (!state.bizDateSort) state.bizDateSort = { key: 'evaluate', dir: 'asc' }
  const sort = state.bizDateSort
  const sortValue = (item, key) => {
    if (key === 'evaluate') return Number.isFinite(item.diffDays) ? item.diffDays : Number.POSITIVE_INFINITY
    if (key === 'status') return String(item.row.parent.status || '').toLowerCase()
    if (key === 'fepmf') return String(item.row.parent.key || '').toLowerCase()
    if (key === 'summary') return String(item.row.parent.summary || '').toLowerCase()
    if (key === 'businessPartner') return String(item.bp || '').toLowerCase()
    if (key === 'businessType') return String(item.bt || '').toLowerCase()
    if (key === 'assignee') return String(item.row.parent.assignee || '').toLowerCase()
    return ''
  }
  const sorted = [...filtered].sort((a, b) => {
    const av = sortValue(a, sort.key)
    const bv = sortValue(b, sort.key)
    if (av < bv) return sort.dir === 'asc' ? -1 : 1
    if (av > bv) return sort.dir === 'asc' ? 1 : -1
    return String(a.row.parent.key || '').localeCompare(String(b.row.parent.key || ''))
  })
  const sortIcon = (key) => {
    if (sort.key !== key) return '↕'
    return sort.dir === 'asc' ? '↑' : '↓'
  }

  if (countChip) countChip.textContent = `${sorted.length} FEPMF`
  if (searchNode && searchNode.value !== state.bizDateQuery) searchNode.value = state.bizDateQuery
  if (!sorted.length) {
    host.innerHTML = '<div class="dash-empty">ไม่พบ FEPMF สำหรับการจัดเรียง Business Date</div>'
    return
  }

  host.innerHTML = `
    <table class="dash-table dash-bizdate-table">
      <thead>
        <tr>
          <th><button class="dash-sort-btn ${sort.key === 'evaluate' ? 'active' : ''}" type="button" data-biz-sort-key="evaluate"><span>Evaluate</span><span class="dash-sort-icon">${sortIcon('evaluate')}</span></button></th>
          <th><button class="dash-sort-btn ${sort.key === 'status' ? 'active' : ''}" type="button" data-biz-sort-key="status"><span>Status</span><span class="dash-sort-icon">${sortIcon('status')}</span></button></th>
          <th><button class="dash-sort-btn ${sort.key === 'fepmf' ? 'active' : ''}" type="button" data-biz-sort-key="fepmf"><span>FEPMF</span><span class="dash-sort-icon">${sortIcon('fepmf')}</span></button></th>
          <th><button class="dash-sort-btn ${sort.key === 'summary' ? 'active' : ''}" type="button" data-biz-sort-key="summary"><span>Summary</span><span class="dash-sort-icon">${sortIcon('summary')}</span></button></th>
          <th><button class="dash-sort-btn ${sort.key === 'businessPartner' ? 'active' : ''}" type="button" data-biz-sort-key="businessPartner"><span>Business Partner</span><span class="dash-sort-icon">${sortIcon('businessPartner')}</span></button></th>
          <th><button class="dash-sort-btn ${sort.key === 'businessType' ? 'active' : ''}" type="button" data-biz-sort-key="businessType"><span>Business Type</span><span class="dash-sort-icon">${sortIcon('businessType')}</span></button></th>
          <th><button class="dash-sort-btn ${sort.key === 'assignee' ? 'active' : ''}" type="button" data-biz-sort-key="assignee"><span>Assignee</span><span class="dash-sort-icon">${sortIcon('assignee')}</span></button></th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(({ row, bp, bt, evalInfo, businessDate }) => `
          <tr>
            <td><span class="dash-eval-pill ${esc(evalInfo.cls)}">${esc(evalInfo.text)}${businessDate ? ` (${esc(formatDate(businessDate))})` : ''}</span></td>
            <td><span class="${badgeClass(row.parent.status)}">${esc(row.parent.status || '-')}</span></td>
            <td><a class="dash-item-key" href="${esc(row.parent.browseUrl || '#')}" target="_blank" rel="noopener noreferrer">${esc(row.parent.key || '-')}</a></td>
            <td>${esc(row.parent.summary || '-')}</td>
            <td title="${esc(bp)}">${esc(bp)}</td>
            <td title="${esc(bt)}">${esc(bt)}</td>
            <td>${esc(row.parent.assignee || '-')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}

function compareClass(type) {
  if (type === 'equal') return 'cmp-equal'
  if (type === 'early') return 'cmp-early'
  if (type === 'late') return 'cmp-late'
  return 'cmp-na'
}

function tableSortValue(row, key) {
  if (key === 'fepmf') return String(row.parent.key || '').toLowerCase()
  if (key === 'summary') return String(row.parent.summary || '').toLowerCase()
  if (key === 'status') return String(row.parent.status || '').toLowerCase()
  if (key === 'squad') return String(row.parent.squad || '').toLowerCase()
  if (key === 'estimate') return row.derived.estimateNum ?? Number.POSITIVE_INFINITY
  if (key === 'actual') return row.derived.actualNum ?? Number.POSITIVE_INFINITY
  if (key === 'compare') {
    const rank = { equal: 0, early: 1, late: 2, na: 3 }
    return rank[row.derived.compareType] ?? 99
  }
  if (key === 'itcm') return (row.derived.itcmKeys || []).join('|').toLowerCase()
  if (key === 'itcmStatus') return (row.derived.itcmStatuses || []).join('|').toLowerCase()
  if (key === 'cabDate') {
    const d = safeDate(`${row.parent.cabDate || ''}T00:00:00Z`)
    return d ? d.getTime() : Number.POSITIVE_INFINITY
  }
  if (key === 'progress') return Number(row.progressPercent || 0)
  if (key === 'linked') return Number(row.linkedCount || 0)
  return ''
}

function updateTableSortHeaders() {
  const head = document.getElementById('dashTableHead')
  if (!head) return
  if (!state.tableSort) state.tableSort = { key: 'fepmf', dir: 'asc' }
  for (const btn of head.querySelectorAll('[data-sort-key]')) {
    const key = btn.getAttribute('data-sort-key')
    const icon = btn.querySelector('.dash-sort-icon')
    const active = key === state.tableSort.key
    btn.classList.toggle('active', active)
    let ariaSort = 'none'
    let symbol = '↕'
    if (active && state.tableSort.dir === 'asc') {
      ariaSort = 'ascending'
      symbol = '↑'
    } else if (active && state.tableSort.dir === 'desc') {
      ariaSort = 'descending'
      symbol = '↓'
    }
    btn.setAttribute('aria-sort', ariaSort)
    if (icon) icon.textContent = symbol
  }
}

function tableRowMarkup(row) {
  const estimateText = row.derived.estimateNum != null ? `Sprint${row.derived.estimateNum}` : '-'
  const actualText = row.derived.actualNum != null ? `Sprint${row.derived.actualNum}` : '-'
  const itcmKeys = row.derived.itcmKeys.length
    ? row.derived.itcmKeys.map((key) => `<div class="dash-itcm-line">${esc(key)}</div>`).join('')
    : '<div class="dash-itcm-line">-</div>'
  const itcmStatuses = row.derived.itcmStatuses.length
    ? row.derived.itcmStatuses.map((status) => `<div class="dash-itcm-line">${esc(status)}</div>`).join('')
    : '<div class="dash-itcm-line">-</div>'

  return `
    <tr>
      <td><a class="dash-item-key" href="${esc(row.parent.browseUrl)}" target="_blank" rel="noopener noreferrer">${esc(row.parent.key)}</a></td>
      <td class="dash-col-summary">${esc(row.parent.summary || '-')}</td>
      <td><span class="${badgeClass(row.parent.status)}">${esc(row.parent.status || '-')}</span></td>
      <td>${esc(row.parent.squad || '-')}</td>
      <td>${esc(estimateText)}</td>
      <td>${esc(actualText)}</td>
      <td><span class="dash-compare ${compareClass(row.derived.compareType)}">${esc(compareLabel(row.derived.compareType))}</span></td>
      <td><div class="dash-itcm-cell">${itcmKeys}</div></td>
      <td><div class="dash-itcm-cell">${itcmStatuses}</div></td>
      <td>${esc(formatDate(row.parent.cabDate))}</td>
      <td><strong>${esc(row.progressPercent || 0)}%</strong></td>
      <td>${esc(row.linkedCount || 0)}</td>
    </tr>
  `
}

function renderStatusModalRows(status) {
  const modalRows = document.getElementById('dashStatusModalRows')
  const modalStatus = document.getElementById('dashStatusModalStatus')
  const modalCount = document.getElementById('dashStatusModalCount')
  const modalHead = document.getElementById('dashStatusModalHead')
  if (!modalRows || !modalStatus || !modalCount || !modalHead) return

  const filtered = (state.rows || [])
    .filter((row) => String(row.parent.status || 'Unknown') === String(status || ''))

  modalStatus.textContent = status || '-'
  modalCount.textContent = `${filtered.length} รายการ`

  if (!filtered.length) {
    modalRows.innerHTML = '<tr><td colspan="12" class="dash-empty">No result found</td></tr>'
    modalHead.querySelectorAll('[data-modal-sort-key]').forEach((btn) => {
      btn.classList.remove('active')
      const icon = btn.querySelector('.dash-sort-icon')
      if (icon) icon.textContent = '↕'
    })
    return
  }

  if (!state.kpiModalSort) state.kpiModalSort = { key: 'fepmf', dir: 'asc' }
  const sorted = [...filtered].sort((a, b) => {
    const av = tableSortValue(a, state.kpiModalSort.key)
    const bv = tableSortValue(b, state.kpiModalSort.key)
    if (av < bv) return state.kpiModalSort.dir === 'asc' ? -1 : 1
    if (av > bv) return state.kpiModalSort.dir === 'asc' ? 1 : -1
    return String(a.parent.key || '').localeCompare(String(b.parent.key || ''))
  })

  modalRows.innerHTML = sorted.map(tableRowMarkup).join('')

  modalHead.querySelectorAll('[data-modal-sort-key]').forEach((btn) => {
    const key = btn.getAttribute('data-modal-sort-key')
    const active = key === state.kpiModalSort.key
    btn.classList.toggle('active', active)
    const icon = btn.querySelector('.dash-sort-icon')
    if (icon) icon.textContent = active ? (state.kpiModalSort.dir === 'asc' ? '↑' : '↓') : '↕'
  })
}

function openStatusModal(status) {
  const modal = document.getElementById('dashStatusModal')
  if (!modal) return
  state.kpiModalStatus = status || null
  renderStatusModalRows(status)
  modal.classList.add('open')
  modal.setAttribute('aria-hidden', 'false')
  document.body.classList.add('modal-open')
}

function closeStatusModal() {
  const modal = document.getElementById('dashStatusModal')
  if (!modal) return
  modal.classList.remove('open')
  modal.setAttribute('aria-hidden', 'true')
  document.body.classList.remove('modal-open')
}

function applyTableKeywordFilter(rows) {
  const terms = String(state.tableQuery || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return rows
  return rows.filter((row) => {
    const blob = rowBlob(row)
    return terms.every((term) => blob.includes(term))
  })
}

function renderTable() {
  const host = document.getElementById('dashRows')
  const rows = applyTableKeywordFilter(state.rows || [])
  if (!state.tableSort) state.tableSort = { key: 'fepmf', dir: 'asc' }
  if (!rows.length) {
    host.innerHTML = '<tr><td colspan="12" class="dash-empty">No table match found</td></tr>'
    updateTableSortHeaders()
    return
  }

  const sortedRows = [...rows]
    .sort((a, b) => {
      const av = tableSortValue(a, state.tableSort.key)
      const bv = tableSortValue(b, state.tableSort.key)
      if (av < bv) return state.tableSort.dir === 'asc' ? -1 : 1
      if (av > bv) return state.tableSort.dir === 'asc' ? 1 : -1
      return String(a.parent.key || '').localeCompare(String(b.parent.key || ''))
    })

  host.innerHTML = sortedRows
    .map(tableRowMarkup)
    .join('')
  updateTableSortHeaders()
}

function renderHighlights() {
  const rows = (state.rows || []).filter((row) => !isCancelledStatus(row.parent.status))
  renderRiskByItcmStatus(rows)
  renderUpcomingCabCards(rows)
  renderBusinessDateSorting(rows)
}

function renderResultSummary() {
  const rows = state.rows || []
  const tableRows = applyTableKeywordFilter(rows)
  const host = document.getElementById('dashResultInfo')
  if (!host) return

  const withItcm = rows.filter((row) => row.derived.itcmKeys.length).length
  const comparable = rows.filter((row) => row.derived.compareType !== 'na').length

  host.innerHTML = `
    <span class="dash-chip">Results: ${esc(rows.length)}</span>
    <span class="dash-chip">Table Match: ${esc(tableRows.length)}</span>
    <span class="dash-chip">With ITCM: ${esc(withItcm)}</span>
    <span class="dash-chip">Comparable Sprint: ${esc(comparable)}</span>
  `
}

function renderAll() {
  filterRows()
  renderKpis()
  renderCurrentSprintPendingMetric()
  renderStatusBars()
  renderSmartReading()
  renderBusinessBentoSections()
  renderCompareAnalysis()
  renderStatusKpiCards()
  renderHighlights()
  renderTable()
  renderResultSummary()
  if (state.kpiModalStatus) renderStatusModalRows(state.kpiModalStatus)
}

function renderStatusOptions() {
  const statuses = state.data?.meta?.available?.statuses || []
  const host = document.getElementById('dashStatusOptions')
  const allNode = document.getElementById('dashStatusAll')
  const summaryNode = document.getElementById('dashStatusSummaryText')
  if (!host || !allNode || !summaryNode) return
  const selected = state.statusSelections || []

  host.innerHTML = statuses.length
    ? statuses.map((status) => {
      const checked = selected.includes(status) ? 'checked' : ''
      return `<label class="dash-multi-item" data-label="${esc(String(status).toLowerCase())}"><input type="checkbox" value="${esc(status)}" ${checked}/> ${esc(status)}</label>`
    }).join('')
    : '<div class="dash-empty">No value</div>'

  allNode.checked = selected.length === 0
  if (!selected.length) {
    summaryNode.textContent = 'Status: All'
  } else {
    const preview = selected.slice(0, 2).join(', ')
    summaryNode.textContent = selected.length > 2 ? `Status: ${preview} +${selected.length - 2}` : `Status: ${preview}`
  }
}

function renderCompareOptions() {
  const compareOptions = [
    { value: 'equal', label: 'Actual = Estimate' },
    { value: 'early', label: 'Actual เร็วกว่า Estimate' },
    { value: 'late', label: 'Actual ช้ากว่า Estimate' },
    { value: 'na', label: 'Compare N/A' }
  ]
  const host = document.getElementById('dashCompareOptions')
  const allNode = document.getElementById('dashCompareAll')
  const summaryNode = document.getElementById('dashCompareSummaryText')
  if (!host || !allNode || !summaryNode) return
  const selected = state.compareSelections || []

  host.innerHTML = compareOptions.map((opt) => {
    const checked = selected.includes(opt.value) ? 'checked' : ''
    return `<label class="dash-multi-item" data-label="${esc(String(opt.label).toLowerCase())}"><input type="checkbox" value="${esc(opt.value)}" ${checked}/> ${esc(opt.label)}</label>`
  }).join('')

  allNode.checked = selected.length === 0
  if (!selected.length) {
    summaryNode.textContent = 'Compare: All'
  } else {
    const selectedLabels = compareOptions.filter((o) => selected.includes(o.value)).map((o) => o.label)
    const preview = selectedLabels.slice(0, 2).join(', ')
    summaryNode.textContent = selectedLabels.length > 2 ? `Compare: ${preview} +${selectedLabels.length - 2}` : `Compare: ${preview}`
  }
}

function getBusinessFilterValues(key) {
  const fromMeta = state.data?.meta?.available?.[key]
  if (Array.isArray(fromMeta) && fromMeta.length) {
    return [...new Set(fromMeta.map((v) => String(v || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
  }
  const parentKey = key === 'businessTypes' ? 'businessType' : 'businessPartner'
  const fallback = (state.data?.parents || []).flatMap((row) => normalizeMultiValues(row?.parent?.[parentKey]))
  return [...new Set(fallback.map((v) => String(v || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
}

function updateBusinessFilterSummary(summaryId, label, selected) {
  const summary = document.getElementById(summaryId)
  if (!summary) return
  if (!selected.length) {
    summary.textContent = `${label}: All`
    return
  }
  const preview = selected.slice(0, 2).join(', ')
  summary.textContent = selected.length > 2 ? `${label}: ${preview} +${selected.length - 2}` : `${label}: ${preview}`
}

function renderBusinessFilterOptions(opts) {
  const values = getBusinessFilterValues(opts.dataKey)
  const selected = state[opts.stateKey] || []
  const optionsNode = document.getElementById(opts.optionsId)
  const allNode = document.getElementById(opts.allId)
  if (!optionsNode || !allNode) return

  optionsNode.innerHTML = values.length
    ? values.map((value) => {
      const checked = selected.includes(value) ? 'checked' : ''
      return `<label class="dash-multi-item" data-label="${esc(value.toLowerCase())}"><input type="checkbox" value="${esc(value)}" ${checked}/> ${esc(value)}</label>`
    }).join('')
    : '<div class="dash-empty">No value</div>'

  allNode.checked = selected.length === 0
  updateBusinessFilterSummary(opts.summaryId, opts.label, selected)
}

function filterBusinessOptionList(inputId, optionsId) {
  const input = document.getElementById(inputId)
  const list = document.getElementById(optionsId)
  if (!input || !list) return
  const q = String(input.value || '').trim().toLowerCase()
  list.querySelectorAll('.dash-multi-item[data-label]').forEach((node) => {
    const label = String(node.getAttribute('data-label') || '')
    node.style.display = !q || label.includes(q) ? '' : 'none'
  })
}

function renderBusinessFilters() {
  renderBusinessFilterOptions({
    dataKey: 'businessTypes',
    stateKey: 'businessTypes',
    optionsId: 'dashBusinessTypeOptions',
    allId: 'dashBusinessTypeAll',
    summaryId: 'dashBusinessTypeSummary',
    label: 'Business Type'
  })
  renderBusinessFilterOptions({
    dataKey: 'businessPartners',
    stateKey: 'businessPartners',
    optionsId: 'dashBusinessPartnerOptions',
    allId: 'dashBusinessPartnerAll',
    summaryId: 'dashBusinessPartnerSummary',
    label: 'Business Partner'
  })
}

function bindEvents() {
  document.getElementById('dashSearch').addEventListener('input', (event) => {
    state.query = event.target.value || ''
    renderAll()
  })
  const tableSearch = document.getElementById('dashTableSearch')
  if (tableSearch) {
    tableSearch.addEventListener('input', (event) => {
      state.tableQuery = event.target.value || ''
      renderTable()
      renderResultSummary()
    })
  }
  const smartFrom = document.getElementById('dashSmartDateFrom')
  const smartTo = document.getElementById('dashSmartDateTo')
  if (smartFrom) {
    smartFrom.addEventListener('change', (event) => {
      state.smartDateFrom = String(event.target.value || '').trim() || firstDayPrevMonthIsoLocal()
      renderSmartReading()
    })
  }
  if (smartTo) {
    smartTo.addEventListener('change', (event) => {
      state.smartDateTo = String(event.target.value || '').trim() || todayIsoLocal()
      renderSmartReading()
    })
  }
  const bizDateSearch = document.getElementById('dashBusinessDateSearch')
  if (bizDateSearch) {
    bizDateSearch.addEventListener('input', (event) => {
      state.bizDateQuery = String(event.target.value || '')
      renderBusinessDateSorting(state.rows || [])
    })
  }
  const bindVizSwitch = (id, mode, stateKey) => {
    const node = document.getElementById(id)
    if (!node) return
    node.addEventListener('click', () => {
      state[stateKey] = mode
      renderBusinessBentoSections()
    })
  }
  bindVizSwitch('dashPartnerViewPie', 'pie', 'partnerViz')
  bindVizSwitch('dashPartnerViewHBar', 'hbar', 'partnerViz')
  bindVizSwitch('dashPartnerViewVBar', 'vbar', 'partnerViz')
  bindVizSwitch('dashTypeViewPie', 'pie', 'typeViz')
  bindVizSwitch('dashTypeViewHBar', 'hbar', 'typeViz')
  bindVizSwitch('dashTypeViewVBar', 'vbar', 'typeViz')

  document.getElementById('dashStatusAll').addEventListener('change', (event) => {
    if (!event.target.checked) return
    state.statusSelections = []
    renderStatusOptions()
    renderAll()
  })

  document.getElementById('dashCompareAll').addEventListener('change', (event) => {
    if (!event.target.checked) return
    state.compareSelections = []
    renderCompareOptions()
    renderAll()
  })

  document.getElementById('dashStatusOptions').addEventListener('change', () => {
    const checked = [...document.querySelectorAll('#dashStatusOptions input[type="checkbox"]:checked')]
      .map((n) => String(n.value || '').trim())
      .filter(Boolean)
    const allValues = state.data?.meta?.available?.statuses || []
    state.statusSelections = checked.length === allValues.length ? [] : checked
    renderStatusOptions()
    renderAll()
  })

  document.getElementById('dashCompareOptions').addEventListener('change', () => {
    const checked = [...document.querySelectorAll('#dashCompareOptions input[type="checkbox"]:checked')]
      .map((n) => String(n.value || '').trim())
      .filter(Boolean)
    const allValues = ['equal', 'early', 'late', 'na']
    state.compareSelections = checked.length === allValues.length ? [] : checked
    renderCompareOptions()
    renderAll()
  })

  document.getElementById('dashStatusSearch').addEventListener('input', () => {
    filterBusinessOptionList('dashStatusSearch', 'dashStatusOptions')
  })

  document.getElementById('dashCompareSearch').addEventListener('input', () => {
    filterBusinessOptionList('dashCompareSearch', 'dashCompareOptions')
  })

  document.getElementById('dashBusinessTypeAll').addEventListener('change', (event) => {
    if (!event.target.checked) return
    state.businessTypes = []
    renderBusinessFilters()
    renderAll()
  })

  document.getElementById('dashBusinessPartnerAll').addEventListener('change', (event) => {
    if (!event.target.checked) return
    state.businessPartners = []
    renderBusinessFilters()
    renderAll()
  })

  document.getElementById('dashBusinessTypeOptions').addEventListener('change', () => {
    const checked = [...document.querySelectorAll('#dashBusinessTypeOptions input[type="checkbox"]:checked')]
      .map((n) => String(n.value || '').trim())
      .filter(Boolean)
    const values = getBusinessFilterValues('businessTypes')
    state.businessTypes = checked.length === values.length ? [] : checked
    renderBusinessFilters()
    renderAll()
  })

  document.getElementById('dashBusinessPartnerOptions').addEventListener('change', () => {
    const checked = [...document.querySelectorAll('#dashBusinessPartnerOptions input[type="checkbox"]:checked')]
      .map((n) => String(n.value || '').trim())
      .filter(Boolean)
    const values = getBusinessFilterValues('businessPartners')
    state.businessPartners = checked.length === values.length ? [] : checked
    renderBusinessFilters()
    renderAll()
  })

  document.getElementById('dashBusinessTypeSearch').addEventListener('input', () => {
    filterBusinessOptionList('dashBusinessTypeSearch', 'dashBusinessTypeOptions')
  })

  document.getElementById('dashBusinessPartnerSearch').addEventListener('input', () => {
    filterBusinessOptionList('dashBusinessPartnerSearch', 'dashBusinessPartnerOptions')
  })

  document.getElementById('dashClear').addEventListener('click', () => {
    state.query = ''
    state.statusSelections = []
    state.compareSelections = []
    state.businessTypes = []
    state.businessPartners = []
    state.tableQuery = ''
    state.partnerFocus = 'ALL'
    state.typeFocus = 'ALL'
    state.partnerViz = 'pie'
    state.typeViz = 'pie'
    state.partnerSort = { key: 'fepmf', dir: 'asc' }
    state.typeSort = { key: 'fepmf', dir: 'asc' }
    state.bizDateSort = { key: 'evaluate', dir: 'asc' }
    state.bizDateQuery = ''
    state.smartDateFrom = firstDayPrevMonthIsoLocal()
    state.smartDateTo = todayIsoLocal()
    document.getElementById('dashSearch').value = ''
    document.getElementById('dashStatusSearch').value = ''
    document.getElementById('dashCompareSearch').value = ''
    document.getElementById('dashBusinessTypeSearch').value = ''
    document.getElementById('dashBusinessPartnerSearch').value = ''
    const tableSearch = document.getElementById('dashTableSearch')
    if (tableSearch) tableSearch.value = ''
    if (bizDateSearch) bizDateSearch.value = ''
    const smartFrom = document.getElementById('dashSmartDateFrom')
    const smartTo = document.getElementById('dashSmartDateTo')
    if (smartFrom) smartFrom.value = state.smartDateFrom
    if (smartTo) smartTo.value = state.smartDateTo
    renderStatusOptions()
    renderCompareOptions()
    renderBusinessFilters()
    renderAll()
  })

  document.getElementById('dashRefresh').addEventListener('click', () => load(true))
  const tableHead = document.getElementById('dashTableHead')
  if (tableHead) {
    tableHead.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-sort-key]')
      if (!btn) return
      const key = btn.getAttribute('data-sort-key')
      if (!key) return
      if (!state.tableSort) state.tableSort = { key: 'fepmf', dir: 'asc' }
      if (state.tableSort.key === key) {
        state.tableSort.dir = state.tableSort.dir === 'asc' ? 'desc' : 'asc'
      } else {
        state.tableSort.key = key
        state.tableSort.dir = 'asc'
      }
      renderTable()
    })
  }

  const barBtn = document.getElementById('dashViewBar')
  const pieBtn = document.getElementById('dashViewPie')
  if (barBtn) {
    barBtn.addEventListener('click', () => {
      state.statusView = 'bar'
      renderStatusBars()
    })
  }
  if (pieBtn) {
    pieBtn.addEventListener('click', () => {
      state.statusView = 'pie'
      renderStatusBars()
    })
  }
  const riskTabs = document.getElementById('dashRiskTabs')
  if (riskTabs) {
    riskTabs.addEventListener('click', (event) => {
      const btn = event.target.closest('.dash-risk-tab[data-tab]')
      if (!btn) return
      state.riskItcmTab = btn.getAttribute('data-tab') || 'all'
      renderHighlights()
    })
  }
  document.addEventListener('click', (event) => {
    const bento = event.target.closest('[data-bento-kind][data-bento-label]')
    if (bento) {
      const kind = bento.getAttribute('data-bento-kind')
      const label = bento.getAttribute('data-bento-label') || ''
      if (!kind) return
      if (kind === 'partnerFocus') state.partnerFocus = label
      if (kind === 'typeFocus') state.typeFocus = label
      renderBusinessBentoSections()
      return
    }
    const bentoSort = event.target.closest('[data-bento-sort-kind][data-bento-sort-key]')
    if (bentoSort) {
      const kind = bentoSort.getAttribute('data-bento-sort-kind')
      const key = bentoSort.getAttribute('data-bento-sort-key')
      if (!kind || !key) return
      if (!state[kind]) state[kind] = { key: 'fepmf', dir: 'asc' }
      if (state[kind].key === key) {
        state[kind].dir = state[kind].dir === 'asc' ? 'desc' : 'asc'
      } else {
        state[kind].key = key
        state[kind].dir = 'asc'
      }
      renderBusinessBentoSections()
    }
  })
  const riskHost = document.getElementById('dashRisk')
  if (riskHost) {
    riskHost.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-risk-sort-key]')
      if (!btn) return
      const key = btn.getAttribute('data-risk-sort-key')
      if (!key) return
      if (!state.riskSort) state.riskSort = { key: 'itcm', dir: 'asc' }
      if (state.riskSort.key === key) {
        state.riskSort.dir = state.riskSort.dir === 'asc' ? 'desc' : 'asc'
      } else {
        state.riskSort.key = key
        state.riskSort.dir = 'asc'
      }
      renderRiskByItcmStatus(state.rows || [])
    })
  }
  const bizDateHost = document.getElementById('dashBusinessDateRows')
  if (bizDateHost) {
    bizDateHost.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-biz-sort-key]')
      if (!btn) return
      const key = btn.getAttribute('data-biz-sort-key')
      if (!key) return
      if (!state.bizDateSort) state.bizDateSort = { key: 'evaluate', dir: 'asc' }
      if (state.bizDateSort.key === key) {
        state.bizDateSort.dir = state.bizDateSort.dir === 'asc' ? 'desc' : 'asc'
      } else {
        state.bizDateSort.key = key
        state.bizDateSort.dir = 'asc'
      }
      renderBusinessDateSorting(state.rows || [])
    })
  }
  const modalHead = document.getElementById('dashStatusModalHead')
  if (modalHead) {
    modalHead.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-modal-sort-key]')
      if (!btn) return
      const key = btn.getAttribute('data-modal-sort-key')
      if (!key) return
      if (!state.kpiModalSort) state.kpiModalSort = { key: 'fepmf', dir: 'asc' }
      if (state.kpiModalSort.key === key) {
        state.kpiModalSort.dir = state.kpiModalSort.dir === 'asc' ? 'desc' : 'asc'
      } else {
        state.kpiModalSort.key = key
        state.kpiModalSort.dir = 'asc'
      }
      if (state.kpiModalStatus) renderStatusModalRows(state.kpiModalStatus)
    })
  }
  document.addEventListener('click', (event) => {
    const cta = event.target.closest('.dash-status-kpi-cta[data-status]')
    if (cta) {
      openStatusModal(cta.dataset.status || '')
      return
    }
    if (event.target.matches('[data-close-status-modal]')) {
      closeStatusModal()
      return
    }
    const modal = document.getElementById('dashStatusModal')
    if (modal && event.target === modal) closeStatusModal()

    const statusMulti = document.getElementById('dashStatusMulti')
    const compareMulti = document.getElementById('dashCompareMulti')
    const typeMulti = document.getElementById('dashBusinessTypeMulti')
    const partnerMulti = document.getElementById('dashBusinessPartnerMulti')
    if (statusMulti && !statusMulti.contains(event.target)) statusMulti.removeAttribute('open')
    if (compareMulti && !compareMulti.contains(event.target)) compareMulti.removeAttribute('open')
    if (typeMulti && !typeMulti.contains(event.target)) typeMulti.removeAttribute('open')
    if (partnerMulti && !partnerMulti.contains(event.target)) partnerMulti.removeAttribute('open')
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeStatusModal()
      const statusMulti = document.getElementById('dashStatusMulti')
      const compareMulti = document.getElementById('dashCompareMulti')
      const typeMulti = document.getElementById('dashBusinessTypeMulti')
      const partnerMulti = document.getElementById('dashBusinessPartnerMulti')
      if (statusMulti) statusMulti.removeAttribute('open')
      if (compareMulti) compareMulti.removeAttribute('open')
      if (typeMulti) typeMulti.removeAttribute('open')
      if (partnerMulti) partnerMulti.removeAttribute('open')
    }
  })
}

async function load(refresh = false) {
  try {
    const response = await fetch(`/api/dashboard${refresh ? '?refresh=true' : ''}`)
    const data = await response.json()
    if (data.error) throw new Error(data.error)

    state.data = data
    renderStatusOptions()
    renderCompareOptions()
    renderBusinessFilters()
    renderAll()

    document.getElementById('dashSync').textContent = `Updated: ${new Date(data.generatedAt || Date.now()).toLocaleString('th-TH')}`
    const sprintValue = document.getElementById('dashSprintValue')
    const daysValue = document.getElementById('dashDaysValue')
    if (sprintValue) sprintValue.textContent = `${data.summary?.currentSprintName || '-'}`
    if (daysValue) daysValue.textContent = `${data.summary?.workingDaysRemaining ?? '-'}`
  } catch (error) {
    document.getElementById('dashRows').innerHTML = `<tr><td colspan="12" class="dash-empty">Failed to load data: ${esc(error.message || error)}</td></tr>`
    document.getElementById('dashRisk').innerHTML = '<div class="dash-empty">No data</div>'
    document.getElementById('dashCab').innerHTML = '<div class="dash-empty">No data</div>'
    const bizHost = document.getElementById('dashBusinessDateRows')
    const bizCount = document.getElementById('dashBusinessDateCount')
    if (bizHost) bizHost.innerHTML = '<div class="dash-empty">No data</div>'
    if (bizCount) bizCount.textContent = '0 FEPMF'
    document.getElementById('dashCompareAnalysis').innerHTML = '<div class="dash-empty">No data</div>'
    const statusCards = document.getElementById('dashStatusKpiCards')
    const statusTotal = document.getElementById('dashStatusTotal')
    const pendingPercent = document.getElementById('dashPendingPercent')
    const pendingCount = document.getElementById('dashPendingCount')
    const pendingTotal = document.getElementById('dashPendingTotal')
    const pendingRing = document.getElementById('dashPendingRing')
    const pendingBento = document.getElementById('dashPendingStatusBento')
    if (statusCards) statusCards.innerHTML = '<div class="dash-empty">No data</div>'
    if (statusTotal) statusTotal.textContent = '0'
    if (pendingPercent) pendingPercent.textContent = '0'
    if (pendingCount) pendingCount.textContent = '0'
    if (pendingTotal) pendingTotal.textContent = '0'
    if (pendingRing) pendingRing.style.setProperty('--pct', '0')
    if (pendingBento) pendingBento.innerHTML = '<span class="dash-pending-empty">No data</span>'
    const resultInfo = document.getElementById('dashResultInfo')
    if (resultInfo) resultInfo.innerHTML = ''
    document.getElementById('dashSync').textContent = 'Load failed'
  }
}

bindEvents()
load()
















