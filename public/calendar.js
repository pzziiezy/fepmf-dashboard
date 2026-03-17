const calendarState = {
  dashboard: null,
  plans: [],
  month: '',
  source: '',
  editingId: ''
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

function getMonthRange(ym) {
  const [year, month] = ym.split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 0))
  return {
    start: toIsoDate(start),
    end: toIsoDate(end),
    days: end.getUTCDate()
  }
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd
}

function enumerateEvents() {
  const jiraEvents = (calendarState.dashboard?.timelineItems || []).map((x) => ({
    key: x.key,
    title: x.summary,
    start: x.start,
    end: x.end,
    source: x.source === 'parent' ? 'parent' : 'linked',
    url: x.browseUrl,
    sprint: x.sprint || ''
  }))

  const manualEvents = (calendarState.plans || []).map((x) => ({
    key: x.key || '-',
    title: x.title,
    start: x.start,
    end: x.end,
    source: 'manual',
    url: '',
    sprint: x.sprint || ''
  }))

  return [...jiraEvents, ...manualEvents]
}

function setEditMode(item) {
  const form = document.getElementById('planForm')
  const saveBtn = document.getElementById('savePlanBtn')
  const cancelBtn = document.getElementById('cancelEditBtn')
  const modeLabel = document.getElementById('editModeLabel')

  if (!item) {
    calendarState.editingId = ''
    form.reset()
    saveBtn.textContent = 'บันทึกแผนงาน'
    cancelBtn.style.display = 'none'
    modeLabel.style.display = 'none'
    return
  }

  calendarState.editingId = item.id
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

function renderTimeline() {
  const ym = calendarState.month
  const { start, end, days } = getMonthRange(ym)
  const events = enumerateEvents().filter((event) => overlaps(event.start, event.end, start, end))

  const dayHeaders = Array.from({ length: days }, (_, i) => `<div class="day-cell">${i + 1}</div>`).join('')

  const rows = events
    .sort((a, b) => (a.start || '').localeCompare(b.start || ''))
    .slice(0, 120)
    .map((event) => {
      const clampedStart = event.start < start ? start : event.start
      const clampedEnd = event.end > end ? end : event.end
      const startDay = Number(clampedStart.slice(-2))
      const endDay = Number(clampedEnd.slice(-2))

      const left = ((startDay - 1) / days) * 100
      const width = (Math.max(1, endDay - startDay + 1) / days) * 100

      const sourceClass = event.source === 'manual' ? 'bar-manual' : event.source === 'parent' ? 'bar-parent' : 'bar-linked'
      const label = `${event.key} ${event.title}`

      return `
        <div class="timeline-row">
          <div class="row-label">
            <div><strong>${event.url ? `<a href="${esc(event.url)}" target="_blank">${esc(event.key)}</a>` : esc(event.key)}</strong></div>
            <div style="font-size:12px;color:var(--muted)">${esc(event.sprint || '-')}</div>
          </div>
          ${Array.from({ length: days }, () => '<div class="row-day"></div>').join('')}
          <div class="row-track">
            <div class="event-bar ${sourceClass}" style="left:${left}%;width:${width}%" title="${esc(label)}">${esc(label)}</div>
          </div>
        </div>
      `
    })
    .join('')

  document.getElementById('timelineGrid').innerHTML = `
    <div class="timeline-head">
      <div class="time-label"><strong>Item</strong><div style="font-size:11px;color:var(--muted)">${esc(ym)}</div></div>
      ${dayHeaders}
    </div>
    ${rows || '<div class="empty">ไม่พบงานในช่วงเดือนนี้</div>'}
  `

  const manualCount = calendarState.plans.length
  const jiraCount = events.filter((x) => x.source !== 'manual').length
  document.getElementById('calendarSummary').textContent = `เดือน ${ym}: Jira events ${jiraCount} รายการ | Manual plans ${manualCount} รายการ | Source: ${calendarState.source || '-'}`
}

function renderManualList() {
  const list = document.getElementById('manualList')
  if (!calendarState.plans.length) {
    list.innerHTML = '<div class="empty">ยังไม่มีรายการที่บันทึกเพิ่ม</div>'
    return
  }

  list.innerHTML = calendarState.plans
    .map(
      (item) => `
      <div class="item-row">
        <div class="item-top">
          <div><strong>${esc(item.key || '-')}</strong> ${esc(item.title)}</div>
          <div class="badge b-status">${esc(item.start)} - ${esc(item.end)}</div>
        </div>
        <div class="item-meta">Sprint: ${esc(item.sprint || '-')} | Owner: ${esc(item.owner || '-')}</div>
        <div class="item-meta">${esc(item.note || '')}</div>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button class="btn" data-action="edit" data-id="${esc(item.id)}">แก้ไข</button>
          <button class="btn" data-action="delete" data-id="${esc(item.id)}">ลบ</button>
        </div>
      </div>
    `
    )
    .join('')

  list.querySelectorAll('button[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id')
      const item = calendarState.plans.find((x) => x.id === id)
      if (item) setEditMode(item)
    })
  })

  list.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id')
      if (!id) return
      if (!confirm('ยืนยันลบรายการนี้?')) return

      const statusEl = document.getElementById('planStatus')
      statusEl.textContent = 'กำลังลบ...'

      try {
        const response = await fetch('/api/planner', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        })
        const data = await response.json()
        if (data.error) throw new Error(data.error)

        statusEl.textContent = 'ลบเรียบร้อย'
        if (calendarState.editingId === id) setEditMode(null)
        await loadAll()
      } catch (error) {
        statusEl.textContent = `ลบไม่สำเร็จ: ${error.message || error}`
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

  calendarState.dashboard = dashboard
  calendarState.plans = Array.isArray(planner.items) ? planner.items : []
  calendarState.source = planner.source || ''

  const timestamp = new Date(dashboard.generatedAt || Date.now()).toLocaleString('th-TH')
  document.getElementById('calendarSync').textContent = `อัปเดตล่าสุด: ${timestamp}`

  renderManualList()
  renderTimeline()
}

function bindEvents() {
  const picker = document.getElementById('monthPicker')
  const now = new Date()
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  picker.value = ym
  calendarState.month = ym

  picker.addEventListener('change', (e) => {
    calendarState.month = e.target.value || ym
    renderTimeline()
  })

  document.getElementById('refreshTimeline').addEventListener('click', loadAll)
  document.getElementById('cancelEditBtn').addEventListener('click', () => setEditMode(null))

  document.getElementById('planForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const payload = Object.fromEntries(formData.entries())

    if (calendarState.editingId) payload.id = calendarState.editingId

    const statusEl = document.getElementById('planStatus')
    statusEl.textContent = calendarState.editingId ? 'กำลังอัปเดต...' : 'กำลังบันทึก...'

    try {
      const response = await fetch('/api/planner', {
        method: calendarState.editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await response.json()
      if (data.error) throw new Error(data.error)

      statusEl.textContent = calendarState.editingId ? 'อัปเดตเรียบร้อย' : 'บันทึกเรียบร้อย'
      setEditMode(null)
      await loadAll()
    } catch (error) {
      statusEl.textContent = `ไม่สำเร็จ: ${error.message || error}`
    }
  })
}

bindEvents()
loadAll().catch((error) => {
  document.getElementById('timelineGrid').innerHTML = `<div class="empty">โหลดข้อมูลไม่สำเร็จ: ${esc(error.message || error)}</div>`
  document.getElementById('calendarSync').textContent = 'โหลดข้อมูลล้มเหลว'
})
