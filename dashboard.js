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
  kpiModalStatus: null
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
  if (!percentNode || !pendingCountNode || !totalNode || !ringNode) return

  const rows = state.rows || []
  const currentSprintNum = parseSprintNumber(state.data?.summary?.currentSprintName)
  if (currentSprintNum == null) {
    percentNode.textContent = '0'
    pendingCountNode.textContent = '0'
    totalNode.textContent = '0'
    ringNode.style.setProperty('--pct', '0')
    return
  }

  const currentSprintRows = rows.filter((row) => row.derived.actualNum === currentSprintNum)
  const totalCurrent = currentSprintRows.length
  const pendingCount = currentSprintRows.filter((row) => !isS7Status(row.parent.status)).length
  const pct = totalCurrent ? Math.round((pendingCount / totalCurrent) * 100) : 0

  percentNode.textContent = String(pct)
  pendingCountNode.textContent = String(pendingCount)
  totalNode.textContent = String(totalCurrent)
  ringNode.style.setProperty('--pct', String(pct))
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
    { bar: 'linear-gradient(180deg,#6eb8ff 0%,#2b72de 100%)', pie: '#2b72de' },
    { bar: 'linear-gradient(180deg,#79d9d1 0%,#2a93b8 100%)', pie: '#2a93b8' },
    { bar: 'linear-gradient(180deg,#8ca8ff 0%,#4f69df 100%)', pie: '#4f69df' },
    { bar: 'linear-gradient(180deg,#ff9cc2 0%,#e35493 100%)', pie: '#e35493' },
    { bar: 'linear-gradient(180deg,#ffc28f 0%,#f08337 100%)', pie: '#f08337' },
    { bar: 'linear-gradient(180deg,#b8df89 0%,#62a83b 100%)', pie: '#62a83b' },
    { bar: 'linear-gradient(180deg,#cfb6ff 0%,#7a5ad8 100%)', pie: '#7a5ad8' },
    { bar: 'linear-gradient(180deg,#9ec2cb 0%,#4b7987 100%)', pie: '#4b7987' }
  ]

  const rowsByCount = [...orderedStatuses]
    .map((status) => ({ status, count: counts.get(status) || 0 }))

  if (state.statusView === 'pie') {
    const total = rowsByCount.reduce((sum, item) => sum + item.count, 0) || 1
    const radius = 72
    const c = 2 * Math.PI * radius
    const gapPct = 3.2

    let currentPct = 0
    const slices = rowsByCount.map((item, index) => {
      const pct = (item.count / total) * 100
      const usablePct = Math.max(0.8, pct - gapPct)
      const length = (usablePct / 100) * c
      const offset = -((currentPct + gapPct / 2) / 100) * c
      currentPct += pct
      return {
        ...item,
        pct,
        color: palette[index % palette.length].pie,
        length,
        offset
      }
    })

    host.innerHTML = `
      <div class="dash-pie-wrap">
        <div class="dash-pie-left">
          <svg class="dash-pie-svg" viewBox="0 0 200 200" aria-label="Status pie chart">
            <circle class="dash-pie-ring-bg" cx="100" cy="100" r="${radius}"></circle>
            ${slices.map((slice, idx) => `
              <circle
                class="dash-pie-seg"
                cx="100"
                cy="100"
                r="${radius}"
                stroke="${slice.color}"
                stroke-dasharray="${slice.length.toFixed(2)} ${c.toFixed(2)}"
                stroke-dashoffset="${slice.offset.toFixed(2)}"
                data-idx="${idx}"
              ></circle>
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

    const focusEl = host.querySelector('#dashPieFocus')
    const focusMarkEl = host.querySelector('#dashPieFocusMark')
    const focusValueEl = host.querySelector('#dashPieFocusValue')
    const focusSubEl = host.querySelector('#dashPieFocusSub')
    const segs = host.querySelectorAll('.dash-pie-seg')
    const items = host.querySelectorAll('.dash-pie-item')

    const applyFocus = (idx) => {
      const slice = slices[idx]
      if (!slice || !focusEl || !focusMarkEl || !focusValueEl || !focusSubEl) return
      focusMarkEl.style.background = slice.color
      focusValueEl.textContent = `${slice.pct.toFixed(1)}%`
      focusSubEl.textContent = `${slice.status} | ${slice.count} FEPMF`
      focusEl.classList.add('active')
    }
    const clearFocus = () => {
      if (focusEl) focusEl.classList.remove('active')
    }

    segs.forEach((seg) => {
      seg.addEventListener('mouseenter', () => applyFocus(Number(seg.getAttribute('data-idx'))))
      seg.addEventListener('mouseleave', clearFocus)
    })
    items.forEach((item) => {
      item.addEventListener('mouseenter', () => applyFocus(Number(item.getAttribute('data-idx'))))
      item.addEventListener('mouseleave', clearFocus)
    })

    meta.innerHTML = rowsByCount.slice(0, 4).map((item) => `
      <span class="dash-chip">${esc(item.status)}: ${esc(item.count)}</span>
    `).join('')
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
  if (!summary || !recentList) return

  const windowStart = state.data?.summary?.deliveredRecentWindowStart
  const windowLabel = windowStart
    ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${windowStart}T00:00:00Z`))
    : 'ช่วงที่กำหนด'

  const recent = (state.data?.deliveredRecent || []).filter((item) => item?.key)
  if (!recent.length) {
    summary.textContent = `ตั้งแต่ ${windowLabel}: ไม่พบงานที่เปลี่ยนเป็น S7`
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
  summary.textContent = `ตั้งแต่ ${windowLabel}: ${totalRows} งาน ครอบคลุม ${totalDates} วันที่มีการเปลี่ยนสถานะเป็น S7`

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
  }).sort((a, b) => b.n - a.n || String(a.squad).localeCompare(String(b.squad))).slice(0, 10)

  const metricCards = [
    { key: 'ตรงแผน', value: `${onTimeRate}%`, detail: `${onTime}/${comparable}`, meaning: 'เริ่มงานตรงกับ Estimate Sprint', help: 'ค่ายิ่งสูงยิ่งดี' },
    { key: 'เริ่มก่อนแผน', value: `${earlyRate}%`, detail: `${early}/${comparable}`, meaning: 'เริ่มงานเร็วกว่าที่ประเมินไว้', help: 'ดีเมื่อไม่กระทบ dependency' },
    { key: 'เริ่มช้ากว่าแผน', value: `${lateRate}%`, detail: `${late}/${comparable}`, meaning: 'สัดส่วนงานที่เริ่มช้ากว่า Estimate Sprint', help: 'ตัวชี้วัดความเสี่ยงหลัก', risk: true }
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
            <div class="h">${m.help}</div>
          </article>
        `).join('')}
      </div>

      <div class="exec-viz-grid">
        <article class="exec-viz-card benchmark-card" style="grid-column:1 / -1;">
          <h4>Squad Benchmark: Mix Compare ของ Comparable FEPMF</h4>
          <p class="viz-desc">1 Squad = 1 Bar จากค่า Compare จริง (เริ่มก่อนแผน / ตรงแผน / เริ่มช้ากว่าแผน) โดยใช้เฉพาะ FEPMF ที่มี Estimate และ Actual และไม่รวม No Squad</p>
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
          <span>Explore</span>
          <span class="dash-status-kpi-cta-dot">→</span>
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

function cabDateObj(value) {
  if (!value) return null
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function renderUpcomingCabCards(rows) {
  const host = document.getElementById('dashCab')
  const sub = document.getElementById('dashCabSub')
  const countChip = document.getElementById('dashCabCount')
  if (!host) return
  host.className = 'cab-list'

  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const windowDays = 21
  const end = new Date(now)
  end.setDate(end.getDate() + windowDays)

  const candidates = rows
    .filter((row) => !isS7Status(row.parent.status))
    .map((row) => ({ row, cab: cabDateObj(row.parent.cabDate) }))
    .filter((x) => x.cab && x.cab >= now && x.cab <= end)
    .sort((a, b) => a.cab - b.cab)

  if (sub) sub.textContent = `งานไม่ใช่ S7 ที่ CAB Date ภายใน ${windowDays} วันจากวันนี้`
  if (countChip) countChip.textContent = `${candidates.length} งาน`

  if (!candidates.length) {
    host.innerHTML = '<div class="dash-empty">ไม่พบงาน non-S7 ที่มี CAB Date ในช่วงเร็ว ๆ นี้</div>'
    return
  }

  const maxItems = 10
  const view = candidates.slice(0, maxItems)
  host.innerHTML = view.map(({ row, cab }, idx) => {
    const dateText = cab
      ? cab.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : '-'
    const dayText = cab ? cab.toLocaleDateString('en-GB', { day: '2-digit' }) : '--'
    const monText = cab ? cab.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() : '---'
    const url = row.parent.browseUrl || '#'
    const itcm = row.derived.itcmKeys[0] || '-'
    const status = row.parent.status || '-'
    const compare = compareLabel(row.derived.compareType)
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
            <span>Compare: ${esc(compare)}</span>
          </div>
          <div class="cab-line"><span style="width:${width}%"></span></div>
        </div>
      </article>
    `
  }).join('')
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
  if (!modalRows || !modalStatus || !modalCount) return

  const filtered = (state.rows || [])
    .filter((row) => String(row.parent.status || 'Unknown') === String(status || ''))
    .sort((a, b) => String(a.parent.key || '').localeCompare(String(b.parent.key || '')))

  modalStatus.textContent = status || '-'
  modalCount.textContent = `${filtered.length} รายการ`

  if (!filtered.length) {
    modalRows.innerHTML = '<tr><td colspan="12" class="dash-empty">No result found</td></tr>'
    return
  }

  modalRows.innerHTML = filtered.map(tableRowMarkup).join('')
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

function renderTable() {
  const host = document.getElementById('dashRows')
  const rows = state.rows || []
  if (!state.tableSort) state.tableSort = { key: 'fepmf', dir: 'asc' }
  if (!rows.length) {
    host.innerHTML = '<tr><td colspan="12" class="dash-empty">No result found</td></tr>'
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
  const rows = state.rows || []
  const riskRows = [...rows]
    .sort((a, b) => {
      const scoreA = (a.progressPercent || 0) - (a.linkedCount || 0) * 4
      const scoreB = (b.progressPercent || 0) - (b.linkedCount || 0) * 4
      return scoreA - scoreB
    })
    .slice(0, 8)

  renderList('dashRisk', riskRows, 'ไม่พบรายการความเสี่ยงในเงื่อนไขที่เลือก')
  renderUpcomingCabCards(rows)
}

function renderResultSummary() {
  const rows = state.rows || []
  const host = document.getElementById('dashResultInfo')

  const withItcm = rows.filter((row) => row.derived.itcmKeys.length).length
  const comparable = rows.filter((row) => row.derived.compareType !== 'na').length

  host.innerHTML = `
    <span class="dash-chip">Results: ${esc(rows.length)}</span>
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
    document.getElementById('dashSearch').value = ''
    document.getElementById('dashStatusSearch').value = ''
    document.getElementById('dashCompareSearch').value = ''
    document.getElementById('dashBusinessTypeSearch').value = ''
    document.getElementById('dashBusinessPartnerSearch').value = ''
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
    document.getElementById('dashCompareAnalysis').innerHTML = '<div class="dash-empty">No data</div>'
    const statusCards = document.getElementById('dashStatusKpiCards')
    const statusTotal = document.getElementById('dashStatusTotal')
    const pendingPercent = document.getElementById('dashPendingPercent')
    const pendingCount = document.getElementById('dashPendingCount')
    const pendingTotal = document.getElementById('dashPendingTotal')
    const pendingRing = document.getElementById('dashPendingRing')
    if (statusCards) statusCards.innerHTML = '<div class="dash-empty">No data</div>'
    if (statusTotal) statusTotal.textContent = '0'
    if (pendingPercent) pendingPercent.textContent = '0'
    if (pendingCount) pendingCount.textContent = '0'
    if (pendingTotal) pendingTotal.textContent = '0'
    if (pendingRing) pendingRing.style.setProperty('--pct', '0')
    document.getElementById('dashResultInfo').innerHTML = ''
    document.getElementById('dashSync').textContent = 'Load failed'
  }
}

bindEvents()
load()
















