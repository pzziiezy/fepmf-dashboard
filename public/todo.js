const TODO_DEFAULT_COLOR = '#2c6e91'

const state = {
  tasks: [],
  plannerItems: [],
  search: '',
  statusFilter: 'open',
  sourceFilter: 'all',
  editingTaskId: '',
  expandedLogUid: '',
  sheetName: 'PlannerTasks'
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
}

function setNotice(el, message, type = 'info') {
  if (!el) return
  el.textContent = message || ''
  el.classList.remove('notice-success', 'notice-error')
  if (type === 'success') el.classList.add('notice-success')
  if (type === 'error') el.classList.add('notice-error')
}

function byId(id) {
  return document.getElementById(id)
}

function normalizeColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || '').trim()) ? String(value).trim() : TODO_DEFAULT_COLOR
}

function normalizeDate(value) {
  const raw = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''
}

function hasTimelineDates(start, end) {
  return Boolean(start && end)
}

function syncColorPreview() {
  const input = byId('todoColorInput')
  const preview = byId('todoColorPreview')
  if (!input || !preview) return
  const color = normalizeColor(input.value)
  input.value = color
  preview.style.background = color
}

function formatThaiDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatThaiDate(value) {
  if (!value) return '-'
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function apiFetch(url, options = {}) {
  return fetch(url, options)
    .then(async (response) => {
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.error) throw new Error(data?.error || 'Request failed')
      return data
    })
}

function getTaskMapByPlannerRef() {
  return new Map(
    state.tasks
      .filter((task) => String(task.sourceType || 'todo') === 'planner' && task.plannerRefId)
      .map((task) => [task.plannerRefId, task])
  )
}

function getCombinedItems() {
  const plannerTaskMap = getTaskMapByPlannerRef()

  let items = [
    ...state.tasks
      .filter((task) => String(task.sourceType || 'todo') === 'todo')
      .map((task) => ({
        uid: `todo:${task.id}`,
        origin: 'todo',
        taskId: task.id,
        key: task.key || '',
        title: task.title || '',
        owner: task.owner || '',
        note: task.note || '',
        logs: Array.isArray(task.logs) ? task.logs : [],
        color: task.color || TODO_DEFAULT_COLOR,
        isDone: Boolean(task.isDone),
        doneAt: task.doneAt || '',
        createdAt: task.createdAt || '',
        updatedAt: task.updatedAt || '',
        start: task.start || '',
        end: task.end || ''
      })),
    ...state.plannerItems.map((planner) => {
      const syncedTask = plannerTaskMap.get(planner.id)
      return {
        uid: `planner:${planner.id}`,
        origin: 'planner',
        taskId: syncedTask?.id || '',
        plannerRefId: planner.id,
        key: planner.key || '',
        title: planner.title || '',
        owner: planner.owner || '',
        note: syncedTask?.note || planner.note || '',
        logs: Array.isArray(syncedTask?.logs) ? syncedTask.logs : [],
        color: syncedTask?.color || planner.color || '#b66a00',
        isDone: Boolean(syncedTask?.isDone),
        doneAt: syncedTask?.doneAt || '',
        createdAt: syncedTask?.createdAt || planner.createdAt || '',
        updatedAt: syncedTask?.updatedAt || planner.updatedAt || '',
        start: planner.start || '',
        end: planner.end || ''
      }
    })
  ]

  const q = state.search.trim().toLowerCase()
  if (q) {
    items = items.filter((item) => [item.key, item.title, item.owner, item.note].join(' ').toLowerCase().includes(q))
  }
  if (state.statusFilter === 'open') items = items.filter((item) => !item.isDone)
  if (state.statusFilter === 'done') items = items.filter((item) => item.isDone)
  if (state.sourceFilter === 'todo') items = items.filter((item) => item.origin === 'todo')
  if (state.sourceFilter === 'planner') items = items.filter((item) => item.origin === 'planner')

  return items.sort((a, b) => {
    if (a.isDone !== b.isDone) return a.isDone ? 1 : -1
    if (a.origin !== b.origin) return a.origin === 'todo' ? -1 : 1
    const aUpdated = String(a.updatedAt || a.createdAt || '')
    const bUpdated = String(b.updatedAt || b.createdAt || '')
    if (aUpdated !== bUpdated) return bUpdated.localeCompare(aUpdated)
    return String(a.title || '').localeCompare(String(b.title || ''))
  })
}

function renderSegmented(hostId, options, currentValue, onChange) {
  const host = byId(hostId)
  host.innerHTML = options.map((option) => `
    <button type="button" class="todo-segment-btn ${option.value === currentValue ? 'active' : ''}" data-value="${esc(option.value)}">${esc(option.label)}</button>
  `).join('')
  host.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => onChange(button.dataset.value || ''))
  })
}

function renderKpis(items) {
  const total = items.length
  const done = items.filter((item) => item.isDone).length
  const open = total - done
  const planner = items.filter((item) => item.origin === 'planner').length
  byId('todoKpis').innerHTML = `
    <article class="kpi todo-kpi"><span class="todo-kpi-label">Total items</span><strong class="todo-kpi-value">${esc(String(total))}</strong></article>
    <article class="kpi todo-kpi"><span class="todo-kpi-label">Open</span><strong class="todo-kpi-value">${esc(String(open))}</strong></article>
    <article class="kpi todo-kpi"><span class="todo-kpi-label">Done</span><strong class="todo-kpi-value">${esc(String(done))}</strong></article>
    <article class="kpi todo-kpi"><span class="todo-kpi-label">From planner</span><strong class="todo-kpi-value">${esc(String(planner))}</strong></article>
  `
}

function hydrateForm(task) {
  const form = byId('todoForm')
  form.title.value = task?.title || ''
  form.key.value = task?.key || ''
  form.start.value = task?.start || ''
  form.end.value = task?.end || ''
  form.owner.value = task?.owner || ''
  form.note.value = task?.note || ''
  form.color.value = normalizeColor(task?.color || TODO_DEFAULT_COLOR)
  syncColorPreview()
  byId('todoCancelBtn').style.display = task ? '' : 'none'
  byId('todoSaveBtn').textContent = task ? 'Update task' : 'Save task'
}

function renderList() {
  const items = getCombinedItems()
  renderKpis(items)
  byId('todoSummary').textContent = `${items.length} items shown | custom ${items.filter((item) => item.origin === 'todo').length} | planner ${items.filter((item) => item.origin === 'planner').length}`

  if (!items.length) {
    byId('todoList').innerHTML = `
      <section class="todo-empty-state">
        <strong>ยังไม่มีรายการ To Do</strong>
        <p>เริ่มจากเพิ่มงานใหม่ทางฝั่งซ้าย หรือสลับตัวกรองเพื่อแสดงงานจาก Planner manual</p>
      </section>
    `
    return
  }

  byId('todoList').innerHTML = items.map((item) => {
    const isChecklist = item.origin === 'todo'
    const accentColor = normalizeColor(item.color || TODO_DEFAULT_COLOR)
    const cardClass = `todo-card ${item.isDone ? 'is-done' : ''} ${isChecklist ? 'todo-card-checklist' : ''}`.trim()
    const cardStyle = isChecklist ? ` style="--todo-accent:${esc(accentColor)}"` : ''
    const rangeText = hasTimelineDates(item.start, item.end)
      ? `${formatThaiDate(item.start)} - ${formatThaiDate(item.end)}`
      : 'No timeline date'
    const meta = item.origin === 'planner'
      ? rangeText
      : `${rangeText} | Updated ${formatThaiDateTime(item.updatedAt || item.createdAt)}`
    const logs = Array.isArray(item.logs) ? item.logs : []
    const isExpanded = state.expandedLogUid === item.uid
    return `
      <article class="${esc(cardClass)}" data-uid="${esc(item.uid)}"${cardStyle}>
        <div class="todo-card-main">
          <label class="todo-check">
            <input type="checkbox" data-role="toggle" ${item.isDone ? 'checked' : ''} />
            <span></span>
          </label>
          <div class="todo-copy">
            <div class="todo-title-row">
              <strong>${esc(item.title)}</strong>
              <span class="badge ${item.origin === 'planner' ? 'status-manual' : 'badge-checklist'}">${esc(item.origin === 'planner' ? 'Planner manual' : 'Checklist')}</span>
              ${item.key ? `<span class="tag">${esc(item.key)}</span>` : ''}
            </div>
            <div class="todo-meta">${esc(meta)} | ${esc(item.owner || '-')}</div>
            <div class="todo-note">${esc(item.note || (item.origin === 'planner' ? 'No extra note' : 'No note'))}</div>
            ${item.isDone && item.doneAt ? `<div class="todo-done-at">Done at ${esc(formatThaiDateTime(item.doneAt))}</div>` : ''}
            <div class="todo-log-summary">${esc(String(logs.length))} update log${logs.length === 1 ? '' : 's'}</div>
            ${isExpanded ? `
              <section class="todo-log-panel">
                <div class="todo-log-list">
                  ${logs.length ? logs.map((entry) => `
                    <article class="todo-log-entry">
                      <div class="todo-log-time">${esc(formatThaiDateTime(entry.createdAt))}</div>
                      <div class="todo-log-message">${esc(entry.message)}</div>
                    </article>
                  `).join('') : '<div class="mini-empty">ยังไม่มี update log สำหรับงานนี้</div>'}
                </div>
                <form class="todo-log-form" data-role="log-form">
                  <textarea name="message" placeholder="บันทึกอัปเดตล่าสุดของงานนี้"></textarea>
                  <div class="todo-log-actions">
                    <button class="btn primary" type="submit">Add update log</button>
                  </div>
                </form>
              </section>
            ` : ''}
          </div>
        </div>
        <div class="todo-card-actions">
          ${item.origin === 'planner'
            ? '<a class="btn" href="/calendar.html" target="_blank" rel="noopener noreferrer">Open planner</a>'
            : '<button class="btn" type="button" data-role="edit">Edit</button><button class="btn" type="button" data-role="delete">Delete</button>'}
          <button class="btn" type="button" data-role="toggle-log">${isExpanded ? 'Hide logs' : 'View logs'}</button>
        </div>
      </article>
    `
  }).join('')

  byId('todoList').querySelectorAll('[data-role="toggle"]').forEach((input) => {
    input.addEventListener('change', async (event) => {
      const card = event.target.closest('.todo-card')
      if (!card) return
      await toggleDone(card.dataset.uid || '', event.target.checked)
    })
  })

  byId('todoList').querySelectorAll('[data-role="edit"]').forEach((button) => {
    button.addEventListener('click', () => {
      const uid = button.closest('.todo-card')?.dataset.uid || ''
      const taskId = uid.replace(/^todo:/, '')
      const task = state.tasks.find((item) => item.id === taskId && String(item.sourceType || 'todo') === 'todo')
      if (!task) return
      state.editingTaskId = task.id
      hydrateForm(task)
      setNotice(byId('todoFormStatus'), 'Editing checklist item...')
    })
  })

  byId('todoList').querySelectorAll('[data-role="delete"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const uid = button.closest('.todo-card')?.dataset.uid || ''
      const taskId = uid.replace(/^todo:/, '')
      if (!taskId) return
      try {
        await apiFetch(`/api/todo?id=${encodeURIComponent(taskId)}`, { method: 'DELETE' })
        if (state.editingTaskId === taskId) resetForm()
        await loadData()
      } catch (error) {
        setNotice(byId('todoSync'), error.message || 'Unable to delete task', 'error')
      }
    })
  })

  byId('todoList').querySelectorAll('[data-role="toggle-log"]').forEach((button) => {
    button.addEventListener('click', () => {
      const uid = button.closest('.todo-card')?.dataset.uid || ''
      state.expandedLogUid = state.expandedLogUid === uid ? '' : uid
      renderList()
    })
  })

  byId('todoList').querySelectorAll('[data-role="log-form"]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      const card = form.closest('.todo-card')
      const uid = card?.dataset.uid || ''
      const message = String(form.message.value || '').trim()
      if (!uid || !message) return
      await saveLog(uid, message)
    })
  })
}

function resetForm() {
  state.editingTaskId = ''
  byId('todoForm').reset()
  byId('todoForm').color.value = TODO_DEFAULT_COLOR
  hydrateForm(null)
  setNotice(byId('todoFormStatus'), '')
}

function renderControls() {
  renderSegmented('todoStatusSwitch', [
    { value: 'all', label: 'All status' },
    { value: 'open', label: 'Open only' },
    { value: 'done', label: 'Done only' }
  ], state.statusFilter, (value) => {
    state.statusFilter = value || 'open'
    renderControls()
    renderList()
  })

  renderSegmented('todoSourceSwitch', [
    { value: 'all', label: 'All sources' },
    { value: 'todo', label: 'My checklist' },
    { value: 'planner', label: 'Planner manual' }
  ], state.sourceFilter, (value) => {
    state.sourceFilter = value || 'all'
    renderControls()
    renderList()
  })
}

async function loadData() {
  setNotice(byId('todoSync'), 'Loading checklist...')
  try {
    const [taskData, plannerData] = await Promise.all([
      apiFetch('/api/todo'),
      apiFetch('/api/planner?entityType=manual')
    ])
    state.tasks = Array.isArray(taskData.items) ? taskData.items : []
    state.plannerItems = Array.isArray(plannerData.items) ? plannerData.items : []
    state.sheetName = taskData.sheetName || 'PlannerTasks'
    byId('todoSheetTag').textContent = `Sheet: ${state.sheetName}`
    setNotice(byId('todoSync'), `Loaded ${state.tasks.length} stored tasks + ${state.plannerItems.length} planner items`, 'success')
    renderList()
  } catch (error) {
    setNotice(byId('todoSync'), error.message || 'Failed to load checklist', 'error')
    byId('todoSummary').textContent = error.message || 'Failed to load checklist'
  }
}

async function syncPlannerTimelineForTodo(task, payload) {
  const start = normalizeDate(payload.start)
  const end = normalizeDate(payload.end)
  const hasDates = hasTimelineDates(start, end)
  const hasPlannerLink = Boolean(task?.plannerRefId)

  if (!hasDates && hasPlannerLink) {
    await apiFetch(`/api/planner?id=${encodeURIComponent(task.plannerRefId)}`, { method: 'DELETE' })
    return { plannerRefId: '', start: '', end: '' }
  }

  if (!hasDates) {
    return { plannerRefId: '', start: '', end: '' }
  }

  const plannerPayload = {
    title: payload.title,
    key: payload.key,
    owner: payload.owner,
    note: payload.note,
    color: payload.color,
    start,
    end,
    entityType: 'manual'
  }

  if (hasPlannerLink) {
    const result = await apiFetch('/api/planner', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...plannerPayload, id: task.plannerRefId })
    })
    return { plannerRefId: result?.item?.id || task.plannerRefId, start, end }
  }

  const created = await apiFetch('/api/planner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plannerPayload)
  })
  return { plannerRefId: created?.item?.id || '', start, end }
}

async function toggleDone(uid, nextChecked) {
  const plannerTaskMap = getTaskMapByPlannerRef()
  const taskMatch = uid.startsWith('todo:')
    ? state.tasks.find((task) => task.id === uid.replace(/^todo:/, ''))
    : plannerTaskMap.get(uid.replace(/^planner:/, ''))

  const plannerItem = uid.startsWith('planner:')
    ? state.plannerItems.find((item) => item.id === uid.replace(/^planner:/, ''))
    : null

  try {
    if (taskMatch) {
      await apiFetch('/api/todo', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: taskMatch.id,
          isDone: nextChecked,
          doneAt: nextChecked ? new Date().toISOString() : ''
        })
      })
    } else if (plannerItem) {
      await apiFetch('/api/todo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plannerRefId: plannerItem.id,
          sourceType: 'planner',
          title: plannerItem.title || '',
          key: plannerItem.key || '',
          owner: plannerItem.owner || '',
          note: plannerItem.note || '',
          color: plannerItem.color || '#b66a00',
          start: plannerItem.start || '',
          end: plannerItem.end || '',
          isDone: nextChecked,
          doneAt: nextChecked ? new Date().toISOString() : ''
        })
      })
    }
    await loadData()
  } catch (error) {
    setNotice(byId('todoSync'), error.message || 'Unable to update task status', 'error')
  }
}

async function saveLog(uid, message) {
  const plannerTaskMap = getTaskMapByPlannerRef()
  const taskMatch = uid.startsWith('todo:')
    ? state.tasks.find((task) => task.id === uid.replace(/^todo:/, ''))
    : plannerTaskMap.get(uid.replace(/^planner:/, ''))

  const plannerItem = uid.startsWith('planner:')
    ? state.plannerItems.find((item) => item.id === uid.replace(/^planner:/, ''))
    : null

  const nextLog = {
    message,
    createdAt: new Date().toISOString()
  }

  try {
    setNotice(byId('todoSync'), 'Saving update log...')
    if (taskMatch) {
      await apiFetch('/api/todo', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: taskMatch.id,
          logs: [...(Array.isArray(taskMatch.logs) ? taskMatch.logs : []), nextLog]
        })
      })
    } else if (plannerItem) {
      await apiFetch('/api/todo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plannerRefId: plannerItem.id,
          sourceType: 'planner',
          title: plannerItem.title || '',
          key: plannerItem.key || '',
          owner: plannerItem.owner || '',
          note: plannerItem.note || '',
          color: plannerItem.color || '#b66a00',
          start: plannerItem.start || '',
          end: plannerItem.end || '',
          isDone: false,
          logs: [nextLog]
        })
      })
    }
    await loadData()
    state.expandedLogUid = uid
    renderList()
    setNotice(byId('todoSync'), 'Update log saved', 'success')
  } catch (error) {
    setNotice(byId('todoSync'), error.message || 'Unable to save update log', 'error')
  }
}

function bindEvents() {
  byId('todoColorPreview').addEventListener('click', () => {
    byId('todoColorInput')?.click()
  })
  byId('todoColorInput').addEventListener('input', syncColorPreview)
  syncColorPreview()

  byId('todoSearch').addEventListener('input', (event) => {
    state.search = event.target.value || ''
    renderList()
  })

  byId('todoForm').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const payload = {
      title: String(form.title.value || '').trim(),
      key: String(form.key.value || '').trim(),
      start: normalizeDate(form.start.value || ''),
      end: normalizeDate(form.end.value || ''),
      owner: String(form.owner.value || '').trim(),
      note: String(form.note.value || '').trim(),
      color: normalizeColor(form.color.value || TODO_DEFAULT_COLOR),
      sourceType: 'todo'
    }

    if (!payload.title) {
      setNotice(byId('todoFormStatus'), 'Task title is required', 'error')
      return
    }
    if ((payload.start && !payload.end) || (!payload.start && payload.end)) {
      setNotice(byId('todoFormStatus'), 'If set timeline, both Start and End are required', 'error')
      return
    }
    if (payload.start && payload.end && payload.end < payload.start) {
      setNotice(byId('todoFormStatus'), 'End date must be on or after Start date', 'error')
      return
    }

    try {
      setNotice(byId('todoFormStatus'), state.editingTaskId ? 'Updating task...' : 'Saving task...')
      const editingTask = state.editingTaskId
        ? state.tasks.find((task) => task.id === state.editingTaskId)
        : null
      const plannerSync = await syncPlannerTimelineForTodo(editingTask, payload)
      const syncedPayload = {
        ...payload,
        plannerRefId: plannerSync.plannerRefId || ''
      }
      if (state.editingTaskId) {
        await apiFetch('/api/todo', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...syncedPayload, id: state.editingTaskId })
        })
      } else {
        await apiFetch('/api/todo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(syncedPayload)
        })
      }
      await loadData()
      resetForm()
      setNotice(byId('todoFormStatus'), 'Checklist item saved', 'success')
    } catch (error) {
      setNotice(byId('todoFormStatus'), error.message || 'Unable to save task', 'error')
    }
  })

  byId('todoCancelBtn').addEventListener('click', resetForm)
}

bindEvents()
renderControls()
loadData()
