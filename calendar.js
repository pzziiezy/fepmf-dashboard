const state = {
  dashboard: null,
  plans: [],
  qaAssignments: [],
  source: '',
  editingId: '',
  timelineVisibleCount: 30,
  selectedMonth: '',
  activeTab: 'manual',
  filters: {
    q: '',
    status: ['S4', 'S5', 'S6']
  },
  statusOptions: [],
  statusSearch: '',
  qa: {
    q: '',
    status: ['S3', 'S4', 'S5', 'S6'],
    statusOptions: ['S3', 'S4', 'S5', 'S6'],
    statusSearch: '',
    selectedKeys: new Set()
  }
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

function getTwoMonthRange() {
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
  const end = new Date(Date.UTC(y, m + 2, 0))
  return { start: toIsoDate(start), end: toIsoDate(end) }
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd
}

function statusBadgeClass(status) {
  const s = String(status || '')
  if (s === 'Manual') return 'badge status-manual'
  if (s === 'QA Plan') return 'badge status-s3'
  if (s === 'S7') return 'badge status-s7'
  if (s === 'S6') return 'badge status-s6'
  if (s === 'S5') return 'badge status-s5'
  if (s === 'S4') return 'badge status-s4'
  if (s === 'S3') return 'badge status-s3'
  if (s === 'Cancelled') return 'badge status-cancel'
  return 'badge status-default'
}

function setNotice(el, message, type = 'info') {
  if (!el) return
  el.textContent = message || ''
  el.classList.remove('notice-success', 'notice-error')
  if (type === 'success') el.classList.add('notice-success')
  if (type === 'error') el.classList.add('notice-error')
}

function parseQaNamesInput(rawValue) {
  const raw = String(rawValue || '').trim()
  if (!raw) return []
  return [...new Set(raw.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean))]
}

function getActiveQaByProjectKey() {
  const map = new Map()
  for (const item of state.qaAssignments || []) {
    const projectKey = String(item.projectKey || '').trim()
    const qaName = String(item.qaName || '').trim()
    if (!projectKey || !qaName) continue
    if (!map.has(projectKey)) map.set(projectKey, [])
    map.get(projectKey).push(item)
  }
  return map
}

function buildMultiFilter(hostId, selected, options, searchText, placeholder, onChange, onSearch) {
  const host = document.getElementById(hostId)
  const filtered = (options || []).filter((v) => String(v).toLowerCase().includes(searchText.toLowerCase()))
  const label = selected.length ? `${selected[0]}${selected.length > 1 ? ` +${selected.length - 1}` : ''}` : placeholder

  host.innerHTML = `
    <button class="multi-trigger" type="button"><span class="value">${esc(label)}</span><span class="muted">▾</span></button>
    <div class="multi-panel">
      <div class="multi-search"><input data-role="search" value="${esc(searchText)}" placeholder="ค้นหา" /></div>
      <div class="multi-options">
        ${filtered.map((value) => `
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
    onSearch(e.target.value || '')
    host.classList.add('open')
  })
  host.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.addEventListener('change', () => {
      const next = [...host.querySelectorAll('input[type="checkbox"]:checked')].map((x) => x.value)
      onChange(next)
      host.classList.add('open')
    })
  })
  host.querySelector('[data-role="clear"]').addEventListener('click', () => {
    onSearch('')
    onChange([])
    host.classList.add('open')
  })
  host.querySelector('[data-role="close"]').addEventListener('click', () => host.classList.remove('open'))
}

function buildStatusFilter() {
  buildMultiFilter(
    'calendarStatusFilter',
    state.filters.status,
    state.statusOptions,
    state.statusSearch,
    'เลือก Status',
    (next) => {
      state.filters.status = next
      state.timelineVisibleCount = 30
      buildStatusFilter()
      renderTimeline()
    },
    (nextSearch) => {
      state.statusSearch = nextSearch
      buildStatusFilter()
    }
  )
}

function buildQaStatusFilter() {
  buildMultiFilter(
    'qaStatusFilter',
    state.qa.status,
    state.qa.statusOptions,
    state.qa.statusSearch,
    'เลือก Status (S3-S6)',
    (next) => {
      state.qa.status = next
      buildQaStatusFilter()
      renderQaProjectList()
      renderQaCounter()
    },
    (nextSearch) => {
      state.qa.statusSearch = nextSearch
      buildQaStatusFilter()
    }
  )
}

function enumerateEvents() {
  const jiraParents = (state.dashboard?.parents || []).map((row) => {
    const timeline = (state.dashboard.timelineItems || []).find((x) => x.key === row.parent.key)
    if (!timeline) return null
    return {
      id: row.parent.key,
      key: row.parent.key,
      title: row.parent.summary,
      status: row.parent.status,
      squad: row.parent.squad,
      start: timeline.start,
      end: timeline.end,
      source: 'parent',
      url: row.parent.browseUrl
    }
  }).filter(Boolean)

  const manual = (state.plans || []).map((x) => ({
    id: x.id,
    key: x.key || '-',
    title: x.title,
    status: 'Manual',
    squad: x.owner || '-',
    start: x.start,
    end: x.end,
    color: x.color || '#b66a00',
    source: 'manual',
    url: ''
  }))
  return [...jiraParents, ...manual]
}

function filteredEvents() {
  const { start, end } = getTwoMonthRange()
  const q = state.filters.q.toLowerCase().trim()
  return enumerateEvents().filter((e) => {
    if (!overlaps(e.start, e.end, start, end)) return false
    if (state.filters.status.length && !state.filters.status.includes(e.status)) return false
    if (q) {
      const blob = `${e.key} ${e.title} ${e.status} ${e.squad}`.toLowerCase()
      if (!blob.includes(q)) return false
    }
    return true
  })
}

function renderTimeline() {
  const { start, end } = getTwoMonthRange()
  const startDate = new Date(`${start}T00:00:00Z`)
  const endDate = new Date(`${end}T00:00:00Z`)
  const days = Math.floor((endDate - startDate) / 86400000) + 1
  const allEvents = filteredEvents().sort((a, b) => (a.start || '').localeCompare(b.start || ''))
  const visibleCount = Math.min(state.timelineVisibleCount, allEvents.length)
  const events = allEvents.slice(0, visibleCount)
  const todayIso = toIsoDate(new Date())
  const todayDate = new Date(`${todayIso}T00:00:00Z`)
  const todayVisible = todayDate >= startDate && todayDate <= endDate
  const todayOffset = todayVisible ? Math.floor((todayDate - startDate) / 86400000) : -1
  const todayLeft = todayVisible ? (todayOffset / days) * 100 : -1
  const todayWidth = 100 / days

  const dayHeaders = Array.from({ length: days }, (_, i) => {
    const d = new Date(startDate.getTime())
    d.setUTCDate(d.getUTCDate() + i)
    return `<div class="day-cell ${todayVisible && i === todayOffset ? 'today-cell' : ''}">${d.getUTCDate()}</div>`
  }).join('')

  const qaByProject = getActiveQaByProjectKey()
  const rows = events.map((e) => {
    const qaRows = e.source === 'parent' ? (qaByProject.get(e.key) || []) : []
    const qaNames = [...new Set(qaRows.map((x) => String(x.qaName || '').trim()).filter(Boolean))]
    const eventStart = new Date(`${e.start}T00:00:00Z`)
    const eventEnd = new Date(`${e.end}T00:00:00Z`)
    const clampedStart = eventStart < startDate ? startDate : eventStart
    const clampedEnd = eventEnd > endDate ? endDate : eventEnd
    const startOffset = Math.floor((clampedStart - startDate) / 86400000)
    const endOffset = Math.floor((clampedEnd - startDate) / 86400000)
    const left = (startOffset / days) * 100
    const width = (Math.max(1, endOffset - startOffset + 1) / days) * 100
    const barClass = e.source === 'manual' ? 'bar-manual' : 'bar-parent'
    const manualStyle = e.source === 'manual' ? `background:${esc(e.color || '#b66a00')};` : ''
    const rangeText = `${e.start} - ${e.end}`
    const hoverText = `${e.title}\n${rangeText}`
    const isProjectLike = e.source === 'parent'
    const itemLabel = isProjectLike ? `${e.key}${e.squad ? ` (${e.squad})` : ''}` : e.title
    const qaHoverText = qaNames.length ? `QA Plan: ${qaNames.join(', ')}\n${rangeText}` : ''

    return `
      <div class="timeline-row calendar-row-compact ${qaNames.length ? 'has-qa' : ''}" style="grid-template-columns:240px repeat(${days}, minmax(14px, 1fr));">
        <div class="row-label">
          <div style="display:flex;justify-content:space-between;gap:6px;align-items:center">
            <strong>${e.url ? `<a href="${esc(e.url)}" target="_blank" title="${esc(hoverText)}">${esc(itemLabel)}</a>` : `<span title="${esc(hoverText)}">${esc(itemLabel)}</span>`}</strong>
            <span class="${statusBadgeClass(e.status)}" style="padding:2px 8px">${esc(e.status)}</span>
          </div>
          <div class="calendar-item-summary">${esc(e.title || '-')}</div>
        </div>
        <div class="row-track" style="grid-column:2 / -1;grid-row:1;">
          ${todayVisible ? `<div class="today-bg" style="left:${todayLeft}%;width:${todayWidth}%"></div>` : ''}
          <div class="event-bar ${barClass}" style="left:${left}%;width:${width};${manualStyle}" title="${esc(hoverText)}">${esc(e.key)}</div>
          ${qaNames.length ? `<div class="event-bar bar-qa event-bar-secondary" style="left:${left}%;width:${width}%" title="${esc(qaHoverText)}">${esc(qaNames.join(', '))}</div>` : ''}
        </div>
        ${Array.from({ length: days }, () => '<div class="row-day"></div>').join('')}
      </div>
    `
  }).join('')

  document.getElementById('timelineGrid').innerHTML = `
    <div class="timeline-head calendar-row-compact" style="grid-template-columns:240px repeat(${days}, minmax(14px, 1fr));position:relative;">
      <div class="time-label"><strong>Item</strong><div style="font-size:10px;color:var(--muted)">${start} ถึง ${end}</div></div>
      ${dayHeaders}
    </div>
    ${rows || '<div class="empty">ไม่พบข้อมูลตามเงื่อนไข</div>'}
  `

  document.getElementById('calendarSummary').textContent = `แสดง ${events.length}/${allEvents.length} รายการ | ช่วงวันที่ ${start} ถึง ${end} | Source: ${state.source || '-'}`

  const controls = document.getElementById('timelineControls')
  if (!controls) return
  if (visibleCount < allEvents.length) {
    controls.innerHTML = `<button id="loadMoreTimelineBtn" class="btn" type="button">Load more (${allEvents.length - visibleCount} remaining)</button>`
    document.getElementById('loadMoreTimelineBtn').addEventListener('click', () => {
      state.timelineVisibleCount += 30
      renderTimeline()
    })
  } else if (allEvents.length > 30) {
    controls.innerHTML = `<button id="showLessTimelineBtn" class="btn" type="button">Show less</button>`
    document.getElementById('showLessTimelineBtn').addEventListener('click', () => {
      state.timelineVisibleCount = 30
      renderTimeline()
    })
  } else {
    controls.innerHTML = ''
  }
}

function setEditMode(item) {
  const form = document.getElementById('planForm')
  const saveBtn = document.getElementById('savePlanBtn')
  const cancelBtn = document.getElementById('cancelEditBtn')
  const modeLabel = document.getElementById('editModeLabel')
  if (!item) {
    state.editingId = ''
    form.reset()
    form.elements.color.value = '#b66a00'
    saveBtn.textContent = 'บันทึกแผนงาน'
    cancelBtn.style.display = 'none'
    modeLabel.style.display = 'none'
    return
  }
  state.editingId = item.id
  form.elements.title.value = item.title || ''
  form.elements.key.value = item.key || ''
  form.elements.sprint.value = item.sprint || ''
  form.elements.start.value = item.start || ''
  form.elements.end.value = item.end || ''
  form.elements.owner.value = item.owner || ''
  form.elements.color.value = item.color || '#b66a00'
  form.elements.note.value = item.note || ''
  saveBtn.textContent = 'อัปเดตแผนงาน'
  cancelBtn.style.display = ''
  modeLabel.style.display = ''
}

function renderManualList() {
  const list = document.getElementById('manualList')
  if (!state.plans.length) {
    list.innerHTML = '<div class="empty">ยังไม่มีรายการ Manual</div>'
    return
  }
  list.innerHTML = state.plans.map((item) => `
    <div class="item-row">
      <div class="item-top"><div><strong>${esc(item.key || '-')}</strong> ${esc(item.title)}</div><div class="badge status-default">${esc(item.start)} - ${esc(item.end)}</div></div>
      <div class="item-meta">Owner: ${esc(item.owner || '-')} | Sprint: ${esc(item.sprint || '-')} | <span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:999px;background:${esc(item.color || '#b66a00')};display:inline-block;border:1px solid rgba(0,0,0,0.12)"></span>Timeline Color</span></div>
      <div class="item-meta">${esc(item.note || '')}</div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button class="btn" data-action="edit" data-id="${esc(item.id)}">แก้ไข</button>
        <button class="btn" data-action="delete" data-id="${esc(item.id)}">ลบ</button>
      </div>
    </div>
  `).join('')

  list.querySelectorAll('button[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id')
      const item = state.plans.find((x) => x.id === id)
      if (item) setEditMode(item)
    })
  })

  list.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id')
      if (!id || !confirm('ยืนยันลบรายการนี้?')) return
      const status = document.getElementById('planStatus')
      setNotice(status, 'กำลังลบ...')
      try {
        const res = await fetch('/api/planner', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        setNotice(status, 'ลบเรียบร้อย', 'success')
        await loadAll()
      } catch (error) {
        setNotice(status, `ลบไม่สำเร็จ: ${error.message || error}`, 'error')
      }
    })
  })
}

function getQaCandidates() {
  const q = state.qa.q.toLowerCase().trim()
  return (state.dashboard?.parents || []).filter((row) => {
    const status = row.parent.status
    if (!['S3', 'S4', 'S5', 'S6'].includes(status)) return false
    if (state.qa.status.length && !state.qa.status.includes(status)) return false
    if (!q) return true
    return `${row.parent.key} ${row.parent.summary} ${row.parent.squad}`.toLowerCase().includes(q)
  })
}

function renderQaProjectList() {
  const host = document.getElementById('qaProjectList')
  const rows = getQaCandidates()
  if (!rows.length) {
    host.innerHTML = '<div class="empty">ไม่พบโปรเจ็คตามเงื่อนไข</div>'
    return
  }
  host.innerHTML = rows.map((row) => {
    const checked = state.qa.selectedKeys.has(row.parent.key) ? 'checked' : ''
    return `
      <label class="item-row" style="display:flex;gap:8px;align-items:flex-start">
        <input type="checkbox" data-role="qa-pick" data-key="${esc(row.parent.key)}" ${checked} />
        <div>
          <div><strong>${esc(row.parent.key)}</strong> ${esc(row.parent.summary || '')}</div>
          <div class="item-meta">Status: ${esc(row.parent.status || '-')} | Squad: ${esc(row.parent.squad || '-')}</div>
        </div>
      </label>
    `
  }).join('')
}

function renderQaAssignmentList() {
  const host = document.getElementById('qaAssignmentList')
  if (!state.qaAssignments.length) {
    host.innerHTML = '<div class="empty">ยังไม่มี QA Assignment</div>'
    return
  }
  host.innerHTML = state.qaAssignments.map((item) => `
    <div class="item-row">
      <div class="item-top">
        <div><strong>${esc(item.projectKey)}</strong> ${esc(item.projectTitle || '')}</div>
        <div class="badge b-status">${esc(item.qaName || '-')}</div>
      </div>
      <div class="item-meta">Status: ${esc(item.status || '-')} | Assigned: ${esc(item.assignedAt || '-')}</div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <input data-role="qa-reassign-input" data-id="${esc(item.id)}" class="search" style="max-width:220px;padding:6px 10px" placeholder="ชื่อ QA คนใหม่" />
        <button class="btn" data-action="qa-reassign" data-id="${esc(item.id)}">Re-assign</button>
        <button class="btn" data-action="qa-delete" data-id="${esc(item.id)}">ลบ Assign</button>
      </div>
    </div>
  `).join('')

  host.querySelectorAll('button[data-action="qa-reassign"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id')
      const row = btn.closest('.item-row')
      const input = row ? row.querySelector('input[data-role="qa-reassign-input"]') : null
      const qaName = String(input?.value || '').trim()
      if (!id || !qaName) return
      await updateQaAssignment(id, qaName)
    })
  })

  host.querySelectorAll('button[data-action="qa-delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id')
      if (!id || !confirm('ยืนยันลบการ assign นี้?')) return
      const status = document.getElementById('qaAssignStatus')
      setNotice(status, 'กำลังลบ assignment...')
      try {
        const res = await fetch('/api/qa-plan', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        setNotice(status, 'ลบ assignment แล้ว', 'success')
        await loadAll()
      } catch (error) {
        setNotice(status, `ลบไม่สำเร็จ: ${error.message || error}`, 'error')
      }
    })
  })
}

function renderQaCounter() {
  const active = (state.qaAssignments || []).filter((x) => ['S3', 'S4', 'S5', 'S6'].includes(String(x.status || '').toUpperCase()))
  const uniqueQa = [...new Set(active.map((x) => String(x.qaName || '').trim()).filter(Boolean))]
  document.getElementById('qaCounter').textContent = `QA Assigned (S3-S6): ${uniqueQa.length} คน | รายการ: ${active.length}`
}

async function updateQaAssignment(id, qaName) {
  const status = document.getElementById('qaAssignStatus')
  setNotice(status, 'กำลัง re-assign...')
  try {
    const res = await fetch('/api/qa-plan', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, qaName })
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    setNotice(status, 'Re-assign สำเร็จ', 'success')
    await loadAll()
  } catch (error) {
    setNotice(status, `Re-assign ไม่สำเร็จ: ${error.message || error}`, 'error')
  }
}

function switchTab(tab) {
  state.activeTab = tab
  document.getElementById('tabManual').style.display = tab === 'manual' ? '' : 'none'
  document.getElementById('tabQa').style.display = tab === 'qa' ? '' : 'none'
  document.getElementById('tabManualBtn').classList.toggle('active', tab === 'manual')
  document.getElementById('tabQaBtn').classList.toggle('active', tab === 'qa')
}

async function loadAll() {
  const [dashboardRes, plannerRes, qaRes] = await Promise.all([fetch('/api/dashboard'), fetch('/api/planner'), fetch('/api/qa-plan')])
  const dashboard = await dashboardRes.json()
  const planner = await plannerRes.json()
  const qa = await qaRes.json()
  if (dashboard.error) throw new Error(dashboard.error)
  if (planner.error) throw new Error(planner.error)
  if (qa.error) throw new Error(qa.error)

  state.dashboard = dashboard
  state.plans = Array.isArray(planner.items) ? planner.items : []
  state.qaAssignments = Array.isArray(qa.items) ? qa.items : []
  state.source = planner.source || qa.source || ''

  state.statusOptions = dashboard.meta?.available?.statuses || []
  if (!state.statusOptions.includes('Manual')) state.statusOptions.push('Manual')
  state.filters.status = ['S4', 'S5', 'S6'].filter((s) => state.statusOptions.includes(s))
  state.timelineVisibleCount = 30

  buildStatusFilter()
  buildQaStatusFilter()
  renderManualList()
  renderQaProjectList()
  renderQaAssignmentList()
  renderQaCounter()
  renderTimeline()
  document.getElementById('calendarSync').textContent = `อัปเดตล่าสุด: ${new Date(dashboard.generatedAt || Date.now()).toLocaleString('th-TH')}`
}

function bindEvents() {
  const monthPicker = document.getElementById('calendarMonthPicker')
  if (monthPicker) {
    const now = new Date()
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    state.selectedMonth = currentMonth
    monthPicker.value = currentMonth
    monthPicker.addEventListener('change', (e) => {
      state.selectedMonth = e.target.value || currentMonth
      state.timelineVisibleCount = 30
      renderTimeline()
    })
  }

  document.getElementById('calendarSearch').addEventListener('input', (e) => {
    state.filters.q = e.target.value || ''
    state.timelineVisibleCount = 30
    renderTimeline()
  })

  document.getElementById('cancelEditBtn').addEventListener('click', () => setEditMode(null))

  document.getElementById('planForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const payload = Object.fromEntries(new FormData(e.currentTarget).entries())
    if (state.editingId) payload.id = state.editingId
    const status = document.getElementById('planStatus')
    setNotice(status, state.editingId ? 'กำลังอัปเดต...' : 'กำลังบันทึก...')
    try {
      const res = await fetch('/api/planner', {
        method: state.editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setNotice(status, state.editingId ? 'อัปเดตเรียบร้อย' : 'บันทึกเรียบร้อย', 'success')
      setEditMode(null)
      await loadAll()
    } catch (error) {
      setNotice(status, `ไม่สำเร็จ: ${error.message || error}`, 'error')
    }
  })

  document.getElementById('tabManualBtn').addEventListener('click', () => switchTab('manual'))
  document.getElementById('tabQaBtn').addEventListener('click', () => switchTab('qa'))

  document.getElementById('qaSearch').addEventListener('input', (e) => {
    state.qa.q = e.target.value || ''
    renderQaProjectList()
  })

  document.getElementById('qaProjectList').addEventListener('change', (e) => {
    if (e.target.getAttribute('data-role') !== 'qa-pick') return
    const key = e.target.getAttribute('data-key')
    if (!key) return
    if (e.target.checked) state.qa.selectedKeys.add(key)
    else state.qa.selectedKeys.delete(key)
  })

  document.getElementById('qaAssignBtn').addEventListener('click', async () => {
    const qaInput = document.getElementById('qaNameInput')
    const qaNames = parseQaNamesInput(qaInput.value)
    const selectedKeys = [...state.qa.selectedKeys]
    const status = document.getElementById('qaAssignStatus')
    if (!qaNames.length) {
      setNotice(status, 'กรุณาระบุชื่อ QA', 'error')
      return
    }
    if (!selectedKeys.length) {
      setNotice(status, 'กรุณาเลือกโปรเจ็คอย่างน้อย 1 รายการ', 'error')
      return
    }

    const candidatesByKey = new Map(getQaCandidates().map((x) => [x.parent.key, x.parent]))
    const projects = selectedKeys.map((k) => candidatesByKey.get(k)).filter(Boolean).map((p) => ({
      projectKey: p.key,
      projectTitle: p.summary,
      status: p.status
    }))

    setNotice(status, 'กำลัง assign QA...')
    try {
      const res = await fetch('/api/qa-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qaNames, projects })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setNotice(status, 'Assign QA สำเร็จ', 'success')
      state.qa.selectedKeys.clear()
      qaInput.value = ''
      await loadAll()
    } catch (error) {
      setNotice(status, `Assign ไม่สำเร็จ: ${error.message || error}`, 'error')
    }
  })

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.multi')) {
      document.querySelectorAll('.multi.open').forEach((el) => el.classList.remove('open'))
    }
  })
}

bindEvents()
loadAll().catch((error) => {
  document.getElementById('timelineGrid').innerHTML = `<div class="empty">โหลดข้อมูลไม่สำเร็จ: ${esc(error.message || error)}</div>`
  document.getElementById('calendarSync').textContent = 'โหลดข้อมูลล้มเหลว'
})
