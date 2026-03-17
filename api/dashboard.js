export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

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
      const match = v.match(/-?\d+(?:\.\d+)?/)
      return match ? Number(match[0]) : null
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
      for (const key of ['percent', 'percentage', 'progress', 'value', 'done']) {
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

  function findSprintCandidates(value) {
    const rows = []

    function walk(v) {
      if (v == null) return
      if (Array.isArray(v)) {
        for (const x of v) walk(x)
        return
      }
      if (typeof v === 'string') {
        const matches = v.match(/Sprint\s*\d+/gi)
        if (matches) {
          for (const name of matches) rows.push({ name: name.replace(/\s+/g, ''), raw: null })
        }
        return
      }
      if (typeof v === 'object') {
        const name = v.name || v.value || v.displayName || null
        if (typeof name === 'string' && /sprint/i.test(name)) {
          rows.push({
            name: name.replace(/\s+/g, ''),
            raw: {
              id: v.id || null,
              state: v.state || null,
              startDate: v.startDate || v.startdate || null,
              endDate: v.endDate || v.enddate || null,
              completeDate: v.completeDate || null
            }
          })
        }
        for (const x of Object.values(v)) walk(x)
      }
    }

    walk(value)
    return rows
  }

  function parseSprintFromIssue(issue, sprintFieldIds = []) {
    const rows = []
    for (const fieldId of sprintFieldIds) {
      rows.push(...findSprintCandidates(issue?.fields?.[fieldId]))
    }
    rows.push(...findSprintCandidates(issue?.fields?.sprint))
    rows.push(...findSprintCandidates(issue?.fields?.Sprint))

    if (!rows.length) return { name: '', start: '', end: '' }

    const first = rows[0]
    return {
      name: first.name || '',
      start: first.raw?.startDate ? toIsoDate(first.raw.startDate) : '',
      end: first.raw?.endDate ? toIsoDate(first.raw.endDate) : ''
    }
  }

  function toIsoDate(value) {
    if (!value) return ''
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return ''
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }

  function formatDateHuman(value) {
    if (!value) return ''
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value)
    if (Number.isNaN(d.getTime())) return ''
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
  }

  function getStatus(issue) {
    return issue?.fields?.status?.name || ''
  }

  function getStatusCategory(issue) {
    return issue?.fields?.status?.statusCategory?.key || ''
  }

  function statusGroup(issue) {
    const category = lower(getStatusCategory(issue))
    if (category === 'done') return 'done'
    if (category === 'indeterminate') return 'in_progress'

    const s = lower(getStatus(issue))
    if (!s) return 'other'
    if (s.includes('block')) return 'blocked'
    if (s.includes('done') || s.includes('closed') || s.includes('complete') || s.includes('resolved') || s.includes('deploy')) return 'done'
    if (s.includes('uat')) return 'uat'
    if (s.includes('sit')) return 'sit'
    if (s.includes('test') || s.includes('qa')) return 'test'
    if (s.includes('progress') || s.includes('develop') || s.includes('doing') || s.includes('review') || s.includes('implement')) return 'in_progress'
    if (s.includes('open') || s.includes('todo') || s.includes('to do') || s.includes('plan') || s.includes('backlog') || s.includes('selected')) return 'open'
    return 'other'
  }

  function isDoneIssue(issue) {
    return statusGroup(issue) === 'done'
  }

  function getProgressFromIssue(issue, progressFieldIds = []) {
    const candidates = [issue?.fields?.progress, issue?.fields?.aggregateprogress, ...getFieldValues(issue, progressFieldIds)]
    for (const value of candidates) {
      const percent = extractPercent(value)
      if (percent != null) return Math.max(0, Math.min(100, percent))
    }
    return null
  }

  function normalizeIssue(issue, cfg) {
    const sprint = parseSprintFromIssue(issue, cfg.sprintFieldIds)
    return {
      id: issue?.id || '',
      key: issue?.key || '',
      browseUrl: issue?.key ? `https://dgtbigc.atlassian.net/browse/${issue.key}` : '',
      summary: issue?.fields?.summary || '',
      issueType: issue?.fields?.issuetype?.name || '',
      status: getStatus(issue),
      statusGroup: statusGroup(issue),
      assignee: issue?.fields?.assignee?.displayName || '',
      projectKey: issue?.fields?.project?.key || '',
      created: issue?.fields?.created || '',
      updated: issue?.fields?.updated || '',
      dueDate: issue?.fields?.duedate || '',
      sprint: sprint.name,
      sprintStart: sprint.start,
      sprintEnd: sprint.end,
      progressFieldPercent: getProgressFromIssue(issue, cfg.progressFieldIds)
    }
  }

  function extractRelationRecords(issue, childFieldIds = [], linkedFieldIds = []) {
    const records = []

    for (const subtask of issue?.fields?.subtasks || []) {
      if (!subtask?.key) continue
      records.push({
        key: String(subtask.key).toUpperCase(),
        direction: 'subtask',
        relationType: 'subtask',
        relationLabel: 'subtask'
      })
    }

    for (const link of issue?.fields?.issuelinks || []) {
      const typeName = link?.type?.name || 'link'
      const outwardLabel = link?.type?.outward || 'outward'
      const inwardLabel = link?.type?.inward || 'inward'

      if (link?.outwardIssue?.key) {
        records.push({
          key: String(link.outwardIssue.key).toUpperCase(),
          direction: 'outward',
          relationType: typeName,
          relationLabel: outwardLabel
        })
      }

      if (link?.inwardIssue?.key) {
        records.push({
          key: String(link.inwardIssue.key).toUpperCase(),
          direction: 'inward',
          relationType: typeName,
          relationLabel: inwardLabel
        })
      }
    }

    for (const fieldId of childFieldIds) {
      for (const key of parseIssueKeysFromValue(issue?.fields?.[fieldId])) {
        records.push({ key, direction: 'child_field', relationType: 'child_field', relationLabel: fieldId })
      }
    }

    for (const fieldId of linkedFieldIds) {
      for (const key of parseIssueKeysFromValue(issue?.fields?.[fieldId])) {
        records.push({ key, direction: 'linked_field', relationType: 'linked_field', relationLabel: fieldId })
      }
    }

    return records
  }

  function mergeRelations(records) {
    const map = new Map()
    for (const item of records || []) {
      if (!item?.key) continue
      if (!map.has(item.key)) {
        map.set(item.key, {
          key: item.key,
          relationTypes: new Set(),
          relationLabels: new Set(),
          directions: new Set()
        })
      }
      const row = map.get(item.key)
      if (item.relationType) row.relationTypes.add(item.relationType)
      if (item.relationLabel) row.relationLabels.add(item.relationLabel)
      if (item.direction) row.directions.add(item.direction)
    }

    return [...map.values()].map((row) => ({
      key: row.key,
      relationTypes: [...row.relationTypes],
      relationLabels: [...row.relationLabels],
      directions: [...row.directions]
    }))
  }

  async function fetchJira(path, options = {}) {
    const response = await fetch(`${BASE}${path}`, {
      headers,
      ...options
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Jira ${response.status}: ${response.statusText} | ${text}`)
    }

    return response.json()
  }

  async function fetchAllByJql(jql, fields = []) {
    const all = []
    let nextPageToken = undefined
    let guard = 0

    while (true) {
      const body = {
        jql,
        maxResults: 100,
        fields
      }
      if (nextPageToken) body.nextPageToken = nextPageToken

      const page = await fetchJira('/search/jql', {
        method: 'POST',
        body: JSON.stringify(body)
      })

      const issues = page.issues || []
      all.push(...issues)
      nextPageToken = page.nextPageToken
      guard += 1

      if (!issues.length || page.isLast || !nextPageToken || guard > 120) break
    }

    return all
  }

  async function fetchIssuesByKeys(keys, fields = []) {
    const output = []
    const uniqueKeys = uniq((keys || []).map((k) => String(k).toUpperCase()))

    for (let i = 0; i < uniqueKeys.length; i += 50) {
      const batch = uniqueKeys.slice(i, i + 50)
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
      ...fuzzyFieldIds(fieldCatalog, ['sprint']).slice(0, 6)
    ])
    const progressFieldIds = uniq([
      ...exactFieldIds(fieldCatalog, ['Progress']),
      ...fuzzyFieldIds(fieldCatalog, ['progress', 'percent done']).slice(0, 6)
    ])
    const childFieldIds = uniq([
      ...exactFieldIds(fieldCatalog, ['Child work items', 'Child work item']),
      ...fuzzyFieldIds(fieldCatalog, ['child work item']).slice(0, 4)
    ])
    const linkedFieldIds = uniq([
      ...exactFieldIds(fieldCatalog, ['Linked work items', 'Linked work item']),
      ...fuzzyFieldIds(fieldCatalog, ['linked work item']).slice(0, 4)
    ])
    const parentRefFieldIds = uniq([
      ...exactFieldIds(fieldCatalog, ['Parent Link', 'Parent work item', 'Initiative Link', 'Epic Link', 'Feature Link']),
      ...fuzzyFieldIds(fieldCatalog, ['parent link', 'initiative link', 'epic link']).slice(0, 6)
    ])

    const baseFields = uniq([
      'summary',
      'status',
      'assignee',
      'issuetype',
      'created',
      'updated',
      'project',
      'parent',
      'subtasks',
      'issuelinks',
      'duedate',
      'progress',
      'aggregateprogress',
      ...sprintFieldIds,
      ...progressFieldIds,
      ...childFieldIds,
      ...linkedFieldIds,
      ...parentRefFieldIds
    ])

    const cfg = { sprintFieldIds, progressFieldIds }

    const parentsRaw = await fetchAllByJql('project = FEPMF ORDER BY updated DESC', baseFields)
    const parentKeys = parentsRaw.map((x) => x.key)

    const relationsByParent = new Map()
    const relatedKeySet = new Set()

    for (const parentRaw of parentsRaw) {
      const rels = extractRelationRecords(parentRaw, childFieldIds, linkedFieldIds)
      relationsByParent.set(parentRaw.key, rels)
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

          const current = relationsByParent.get(parentKey) || []
          current.push({
            key: String(hit.key).toUpperCase(),
            direction: 'parent_ref_field',
            relationType: 'parent_ref_field',
            relationLabel: fieldId
          })
          relationsByParent.set(parentKey, current)
          relatedKeySet.add(String(hit.key).toUpperCase())
        }
      }
    }

    const relatedRaw = relatedKeySet.size ? await fetchIssuesByKeys([...relatedKeySet], baseFields) : []
    const rawMap = new Map()

    for (const row of parentsRaw) rawMap.set(row.key, row)
    for (const row of relatedRaw) rawMap.set(row.key, row)

    const normalizedMap = new Map()
    for (const issue of rawMap.values()) {
      normalizedMap.set(issue.key, normalizeIssue(issue, cfg))
    }

    const sprintRangeMap = new Map()

    function registerSprintRange(issue) {
      const sprint = parseSprintFromIssue(issue, sprintFieldIds)
      if (!sprint.name) return

      if (!sprintRangeMap.has(sprint.name)) {
        sprintRangeMap.set(sprint.name, { name: sprint.name, start: sprint.start || '', end: sprint.end || '' })
        return
      }

      const current = sprintRangeMap.get(sprint.name)
      if (!current.start || (sprint.start && sprint.start < current.start)) current.start = sprint.start
      if (!current.end || (sprint.end && sprint.end > current.end)) current.end = sprint.end
    }

    for (const row of rawMap.values()) registerSprintRange(row)

    const parents = parentsRaw.map((parentRaw) => {
      const parent = normalizedMap.get(parentRaw.key)
      const relationRows = mergeRelations(relationsByParent.get(parent.key) || [])
      const workItems = []

      for (const relation of relationRows) {
        const linked = normalizedMap.get(relation.key)
        if (!linked) continue
        workItems.push({
          ...linked,
          relationTypes: relation.relationTypes,
          relationLabels: relation.relationLabels,
          relationDirections: relation.directions,
          relationText: relation.relationLabels[0] || relation.relationTypes[0] || 'linked'
        })
      }

      const doneCount = workItems.filter((x) => x.statusGroup === 'done').length
      const blockedCount = workItems.filter((x) => x.statusGroup === 'blocked').length
      const progressCalculated = workItems.length ? Math.round((doneCount / workItems.length) * 100) : parent.statusGroup === 'done' ? 100 : 0
      const progressFromJira = parent.progressFieldPercent
      const progressPercent = progressFromJira != null ? progressFromJira : progressCalculated

      const riskFlags = []
      if (!workItems.length) riskFlags.push('no_linked_item')
      if (blockedCount > 0) riskFlags.push('blocked')
      if (progressPercent < 50 && workItems.length > 0) riskFlags.push('slow_progress')

      const timelineItems = []
      const allItems = [parent, ...workItems]
      for (const item of allItems) {
        const sprint = item.sprint
        const range = sprint ? sprintRangeMap.get(sprint) : null
        const start = range?.start || item.created?.slice(0, 10) || item.dueDate || ''
        const end = range?.end || item.dueDate || start
        if (!start || !end) continue

        timelineItems.push({
          key: item.key,
          summary: item.summary,
          status: item.status,
          type: item.issueType,
          sprint: sprint || '',
          start,
          end,
          browseUrl: item.browseUrl,
          source: item.key === parent.key ? 'parent' : 'linked'
        })
      }

      return {
        parent,
        progressPercent,
        progress: {
          jiraPercent: progressFromJira,
          linkedDonePercent: progressCalculated,
          totalLinked: workItems.length,
          doneLinked: doneCount,
          source: progressFromJira != null ? 'jira_field' : 'linked_completion'
        },
        linkedCount: workItems.length,
        blockedCount,
        riskFlags,
        workItems,
        timelineItems
      }
    })

    const allWorkItems = parents.flatMap((row) => row.workItems)
    const allTimeline = parents.flatMap((row) => row.timelineItems)

    const sprintCalendarMap = new Map()
    for (const item of allTimeline) {
      const sprintName = item.sprint || 'NoSprint'
      if (!sprintCalendarMap.has(sprintName)) {
        sprintCalendarMap.set(sprintName, {
          name: sprintName,
          start: item.start,
          end: item.end,
          items: []
        })
      }
      const row = sprintCalendarMap.get(sprintName)
      if (item.start < row.start) row.start = item.start
      if (item.end > row.end) row.end = item.end
      row.items.push({
        key: item.key,
        summary: item.summary,
        type: item.type,
        status: item.status,
        source: item.source,
        start: item.start,
        end: item.end,
        browseUrl: item.browseUrl
      })
    }

    const sprintCalendar = [...sprintCalendarMap.values()]
      .sort((a, b) => (a.start || '9999-12-31').localeCompare(b.start || '9999-12-31'))
      .map((row) => ({
        ...row,
        rangeText: `${formatDateHuman(row.start)} - ${formatDateHuman(row.end)}`
      }))

    const summary = {
      totalParents: parents.length,
      totalLinkedItems: uniq(allWorkItems.map((x) => x.key)).length,
      blockedLinkedItems: allWorkItems.filter((x) => x.statusGroup === 'blocked').length,
      avgProgress: parents.length ? Math.round(parents.reduce((sum, row) => sum + row.progressPercent, 0) / parents.length) : 0,
      noLinkedItemParents: parents.filter((x) => x.linkedCount === 0).length
    }

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      meta: {
        discoveredFields: {
          sprintFieldIds,
          progressFieldIds,
          childFieldIds,
          linkedFieldIds,
          parentRefFieldIds
        },
        available: {
          parentStatuses: uniq(parents.map((x) => x.parent.status)).sort(),
          linkedStatuses: uniq(allWorkItems.map((x) => x.status)).sort(),
          sprints: uniq(allTimeline.map((x) => x.sprint).filter(Boolean)).sort((a, b) => parseNumberLike(a) - parseNumberLike(b)),
          issueTypes: uniq(allWorkItems.map((x) => x.issueType)).sort(),
          risks: ['blocked', 'slow_progress', 'no_linked_item']
        }
      },
      summary,
      sprintCalendar,
      timelineItems: allTimeline,
      parents
    })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unknown error' })
  }
}
