const state = {
  dashboard: null,
  plans: [],
  source: '',
  editingId: '',
  timelineVisibleCount: 30,
  selectedMonth: '',
  filters: {
    q: '',
    status: ['S4', 'S5', 'S6']
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
  if (s === 'S7') return 'badge status-s7'
  if (s === 'S6') return 'badge status-s6'
  if (s === 'S5') return 'badge status-s5'
  if (s === 'S4') return 'badge status-s4'
  if (s === 'S3') return 'badge status-s3'
  if (s === 'Cancelled') return 'badge status-cancel'
  return 'badge status-default'
}

function buildStatusFilter() {
  const host = document.getElementById('calendarStatusFilter')
  const selected = state.filters.status
  const options = (state.statusOptions || []).filter((v) => String(v).toLowerCase().includes(state.statusSearch.toLowerCase()))
  const label = selected.length ? `${selected[0]}${selected.length > 1 ? ` +${selected.length - 1}` : ''}` : 'เลือก Status'

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
      state.timelineVisibleCount = 30
      buildStatusFilter()
      host.classList.add('open')
      renderTimeline()
    })
  })

  host.querySelector('[data-role="clear"]').addEventListener('click', () => {
    state.filters.status = []
    state.statusSearch = ''
    state.timelineVisibleCount = 30
    buildStatusFilter()
    host.classList.add('open')
    renderTimeline()
  })

  host.querySelector('[data-role="close"]').addEventListener('click', () => host.classList.remove('open'))
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

    if (e.source === 'parent' && state.filters.status.length && !state.filters.status.includes(e.status)) return false

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

  const dayHeaders = Array.from({ length: days }, (_, i) => {
    const d = new Date(startDate.getTime())
    d.setUTCDate(d.getUTCDate() + i)
    return `<div class="day-cell">${d.getUTCDate()}</div>`
  }).join('')

  const rows = events.map((e) => {
    const eventStart = new Date(`${e.start}T00:00:00Z`)
    const eventEnd = new Date(`${e.end}T00:00:00Z`)

    const clampedStart = eventStart < startDate ? startDate : eventStart
    const clampedEnd = eventEnd > endDate ? endDate : eventEnd

    const startOffset = Math.floor((clampedStart - startDate) / 86400000)
    const endOffset = Math.floor((clampedEnd - startDate) / 86400000)

    const left = (startOffset / days) * 100
    const width = (Math.max(1, endOffset - startOffset + 1) / days) * 100

    const barClass = e.source === 'manual' ? 'bar-manual' : 'bar-parent'
    const rangeText = `${e.start} - ${e.end}`
    const hoverText = `${e.title}\n${rangeText}`

    return `
      <div class="timeline-row" style="grid-template-columns:240px repeat(${days}, minmax(16px, 1fr));">
        <div class="row-label">
          <div style="display:flex;justify-content:space-between;gap:6px;align-items:center">
            <strong>${e.url ? `<a href="${esc(e.url)}" target="_blank" title="${esc(hoverText)}">${esc(e.key)}</a>` : `<span title="${esc(hoverText)}">${esc(e.key)}</span>`}</strong>
            <span class="${statusBadgeClass(e.status)}" style="padding:2px 8px">${esc(e.status)}</span>
          </div>
          <div style="font-size:11px;color:var(--muted);line-height:1.2">${esc(e.squad || '-')}</div>
        </div>
        <div class="row-track" style="grid-column:2 / -1;grid-row:1;">
          <div class="event-bar ${barClass}" style="left:${left}%;width:${width}%" title="${esc(hoverText)}">${esc(e.key)}</div>
        </div>
        ${Array.from({ length: days }, () => '<div class="row-day"></div>').join('')}
      </div>
    `
  }).join('')

  document.getElementById('timelineGrid').innerHTML = `
    <div class="timeline-head" style="grid-template-columns:240px repeat(${days}, minmax(16px, 1fr));">
      <div class="time-label"><strong>Item</strong><div style="font-size:11px;color:var(--muted)">${start} ถึง ${end}</div></div>
      ${dayHeaders}
    </div>
    ${rows || '<div class="empty">ไม่พบข้อมูลตามเงื่อนไข</div>'}
  `

  document.getElementById('calendarSummary').textContent = `แสดง ${events.length}/${allEvents.length} รายการ | ช่วงวันที่ ${start} ถึง ${end} | Source: ${state.source || '-'}`

  const controls = document.getElementById('timelineControls')
  if (controls) {
    if (visibleCount < allEvents.length) {
      controls.innerHTML = `<button id="loadMoreTimelineBtn" class="btn" type="button">Load more (${allEvents.length - visibleCount} remaining)</button>`
      const btn = document.getElementById('loadMoreTimelineBtn')
      if (btn) {
        btn.addEventListener('click', () => {
          state.timelineVisibleCount += 30
          renderTimeline()
        })
      }
    } else if (allEvents.length > 30) {
      controls.innerHTML = `<button id="showLessTimelineBtn" class="btn" type="button">Show less</button>`
      const btn = document.getElementById('showLessTimelineBtn')
      if (btn) {
        btn.addEventListener('click', () => {
          state.timelineVisibleCount = 30
          renderTimeline()
        })
      }
    } else {
      controls.innerHTML = ''
    }
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
      <div class="item-meta">Owner: ${esc(item.owner || '-')} | Sprint: ${esc(item.sprint || '-')}</div>
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
      if (!id) return
      if (!confirm('ยืนยันลบรายการนี้?')) return

      const status = document.getElementById('planStatus')
      status.textContent = 'กำลังลบ...'

      try {
        const res = await fetch('/api/planner', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)

        status.textContent = 'ลบเรียบร้อย'
        await loadAll()
      } catch (error) {
        status.textContent = `ลบไม่สำเร็จ: ${error.message || error}`
      }
    })
  })
}

async function loadAll() {
  const [dashboardRes, plannerRes] = await Promise.all([fetch('/api/dashboard'), fetch('/api/planner')])
  const dashboard = await dashboardRes.json()
  const planner = await plannerRes.json()

  if (dashboard.error) throw new Error(dashboard.error)
  if (planner.error) throw new Error(planner.error)

  state.dashboard = dashboard
  state.plans = Array.isArray(planner.items) ? planner.items : []
  state.source = planner.source || ''

  state.statusOptions = dashboard.meta?.available?.statuses || []
  state.filters.status = ['S4', 'S5', 'S6'].filter((s) => state.statusOptions.includes(s))
  state.timelineVisibleCount = 30

  buildStatusFilter()
  renderManualList()
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
    status.textContent = state.editingId ? 'กำลังอัปเดต...' : 'กำลังบันทึก...'

    try {
      const res = await fetch('/api/planner', {
        method: state.editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      status.textContent = state.editingId ? 'อัปเดตเรียบร้อย' : 'บันทึกเรียบร้อย'
      setEditMode(null)
      await loadAll()
    } catch (error) {
      status.textContent = `ไม่สำเร็จ: ${error.message || error}`
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
