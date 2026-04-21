const state = {
  data: null,
  rows: [],
  query: '',
  status: 'all',
  compare: 'all',
  statusView: 'bar'
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
  if (type === 'early') return 'Actual เน€เธฃเนเธงเธเธงเนเธฒ'
  if (type === 'late') return 'Actual เธเนเธฒเธเธงเนเธฒ'
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
    .sort((a, b) => b.count - a.count)

  if (state.statusView === 'pie') {
    const total = rowsByCount.reduce((sum, item) => sum + item.count, 0) || 1
    let offset = 0
    const slices = rowsByCount.map((item, index) => {
      const pct = (item.count / total) * 100
      const start = offset
      offset += pct
      return {
        ...item,
        pct,
        color: palette[index % palette.length].pie,
        start,
        end: offset
      }
    })

    const conic = slices
      .map((slice) => `${slice.color} ${slice.start.toFixed(2)}% ${slice.end.toFixed(2)}%`)
      .join(', ')

    host.innerHTML = `
      <div class="dash-pie-wrap">
        <div class="dash-pie-chart" style="background:conic-gradient(${conic})">
          <div class="dash-pie-hole">
            <div class="dash-pie-total">${total}</div>
            <div>งานทั้งหมด</div>
          </div>
        </div>
        <div class="dash-pie-legend">
          ${slices.map((slice) => `
            <div class="dash-pie-item">
              <span class="dash-pie-dot" style="background:${slice.color}"></span>
              <span>${esc(slice.status)}</span>
              <span class="dash-pie-value">${esc(slice.count)} (${Math.round(slice.pct)}%)</span>
            </div>
          `).join('')}
        </div>
      </div>
    `

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
    const compareValue = document.getElementById('dashCompareValue')
    const coverageValue = document.getElementById('dashCoverageValue')
    if (compareValue) compareValue.textContent = '0'
    if (coverageValue) coverageValue.textContent = '(0% coverage)'
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
  const compareValue = document.getElementById('dashCompareValue')
  const coverageValue = document.getElementById('dashCoverageValue')
  if (compareValue) compareValue.textContent = `${comparable}`
  if (coverageValue) coverageValue.textContent = `(${coverage}% coverage)`
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

  renderList('dashRisk', riskRows, 'เนเธกเนเธเธเธฃเธฒเธขเธเธฒเธฃเธเธงเธฒเธกเน€เธชเธตเนเธขเธเนเธเน€เธเธทเนเธญเธเนเธเธ—เธตเนเน€เธฅเธทเธญเธ')
  renderList('dashCab', cabRows, 'เนเธกเนเธเธเธฃเธฒเธขเธเธฒเธฃ CAB เนเธเน€เธเธทเนเธญเธเนเธเธ—เธตเนเน€เธฅเธทเธญเธ')
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
  renderSmartReading()
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
    '<option value="early">Actual เน€เธฃเนเธงเธเธงเนเธฒ Estimate</option>',
    '<option value="late">Actual เธเนเธฒเธเธงเนเธฒ Estimate</option>',
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
  }
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
    document.getElementById('dashResultInfo').innerHTML = ''
    document.getElementById('dashSync').textContent = 'Load failed'
  }
}

bindEvents()
load()





