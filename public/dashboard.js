const state = {
  data: null,
  rows: [],
  query: '',
  status: 'all',
  compare: 'all',
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

function parseSprintNumber(value) {
  const text = String(value || '')
  const m = text.match(/sprint\s*([0-9]+)/i)
  return m ? Number(m[1]) : null
}

function isLikelyNotStarted(status) {
  const text = normalizeText(status)
  if (!text) return true
  if (text.includes('to do')) return true
  if (text.includes('open')) return true
  if (text.includes('backlog')) return true
  if (text.includes('pending')) return true
  if (text === 's0' || text === 's1' || text === 's2' || text === 's3') return true
  return false
}

function deriveActualStartSprint(row) {
  const started = []

  for (const item of row.workItems || []) {
    const sprintNum = parseSprintNumber(item.sprint) ?? parseSprintNumber(item.estimateSprint)
    if (sprintNum == null) continue
    if (!isLikelyNotStarted(item.status)) started.push(sprintNum)
  }

  if (started.length) return Math.min(...started)
  return null
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
  const estimateNum = parseSprintNumber(row.parent.estimateSprint || row.parent.sprint)
  const actualNum = deriveActualStartSprint(row)
  const compareType = deriveCompareType(estimateNum, actualNum)
  const itcms = itcmItems(row)
  const itcmKeys = [...new Set(itcms.map((item) => item.key).filter(Boolean))]
  const itcmStatuses = [...new Set(itcms.map((item) => item.status || '-'))]

  return {
    ...row,
    derived: {
      estimateNum,
      actualNum,
      compareType,
      itcmKeys,
      itcmStatuses
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
    ...row.derived.itcmKeys,
    ...row.derived.itcmStatuses,
    ...(row.workItems || []).flatMap((item) => [item.key, item.summary, item.status, item.assignee])
  ].join(' ').toLowerCase()
}

function filterRows() {
  const terms = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  state.rows = (state.data?.parents || []).map(enrichRow).filter((row) => {
    if (state.status !== 'all' && row.parent.status !== state.status) return false
    if (state.compare !== 'all' && row.derived.compareType !== state.compare) return false
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

    const describe = (status) => {
      const s = String(status || '').toLowerCase()
      if (s.includes('open')) return 'Awaiting execution'
      if (s.includes('cancel')) return 'Stopped or withdrawn'
      if (s.includes('s7')) return 'Project delivered'
      return 'Active status mix'
    }
    const rank = (pct) => (pct >= 35 ? 'dominant' : pct >= 15 ? 'key' : 'minor')

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
                <div class="dash-pie-desc">${describe(slice.status)}</div>
              </div>
              <div class="dash-pie-stat">
                <div class="dash-pie-value">${slice.pct.toFixed(1)}%</div>
                <div class="dash-pie-rank">${rank(slice.pct)}</div>
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
      focusSubEl.textContent = `${slice.status} | ${rank(slice.pct)}`
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

  meta.innerHTML = rowsByCount.slice(0, 4).map((item) => `
    <span class="dash-chip">${esc(item.status)}: ${esc(item.count)}</span>
  `).join('')
}

function renderSmartReading() {
  const summary = document.getElementById('dashStatusSummary')
  const recentList = document.getElementById('dashStatusRecentList')
  if (!summary || !recentList) return

  const recent = (state.data?.deliveredRecent || []).filter((item) => item?.key)
  if (!recent.length) {
    summary.textContent = '15 วันล่าสุด: ไม่พบงานที่เปลี่ยนเป็น S7'
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
  summary.textContent = `15 วันล่าสุด: ${totalRows} งาน ครอบคลุม ${totalDates} วันที่มีการเปลี่ยนสถานะเป็น S7`

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
            return `
              <div class="dash-smart-mini" style="--smart-accent:${color}">
                <a class="dash-smart-mini-key" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(item.key)}</a>
                <span class="dash-smart-mini-squad">${esc(squad)}</span>
                <span class="dash-smart-mini-summary">${esc(summaryText)}</span>
                <span class="dash-smart-mini-time">${esc(timeText)}</span>
              </div>
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
  const lateRate = Math.round((late / comparable) * 100)

  const squadMap = new Map()
  for (const row of comparableRows) {
    const squad = row.parent.squad || 'No Squad'
    const delta = row.derived.actualNum - row.derived.estimateNum
    if (!squadMap.has(squad)) squadMap.set(squad, [])
    squadMap.get(squad).push(delta)
  }

  const squadStats = [...squadMap.entries()].map(([squad, vals]) => {
    const sorted = [...vals].sort((a, b) => a - b)
    const lateCount = vals.filter((x) => x > 0).length
    return {
      squad,
      n: vals.length,
      lateRate: vals.length ? Math.round((lateCount / vals.length) * 100) : 0,
      median: quantile(sorted, 0.5),
      iqr: quantile(sorted, 0.75) - quantile(sorted, 0.25)
    }
  }).sort((a, b) => b.lateRate - a.lateRate || b.median - a.median || b.n - a.n).slice(0, 8)

  const metricCards = [
    { key: 'ตรงแผน', value: `${onTimeRate}%`, detail: `${onTime}/${comparable}`, meaning: 'เริ่มงานตรงกับ Estimate Sprint', help: 'ค่ายิ่งสูงยิ่งดี' },
    { key: 'เริ่มก่อนแผน', value: `${earlyRate}%`, detail: `${early}/${comparable}`, meaning: 'เริ่มงานเร็วกว่าที่ประเมินไว้', help: 'ดีเมื่อไม่กระทบ dependency' },
    { key: 'เริ่มช้ากว่าแผน', value: `${lateRate}%`, detail: `${late}/${comparable}`, meaning: 'สัดส่วนงานที่เริ่มช้ากว่า Estimate Sprint', help: 'ตัวชี้วัดความเสี่ยงหลัก', risk: true }
  ]

  host.innerHTML = `
    <div class="exec-analytics">
      <div class="exec-readme">
        <div class="exec-readme-title">วิธีอ่านผลวิเคราะห์</div>
        <div class="exec-readme-grid">
          <div><strong>วัดอะไร:</strong> ความแม่นยำของ Estimate Sprint เทียบ Actual Start Sprint</div>
          <div><strong>ใช้ตัดสินใจอะไร:</strong> หา Squad/Sprint ที่ควรเร่งแก้ก่อนความล่าช้าขยายวง</div>
          <div><strong>ฐานข้อมูล:</strong> ใช้เฉพาะรายการที่มีทั้ง Estimate และ Actual (Comparable)</div>
        </div>
      </div>

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
          <h4>Squad Benchmark: ความเสี่ยงเริ่มช้า</h4>
          <p class="viz-desc">จัดอันดับ Squad ตาม Late Rate และความผันผวน (Median + IQR)</p>
          <div class="exec-squad-list">
            ${squadStats.map((s) => `
              <div class="sq-row">
                <div class="sq-head">
                  <span>${esc(s.squad)}</span>
                  <span>${s.lateRate}% late</span>
                </div>
                <div class="sq-bar"><span style="width:${Math.max(8, s.lateRate)}%"></span></div>
                <div class="sq-meta">n=${s.n} | median=${formatSigned(Math.round(s.median * 10) / 10)} | IQR=${Math.round(s.iqr * 10) / 10}</div>
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
  if (!rows.length) {
    host.innerHTML = '<tr><td colspan="12" class="dash-empty">No result found</td></tr>'
    return
  }

  host.innerHTML = rows
    .sort((a, b) => String(a.parent.key || '').localeCompare(String(b.parent.key || '')))
    .map(tableRowMarkup)
    .join('')
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
  const select = document.getElementById('dashStatus')
  const statuses = state.data?.meta?.available?.statuses || []
  select.innerHTML = ['<option value="all">All Status</option>', ...statuses.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`)].join('')
  select.value = state.status
}

function renderCompareOptions() {
  const select = document.getElementById('dashSprintCompare')
  select.innerHTML = [
    '<option value="all">All Compare</option>',
    '<option value="equal">Actual = Estimate</option>',
    '<option value="early">Actual เร็วกว่า Estimate</option>',
    '<option value="late">Actual ช้ากว่า Estimate</option>',
    '<option value="na">Compare N/A</option>'
  ].join('')
  select.value = state.compare
}

function bindEvents() {
  document.getElementById('dashSearch').addEventListener('input', (event) => {
    state.query = event.target.value || ''
    renderAll()
  })

  document.getElementById('dashStatus').addEventListener('change', (event) => {
    state.status = event.target.value || 'all'
    renderAll()
  })

  document.getElementById('dashSprintCompare').addEventListener('change', (event) => {
    state.compare = event.target.value || 'all'
    renderAll()
  })

  document.getElementById('dashClear').addEventListener('click', () => {
    state.query = ''
    state.status = 'all'
    state.compare = 'all'
    document.getElementById('dashSearch').value = ''
    document.getElementById('dashStatus').value = 'all'
    document.getElementById('dashSprintCompare').value = 'all'
    renderAll()
  })

  document.getElementById('dashRefresh').addEventListener('click', () => load(true))

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
  }  document.addEventListener('click', (event) => {
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
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeStatusModal()
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






