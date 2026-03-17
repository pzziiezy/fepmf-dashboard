const state = {
  data: null,
  query: ''
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
}

function textBlob(row) {
  return [
    row.parent.key,
    row.parent.summary,
    row.parent.status,
    ...(row.workItems || []).flatMap((x) => [x.key, x.summary, x.status, x.issueType])
  ].join(' ').toLowerCase()
}

function renderKpis(summary) {
  const cards = [
    ['Total FEPMF', summary.totalParents, 'จำนวน parent ทั้งหมด'],
    ['Linked Items', summary.totalLinkedItems, 'รวมทุก child / link'],
    ['Blocked Items', summary.blockedLinkedItems, 'งานที่สถานะ block'],
    ['Average Progress', `${summary.avgProgress || 0}%`, 'ค่าเฉลี่ยภาพรวม'],
    ['No Link Parent', summary.noLinkedItemParents, 'FEPMF ที่ยังไม่ link งาน']
  ]

  document.getElementById('kpis').innerHTML = cards
    .map((c) => `<article class="panel kpi"><div class="kpi-label">${c[0]}</div><div class="kpi-value">${esc(c[1])}</div><div class="kpi-sub">${c[2]}</div></article>`)
    .join('')
}

function renderParents(rows) {
  const host = document.getElementById('content')

  if (!rows.length) {
    host.innerHTML = '<div class="panel empty">ไม่พบรายการที่ตรงกับคำค้นหา</div>'
    return
  }

  host.innerHTML = rows.map((row) => {
    const riskBadges = row.riskFlags?.length
      ? row.riskFlags.map((risk) => `<span class="badge b-risk">${esc(risk)}</span>`).join('')
      : '<span class="badge b-safe">On Track</span>'

    const items = (row.workItems || []).slice(0, 10)

    return `
      <article class="panel parent-card">
        <div class="parent-head">
          <div class="parent-main">
            <a class="parent-key" href="${esc(row.parent.browseUrl)}" target="_blank">${esc(row.parent.key)}</a>
            <div>${esc(row.parent.summary || '-')}</div>
            <div class="progress-line"><div style="width:${Math.max(0, Math.min(100, row.progressPercent || 0))}%"></div></div>
            <div class="progress-meta">
              <span><strong>${esc(row.progressPercent || 0)}%</strong></span>
              <span>Jira field: ${esc(row.progress.jiraPercent ?? '-')}</span>
              <span>Linked completion: ${esc(row.progress.linkedDonePercent ?? '-')}</span>
              <span>Linked items: ${esc(row.linkedCount)}</span>
            </div>
          </div>
          <div class="badges">
            <span class="badge b-status">${esc(row.parent.status || '-')}</span>
            ${riskBadges}
          </div>
        </div>
        <div class="work-items">
          ${items.length ? items.map((item) => `
            <div class="item-row">
              <div class="item-top">
                <div><a class="item-key" href="${esc(item.browseUrl)}" target="_blank">${esc(item.key)}</a> ${esc(item.summary || '')}</div>
                <div class="badge b-status">${esc(item.status || '-')}</div>
              </div>
              <div class="item-meta">Type: ${esc(item.issueType || '-')} | Relation: ${esc(item.relationText || '-')} | Sprint: ${esc(item.sprint || '-')}</div>
            </div>
          `).join('') : '<div class="empty">ยังไม่พบ linked work items</div>'}
        </div>
      </article>
    `
  }).join('')
}

function applyFilters() {
  const query = state.query.trim().toLowerCase()
  const rows = (state.data?.parents || []).filter((row) => !query || textBlob(row).includes(query))
  renderParents(rows)
}

async function load() {
  try {
    const response = await fetch('/api/dashboard')
    const data = await response.json()
    if (data.error) throw new Error(data.error)

    state.data = data
    renderKpis(data.summary || {})
    applyFilters()

    const timestamp = new Date(data.generatedAt || Date.now()).toLocaleString('th-TH')
    document.getElementById('syncTime').textContent = `อัปเดตล่าสุด: ${timestamp}`
  } catch (error) {
    document.getElementById('content').innerHTML = `<div class="panel empty">โหลดข้อมูลไม่สำเร็จ: ${esc(error.message || error)}</div>`
    document.getElementById('syncTime').textContent = 'โหลดข้อมูลล้มเหลว'
  }
}

function bindEvents() {
  document.getElementById('search').addEventListener('input', (e) => {
    state.query = e.target.value || ''
    applyFilters()
  })

  document.getElementById('refreshBtn').addEventListener('click', load)

  document.getElementById('clearBtn').addEventListener('click', () => {
    state.query = ''
    document.getElementById('search').value = ''
    applyFilters()
  })
}

bindEvents()
load()
