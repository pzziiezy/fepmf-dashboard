
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const EMAIL = process.env.JIRA_EMAIL
  const TOKEN = process.env.JIRA_API_TOKEN
  const BASE = 'https://dgtbigc.atlassian.net/rest/api/3'

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

  async function fetchJira(path, options = {}) {
    const r = await fetch(`${BASE}${path}`, { headers, ...options })
    if (!r.ok) {
      const text = await r.text()
      throw new Error(`Jira ${r.status}: ${r.statusText} | ${text}`)
    }
    return r.json()
  }

  async function fetchAllByJql(jql, fields = [], extra = {}) {
    let start = 0
    let all = []

    while (true) {
      const body = {
        jql,
        startAt: start,
        maxResults: 100,
        fields
      }
      if (extra.expand) body.expand = extra.expand
      if (extra.fieldsByKeys) body.fieldsByKeys = true

      const d = await fetchJira('/search', { method: 'POST', body: JSON.stringify(body) })
      const issues = d.issues || []
      all = all.concat(issues)
      if (!issues.length || all.length >= (d.total || 0)) break
      start += 100
      if (start > 5000) break
    }
    return all
  }

  async function fetchIssuesByKeys(keys, fields = []) {
    const uniqKeys = uniq(keys)
    const out = []
    for (let i = 0; i < uniqKeys.length; i += 50) {
      const batch = uniqKeys.slice(i, i + 50)
      if (!batch.length) continue
      const jql = `key in (${quoteValues(batch)}) ORDER BY updated DESC`
      const rows = await fetchAllByJql(jql, fields)
      out.push(...rows)
    }
    return out
  }

  function lower(v) { return String(v || '').toLowerCase() }
  function uniq(arr) { return [...new Set((arr || []).filter(Boolean))] }
  function uniqByKey(arr) {
    const map = new Map()
    for (const x of arr || []) {
      if (x?.key) map.set(x.key, x)
    }
    return [...map.values()]
  }
  function quoteValues(values) { return values.map(v => `"${String(v).replace(/"/g, '\\"')}"`).join(',') }
  function daysSince(iso) {
    if (!iso) return null
    const t = new Date(iso).getTime()
    if (!t) return null
    return Math.floor((Date.now() - t) / 86400000)
  }
  function pickText(v) {
    if (v == null) return ''
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (Array.isArray(v)) return v.map(pickText).filter(Boolean).join(', ')
    if (typeof v === 'object') {
      if (v.displayName) return String(v.displayName)
      if (v.name) return String(v.name)
      if (v.value) return String(v.value)
      if (v.key) return String(v.key)
      if (v.id) return String(v.id)
    }
    return ''
  }
  function normalizeFieldName(v) { return lower(v).replace(/[^a-z0-9]+/g, ' ').trim() }
  function exactFieldIds(fields, names) {
    const wanted = new Set(names.map(normalizeFieldName))
    return fields.filter(f => wanted.has(normalizeFieldName(f.name))).map(f => f.id)
  }
  function fuzzyFieldIds(fields, snippets) {
    return fields.filter(f => {
      const name = normalizeFieldName(f.name)
      const id = normalizeFieldName(f.id)
      return snippets.some(s => name.includes(s) || id.includes(s))
    }).map(f => f.id)
  }
  function getStatusName(issue) { return issue?.fields?.status?.name || '' }
  function getIssueTypeName(issue) { return issue?.fields?.issuetype?.name || '' }
  function getAssigneeName(issue) { return issue?.fields?.assignee?.displayName || '' }
  function getProjectKey(issue) { return issue?.fields?.project?.key || '' }
  function getAttachments(issue) {
    return (issue?.fields?.attachment || []).map(x => ({ id: x.id, filename: x.filename, mimeType: x.mimeType, size: x.size, content: x.content }))
  }
  function groupStatus(status) {
    const s = lower(status)
    if (!s) return 'other'
    if (s.includes('block')) return 'blocked'
    if (s.includes('done') || s.includes('closed') || s.includes('complete') || s.includes('resolved') || s.includes('deploy') || s.includes('deliver')) return 'done'
    if (s.includes('uat')) return 'uat'
    if (s.includes('sit')) return 'sit'
    if (s.includes('test') || s.includes('qa')) return 'test'
    if (s.includes('progress') || s.includes('implement') || s.includes('develop') || s.includes('doing') || s.includes('review') || s.includes('coding')) return 'in_progress'
    if (s.includes('open') || s.includes('to do') || s.includes('todo') || s.includes('plan') || s.includes('backlog') || s.includes('selected') || s.includes('ready')) return 'open'
    return 'other'
  }
  function isDoneStatus(status) { return groupStatus(status) === 'done' }
  function formatDateISO(v) {
    if (!v) return ''
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return ''
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  function formatDateHuman(v) {
    if (!v) return ''
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
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
      for (const key of ['percent', 'percentage', 'progress', 'done', 'completed', 'value']) {
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
      if (v.progress && typeof v.progress === 'object') {
        const p = extractPercent(v.progress)
        if (p != null) return p
      }
    }
    return null
  }
  function getFieldValues(issue, fieldIds = []) { return fieldIds.map(id => issue?.fields?.[id]).filter(v => v != null && v !== '') }
  function getDueDate(issue) { return issue?.fields?.duedate || '' }
  function parseSprintNamesFromValue(value) {
    const out = []
    function walk(v) {
      if (v == null) return
      if (typeof v === 'string') {
        const matches = v.match(/Sprint\s*\d+/gi)
        if (matches) out.push(...matches.map(x => x.replace(/\s+/g, '')))
        return
      }
      if (Array.isArray(v)) { for (const item of v) walk(item); return }
      if (typeof v === 'object') {
        for (const key of ['name', 'value', 'displayName', 'state']) if (typeof v[key] === 'string') walk(v[key])
        for (const key of Object.keys(v)) walk(v[key])
      }
    }
    walk(value)
    return uniq(out)
  }
  function findSprint(issue, sprintFieldIds = []) {
    const candidates = []
    for (const value of getFieldValues(issue, sprintFieldIds)) candidates.push(...parseSprintNamesFromValue(value))
    candidates.push(...parseSprintNamesFromValue(issue?.fields?.sprint || issue?.fields?.Sprint))
    return candidates[0] || ''
  }
  function upperText(v) {
    if (v == null) return ''
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v).toUpperCase()
    if (Array.isArray(v)) return v.map(upperText).join(' | ')
    if (typeof v === 'object') return Object.values(v).map(upperText).join(' | ')
    return ''
  }
  function parseSquadFromValue(value) {
    const text = upperText(value)
    return KNOWN_SQUADS.find(s => text.includes(s)) || ''
  }
  function inferSquad(issue, squadFieldIds = []) {
    for (const value of getFieldValues(issue, squadFieldIds)) {
      const s = parseSquadFromValue(value)
      if (s) return s
    }
    const explicit = [issue?.fields?.labels, (issue?.fields?.components || []).map(c => c?.name), issue?.fields?.summary, issue?.fields?.description]
    for (const value of explicit) {
      const s = parseSquadFromValue(value)
      if (s) return s
    }
    return ''
  }
  function readParentRefKey(value) {
    if (value == null) return ''
    if (typeof value === 'string') {
      const m = value.match(/FEPMF-\d+/i)
      return m ? m[0].toUpperCase() : ''
    }
    if (Array.isArray(value)) {
      for (const item of value) { const k = readParentRefKey(item); if (k) return k }
      return ''
    }
    if (typeof value === 'object') {
      if (typeof value.key === 'string' && /^FEPMF-\d+$/i.test(value.key)) return value.key.toUpperCase()
      for (const item of Object.values(value)) { const k = readParentRefKey(item); if (k) return k }
    }
    return ''
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
      if (Array.isArray(v)) { for (const item of v) walk(item); return }
      if (typeof v === 'object') {
        if (typeof v.key === 'string' && /^[A-Z][A-Z0-9_]+-\d+$/.test(v.key)) keys.push(v.key)
        for (const item of Object.values(v)) walk(item)
      }
    }
    walk(value)
    return uniq(keys)
  }
  function getParentProgress(issue, progressFieldIds = []) {
    const directCandidates = [issue?.fields?.progress, ...getFieldValues(issue, progressFieldIds)]
    for (const v of directCandidates) {
      const p = extractPercent(v)
      if (p != null) return p
    }
    return null
  }
  function normalizeIssue(issue, cfg) {
    return {
      id: issue.id,
      key: issue.key,
      self: issue.self,
      browseUrl: `https://dgtbigc.atlassian.net/browse/${issue.key}`,
      summary: issue?.fields?.summary || '',
      status: getStatusName(issue),
      statusGroup: groupStatus(getStatusName(issue)),
      issueType: getIssueTypeName(issue),
      assignee: getAssigneeName(issue),
      projectKey: getProjectKey(issue),
      created: issue?.fields?.created || '',
      updated: issue?.fields?.updated || '',
      updatedDaysAgo: daysSince(issue?.fields?.updated || ''),
      sprint: findSprint(issue, cfg.sprintFieldIds),
      squad: inferSquad(issue, cfg.squadFieldIds),
      attachments: getAttachments(issue),
      attachmentCount: (issue?.fields?.attachment || []).length,
      parentKey: issue?.fields?.parent?.key || '',
      dueDate: getDueDate(issue),
      dueDateIso: formatDateISO(getDueDate(issue)),
      progressFieldPercent: getParentProgress(issue, cfg.progressFieldIds)
    }
  }
  function extractLinkRecords(issue, childFieldIds = [], linkedFieldIds = []) {
    const records = []
    for (const st of issue?.fields?.subtasks || []) {
      if (!st?.key) continue
      records.push({ key: st.key, relationType: 'subtask', relationLabel: 'subtask', direction: 'child' })
    }
    for (const link of issue?.fields?.issuelinks || []) {
      const typeName = link?.type?.name || ''
      const inwardLabel = link?.type?.inward || ''
      const outwardLabel = link?.type?.outward || ''
      if (link?.outwardIssue?.key) records.push({ key: link.outwardIssue.key, relationType: typeName, relationLabel: outwardLabel, direction: 'outward' })
      if (link?.inwardIssue?.key) records.push({ key: link.inwardIssue.key, relationType: typeName, relationLabel: inwardLabel, direction: 'inward' })
    }
    for (const fieldId of childFieldIds) {
      const value = issue?.fields?.[fieldId]
      for (const key of parseIssueKeysFromValue(value)) records.push({ key, relationType: 'child_field', relationLabel: fieldId, direction: 'child' })
    }
    for (const fieldId of linkedFieldIds) {
      const value = issue?.fields?.[fieldId]
      for (const key of parseIssueKeysFromValue(value)) records.push({ key, relationType: 'linked_field', relationLabel: fieldId, direction: 'linked' })
    }
    return uniqByKey(records.map(r => ({...r, key: String(r.key).toUpperCase()})))
  }
  function relationText(rel) { return lower(`${rel?.relationType || ''} ${rel?.relationLabel || ''}`) }
  function isPotentialTestCase(issue) {
    const proj = getProjectKey(issue)
    const type = lower(getIssueTypeName(issue))
    const summary = lower(issue?.fields?.summary)
    if (proj === 'MISQA') return true
    if (type.includes('test')) return true
    if (summary.includes('test case') || summary.includes('testcase')) return true
    return false
  }
  function classifyRelation(parentRaw, linkedRaw, relation) {
    if (!linkedRaw) return 'linked'
    const proj = getProjectKey(linkedRaw)
    const relText = relationText(relation)
    if (isPotentialTestCase(linkedRaw)) return 'test'
    if (relation?.relationType === 'subtask' || relation?.direction === 'child') return 'child'
    if (linkedRaw?.fields?.parent?.key === parentRaw?.key) return 'child'
    if (proj === 'FED') return 'child'
    if (proj === 'FEPMF') {
      if (relText.includes('child') || relText.includes('parent') || relText.includes('implement') || relText.includes('relates') || relText.includes('blocks') || relText.includes('is blocked by') || relText.includes('contains') || relText.includes('split') || relText.includes('decompose')) return 'child'
    }
    return 'linked'
  }
  function dominantValue(values = []) {
    const stats = new Map()
    for (const value of values.filter(Boolean)) stats.set(value, (stats.get(value) || 0) + 1)
    let best = ''
    let count = 0
    for (const [value, c] of stats.entries()) if (c > count) { best = value; count = c }
    return best
  }
  function calcProgress(children, parentStatus, parentProgressField) {
    if (parentProgressField != null) return Math.max(0, Math.min(100, Math.round(parentProgressField)))
    if (!children.length) return isDoneStatus(parentStatus) ? 100 : 0
    const done = children.filter(c => c.statusGroup === 'done').length
    return Math.round((done / children.length) * 100)
  }
  function addDaysUtc(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  function generateSprintCalendar() {
    const rows = []
    let sprint = 4
    let start = '2026-03-09'
    while (start.startsWith('2026-')) {
      const end = addDaysUtc(start, 18)
      rows.push({ name: `Sprint${sprint}`, label: `Sprint${sprint}`, start, end, rangeText: `${formatDateHuman(start).slice(0, 6)}-${formatDateHuman(end).slice(0, 6)}`, mandays: 15 })
      sprint += 1
      start = addDaysUtc(start, 21)
      if (sprint > 60) break
    }
    return rows
  }
  function makeForecast(progressPercent, dueDate) {
    if (!dueDate) return 'No due date'
    if (progressPercent >= 100) return 'Completed'
    if (progressPercent >= 80) return 'Likely on track'
    if (progressPercent >= 50) return 'Watch closely'
    return 'Needs intervention'
  }
  function computeHealth(progressPercent, riskFlags) {
    let score = 100
    if (riskFlags.includes('blocked')) score -= 35
    if (riskFlags.includes('stale_child')) score -= 20
    if (riskFlags.includes('no_test_case')) score -= 15
    if (riskFlags.includes('no_child')) score -= 25
    score += Math.min(progressPercent, 100) * 0.15
    if (score >= 80) return 'Healthy'
    if (score >= 55) return 'Watch'
    return 'Critical'
  }

  try {
    const fieldCatalog = await fetchJira('/field')
    const sprintFieldIds = uniq([...exactFieldIds(fieldCatalog, ['Sprint']), 'customfield_10020', 'customfield_10021', 'customfield_10015', 'customfield_10016'])
    const squadFieldIds = uniq([...exactFieldIds(fieldCatalog, ['Squad', 'Team']), ...fuzzyFieldIds(fieldCatalog, [' squad ', ' team ']).slice(0, 3)])
    const progressFieldIds = uniq([...exactFieldIds(fieldCatalog, ['Progress']), ...fuzzyFieldIds(fieldCatalog, ['progress', 'percent done']).slice(0, 4)])
    const childFieldIds = uniq([...exactFieldIds(fieldCatalog, ['Child work items', 'Child work item']), ...fuzzyFieldIds(fieldCatalog, ['child work item']).slice(0, 3)])
    const linkedFieldIds = uniq([...exactFieldIds(fieldCatalog, ['Linked work items', 'Linked work item']), ...fuzzyFieldIds(fieldCatalog, ['linked work item']).slice(0, 3)])
    const parentRefFieldIds = uniq([...exactFieldIds(fieldCatalog, ['Parent Link', 'Parent work item', 'Initiative Link', 'Epic Link', 'Feature Link']), ...fuzzyFieldIds(fieldCatalog, ['parent link', 'initiative link', 'epic link']).slice(0, 5)])

    const baseFields = uniq(['summary','status','assignee','issuetype','created','updated','attachment','subtasks','issuelinks','project','labels','components','parent','description','duedate','progress', ...sprintFieldIds, ...squadFieldIds, ...progressFieldIds, ...childFieldIds, ...linkedFieldIds, ...parentRefFieldIds])
    const cfg = { sprintFieldIds, squadFieldIds, progressFieldIds }

    const parentsRaw = await fetchAllByJql('project = FEPMF ORDER BY updated DESC', baseFields)
    const parentKeys = parentsRaw.map(x => x.key)

    const relationMapByParent = new Map()
    const level1KeySet = new Set()

    for (const p of parentsRaw) {
      const relations = extractLinkRecords(p, childFieldIds, linkedFieldIds)
      relationMapByParent.set(p.key, relations)
      for (const rel of relations) level1KeySet.add(rel.key)
    }

    const referencedChildrenRaw = []
    for (const fieldId of parentRefFieldIds) {
      const cfId = fieldId.startsWith('customfield_') ? fieldId.replace('customfield_', '') : null
      if (!cfId) continue
      for (let i = 0; i < parentKeys.length; i += 20) {
        const batch = parentKeys.slice(i, i + 20)
        if (!batch.length) continue
        const jql = `cf[${cfId}] in (${quoteValues(batch)}) ORDER BY updated DESC`
        try {
          const hits = await fetchAllByJql(jql, baseFields)
          for (const hit of hits) {
            referencedChildrenRaw.push(hit)
            const parentKey = readParentRefKey(hit?.fields?.[fieldId])
            if (!parentKey) continue
            const current = relationMapByParent.get(parentKey) || []
            current.push({ key: hit.key, relationType: 'parent_ref_field', relationLabel: fieldId, direction: 'child' })
            relationMapByParent.set(parentKey, current)
            level1KeySet.add(hit.key)
          }
        } catch (e) {}
      }
    }

    const level1IssuesRaw = level1KeySet.size ? await fetchIssuesByKeys([...level1KeySet], baseFields) : []
    const level1RawMap = new Map(level1IssuesRaw.map(i => [i.key, i]))
    const level2KeySet = new Set()
    for (const issue of level1IssuesRaw) {
      const rels = extractLinkRecords(issue, childFieldIds, linkedFieldIds)
      for (const rel of rels) if (!level1RawMap.has(rel.key)) level2KeySet.add(rel.key)
    }
    const level2IssuesRaw = level2KeySet.size ? await fetchIssuesByKeys([...level2KeySet], baseFields) : []

    const allRawMap = new Map()
    for (const i of parentsRaw) allRawMap.set(i.key, i)
    for (const i of level1IssuesRaw) allRawMap.set(i.key, i)
    for (const i of level2IssuesRaw) allRawMap.set(i.key, i)
    for (const i of referencedChildrenRaw) allRawMap.set(i.key, i)

    const normalizedMap = new Map()
    for (const raw of allRawMap.values()) normalizedMap.set(raw.key, normalizeIssue(raw, cfg))

    const sprintCalendar = generateSprintCalendar()
    const sprintMap = new Map(sprintCalendar.map(x => [x.name, x]))

    const parentRows = parentsRaw.map(parentRaw => {
      const parent = normalizedMap.get(parentRaw.key)
      const rels = relationMapByParent.get(parent.key) || []
      const level1Items = uniqByKey(rels.map(rel => {
        const raw = allRawMap.get(rel.key)
        const item = normalizedMap.get(rel.key)
        if (!raw || !item) return null
        return { relation: rel, raw, item }
      }).filter(Boolean))

      const children = []
      const linked = []
      const blockers = []
      const blockedBy = []
      const tests = []

      for (const row of level1Items) {
        const kind = classifyRelation(parentRaw, row.raw, row.relation)
        const relLabel = relationText(row.relation)

        if (kind === 'child') {
          children.push({ ...row.item, relationType: row.relation.relationType || '', relationLabel: row.relation.relationLabel || '' })
          const childRelations = extractLinkRecords(row.raw, childFieldIds, linkedFieldIds)
          for (const cr of childRelations) {
            const subRaw = allRawMap.get(cr.key)
            const subItem = normalizedMap.get(cr.key)
            if (!subRaw || !subItem) continue
            if (isPotentialTestCase(subRaw)) tests.push({ ...subItem, parentChildKey: row.item.key, kind: 'test_case' })
          }
        } else if (kind === 'test') {
          tests.push({ ...row.item, kind: 'test_case' })
        } else {
          linked.push({ ...row.item, relationType: row.relation.relationType || '', relationLabel: row.relation.relationLabel || '' })
        }

        if (relLabel.includes('blocks')) blockers.push(row.item)
        if (relLabel.includes('is blocked by')) blockedBy.push(row.item)
        if (isPotentialTestCase(row.raw)) tests.push({ ...row.item, kind: 'test_case' })
      }

      const finalChildren = uniqByKey(children)
      const finalLinked = uniqByKey(linked)
      const finalBlockers = uniqByKey(blockers)
      const finalBlockedBy = uniqByKey(blockedBy)
      const finalTests = uniqByKey(tests)

      const parentSquad = parent.squad || dominantValue(finalChildren.map(c => c.squad))
      const parentAssignee = parent.assignee || dominantValue(finalChildren.map(c => c.assignee))
      const parentSprint = parent.sprint || dominantValue(finalChildren.map(c => c.sprint))
      const progressPercent = calcProgress(finalChildren, parent.status, parent.progressFieldPercent)
      const progressSource = parent.progressFieldPercent != null ? 'jira_field' : 'calculated_from_children'

      const riskFlags = []
      if (!finalChildren.length) riskFlags.push('no_child')
      if (finalTests.length === 0) riskFlags.push('no_test_case')
      if (finalBlockedBy.length > 0 || finalChildren.some(c => c.statusGroup === 'blocked')) riskFlags.push('blocked')
      if (finalChildren.some(c => (c.updatedDaysAgo ?? 0) >= 7 && c.statusGroup !== 'done')) riskFlags.push('stale_child')

      return {
        parent: { ...parent, squad: parentSquad, assignee: parentAssignee, sprint: parentSprint },
        progressPercent,
        progressSource,
        squad: parentSquad,
        squads: uniq(finalChildren.map(c => c.squad)),
        assignee: parentAssignee,
        sprint: parentSprint,
        sprintCalendar: sprintMap.get(parentSprint) || null,
        dueDate: parent.dueDate,
        dueDateIso: parent.dueDateIso,
        childrenCount: finalChildren.length,
        linkedCount: finalLinked.length,
        blockerCount: finalBlockers.length,
        blockedByCount: finalBlockedBy.length,
        testCaseCount: finalTests.length,
        attachmentCount: parent.attachmentCount,
        riskFlags: uniq(riskFlags),
        health: computeHealth(progressPercent, uniq(riskFlags)),
        deliveryForecast: makeForecast(progressPercent, parent.dueDate),
        childStatusBreakdown: {
          open: finalChildren.filter(x => x.statusGroup === 'open').length,
          in_progress: finalChildren.filter(x => x.statusGroup === 'in_progress').length,
          test: finalChildren.filter(x => x.statusGroup === 'test').length,
          sit: finalChildren.filter(x => x.statusGroup === 'sit').length,
          uat: finalChildren.filter(x => x.statusGroup === 'uat').length,
          done: finalChildren.filter(x => x.statusGroup === 'done').length,
          blocked: finalChildren.filter(x => x.statusGroup === 'blocked').length,
          other: finalChildren.filter(x => x.statusGroup === 'other').length
        },
        childAssignees: uniq(finalChildren.map(x => x.assignee)),
        childSprints: uniq(finalChildren.map(x => x.sprint)),
        children: finalChildren,
        linked: finalLinked,
        blockers: finalBlockers,
        blockedBy: finalBlockedBy,
        testCases: finalTests
      }
    })

    const allChildren = parentRows.flatMap(r => r.children)
    const allLinked = parentRows.flatMap(r => r.linked)
    const allTests = parentRows.flatMap(r => r.testCases)
    const uniqIssueCount = arr => new Set(arr.map(x => x.key)).size

    const summary = {
      totalParents: parentRows.length,
      totalChildren: uniqIssueCount(allChildren),
      totalLinked: uniqIssueCount(allLinked),
      totalTestCases: uniqIssueCount(allTests),
      totalAttachments: parentRows.reduce((sum, r) => sum + r.attachmentCount, 0),
      openChildren: allChildren.filter(x => x.statusGroup === 'open').length,
      inProgressChildren: allChildren.filter(x => x.statusGroup === 'in_progress').length,
      sitChildren: allChildren.filter(x => x.statusGroup === 'sit').length,
      testChildren: allChildren.filter(x => x.statusGroup === 'test').length,
      uatChildren: allChildren.filter(x => x.statusGroup === 'uat').length,
      doneChildren: allChildren.filter(x => x.statusGroup === 'done').length,
      blockedChildren: allChildren.filter(x => x.statusGroup === 'blocked').length,
      parentsNoChild: parentRows.filter(r => r.childrenCount === 0).length,
      parentsNoTest: parentRows.filter(r => r.testCaseCount === 0).length,
      parentsBlocked: parentRows.filter(r => r.riskFlags.includes('blocked')).length,
      staleChildren: allChildren.filter(x => (x.updatedDaysAgo ?? 0) >= 7 && x.statusGroup !== 'done').length,
      avgProgress: parentRows.length ? Math.round(parentRows.reduce((sum, r) => sum + r.progressPercent, 0) / parentRows.length) : 0
    }

    const squadSummary = KNOWN_SQUADS.map(squad => {
      const squadItems = allChildren.filter(x => x.squad === squad)
      return {
        squad,
        total: squadItems.length,
        open: squadItems.filter(x => x.statusGroup === 'open').length,
        inProgress: squadItems.filter(x => x.statusGroup === 'in_progress').length,
        test: squadItems.filter(x => x.statusGroup === 'test').length,
        uat: squadItems.filter(x => x.statusGroup === 'uat').length,
        done: squadItems.filter(x => x.statusGroup === 'done').length,
        blocked: squadItems.filter(x => x.statusGroup === 'blocked').length
      }
    }).filter(x => x.total > 0)

    const insights = {
      parentsWithoutChild: parentRows.filter(r => r.childrenCount === 0).map(r => ({ key: r.parent.key, summary: r.parent.summary, browseUrl: r.parent.browseUrl })),
      parentsAtRisk: parentRows.filter(r => r.riskFlags.length > 0).slice(0, 12).map(r => ({ key: r.parent.key, summary: r.parent.summary, risks: r.riskFlags, browseUrl: r.parent.browseUrl })),
      blockedChildren: uniqByKey(allChildren.filter(x => x.statusGroup === 'blocked')).slice(0, 20),
      staleChildren: uniqByKey(allChildren.filter(x => (x.updatedDaysAgo ?? 0) >= 7 && x.statusGroup !== 'done')).slice(0, 20)
    }

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      meta: {
        discoveredFields: { sprintFieldIds, squadFieldIds, progressFieldIds, childFieldIds, linkedFieldIds, parentRefFieldIds },
        available: {
          squads: uniq(parentRows.map(r => r.squad).concat(allChildren.map(x => x.squad))).sort(),
          assignees: uniq(parentRows.map(r => r.assignee).concat(allChildren.map(x => x.assignee))).sort(),
          sprints: uniq(parentRows.map(r => r.sprint).concat(allChildren.map(x => x.sprint))).sort((a, b) => parseNumberLike(a) - parseNumberLike(b)),
          parentStatuses: uniq(parentRows.map(r => r.parent.status)).sort(),
          childStatuses: uniq(allChildren.map(x => x.status)).sort(),
          risks: ['blocked', 'stale_child', 'no_test_case', 'no_child']
        }
      },
      sprintCalendar,
      summary,
      squadSummary,
      insights,
      parents: parentRows
    })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unknown error' })
  }
}
