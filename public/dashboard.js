const state = {
  data: null,
  rows: [],
  query: '',
  status: 'all',
  compare: 'all'
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
  const all = []

  for (const item of row.workItems || []) {
    const sprintNum = parseSprintNumber(item.sprint) ?? parseSprintNumber(item.estimateSprint)
    if (sprintNum == null) continue
    all.push(sprintNum)
    if (!isLikelyNotStarted(item.status)) started.push(sprintNum)
  }

  if (started.length) return Math.min(...started)
  if (all.length) return Math.min(...all)
  return null
}

function deriveCompareType(estimate, actual) {
  if (estimate == null || actual == null) return 'na'
  if (actual === estimate) return 'equal'
  if (actual < estimate) return 'early'
  return 'late'
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

  document.getElementById('dashKpis').innerHTML = cards.map((card) => `
    <article class="dash-kpi ${esc(card.cls)}">
      <div class="dash-kpi-label">${esc(card.label)}</div>
      <div class="dash-kpi-value">${esc(card.value)}</div>
      <div class="dash-kpi-sub">${esc(card.sub)}</div>
    </article>
  `).join('')
}

function renderStatusBars() {
  const rows = state.rows || []
  const host = document.getElementById('dashStatusBars')
  const meta = document.getElementById('dashStatusBarsMeta')
  const summary = document.getElementById('dashStatusSummary')
  const recentList = document.getElementById('dashStatusRecentList')
  if (!host || !meta || !summary || !recentList) return

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
    summary.textContent = '-'
    recentList.innerHTML = ''
    return
  }

  const maxCount = Math.max(...orderedStatuses.map((status) => counts.get(status) || 0), 1)
  const topRows = [...orderedStatuses]
    .map((status) => ({ status, count: counts.get(status) || 0 }))
    .sort((a, b) => b.count - a.count)

  const gradientSet = [
    'linear-gradient(180deg,#6eb8ff 0%,#2b72de 100%)',
    'linear-gradient(180deg,#79d9d1 0%,#2a93b8 100%)',
    'linear-gradient(180deg,#8ca8ff 0%,#4f69df 100%)',
    'linear-gradient(180deg,#ff9cc2 0%,#e35493 100%)',
    'linear-gradient(180deg,#ffc28f 0%,#f08337 100%)',
    'linear-gradient(180deg,#b8df89 0%,#62a83b 100%)',
    'linear-gradient(180deg,#cfb6ff 0%,#7a5ad8 100%)'
  ]

  const barsHtml = orderedStatuses.map((status, index) => {
    const count = counts.get(status) || 0
    const pct = Math.max(0, Math.round((count / maxCount) * 100))
    const share = rows.length ? Math.round((count / rows.length) * 100) : 0
    const gradient = gradientSet[index % gradientSet.length]
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

  host.innerHTML = `
    <div class="dash-vbar-layout">
      <div class="dash-y-axis">
        <span>${esc(maxCount)}</span>
        <span>${esc(Math.round(maxCount * 0.75))}</span>
        <span>${esc(Math.round(maxCount * 0.5))}</span>
        <span>${esc(Math.round(maxCount * 0.25))}</span>
        <span>0</span>
      </div>
      <div class="dash-vbar-grid">${barsHtml}</div>
    </div>
  `

  meta.innerHTML = topRows.slice(0, 4).map((item) => `
    <span class="dash-chip">${esc(item.status)}: ${esc(item.count)}</span>
  `).join('')

  const recent = (state.data?.deliveredRecent || [])
    .filter((item) => item?.key)
  const recentCount = Number(state.data?.summary?.deliveredRecentCount ?? recent.length)
  summary.textContent = `จำนวนงานที่เข้าเงื่อนไข S7 - Project Deliverd (15 วันล่าสุด): ${recentCount} งาน`

  if (!recent.length) {
    recentList.innerHTML = '<li>ไม่พบรายการที่เปลี่ยนเป็น S7 ในช่วง 15 วันที่ผ่านมา</li>'
  } else {
    const chunks = []
    let currentMonthKey = ''

    for (const item of recent) {
      const dt = item.updated ? new Date(item.updated) : null
      const safeDt = dt && !Number.isNaN(dt.getTime()) ? dt : null
      const monthKey = safeDt ? safeDt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase() : ''
      if (monthKey && monthKey !== currentMonthKey) {
        chunks.push(`<li class="dash-smart-month">${esc(monthKey)}</li>`)
        currentMonthKey = monthKey
      }

      const weekday = safeDt ? safeDt.toLocaleDateString('en-US', { weekday: 'short' }) : '-'
      const dayNum = safeDt ? safeDt.toLocaleDateString('en-US', { day: '2-digit' }) : '-'
      const updated = safeDt ? safeDt.toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'
      const url = item.browseUrl || `https://dgtbigc.atlassian.net/browse/${item.key}`
      const squad = item.squad || '-'
      const summaryText = item.summary || '-'
      chunks.push(`
        <li class="dash-smart-item">
          <div class="dash-smart-date">
            <div class="dash-smart-weekday">${esc(weekday)}</div>
            <div class="dash-smart-day">${esc(dayNum)}</div>
          </div>
          <div class="dash-smart-body">
            <div class="dash-smart-head">
              <a class="dash-smart-key" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(item.key)}</a>
              <span class="dash-smart-status">S7</span>
            </div>
            <div class="dash-smart-meta">
              <span class="dash-smart-squad">${esc(squad)}</span>
              <span class="dash-smart-updated">${esc(updated)}</span>
            </div>
            <div class="dash-smart-summary">${esc(summaryText)}</div>
          </div>
          <a class="dash-smart-open" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open</a>
        </li>
      `)
    }

    recentList.innerHTML = chunks.join('')
  }
}

function renderCompareAnalysis() {
  const host = document.getElementById('dashCompareAnalysis')
  const rows = state.rows || []

  const comparableRows = rows.filter((row) => row.derived.estimateNum != null && row.derived.actualNum != null)
  const comparable = comparableRows.length
  const coverage = rows.length ? Math.round((comparable / rows.length) * 100) : 0

  if (!comparable) {
    host.innerHTML = '<div class="dash-empty">No comparable sprint data</div>'
    document.getElementById('dashCompareMeta').textContent = 'Comparable Items: 0'
    return
  }

  const deltas = comparableRows.map((row) => row.derived.actualNum - row.derived.estimateNum)
  const lateDeltas = deltas.filter((x) => x > 0).sort((a, b) => a - b)
  const onTime = deltas.filter((x) => x === 0).length
  const early = deltas.filter((x) => x < 0).length
  const late = deltas.filter((x) => x > 0).length

  const onTimeRate = Math.round((onTime / comparable) * 100)
  const earlyRate = Math.round((early / comparable) * 100)
  const lateRate = Math.round((late / comparable) * 100)
  const medianDelta = median(deltas)
  const p90Late = lateDeltas.length ? quantile(lateDeltas, 0.9) : 0

  const bins = [
    { key: 'early2', label: '<= -2', test: (x) => x <= -2 },
    { key: 'early1', label: '-1', test: (x) => x === -1 },
    { key: 'ontime', label: '0', test: (x) => x === 0 },
    { key: 'late1', label: '+1', test: (x) => x === 1 },
    { key: 'late2', label: '+2', test: (x) => x === 2 },
    { key: 'late3', label: '>= +3', test: (x) => x >= 3 }
  ]
  const histogram = bins.map((bin) => ({
    ...bin,
    count: deltas.filter(bin.test).length
  }))
  const maxHist = Math.max(...histogram.map((x) => x.count), 1)

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

  const sprintMap = new Map()
  for (const row of comparableRows) {
    const key = row.derived.estimateNum
    const delta = row.derived.actualNum - row.derived.estimateNum
    if (!sprintMap.has(key)) sprintMap.set(key, [])
    sprintMap.get(key).push(delta)
  }
  const trendRows = [...sprintMap.entries()]
    .map(([sprint, vals]) => {
      const lateCount = vals.filter((x) => x > 0).length
      return {
        sprint,
        n: vals.length,
        lateRate: vals.length ? Math.round((lateCount / vals.length) * 100) : 0,
        median: median(vals)
      }
    })
    .sort((a, b) => a.sprint - b.sprint)
    .slice(-8)
  const maxTrendLate = Math.max(...trendRows.map((x) => x.lateRate), 1)

  host.innerHTML = `
    <div class="exec-analytics">
      <div class="exec-kpi-row">
        <article class="exec-kpi-card">
          <div class="k">On-time Rate</div><div class="v">${onTimeRate}%</div><div class="s">${onTime}/${comparable}</div>
        </article>
        <article class="exec-kpi-card">
          <div class="k">Early Rate</div><div class="v">${earlyRate}%</div><div class="s">${early}/${comparable}</div>
        </article>
        <article class="exec-kpi-card risk">
          <div class="k">Late Rate</div><div class="v">${lateRate}%</div><div class="s">${late}/${comparable}</div>
        </article>
        <article class="exec-kpi-card">
          <div class="k">Median Delta</div><div class="v">${formatSigned(Math.round(medianDelta * 10) / 10)}</div><div class="s">Actual - Estimate</div>
        </article>
        <article class="exec-kpi-card risk">
          <div class="k">P90 Late Delta</div><div class="v">+${Math.round(p90Late * 10) / 10}</div><div class="s">Tail risk</div>
        </article>
        <article class="exec-kpi-card">
          <div class="k">Coverage</div><div class="v">${coverage}%</div><div class="s">${comparable}/${rows.length}</div>
        </article>
      </div>

      <div class="exec-viz-grid">
        <article class="exec-viz-card">
          <h4>Delta Distribution (Actual - Estimate)</h4>
          <div class="exec-hist">
            ${histogram.map((b) => `
              <div class="bar">
                <div class="bar-fill ${b.key}" style="height:${Math.max(8, Math.round((b.count / maxHist) * 100))}%"></div>
                <div class="bar-count">${b.count}</div>
                <div class="bar-label">${b.label}</div>
              </div>
            `).join('')}
          </div>
        </article>

        <article class="exec-viz-card">
          <h4>Squad Benchmark (Late Risk)</h4>
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

        <article class="exec-viz-card">
          <h4>Trend by Estimate Sprint</h4>
          <div class="exec-trend">
            ${trendRows.map((t) => `
              <div class="tr-col">
                <div class="tr-bar" style="height:${Math.max(8, Math.round((t.lateRate / maxTrendLate) * 100))}%"></div>
                <div class="tr-label">S${t.sprint}</div>
                <div class="tr-meta">${t.lateRate}% | med ${formatSigned(Math.round(t.median * 10) / 10)}</div>
              </div>
            `).join('') || '<div class="dash-empty">No trend data</div>'}
          </div>
        </article>
      </div>
    </div>
  `

  document.getElementById('dashCompareMeta').textContent = `Comparable Items: ${comparable} (${coverage}% coverage)`
}

function renderList(hostId, rows, emptyText) {
  const host = document.getElementById(hostId)
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

function compareClass(type) {
  if (type === 'equal') return 'cmp-equal'
  if (type === 'early') return 'cmp-early'
  if (type === 'late') return 'cmp-late'
  return 'cmp-na'
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
    .map((row) => {
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
    }).join('')
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

  const cabRows = [...rows]
    .filter((row) => row.parent.cabDate)
    .sort((a, b) => String(a.parent.cabDate).localeCompare(String(b.parent.cabDate)))
    .slice(0, 8)

  renderList('dashRisk', riskRows, 'ไม่พบรายการความเสี่ยงในเงื่อนไขที่เลือก')
  renderList('dashCab', cabRows, 'ไม่พบรายการ CAB ในเงื่อนไขที่เลือก')
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
  renderStatusBars()
  renderCompareAnalysis()
  renderHighlights()
  renderTable()
  renderResultSummary()
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
    document.getElementById('dashSprintMeta').textContent = `Current Sprint: ${data.summary?.currentSprintName || '-'}`
    document.getElementById('dashDaysMeta').textContent = `Working Days Left: ${data.summary?.workingDaysRemaining ?? '-'}`
  } catch (error) {
    document.getElementById('dashRows').innerHTML = `<tr><td colspan="12" class="dash-empty">Failed to load data: ${esc(error.message || error)}</td></tr>`
    document.getElementById('dashRisk').innerHTML = '<div class="dash-empty">No data</div>'
    document.getElementById('dashCab').innerHTML = '<div class="dash-empty">No data</div>'
    document.getElementById('dashCompareAnalysis').innerHTML = '<div class="dash-empty">No data</div>'
    document.getElementById('dashResultInfo').innerHTML = ''
    document.getElementById('dashSync').textContent = 'Load failed'
  }
}

bindEvents()
load()



