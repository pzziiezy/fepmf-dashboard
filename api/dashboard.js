export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  const EMAIL = process.env.JIRA_EMAIL
  const TOKEN = process.env.JIRA_API_TOKEN
  const BASE = 'https://dgtbigc.atlassian.net/rest/api/3'

  if (!EMAIL || !TOKEN) {
    return res.status(500).json({
      error: 'Missing env vars: JIRA_EMAIL or JIRA_API_TOKEN'
    })
  }

  const auth = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }

  const KNOWN_SQUADS = ['KEPLER', 'MIDAS', 'NEBULA']
  const SPRINT_FIELD_KEYS = [
    'customfield_10020',
    'customfield_10021',
    'customfield_10015',
    'customfield_10016'
  ]

  async function fetchJira(path) {
    const r = await fetch(`${BASE}${path}`, { method: 'GET', headers })
    if (!r.ok) {
      const text = await r.text()
      throw new Error(`Jira ${r.status}: ${r.statusText} | ${text}`)
    }
    return r.json()
  }

  async function fetchAllByJql(jql, fields = []) {
    let start = 0
    let all = []

    while (true) {
      const p = new URLSearchParams({
        jql,
        startAt: String(start),
        maxResults: '100'
      })

      if (fields.length) p.set('fields', fields.join(','))

      const d = await fetchJira(`/search/jql?${p.toString()}`)
      const issues = d.issues || []
      all = all.concat(issues)

      if (!issues.length || all.length >= (d.total || 0)) break
      start += 100
      if (start > 4000) break
    }

    return all
  }

  function lower(v) {
    return String(v || '').toLowerCase()
  }

  function uniq(arr) {
    return [...new Set((arr || []).filter(Boolean))]
  }

  function uniqByKey(arr) {
    const map = new Map()
    for (const item of arr || []) {
      if (item?.key) map.set(item.key, item)
    }
    return [...map.values()]
  }

  function pickText(v) {
    if (!v) return ''
    if (typeof v === 'string') return v
    if (typeof v === 'number') return String(v)
    if (Array.isArray(v)) return v.map(pickText).filter(Boolean).join(', ')
    if (typeof v === 'object') {
      if (v.displayName) return v.displayName
      if (v.name) return v.name
      if (v.value) return v.value
      if (v.key) return v.key
      if (v.id) return String(v.id)
    }
    return ''
  }

  function daysSince(dateString) {
    if (!dateString) return null
    const t = new Date(dateString).getTime()
    if (Number.isNaN(t)) return null
    return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24))
  }

  function formatDateISO(dateString) {
    if (!dateString) return ''
    const d = new Date(dateString)
    if (Number.isNaN(d.getTime())) return ''
    return d.toISOString().slice(0, 10)
  }

  function getStatusName(issue) {
    return issue?.fields?.status?.name || ''
  }

  function getIssueTypeName(issue) {
    return issue?.fields?.issuetype?.name || ''
  }

  function getAssigneeName(issue) {
    return issue?.fields?.assignee?.displayName || ''
  }

  function getProjectKey(issue) {
    return issue?.fields?.project?.key || ''
  }

  function getPriorityName(issue) {
    return issue?.fields?.priority?.name || ''
  }

  function getAttachments(issue) {
    return (issue?.fields?.attachment || []).map(a => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      created: a.created,
      content: a.content,
      thumbnail: a.thumbnail
    }))
  }

  function getDueDate(issue) {
    return issue?.fields?.duedate || ''
  }

  function groupStatus(status) {
    const s = lower(status)

    if (s.includes('done') || s.includes('closed') || s.includes('complete') || s.includes('resolved') || s.includes('deliver')) {
      return 'done'
    }
    if (s.includes('uat')) return 'uat'
    if (s.includes('sit')) return 'sit'
    if (s.includes('test') || s.includes('qa')) return 'test'
    if (s.includes('block')) return 'blocked'
    if (s.includes('progress') || s.includes('develop') || s.includes('implement') || s.includes('coding') || s.includes('doing')) {
      return 'in_progress'
    }
    if (s.includes('open') || s.includes('todo') || s.includes('to do') || s.includes('ready') || s.includes('backlog') || s.includes('selected')) {
      return 'open'
    }
    return 'other'
  }

  function isDoneStatus(status) {
    return groupStatus(status) === 'done'
  }

  function isPotentialTestCase(issue) {
    const issueType = lower(getIssueTypeName(issue))
    const summary = lower(issue?.fields?.summary || '')
    const labels = (issue?.fields?.labels || []).map(lower).join(' ')
    const comps = (issue?.fields?.components || []).map(c => lower(c?.name)).join(' ')
    const project = lower(getProjectKey(issue))

    return (
      issueType.includes('test') ||
      issueType.includes('qa') ||
      summary.includes('test case') ||
      summary.includes('testcase') ||
      summary.includes('unit test') ||
      summary.includes('qa') ||
      summary.includes('uat') ||
      summary.includes('sit') ||
      labels.includes('test') ||
      labels.includes('qa') ||
      labels.includes('uat') ||
      labels.includes('sit') ||
      comps.includes('test') ||
      comps.includes('qa') ||
      comps.includes('uat') ||
      comps.includes('sit') ||
      project === 'misqa'
    )
  }

  function findSprint(issue) {
    const fields = issue?.fields || {}
    const candidates = SPRINT_FIELD_KEYS.map(k => fields[k]).filter(Boolean)

    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.length) {
        const last = candidate[candidate.length - 1]
        if (typeof last === 'string') {
          const m = last.match(/name=([^,\]]+)/i)
          if (m?.[1]) return m[1]
          return last
        }
        const t = pickText(last)
        if (t) return t
      }

      if (typeof candidate === 'string') {
        const m = candidate.match(/name=([^,\]]+)/i)
        if (m?.[1]) return m[1]
        return candidate
      }

      const t = pickText(candidate)
      if (t) return t
    }

    return ''
  }

  function extractCandidateTexts(issue) {
    const f = issue?.fields || {}
    const bucket = [
      f.summary,
      getStatusName(issue),
      getIssueTypeName(issue),
      getAssigneeName(issue),
      getProjectKey(issue),
      pickText(f.reporter),
      pickText(f.creator),
      ...(f.labels || []),
      ...(f.components || []).map(x => x?.name),
      findSprint(issue),
      JSON.stringify(f.description || ''),
      JSON.stringify(f)
    ]
    return bucket.filter(Boolean).join(' | ').toUpperCase()
  }

  function inferSquad(issue) {
    const text = extractCandidateTexts(issue)
    for (const squad of KNOWN_SQUADS) {
      if (text.includes(squad)) return squad
    }
    return ''
  }

  function extractLinkRecords(issue) {
    const records = []

    for (const st of issue?.fields?.subtasks || []) {
      if (!st?.key) continue
      records.push({
        key: st.key,
        relationType: 'subtask',
        relationLabel: 'subtask',
        direction: 'child'
      })
    }

    for (const link of issue?.fields?.issuelinks || []) {
      const typeName = link?.type?.name || ''
      const inwardLabel = link?.type?.inward || ''
      const outwardLabel = link?.type?.outward || ''

      if (link?.outwardIssue?.key) {
        records.push({
          key: link.outwardIssue.key,
          relationType: typeName,
          relationLabel: outwardLabel,
          direction: 'outward'
        })
      }

      if (link?.inwardIssue?.key) {
        records.push({
          key: link.inwardIssue.key,
          relationType: typeName,
          relationLabel: inwardLabel,
          direction: 'inward'
        })
      }
    }

    return records
  }

  function quoteKeys(keys) {
    return keys.map(k => `"${k}"`).join(',')
  }

  function normalizeIssue(issue) {
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
      priority: getPriorityName(issue),
      created: issue?.fields?.created || '',
      updated: issue?.fields?.updated || '',
      updatedDaysAgo: daysSince(issue?.fields?.updated || ''),
      sprint: findSprint(issue),
      squad: inferSquad(issue),
      labels: issue?.fields?.labels || [],
      components: (issue?.fields?.components || []).map(c => c.name),
      attachments: getAttachments(issue),
      attachmentCount: (issue?.fields?.attachment || []).length,
      parentKey: issue?.fields?.parent?.key || '',
      dueDate: getDueDate(issue),
      dueDateIso: formatDateISO(getDueDate(issue)),
      relatedKeys: uniq(extractLinkRecords(issue).map(x => x.key))
    }
  }

  function relationText(rel) {
    return lower(`${rel?.relationType || ''} ${rel?.relationLabel || ''}`)
  }

  function isStrongChildRelation(rel) {
    const text = relationText(rel)
    return (
      rel?.relationType === 'subtask' ||
      text.includes('child') ||
      text.includes('parent') ||
      text.includes('implements') ||
      text.includes('relates') ||
      text.includes('belongs') ||
      text.includes('contains') ||
      text.includes('decomposes') ||
      text.includes('split')
    )
  }

  function classifyRelation(parentRaw, linkedRaw, relation) {
    if (!linkedRaw) return 'linked'
    if (relation?.relationType === 'subtask') return 'child'

    const linkedProj = getProjectKey(linkedRaw)

    if (isPotentialTestCase(linkedRaw)) return 'test'
    if (linkedRaw?.fields?.parent?.key === parentRaw?.key) return 'child'
    if (linkedProj === 'FED') return 'child'
    if (isStrongChildRelation(relation)) return 'child'

    return 'linked'
  }

  function dominantValue(values = []) {
    const stats = new Map()
    for (const value of values.filter(Boolean)) {
      stats.set(value, (stats.get(value) || 0) + 1)
    }
    let best = ''
    let count = 0
    for (const [value, score] of stats.entries()) {
      if (score > count) {
        best = value
        count = score
      }
    }
    return best
  }

  function calcProgressFromChildren(parentStatus, children) {
    if (!children.length) {
      return isDoneStatus(parentStatus) ? 100 : 0
    }
    const done = children.filter(c => c.statusGroup === 'done').length
    return Math.round((done / children.length) * 100)
  }

  function generateSprintCalendar() {
    const result = []
    let sprintNumber = 4
    let current = new Date('2026-03-09T00:00:00+07:00')

    while (current.getFullYear() <= 2026) {
      const start = new Date(current)
      const end = new Date(current)
      end.setDate(end.getDate() + 18)
      if (start.getFullYear() !== 2026) break
      result.push({
        name: `Sprint${sprintNumber}`,
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        mandays: 15
      })
      sprintNumber += 1
      current.setDate(current.getDate() + 21)
      if (current.getFullYear() > 2026) break
    }
    return result
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
    const baseFields = [
      'summary',
      'status',
      'assignee',
      'priority',
      'issuetype',
      'created',
      'updated',
      'attachment',
      'subtasks',
      'issuelinks',
      'project',
      'labels',
      'components',
      'parent',
      'description',
      'duedate',
      ...SPRINT_FIELD_KEYS
    ]

    const parentsRaw = await fetchAllByJql(
      'project = FEPMF ORDER BY updated DESC',
      baseFields
    )

    const relationMapByParent = new Map()
    const level1KeySet = new Set()

    for (const p of parentsRaw) {
      const relations = extractLinkRecords(p)
      relationMapByParent.set(p.key, relations)
      for (const rel of relations) level1KeySet.add(rel.key)
    }

    let level1IssuesRaw = []
    const level1Keys = [...level1KeySet]
    if (level1Keys.length) {
      level1IssuesRaw = await fetchAllByJql(
        `key IN (${quoteKeys(level1Keys)}) ORDER BY updated DESC`,
        baseFields
      )
    }

    const level1RawMap = new Map(level1IssuesRaw.map(i => [i.key, i]))
    const level2KeySet = new Set()

    for (const issue of level1IssuesRaw) {
      const relations = extractLinkRecords(issue)
      for (const rel of relations) {
        if (!level1RawMap.has(rel.key)) level2KeySet.add(rel.key)
      }
    }

    let level2IssuesRaw = []
    const level2Keys = [...level2KeySet]
    if (level2Keys.length) {
      level2IssuesRaw = await fetchAllByJql(
        `key IN (${quoteKeys(level2Keys)}) ORDER BY updated DESC`,
        baseFields
      )
    }

    const allRawMap = new Map()
    for (const issue of parentsRaw) allRawMap.set(issue.key, issue)
    for (const issue of level1IssuesRaw) allRawMap.set(issue.key, issue)
    for (const issue of level2IssuesRaw) allRawMap.set(issue.key, issue)

    const normalizedMap = new Map()
    for (const raw of allRawMap.values()) {
      normalizedMap.set(raw.key, normalizeIssue(raw))
    }

    const sprintCalendar = generateSprintCalendar()

    const parentRows = parentsRaw.map(parentRaw => {
      const parent = normalizedMap.get(parentRaw.key)
      const rels = relationMapByParent.get(parent.key) || []
      const level1Items = rels
        .map(rel => {
          const raw = allRawMap.get(rel.key)
          const item = normalizedMap.get(rel.key)
          if (!raw || !item) return null
          return { relation: rel, raw, item }
        })
        .filter(Boolean)

      const children = []
      const linked = []
      const blockers = []
      const blockedBy = []
      const tests = []
      const childSubtasks = []

      for (const row of level1Items) {
        const kind = classifyRelation(parentRaw, row.raw, row.relation)
        const relLabel = relationText(row.relation)

        if (kind === 'child') {
          children.push({
            ...row.item,
            relationType: row.relation.relationType || '',
            relationLabel: row.relation.relationLabel || ''
          })

          const childRelations = extractLinkRecords(row.raw)
          for (const cr of childRelations) {
            const subRaw = allRawMap.get(cr.key)
            const subItem = normalizedMap.get(cr.key)
            if (!subRaw || !subItem) continue

            if (cr.relationType === 'subtask' || subItem.parentKey === row.item.key) {
              childSubtasks.push({
                ...subItem,
                rootChildKey: row.item.key
              })
            }
            if (isPotentialTestCase(subRaw)) tests.push(subItem)
          }
        } else if (kind === 'test') {
          tests.push(row.item)
        } else {
          linked.push(row.item)
        }

        if (relLabel.includes('blocks')) blockers.push(row.item)
        if (relLabel.includes('is blocked by')) blockedBy.push(row.item)
        if (isPotentialTestCase(row.raw)) tests.push(row.item)
      }

      const finalChildren = uniqByKey(children)
      const finalLinked = uniqByKey(linked)
      const finalBlockers = uniqByKey(blockers)
      const finalBlockedBy = uniqByKey(blockedBy)
      const finalTests = uniqByKey(tests)
      const finalChildSubtasks = uniqByKey(childSubtasks)

      const parentSquad = parent.squad || dominantValue(finalChildren.map(c => c.squad))
      const parentAssignee = parent.assignee || dominantValue(finalChildren.map(c => c.assignee))
      const parentSprint = parent.sprint || dominantValue(finalChildren.map(c => c.sprint))
      const progressPercent = calcProgressFromChildren(parent.status, finalChildren)

      const riskFlags = []
      if (!finalChildren.length) riskFlags.push('no_child')
      if (finalTests.length === 0) riskFlags.push('no_test_case')
      if (finalBlockedBy.length > 0 || finalChildren.some(c => c.statusGroup === 'blocked')) riskFlags.push('blocked')
      if (finalChildren.some(c => (c.updatedDaysAgo ?? 0) >= 7 && c.statusGroup !== 'done')) riskFlags.push('stale_child')

      return {
        parent: {
          ...parent,
          squad: parentSquad,
          assignee: parentAssignee,
          sprint: parentSprint
        },
        progressPercent,
        squad: parentSquad,
        squads: uniq(finalChildren.map(c => c.squad)),
        assignee: parentAssignee,
        sprint: parentSprint,
        dueDate: parent.dueDate,
        dueDateIso: parent.dueDateIso,
        childrenCount: finalChildren.length,
        linkedCount: finalLinked.length,
        blockerCount: finalBlockers.length,
        blockedByCount: finalBlockedBy.length,
        testCaseCount: finalTests.length,
        attachmentCount: parent.attachmentCount,
        childSubtaskCount: finalChildSubtasks.length,
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
        childSubtasks: finalChildSubtasks,
        linked: finalLinked,
        blockers: finalBlockers,
        blockedBy: finalBlockedBy,
        testCases: finalTests
      }
    })

    const allChildren = uniqByKey(parentRows.flatMap(r => r.children))
    const allLinked = uniqByKey(parentRows.flatMap(r => r.linked))
    const allChildSubtasks = uniqByKey(parentRows.flatMap(r => r.childSubtasks))
    const allTests = uniqByKey(parentRows.flatMap(r => r.testCases))

    const summary = {
      totalParents: parentRows.length,
      totalChildren: allChildren.length,
      totalLinked: allLinked.length,
      totalChildSubtasks: allChildSubtasks.length,
      totalTestCases: allTests.length,
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
      avgProgress: parentRows.length ? Math.round(parentRows.reduce((sum, r) => sum + r.progressPercent, 0) / parentRows.length) : 0,
      healthyParents: parentRows.filter(r => r.health === 'Healthy').length,
      criticalParents: parentRows.filter(r => r.health === 'Critical').length
    }

    const squadsPresent = uniq([
      ...KNOWN_SQUADS,
      ...parentRows.map(r => r.squad),
      ...allChildren.map(c => c.squad)
    ])

    const squadSummary = squadsPresent.map(name => {
      const squadItems = allChildren.filter(c => c.squad === name)
      return {
        squad: name,
        total: squadItems.length,
        open: squadItems.filter(x => x.statusGroup === 'open').length,
        inProgress: squadItems.filter(x => x.statusGroup === 'in_progress').length,
        sit: squadItems.filter(x => x.statusGroup === 'sit').length,
        test: squadItems.filter(x => x.statusGroup === 'test').length,
        uat: squadItems.filter(x => x.statusGroup === 'uat').length,
        done: squadItems.filter(x => x.statusGroup === 'done').length,
        blocked: squadItems.filter(x => x.statusGroup === 'blocked').length,
        utilization: Math.min(100, Math.round((squadItems.filter(x => x.statusGroup !== 'done').length / Math.max(squadItems.length, 1)) * 100))
      }
    })

    const insights = {
      parentsWithoutChild: parentRows
        .filter(r => r.childrenCount === 0)
        .slice(0, 20)
        .map(r => ({ key: r.parent.key, summary: r.parent.summary, status: r.parent.status })),
      parentsWithoutTestCase: parentRows
        .filter(r => r.testCaseCount === 0)
        .slice(0, 20)
        .map(r => ({ key: r.parent.key, summary: r.parent.summary, status: r.parent.status })),
      blockedParents: parentRows
        .filter(r => r.riskFlags.includes('blocked'))
        .slice(0, 20)
        .map(r => ({
          key: r.parent.key,
          summary: r.parent.summary,
          status: r.parent.status,
          blockedBy: r.blockedBy.map(x => x.key)
        })),
      staleChildren: allChildren
        .filter(x => (x.updatedDaysAgo ?? 0) >= 7 && x.statusGroup !== 'done')
        .sort((a, b) => (b.updatedDaysAgo || 0) - (a.updatedDaysAgo || 0))
        .slice(0, 30)
        .map(x => ({
          key: x.key,
          summary: x.summary,
          squad: x.squad,
          status: x.status,
          updatedDaysAgo: x.updatedDaysAgo
        }))
    }

    const meta = {
      available: {
        parentStatuses: uniq(parentRows.map(r => r.parent.status)),
        childStatuses: uniq(allChildren.map(x => x.status)),
        squads: uniq([...parentRows.map(r => r.squad), ...allChildren.map(x => x.squad)]),
        sprints: uniq([...parentRows.map(r => r.sprint), ...allChildren.map(x => x.sprint)]),
        assignees: uniq([...parentRows.map(r => r.assignee), ...allChildren.map(x => x.assignee)]),
        risks: ['blocked', 'stale_child', 'no_test_case', 'no_child']
      }
    }

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      sprintCalendar,
      summary,
      squadSummary,
      insights,
      meta,
      parents: parentRows
    })
  } catch (e) {
    return res.status(500).json({
      error: e.message || 'Unknown server error'
    })
  }
}
