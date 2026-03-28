const state = {
  data: null,
  query: '',
  rows: [],
  expanded: new Set(),
  collapsedAssignees: new Set(),
  assigneeDetailMode: {},
  viewMode: 'fepmf',
  scope: 'waiting',
  filters: {
    status: ['S4', 'S5', 'S6'],
    squad: [],
    estimateSprint: [],
    cabDate: [],
    misqaAssigned: []
  },
  options: {
    status: [],
    squad: [],
    estimateSprint: [],
    cabDate: [],
    misqaAssigned: []
  },
  searchInFilter: {
    status: '',
    squad: '',
    estimateSprint: '',
    cabDate: '',
    misqaAssigned: ''
  }
}

const filterConfig = {
  status: { host: 'misqaStatusFilter', label: 'Parent Status', placeholder: 'เลือก Parent Status' },
  squad: { host: 'misqaSquadFilter', label: 'Parent Squad', placeholder: 'เลือก Parent Squad' },
  estimateSprint: { host: 'misqaEstimateSprintFilter', label: 'Parent Estimate Sprint', placeholder: 'เลือก Parent Estimate Sprint' },
  cabDate: { host: 'misqaCabDateFilter', label: 'CAB Date', placeholder: 'เลือก CAB Date' },
  misqaAssigned: { host: 'misqaAssignedFilter', label: 'MISQA Assigned', placeholder: 'เลือก MISQA Assigned' }
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
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

function misqaStatusToneClass(status) {
  const s = String(status || '').toLowerCase()
  if (s.includes('done') || s.includes('complete') || s.includes('closed') || s.includes('resolved') || s.includes('deliver')) return 'misqa-tone-done'
  if (s.includes('cancel')) return 'misqa-tone-cancel'
  if (s.includes('progress') || s.includes('develop') || s.includes('review') || s.includes('test') || s.includes('uat') || s.includes('sit')) return 'misqa-tone-progress'
  if (s.includes('todo') || s.includes('to do') || s.includes('open') || s.includes('backlog')) return 'misqa-tone-todo'
  return 'misqa-tone-default'
}

function dominantMisqaStatus(items) {
  if (!Array.isArray(items) || !items.length) return '-'
  const counts = new Map()
  for (const item of items) {
    const status = String(item?.status || '-')
    counts.set(status, (counts.get(status) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] || '-'
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

function isMisqa(item) {
  return String(item?.key || '').toUpperCase().startsWith('MISQA-')
}

function isDirectMisqaRelation(item) {
  const sources = Array.isArray(item?.relationSources) ? item.relationSources : []
  return sources.some((source) => source === 'subtask' || source === 'childField' || source === 'linkedField' || source === 'parentRef')
}

function isDoneOrCancelledStatus(status) {
  const s = String(status || '').trim().toLowerCase()
  return s === 'cancelled'
    || s.includes('cancel')
    || s.includes('done')
    || s.includes('complete')
    || s.includes('closed')
    || s.includes('resolved')
    || s.includes('deliver')
    || s.includes('cab approved')
    || s.includes('approved')
}

function textBlob(row) {
  return [
    row.parent.key,
    row.parent.summary,
    row.parent.status,
    row.parent.squad,
    row.parent.estimateSprint,
    row.parent.cabDate,
    row.scopeLabel,
    ...(row.workItems || []).flatMap((x) => [x.key, x.summary, x.status, x.assignee])
  ].join(' ').toLowerCase()
}

function decorateRow(row) {
  const allMisqaItems = (row.workItems || []).filter(isMisqa)
  const directMisqaItems = allMisqaItems.filter((item) => isDirectMisqaRelation(item))
  const misqaItems = directMisqaItems.length ? directMisqaItems : allMisqaItems
  const pendingMisqaItems = misqaItems.filter((item) => !isDoneOrCancelledStatus(item.status))
  const doneMisqaItems = misqaItems.filter((item) => isDoneOrCancelledStatus(item.status))
  const misqaAssignees = [...new Set(misqaItems.map((item) => String(item.assignee || '').trim()).filter(Boolean))].sort()
  const pendingMisqaAssignees = [...new Set(pendingMisqaItems.map((item) => String(item.assignee || '').trim()).filter(Boolean))].sort()

  let scope = 'all'
  let scopeLabel = 'All MISQA States'
  let scopeTone = 'impact-neutral'

  if (!misqaItems.length) {
    scope = 'no_misqa'
    scopeLabel = 'No MISQA'
    scopeTone = 'impact-neutral'
  } else if (pendingMisqaItems.length) {
    scope = 'waiting'
    scopeLabel = 'MISQA Pending'
    scopeTone = 'impact-bad'
  } else {
    scope = 'misqa_done'
    scopeLabel = 'MISQA Closed'
    scopeTone = 'impact-good'
  }

  return {
    ...row,
    misqaItems,
    pendingMisqaItems,
    doneMisqaItems,
    misqaAssignees,
    pendingMisqaAssignees,
    scope,
    scopeLabel,
    scopeTone
  }
}

function filteredRowsBase() {
  const q = state.query.trim().toLowerCase()
  const misqaAssignedAll = state.filters.misqaAssigned.length === state.options.misqaAssigned.length

  return (state.data?.parents || [])
    .map(decorateRow)
    .filter((row) => {
      if (q && !textBlob(row).includes(q)) return false
      if (state.filters.status.length && !state.filters.status.includes(row.parent.status)) return false
      if (state.filters.squad.length && !state.filters.squad.includes(row.parent.squad)) return false
      if (state.filters.estimateSprint.length && !state.filters.estimateSprint.includes(row.parent.estimateSprint || row.parent.sprint || '')) return false
      if (state.filters.cabDate.length && !state.filters.cabDate.includes(row.parent.cabDate || '')) return false

      if (!misqaAssignedAll && state.filters.misqaAssigned.length) {
        const pool = row.pendingMisqaAssignees.length ? row.pendingMisqaAssignees : row.misqaAssignees
        if (!pool.some((name) => state.filters.misqaAssigned.includes(name))) return false
      }

      return true
    })
}

function scopeRows(rows) {
  if (state.scope === 'waiting') return rows.filter((row) => row.pendingMisqaItems.length > 0)
  if (state.scope === 'no_misqa') return rows.filter((row) => row.misqaItems.length === 0)
  return rows.filter((row) => row.pendingMisqaItems.length > 0 || row.misqaItems.length === 0)
}

function renderViewSwitch() {
  const items = [
    { key: 'fepmf', title: 'By FEPMF' },
    { key: 'assignee', title: 'By MISQA Assignee' }
  ]

  document.getElementById('misqaViewSwitch').innerHTML = items.map((item) => `
    <button type="button" class="misqa-scope-btn ${state.viewMode === item.key ? 'active' : ''}" data-view="${esc(item.key)}">
      <span class="misqa-scope-title">${esc(item.title)}</span>
    </button>
  `).join('')

  document.querySelectorAll('.misqa-view-switch .misqa-scope-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.viewMode = btn.getAttribute('data-view') || 'fepmf'
      applyAll()
    })
  })
}

function renderScopeSwitch(rows) {
  const counts = {
    all: rows.filter((row) => row.pendingMisqaItems.length > 0 || row.misqaItems.length === 0).length,
    waiting: rows.filter((row) => row.pendingMisqaItems.length > 0).length,
    no_misqa: rows.filter((row) => row.misqaItems.length === 0).length
  }

  const items = [
    { key: 'waiting', title: 'MISQA Pending' },
    { key: 'no_misqa', title: 'No MISQA' },
    { key: 'all', title: 'All Focus Items' }
  ]

  document.getElementById('misqaScopeSwitch').innerHTML = items.map((item) => `
    <button type="button" class="misqa-scope-btn ${state.scope === item.key ? 'active' : ''}" data-scope="${esc(item.key)}">
      <span class="misqa-scope-title">${esc(item.title)}</span>
    </button>
  `).join('')

  document.querySelectorAll('.misqa-scope-btn').forEach((btn) => {
    if (btn.closest('.misqa-view-switch')) return
    btn.addEventListener('click', () => {
      state.scope = btn.getAttribute('data-scope') || 'waiting'
      applyAll()
    })
  })

  const hint = state.viewMode === 'assignee'
    ? 'มุมมองนี้เหมาะเวลาต้องการดูว่าแต่ละคนถือ FEPMF อะไรอยู่บ้าง และ MISQA child ที่ค้างอยู่เป็นสถานะใด'
    : 'มุมมองนี้เหมาะเวลาต้องการไล่ดูทีละ FEPMF ว่ายังไม่มี MISQA หรือยังรอ MISQA ปิดงานอยู่'
  document.getElementById('misqaModeHint').textContent = hint
}

function renderFilterHint() {
  return
}

function renderActiveSummary() {
  return
}

function renderKpis(rows) {
  const totalPendingMisqa = rows.reduce((sum, row) => sum + row.pendingMisqaItems.length, 0)
  const totalMisqa = rows.reduce((sum, row) => sum + row.misqaItems.length, 0)
  const waitingCount = rows.filter((row) => row.pendingMisqaItems.length > 0).length
  const noMisqaCount = rows.filter((row) => row.misqaItems.length === 0).length
  const assigneeCount = [...new Set(rows.flatMap((row) => row.pendingMisqaAssignees.length ? row.pendingMisqaAssignees : row.misqaAssignees))].filter(Boolean).length

  const cards = [
    ['Total FEPMF', rows.length, 'ตามผลการค้นหาและ filter ปัจจุบัน'],
    ['MISQA Pending', waitingCount, 'FEPMF ที่ยังเหลือ MISQA ไม่จบ', 'kpi-focus-days'],
    ['No MISQA', noMisqaCount, 'FEPMF ที่ยังไม่มี child MISQA'],
    ['Open MISQA Child', totalPendingMisqa, `จาก MISQA ทั้งหมด ${totalMisqa} รายการ`, 'kpi-focus-sprint'],
    ['MISQA Assignees', assigneeCount, 'จำนวนชื่อ MISQA จากผลลัพธ์ปัจจุบัน']
  ]

  document.getElementById('misqaKpis').innerHTML = cards
    .map((c) => `<article class="panel kpi ${esc(c[3] || '')}"><div class="kpi-label">${c[0]}</div><div class="kpi-value">${esc(c[1])}</div><div class="kpi-sub">${c[2]}</div></article>`)
    .join('')
}

function toggleParent(key) {
  if (state.expanded.has(key)) state.expanded.delete(key)
  else state.expanded.add(key)
  renderRows()
}

function toggleAssigneeCard(name) {
  if (state.collapsedAssignees.has(name)) state.collapsedAssignees.delete(name)
  else state.collapsedAssignees.add(name)
  renderRows()
}

function setAssigneeDetailMode(name, mode) {
  if (!name) return
  state.assigneeDetailMode[name] = mode
  state.collapsedAssignees.add(name)
  renderRows()
}

function expandAllAssignees() {
  const groups = buildAssigneeGroups(state.rows || [])
  state.collapsedAssignees = new Set(groups.map((group) => group.name))
  renderRows()
}

function collapseAllAssignees() {
  state.collapsedAssignees = new Set()
  renderRows()
}

function expandAllParents() {
  state.expanded = new Set((state.rows || []).map((row) => row.parent?.key).filter(Boolean))
  renderRows()
}

function collapseAllParents() {
  state.expanded = new Set()
  renderRows()
}

function expandAllCurrentView() {
  if (state.viewMode === 'assignee') {
    expandAllAssignees()
    return
  }
  expandAllParents()
}

function collapseAllCurrentView() {
  if (state.viewMode === 'assignee') {
    collapseAllAssignees()
    return
  }
  collapseAllParents()
}

function renderRows() {
  const host = document.getElementById('misqaContent')
  const rows = state.rows || []
  renderKpis(rows)

  if (!rows.length) {
    host.innerHTML = '<div class="panel empty">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</div>'
    return
  }

  if (state.viewMode === 'assignee') {
    const groups = buildAssigneeGroups(rows)
    if (!groups.length) {
      host.innerHTML = '<div class="panel empty">มุมมอง By MISQA Assignee ยังไม่มี MISQA ที่เข้าเงื่อนไขในผลลัพธ์ปัจจุบัน</div>'
      return
    }

    host.innerHTML = `
      <section class="misqa-assignee-grid">
        ${groups.map((group) => `
          ${(() => {
            const isCollapsed = !state.collapsedAssignees.has(group.name)
            return `
          <article class="panel misqa-assignee-card">
            <div class="misqa-assignee-head clean luxury">
              <div class="misqa-assignee-identity">
                <div class="misqa-assignee-avatar">${esc((group.name || 'U').slice(0, 1).toUpperCase())}</div>
                <div>
                  <div class="misqa-assignee-name">${esc(group.name)}</div>
                  <div class="misqa-assignee-sub">กำลังถือ FEPMF ที่ยังต้องรอ MISQA ปิดงาน</div>
                </div>
              </div>
              <button class="misqa-hero-pill toggle" type="button" data-assignee="${esc(group.name)}" aria-expanded="${isCollapsed ? 'false' : 'true'}" title="${isCollapsed ? 'Show more' : 'Show less'}">
                <span>${esc(group.itemCount)} Open MISQA</span>
              </button>
            </div>

            <div class="misqa-assignee-overview inline-meta">
              <button type="button" class="misqa-overview-chip action ${state.assigneeDetailMode[group.name] !== 'misqa' ? 'active' : ''}" data-assignee-view="${esc(group.name)}" data-mode="fepmf">
                <strong>${esc(group.parentCount)}</strong> FEPMF
              </button>
              <button type="button" class="misqa-overview-chip action ${state.assigneeDetailMode[group.name] === 'misqa' ? 'active' : ''}" data-assignee-view="${esc(group.name)}" data-mode="misqa">
                <strong>${esc(group.itemCount)}</strong> MISQA Child
              </button>
            </div>

            ${isCollapsed ? '' : `
            <div class="misqa-status-ribbon compact">
              <div class="misqa-status-ribbon-label">Open MISQA Status</div>
              <div class="misqa-status-belt compact">
                ${group.statusCounts.map((item) => `<span class="misqa-status-line ${misqaStatusToneClass(item.status)}"><span>${esc(item.status)}</span><strong>${esc(item.count)}</strong></span>`).join('')}
              </div>
            </div>

            ${state.assigneeDetailMode[group.name] === 'misqa' ? `
            <div class="misqa-assignee-parent-list stack">
              ${group.items.map((item) => `
                <div class="misqa-assignee-parent ${misqaStatusToneClass(item.status)}">
                  <div class="misqa-assignee-parent-top">
                    <div class="misqa-parent-identity">
                      <div class="misqa-parent-linkline" title="${esc(item.summary || '-')}" data-tooltip="${esc(item.summary || '-')}">
                        <a class="item-key" href="${esc(item.browseUrl)}" target="_blank">${esc(item.key)}</a>
                        <a class="misqa-parent-summary-link" href="${esc(item.browseUrl)}" target="_blank">${esc(item.summary || '-')}</a>
                      </div>
                    </div>
                    <div class="misqa-parent-badges">
                      <span class="misqa-count-pill">${esc(item.parentKeys?.length || 1)} FEPMF</span>
                    </div>
                  </div>
                  <div class="misqa-assignee-status-row compact stack">
                    <span class="misqa-child-status-chip ${misqaStatusToneClass(item.status)}">${esc(item.status || '-')}</span>
                    ${(item.parentKeys || []).map((parentKey, idx) => `
                      <span class="${statusBadgeClass(item.parentStatuses?.[idx] || '-')} misqa-parent-status">${esc(item.parentStatuses?.[idx] || '-')}</span>
                      <span class="misqa-count-pill" title="${esc(item.parentSummaries?.[idx] || '-')}">${esc(parentKey)}</span>
                    `).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
            ` : `
            <div class="misqa-assignee-parent-list stack">
              ${group.parents.map((parent) => `
                <div class="misqa-assignee-parent ${misqaStatusToneClass(dominantMisqaStatus(parent.items))}">
                  <div class="misqa-assignee-parent-top">
                    <div class="misqa-parent-identity">
                      <div class="misqa-parent-linkline" title="${esc(parent.summary || '-')}" data-tooltip="${esc(parent.summary || '-')}">
                        <a class="item-key" href="${esc(parent.browseUrl)}" target="_blank">${esc(parent.key)}</a>
                        <a class="misqa-parent-summary-link" href="${esc(parent.browseUrl)}" target="_blank">${esc(parent.summary || '-')}</a>
                      </div>
                    </div>
                    <div class="misqa-parent-badges">
                      <span class="${statusBadgeClass(parent.parentStatus)} misqa-parent-status">${esc(parent.parentStatus || '-')}</span>
                      <span class="misqa-count-pill">${esc(parent.items.length)} MISQA</span>
                    </div>
                  </div>
                  <div class="misqa-assignee-status-row compact stack">
                    ${parent.items.map((item) => `<span class="misqa-child-status-chip ${misqaStatusToneClass(item.status)}" title="${esc(`${item.key} - ${item.summary || ''}`)}">${esc(item.key)} · ${esc(item.status || '-')}</span>`).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
            `}
            `}
          </article>
          `
          })()}
        `).join('')}
      </section>
    `
    host.querySelectorAll('[data-assignee-view]').forEach((btn) => {
      btn.addEventListener('click', () => setAssigneeDetailMode(btn.getAttribute('data-assignee-view') || '', btn.getAttribute('data-mode') || 'fepmf'))
    })
    host.querySelectorAll('.misqa-hero-pill.toggle').forEach((btn) => {
      btn.addEventListener('click', () => toggleAssigneeCard(btn.getAttribute('data-assignee') || ''))
    })
    return
  }

  host.innerHTML = rows.map((row) => {
    const isOpen = state.expanded.has(row.parent.key)
    const openMisqa = row.pendingMisqaItems
    const closedMisqa = row.doneMisqaItems
    const otherChildCount = Math.max(0, (row.workItems || []).length - row.misqaItems.length)

    const misqaBlocks = [
      openMisqa.length ? `
        <div class="misqa-section">
          <div class="misqa-section-title">Open MISQA</div>
          <div class="work-items">${openMisqa.map((item) => `
            <div class="item-row ${workItemRowClass(item)}">
              <div class="item-top">
                <div><a class="item-key" href="${esc(item.browseUrl)}" target="_blank">${esc(item.key)}</a> ${esc(item.summary || '')}</div>
                <div class="${workItemStatusClass(item)}">${esc(item.status || '-')}</div>
              </div>
              <div class="item-meta">Assignee: ${esc(item.assignee || '-')}</div>
            </div>
          `).join('')}</div>
        </div>
      ` : '',
      closedMisqa.length ? `
        <div class="misqa-section">
          <div class="misqa-section-title">Closed MISQA</div>
          <div class="work-items">${closedMisqa.map((item) => `
            <div class="item-row ${workItemRowClass(item)}">
              <div class="item-top">
                <div><a class="item-key" href="${esc(item.browseUrl)}" target="_blank">${esc(item.key)}</a> ${esc(item.summary || '')}</div>
                <div class="${workItemStatusClass(item)}">${esc(item.status || '-')}</div>
              </div>
              <div class="item-meta">Assignee: ${esc(item.assignee || '-')}</div>
            </div>
          `).join('')}</div>
        </div>
      ` : '',
      !row.misqaItems.length ? '<div class="empty">FEPMF นี้ยังไม่มี Child ที่เป็น MISQA</div>' : ''
    ].filter(Boolean).join('')

    return `
      <article class="panel parent-card misqa-watch-card">
        <div class="parent-head">
          <div class="parent-main">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <a class="parent-key" href="${esc(row.parent.browseUrl)}" target="_blank">${esc(row.parent.key)}</a>
              <span class="${statusBadgeClass(row.parent.status)}">${esc(row.parent.status || '-')}</span>
              <span class="shift-pill ${esc(row.scopeTone)}">${esc(row.scopeLabel)}</span>
            </div>
            <div>${esc(row.parent.summary || '-')}</div>
            <div class="progress-line"><div style="width:${Math.max(0, Math.min(100, row.progressPercent || 0))}%"></div></div>
            <div class="progress-meta">
              <span><strong>${esc(row.progressPercent || 0)}%</strong></span>
              <span>Based on child status formula</span>
              <span>Children Done: ${esc(row.progress?.doneLinked || 0)}/${esc(row.progress?.totalLinked || 0)}</span>
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
          <div><strong>MISQA Open:</strong> ${esc(openMisqa.length)}/${esc(row.misqaItems.length)}</div>
        </div>

        <div class="misqa-highlight-row">
          <div class="misqa-highlight-card">
            <div class="misqa-highlight-label">MISQA Assigned</div>
            <div class="misqa-highlight-value">${esc((row.pendingMisqaAssignees.length ? row.pendingMisqaAssignees : row.misqaAssignees).join(', ') || '-')}</div>
          </div>
          <div class="misqa-highlight-card">
            <div class="misqa-highlight-label">Other Child</div>
            <div class="misqa-highlight-value">${esc(otherChildCount)}</div>
          </div>
        </div>

        ${isOpen ? `<div class="misqa-sections">${misqaBlocks}</div>` : ''}
      </article>
    `
  }).join('')

  host.querySelectorAll('.expand-btn').forEach((btn) => {
    btn.addEventListener('click', () => toggleParent(btn.getAttribute('data-parent')))
  })
}

function buildAssigneeGroups(rows) {
  const map = new Map()
  const selectedAssignees = state.filters.misqaAssigned || []
  const filterAssigneeEnabled = selectedAssignees.length > 0 && selectedAssignees.length !== (state.options.misqaAssigned || []).length

  for (const row of rows) {
    for (const item of row.pendingMisqaItems) {
      const itemWithParentContext = {
        ...item,
        parentKey: row.parent.key || '-',
        parentStatus: row.parent.status || '-',
        parentSummary: row.parent.summary || '-',
        parentBrowseUrl: row.parent.browseUrl || item.browseUrl || '#'
      }
      const name = String(item.assignee || '').trim() || 'Unassigned'
      if (filterAssigneeEnabled && !selectedAssignees.includes(name)) continue
      if (!map.has(name)) {
        map.set(name, {
          name,
          items: [],
          itemMap: new Map(),
          parents: new Map(),
          statusCountMap: new Map()
        })
      }

      const group = map.get(name)
      if (!group.itemMap.has(itemWithParentContext.key)) {
        group.itemMap.set(itemWithParentContext.key, {
          ...itemWithParentContext,
          parentKeys: [itemWithParentContext.parentKey],
          parentStatuses: [itemWithParentContext.parentStatus],
          parentSummaries: [itemWithParentContext.parentSummary],
          parentBrowseUrls: [itemWithParentContext.parentBrowseUrl]
        })
        group.statusCountMap.set(item.status || '-', (group.statusCountMap.get(item.status || '-') || 0) + 1)
      } else {
        const currentItem = group.itemMap.get(itemWithParentContext.key)
        if (!currentItem.parentKeys.includes(itemWithParentContext.parentKey)) currentItem.parentKeys.push(itemWithParentContext.parentKey)
        if (!currentItem.parentStatuses.includes(itemWithParentContext.parentStatus)) currentItem.parentStatuses.push(itemWithParentContext.parentStatus)
        if (!currentItem.parentSummaries.includes(itemWithParentContext.parentSummary)) currentItem.parentSummaries.push(itemWithParentContext.parentSummary)
        if (!currentItem.parentBrowseUrls.includes(itemWithParentContext.parentBrowseUrl)) currentItem.parentBrowseUrls.push(itemWithParentContext.parentBrowseUrl)
      }

      if (!group.parents.has(row.parent.key)) {
        group.parents.set(row.parent.key, {
          key: row.parent.key,
          summary: row.parent.summary,
          browseUrl: row.parent.browseUrl,
          parentStatus: row.parent.status,
          items: []
        })
      }
      group.parents.get(row.parent.key).items.push(itemWithParentContext)
    }
  }

  return [...map.values()]
    .map((group) => {
      const uniqueItems = [...group.itemMap.values()].sort((a, b) =>
        String(a.key).localeCompare(String(b.key))
        || String(a.parentKey).localeCompare(String(b.parentKey))
      )

      return {
        name: group.name,
        itemCount: uniqueItems.length,
        parentCount: group.parents.size,
        items: uniqueItems,
        statusCounts: [...group.statusCountMap.entries()]
          .map(([status, count]) => ({ status, count }))
          .sort((a, b) => b.count - a.count || String(a.status).localeCompare(String(b.status))),
        parents: [...group.parents.values()].sort((a, b) => a.key.localeCompare(b.key))
      }
    })
    .sort((a, b) => b.itemCount - a.itemCount || a.name.localeCompare(b.name))
}

function selectedText(key) {
  const selected = state.filters[key] || []
  if (key === 'misqaAssigned' && state.options.misqaAssigned.length && selected.length === state.options.misqaAssigned.length) return 'All MISQA Assignees'
  if (!selected.length) return filterConfig[key].placeholder
  if (selected.length === 1) return selected[0]
  return `${selected[0]} +${selected.length - 1}`
}

function renderOneFilter(key) {
  const cfg = filterConfig[key]
  const host = document.getElementById(cfg.host)
  const selected = state.filters[key] || []
  const search = (state.searchInFilter[key] || '').toLowerCase()
  const allOptions = state.options[key] || []
  const options = allOptions.filter((x) => String(x).toLowerCase().includes(search))
  const isAllSelected = allOptions.length > 0 && selected.length === allOptions.length

  host.innerHTML = `
    <button class="multi-trigger" type="button">
      <span class="value">${esc(selectedText(key))}</span>
      <span class="muted">▾</span>
    </button>
    <div class="multi-panel">
      <div class="multi-search"><input type="text" value="${esc(state.searchInFilter[key] || '')}" placeholder="ค้นหา ${esc(cfg.label)}" data-role="search" /></div>
      <div class="multi-options">
        ${allOptions.length ? `
          <label class="multi-option">
            <input type="checkbox" value="__ALL__" ${isAllSelected ? 'checked' : ''} />
            <span>ทั้งหมด</span>
          </label>
        ` : ''}
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
    el.addEventListener('change', (e) => {
      const target = e.target
      if (target.value === '__ALL__') {
        state.filters[key] = target.checked ? [...allOptions] : []
        renderOneFilter(key)
        host.classList.add('open')
        applyAll()
        return
      }

      state.filters[key] = [...host.querySelectorAll('input[type="checkbox"]:checked')]
        .map((x) => x.value)
        .filter((value) => value !== '__ALL__')
      renderOneFilter(key)
      host.classList.add('open')
      applyAll()
    })
  })

  host.querySelector('[data-role="clear"]').addEventListener('click', () => {
    state.filters[key] = key === 'misqaAssigned' ? [...state.options.misqaAssigned] : []
    state.searchInFilter[key] = ''
    renderOneFilter(key)
    host.classList.add('open')
    applyAll()
  })

  host.querySelector('[data-role="close"]').addEventListener('click', () => host.classList.remove('open'))
}

function renderFilters() {
  renderOneFilter('misqaAssigned')
}

function applyAll() {
  const baseRows = filteredRowsBase()
  renderViewSwitch()
  renderScopeSwitch(baseRows)
  state.rows = scopeRows(baseRows)
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
    state.options.misqaAssigned = [...new Set((data.parents || [])
      .flatMap((row) => (row.workItems || []).filter(isMisqa).map((item) => String(item.assignee || '').trim()))
      .filter(Boolean))].sort((a, b) => a.localeCompare(b))

    state.filters.status = [...state.options.status]
    state.filters.misqaAssigned = [...state.options.misqaAssigned]

    renderFilters()
    applyAll()
    document.getElementById('misqaSyncTime').textContent = `อัปเดตล่าสุด: ${new Date(data.generatedAt || Date.now()).toLocaleString('th-TH')}`
  } catch (error) {
    document.getElementById('misqaContent').innerHTML = `<div class="panel empty">โหลดข้อมูลไม่สำเร็จ: ${esc(error.message || error)}</div>`
    document.getElementById('misqaSyncTime').textContent = 'โหลดข้อมูลล้มเหลว'
  }
}

function bindEvents() {
  document.getElementById('misqaSearch').addEventListener('input', (e) => {
    state.query = e.target.value || ''
    applyAll()
  })

  document.getElementById('misqaClearBtn').addEventListener('click', () => {
    state.query = ''
    document.getElementById('misqaSearch').value = ''
    state.filters.status = [...state.options.status]
    state.filters.squad = []
    state.filters.estimateSprint = []
    state.filters.cabDate = []
    state.filters.misqaAssigned = [...state.options.misqaAssigned]
    state.searchInFilter.status = ''
    state.searchInFilter.squad = ''
    state.searchInFilter.estimateSprint = ''
    state.searchInFilter.cabDate = ''
    state.searchInFilter.misqaAssigned = ''
    state.scope = 'waiting'
    state.expanded.clear()
    renderFilters()
    applyAll()
  })

  document.getElementById('misqaRefreshBtn').addEventListener('click', load)
  document.getElementById('misqaExpandAllBtn').addEventListener('click', expandAllCurrentView)
  document.getElementById('misqaCollapseAllBtn').addEventListener('click', collapseAllCurrentView)

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.multi')) {
      document.querySelectorAll('.multi.open').forEach((el) => el.classList.remove('open'))
    }
  })
}

bindEvents()
load()
