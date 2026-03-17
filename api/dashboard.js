export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const EMAIL = process.env.JIRA_EMAIL
  const TOKEN = process.env.JIRA_API_TOKEN
  const BASE = process.env.JIRA_BASE_URL || 'https://dgtbigc.atlassian.net/rest/api/3'

  if (!EMAIL || !TOKEN) {
    return res.status(500).json({ error: 'Missing env vars: JIRA_EMAIL or JIRA_API_TOKEN' })
  }

  const auth = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }

  const KNOWN_SQUADS = ['KEPLER', 'MIDAS', 'NEBULA']
  const STATUS_ORDER = ['Open', 'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'Cancelled']

  function lower(v) {
    return String(v || '').toLowerCase()
  }

  function uniq(arr) {
    return [...new Set((arr || []).filter(Boolean))]
  }

  function quoteValues(values) {
    return (values || []).map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(',')
  }

  function normalizeFieldName(v) {
    return lower(v).replace(/[^a-z0-9]+/g, ' ').trim()
  }

  function exactFieldIds(fields, names) {
    const wanted = new Set((names || []).map(normalizeFieldName))
    return (fields || []).filter((f) => wanted.has(normalizeFieldName(f?.name))).map((f) => f.id)
  }

  function fuzzyFieldIds(fields, snippets) {
    return (fields || [])
      .filter((f) => {
        const name = normalizeFieldName(f?.name)
        const id = normalizeFieldName(f?.id)
        return (snippets || []).some((s) => name.includes(s) || id.includes(s))
      })
      .map((f) => f.id)
  }

  function parseNumberLike(v) {
    if (v == null) return null
    if (typeof v === 'number') return v
    if (typeof v === 'string') {
      const m = v.match(/-?\d+(?:\.\d+)?/)
      return m ? Number(m[0]) : null
    }
    return null
  }

  function extractPercent(v) {
    if (v == null) return null
    if (typeof v === 'number') {
      if (v >= 0 && v <= 1) return Math.round(v * 100)
      if (v >= 0 && v <= 100) return Math.round(v)
      return null
    }

    if (typeof v === 'string') {
      const n = parseNumberLike(v)
      if (n == null) return null
      if (v.includes('%')) return Math.round(n)
      if (n >= 0 && n <= 1) return Math.round(n * 100)
      if (n >= 0 && n <= 100) return Math.round(n)
      return null
    }

    if (Array.isArray(v)) {
      for (const item of v) {
        const p = extractPercent(item)
        if (p != null) return p
      }
      return null
    }

    if (typeof v === 'object') {
      for (const key of ['percent', 'percentage', 'progress', 'value', 'done', 'completed']) {
        if (key in v) {
          const p = extractPercent(v[key])
          if (p != null) return p
        }
      }
      if (v.total != null && v.done != null) {
        const total = parseNumberLike(v.total)
        const done = parseNumberLike(v.done)
        if (total && done != null) return Math.round((done / total) * 100)
      }
    }

    return null
  }

  function getFieldValues(issue, fieldIds = []) {
    return (fieldIds || []).map((id) => issue?.fields?.[id]).filter((v) => v != null && v !== '')
  }

  function parseIssueKeysFromValue(value) {
    const keys = []

    function walk(v) {
      if (v == null) return

      if (typeof v === 'string') {
        const matches = v.match(/[A-Z][A-Z0-9_]+-\d+/g)
        if (matches) keys.push(...matches)
        return
      }

      if (Array.isArray(v)) {
        for (const item of v) walk(item)
        return
      }

      if (typeof v === 'object') {
        if (typeof v.key === 'string' && /^[A-Z][A-Z0-9_]+-\d+$/.test(v.key)) keys.push(v.key)
        for (const item of Object.values(v)) walk(item)
      }
    }

    walk(value)
    return uniq(keys.map((k) => String(k).toUpperCase()))
  }

  function readParentRefKey(value) {
    if (value == null) return ''

    if (typeof value === 'string') {
      const m = value.match(/FEPMF-\d+/i)
      return m ? m[0].toUpperCase() : ''
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const key = readParentRefKey(item)
        if (key) return key
      }
      return ''
    }

    if (typeof value === 'object') {
      if (typeof value.key === 'string' && /^FEPMF-\d+$/i.test(value.key)) return value.key.toUpperCase()
      for (const item of Object.values(value)) {
        const key = readParentRefKey(item)
        if (key) return key
      }
    }

    return ''
  }

  function toIsoDate(value) {
    if (!value) return ''
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return ''
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }

  function findSprintCandidates(value) {
    const out = []

    function walk(v) {
      if (v == null) return

      if (typeof v === 'string') {
        const matches = v.match(/Sprint\s*\d+/gi)
        if (matches) {
          for (const name of matches) out.push({ name: name.replace(/\s+/g, ''), raw: null })
        }
        return
      }

      if (Array.isArray(v)) {
        for (const item of v) walk(item)
        return
      }

      if (typeof v === 'object') {
        const name = v.name || v.value || v.displayName || null
        if (typeof name === 'string' && /sprint/i.test(name)) {
          out.push({
            name: name.replace(/\s+/g, ''),
            raw: {
              startDate: v.startDate || v.startdate || null,
              endDate: v.endDate || v.enddate || null
            }
          })
        }
        for (const item of Object.values(v)) walk(item)
      }
    }

    walk(value)
    return out
  }

  function parseSprintFromIssue(issue, sprintFieldIds = []) {
    const rows = []
    for (const id of sprintFieldIds) rows.push(...findSprintCandidates(issue?.fields?.[id]))
    rows.push(...findSprintCandidates(issue?.fields?.sprint))

    if (!rows.length) return { name: '', start: '', end: '' }

    const first = rows[0]
    return {
      name: first.name || '',
      start: toIsoDate(first.raw?.startDate),
      end: toIsoDate(first.raw?.endDate)
    }
  }

  function upperText(v) {
    if (v == null) return ''
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v).toUpperCase()
    if (Array.isArray(v)) return v.map(upperText).join(' | ')
    if (typeof v === 'object') return Object.values(v).map(upperText).join(' | ')
    return ''
  }

  function inferSquad(issue, squadFieldIds = []) {
    for (const value of getFieldValues(issue, squadFieldIds)) {
      const text = upperText(value)
      const found = KNOWN_SQUADS.find((x) => text.includes(x))
      if (found) return found
    }

    const fallbackValues = [issue?.fields?.labels, issue?.fields?.components?.map((c) => c?.name), issue?.fields?.summary]
    for (const value of fallbackValues) {
      const text = upperText(value)
      const found = KNOWN_SQUADS.find((x) => text.includes(x))
      if (found) return found
    }

    return ''
  }

  function normalizeMainStatus(status) {
    const text = String(status || '').trim()
    if (!text) return 'Open'

    const sMatch = text.match(/\bS\s*([0-7])\b/i)
    if (sMatch) return `S${sMatch[1]}`

    if (/open/i.test(text)) return 'Open'
    if (/cancel/i.test(text)) return 'Cancelled'

    return text
  }

  function getStatus(issue) {
    return issue?.fields?.status?.name || ''
  }

  function isDoneIssue(issue) {
    const status = normalizeMainStatus(getStatus(issue))
    const statusCategory = lower(issue?.fields?.status?.statusCategory?.key)
    if (statusCategory === 'done') return true
    if (status === 'S7') return true

    const s = lower(getStatus(issue))
    if (s.includes('done') || s.includes('complete') || s.includes('closed') || s.includes('resolved') || s.includes('delivered')) return true
    if (s.includes('cancel')) return true
    return false
  }

  function getProgressFromIssue(issue, progressFieldIds = []) {
    const candidates = [
      issue?.fields?.progress,
      issue?.fields?.aggregateprogress,
      ...getFieldValues(issue, progressFieldIds)
    ]

    for (const value of candidates) {
      const percent = extractPercent(value)
      if (percent != null) return Math.max(0, Math.min(100, percent))
    }

    return null
  }

  function getEstimateSprint(issue, estimateSprintFieldIds = []) {
    for (const value of getFieldValues(issue, estimateSprintFieldIds)) {
      const text = String(Array.isArray(value) ? value[0] : value || '').trim()
      if (!text) continue
      const m = text.match(/\d+/)
      if (m) return `Sprint${m[0]}`
      return text
    }

    const fromSprint = parseSprintFromIssue(issue, [])
    return fromSprint.name || ''
  }

  function normalizeIssue(issue, cfg) {
    const sprint = parseSprintFromIssue(issue, cfg.sprintFieldIds)
    const statusRaw = getStatus(issue)
    return {
      id: issue?.id || '',
      key: issue?.key || '',
      browseUrl: issue?.key ? `https://dgtbigc.atlassian.net/browse/${issue.key}` : '',
      summary: issue?.fields?.summary || '',
      issueType: issue?.fields?.issuetype?.name || '',
      assignee: issue?.fields?.assignee?.displayName || '',
      statusRaw,
      status: normalizeMainStatus(statusRaw),
      statusCategory: issue?.fields?.status?.statusCategory?.key || '',
      projectKey: issue?.fields?.project?.key || '',
      dueDate: issue?.fields?.duedate || '',
      created: issue?.fields?.created || '',
      sprint: sprint.name,
      sprintStart: sprint.start,
      sprintEnd: sprint.end,
      squad: inferSquad(issue, cfg.squadFieldIds),
      estimateSprint: getEstimateSprint(issue, cfg.estimateSprintFieldIds),
      progressFieldPercent: getProgressFromIssue(issue, cfg.progressFieldIds)
    }
  }

  function extractRelations(issue, childFieldIds = [], linkedFieldIds = []) {
    const records = []

    for (const sub of issue?.fields?.subtasks || []) {
      if (!sub?.key) continue
      records.push({ key: String(sub.key).toUpperCase() })
    }

    for (const link of issue?.fields?.issuelinks || []) {
      if (link?.outwardIssue?.key) records.push({ key: String(link.outwardIssue.key).toUpperCase() })
      if (link?.inwardIssue?.key) records.push({ key: String(link.inwardIssue.key).toUpperCase() })
    }

    for (const fieldId of childFieldIds) {
      for (const key of parseIssueKeysFromValue(issue?.fields?.[fieldId])) records.push({ key })
    }

    for (const fieldId of linkedFieldIds) {
      for (const key of parseIssueKeysFromValue(issue?.fields?.[fieldId])) records.push({ key })
    }

    return uniq(records.map((x) => x.key)).map((key) => ({ key }))
  }

  function keyNumber(key) {
    const m = String(key || '').match(/-(\d+)/)
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
  }

  function sortChildren(items) {
    return [...(items || [])].sort((a, b) => keyNumber(a.key) - keyNumber(b.key))
  }

  function statusSort(arr) {
    const rank = new Map(STATUS_ORDER.map((x, i) => [x, i]))
    return [...(arr || [])].sort((a, b) => {
      const ra = rank.has(a) ? rank.get(a) : 100
      const rb = rank.has(b) ? rank.get(b) : 100
      if (ra !== rb) return ra - rb
      return String(a).localeCompare(String(b))
    })
  }

  function buildSprintCalendar2026() {
    const rows = []
    let sprint = 4
    let start = new Date(Date.UTC(2026, 2, 9))

    while (start.getUTCFullYear() === 2026) {
      const end = new Date(start.getTime())
      end.setUTCDate(end.getUTCDate() + 18)

      rows.push({
        sprint: sprint,
        name: `Sprint${sprint}`,
        start: toIsoDate(start),
        end: toIsoDate(end)
      })

      sprint += 1
      start = new Date(start.getTime())
      start.setUTCDate(start.getUTCDate() + 21)
    }

    return rows
  }

  function workingDaysRemaining(startIso, endIso) {
    if (!startIso || !endIso) return 0
    const start = new Date(`${startIso}T00:00:00Z`)
    const end = new Date(`${endIso}T00:00:00Z`)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0

    let count = 0
    const cur = new Date(start.getTime())
    while (cur <= end) {
      const day = cur.getUTCDay()
      if (day !== 0 && day !== 6) count += 1
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    return count
  }

  async function fetchJira(path, options = {}) {
    const response = await fetch(`${BASE}${path}`, { headers, ...options })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Jira ${response.status}: ${response.statusText} | ${text}`)
    }
    return response.json()
  }

  async function fetchAllByJql(jql, fields = []) {
    let nextPageToken
    let guard = 0
    let all = []

    while (true) {
      const body = { jql, fields, maxResults: 100 }
      if (nextPageToken) body.nextPageToken = nextPageToken
      const page = await fetchJira('/search/jql', { method: 'POST', body: JSON.stringify(body) })
      const issues = page.issues || []
      all = all.concat(issues)
      nextPageToken = page.nextPageToken
      guard += 1
      if (!issues.length || page.isLast || !nextPageToken || guard > 120) break
    }

    return all
  }

  async function fetchIssuesByKeys(keys, fields = []) {
    const output = []
    const uniqueKeys = uniq((keys || []).map((x) => String(x).toUpperCase()))

    for (let i = 0; i < uniqueKeys.length; i += 50) {
      const batch = uniqueKeys.slice(i, i + 50)
      if (!batch.length) continue
      const jql = `key in (${quoteValues(batch)}) ORDER BY updated DESC`
      const issues = await fetchAllByJql(jql, fields)
      output.push(...issues)
    }

    return output
  }

  try {
    const fieldCatalog = await fetchJira('/field')

    const sprintFieldIds = uniq([
      ...exactFieldIds(fieldCatalog, ['Sprint']),
      ...fuzzyFieldIds(fieldCatalog, ['sprint']).slice(0, 8)
    ])

    const progressFieldIds = uniq([
      ...exactFieldIds(fieldCatalog, ['Progress', 'Project Progress', '% Progress', 'Percent Progress', 'Actual Progress']),
      ...fuzzyFieldIds(fieldCatalog, ['progress', 'percent']).slice(0, 12)
    ])

    const squadFieldIds = uniq([
      ...exactFieldIds(fieldCatalog, ['Squad', 'Team']),
      ...fuzzyFieldIds(fieldCatalog, ['squad', 'team']).slice(0, 6)
    ])

    const estimateSprintFieldIds = uniq([
      ...exactFieldIds(fieldCatalog, ['Estimate Sprint', 'Estimated Sprint']),
      ...fuzzyFieldIds(fieldCatalog, ['estimate sprint']).slice(0, 5)
    ])

    const childFieldIds = uniq([
      ...exactFieldIds(fieldCatalog, ['Child work items', 'Child work item']),
      ...fuzzyFieldIds(fieldCatalog, ['child work item']).slice(0, 6)
    ])

    const linkedFieldIds = uniq([
      ...exactFieldIds(fieldCatalog, ['Linked work items', 'Linked work item']),
      ...fuzzyFieldIds(fieldCatalog, ['linked work item']).slice(0, 6)
    ])

    const parentRefFieldIds = uniq([
      ...exactFieldIds(fieldCatalog, ['Parent Link', 'Parent work item', 'Initiative Link', 'Epic Link', 'Feature Link']),
      ...fuzzyFieldIds(fieldCatalog, ['parent link', 'initiative link', 'epic link']).slice(0, 8)
    ])

    const baseFields = uniq([
      'summary',
      'status',
      'assignee',
      'issuetype',
      'project',
      'duedate',
      'created',
      'subtasks',
      'issuelinks',
      'labels',
      'components',
      'progress',
      'aggregateprogress',
      ...sprintFieldIds,
      ...progressFieldIds,
      ...squadFieldIds,
      ...estimateSprintFieldIds,
      ...childFieldIds,
      ...linkedFieldIds,
      ...parentRefFieldIds
    ])

    const cfg = { sprintFieldIds, progressFieldIds, squadFieldIds, estimateSprintFieldIds }

    const parentsRaw = await fetchAllByJql('project = FEPMF ORDER BY updated DESC', baseFields)
    const parentKeys = parentsRaw.map((x) => x.key)

    const relationMap = new Map()
    const relatedKeySet = new Set()

    for (const parentRaw of parentsRaw) {
      const rels = extractRelations(parentRaw, childFieldIds, linkedFieldIds)
      relationMap.set(parentRaw.key, rels)
      for (const rel of rels) relatedKeySet.add(rel.key)
    }

    for (const fieldId of parentRefFieldIds) {
      const cfId = fieldId.startsWith('customfield_') ? fieldId.replace('customfield_', '') : null
      if (!cfId) continue

      for (let i = 0; i < parentKeys.length; i += 20) {
        const batch = parentKeys.slice(i, i + 20)
        if (!batch.length) continue

        const jql = `cf[${cfId}] in (${quoteValues(batch)}) ORDER BY updated DESC`
        const hits = await fetchAllByJql(jql, baseFields)

        for (const hit of hits) {
          const parentKey = readParentRefKey(hit?.fields?.[fieldId])
          if (!parentKey) continue

          const current = relationMap.get(parentKey) || []
          current.push({ key: String(hit.key).toUpperCase() })
          relationMap.set(parentKey, current)
          relatedKeySet.add(String(hit.key).toUpperCase())
        }
      }
    }

    const relatedRaw = relatedKeySet.size ? await fetchIssuesByKeys([...relatedKeySet], baseFields) : []

    const rawMap = new Map()
    for (const row of parentsRaw) rawMap.set(row.key, row)
    for (const row of relatedRaw) rawMap.set(row.key, row)

    const normalized = new Map()
    for (const issue of rawMap.values()) normalized.set(issue.key, normalizeIssue(issue, cfg))

    const parents = parentsRaw.map((parentRaw) => {
      const parent = normalized.get(parentRaw.key)
      const keys = uniq((relationMap.get(parent.key) || []).map((x) => x.key))

      const children = sortChildren(
        keys
          .map((key) => normalized.get(key))
          .filter(Boolean)
          .map((item) => ({ ...item }))
      )

      const doneCount = children.filter((item) => {
        const raw = rawMap.get(item.key)
        return raw ? isDoneIssue(raw) : item.status === 'S7'
      }).length

      const linkedProgress = children.length ? Math.round((doneCount / children.length) * 100) : (isDoneIssue(parentRaw) ? 100 : 0)

      const jiraProgress = parent.progressFieldPercent
      const progressPercent = jiraProgress != null ? jiraProgress : linkedProgress

      return {
        parent: {
          ...parent,
          cabDate: parent.dueDate || ''
        },
        linkedCount: children.length,
        progressPercent,
        progress: {
          source: jiraProgress != null ? 'jira_field' : 'linked_completion',
          jiraPercent: jiraProgress,
          linkedDonePercent: linkedProgress,
          doneLinked: doneCount,
          totalLinked: children.length
        },
        workItems: children
      }
    })

    const sprintCalendar = buildSprintCalendar2026()
    const today = toIsoDate(new Date())
    const currentSprint = sprintCalendar.find((x) => x.start <= today && today <= x.end) || null
    const workingDaysLeft = currentSprint ? workingDaysRemaining(today, currentSprint.end) : 0

    const timelineItems = parents
      .map((row) => {
        const sprintNum = parseNumberLike(row.parent.estimateSprint || row.parent.sprint || '')
        const sprintMatch = sprintNum ? sprintCalendar.find((x) => x.sprint === sprintNum) : null

        let start = sprintMatch?.start || row.parent.sprintStart || row.parent.created?.slice(0, 10) || ''
        let end = sprintMatch?.end || row.parent.dueDate || row.parent.sprintEnd || start
        if (!start) return null
        if (!end) end = start

        return {
          key: row.parent.key,
          summary: row.parent.summary,
          squad: row.parent.squad,
          status: row.parent.status,
          start,
          end,
          browseUrl: row.parent.browseUrl,
          source: 'parent'
        }
      })
      .filter(Boolean)

    const summary = {
      totalParents: parents.length,
      totalLinkedItems: uniq(parents.flatMap((x) => x.workItems.map((w) => w.key))).length,
      avgProgress: parents.length ? Math.round(parents.reduce((sum, x) => sum + x.progressPercent, 0) / parents.length) : 0,
      noLinkedItemParents: parents.filter((x) => x.linkedCount === 0).length,
      currentSprint: currentSprint ? currentSprint.sprint : null,
      currentSprintName: currentSprint ? currentSprint.name : '-',
      currentSprintStart: currentSprint ? currentSprint.start : '',
      currentSprintEnd: currentSprint ? currentSprint.end : '',
      workingDaysRemaining: workingDaysLeft
    }

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      summary,
      sprintCalendar,
      timelineItems,
      meta: {
        statusOrder: STATUS_ORDER,
        available: {
          statuses: statusSort(uniq(parents.map((x) => x.parent.status))),
          squads: uniq(parents.map((x) => x.parent.squad)).filter((x) => KNOWN_SQUADS.includes(x)),
          cabDates: uniq(parents.map((x) => x.parent.cabDate)).filter(Boolean).sort()
        }
      },
      parents
    })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unknown error' })
  }
}
