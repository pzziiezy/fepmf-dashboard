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

  const BOARD_TO_SQUAD = {
    '563': 'KEPLER',
    '564': 'MIDAS',
    '565': 'NEBULA'
  }

  // ---------- helpers ----------
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
      if (start > 2000) break
    }

    return all
  }

  function uniq(arr) {
    return [...new Set(arr.filter(Boolean))]
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

  function lower(v) {
    return String(v || '').toLowerCase()
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

  function groupStatus(status) {
    const s = lower(status)

    if (s.includes('done') || s.includes('closed') || s.includes('complete') || s.includes('resolved') || s.includes('deliver')) {
      return 'done'
    }
    if (s.includes('uat')) return 'uat'
    if (s.includes('sit')) return 'sit'
    if (s.includes('test')) return 'test'
    if (s.includes('progress') || s.includes('develop') || s.includes('implement') || s.includes('coding') || s.includes('doing')) {
      return 'in_progress'
    }
    if (s.includes('block')) return 'blocked'
    if (s.includes('open') || s.includes('todo') || s.includes('to do') || s.includes('ready') || s.includes('backlog')) {
      return 'open'
    }
    return 'other'
  }

  function daysSince(dateString) {
    if (!dateString) return null
    const t = new Date(dateString).getTime()
    if (Number.isNaN(t)) return null
    return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24))
  }

  function isParentIssue(issue) {
    return getProjectKey(issue) === 'FEPMF'
  }

  function isFedIssue(issue) {
    return getProjectKey(issue) === 'FED'
  }

  function isPotentialTestCase(issue) {
    const issueType = lower(getIssueTypeName(issue))
    const summary = lower(issue?.fields?.summary || '')
    const labels = (issue?.fields?.labels || []).map(lower).join(' ')
    const comps = (issue?.fields?.components || []).map(c => lower(c?.name)).join(' ')

    return (
      issueType.includes('test') ||
      summary.includes('test case') ||
      summary.includes('testcase') ||
      summary.includes('unit test') ||
      summary.includes('uat') ||
      summary.includes('sit') ||
      summary.includes('qa') ||
      labels.includes('test') ||
      labels.includes('uat') ||
      labels.includes('sit') ||
      labels.includes('qa') ||
      comps.includes('test') ||
      comps.includes('uat') ||
      comps.includes('sit') ||
      comps.includes('qa')
    )
  }

  function findSprint(issue) {
    const fields = issue?.fields || {}

    // common Jira sprint custom field first
    const candidates = [
      fields.customfield_10020,
      fields.customfield_10021,
      fields.customfield_10015,
      fields.customfield_10016
    ]

    for (const c of candidates) {
      if (!c) continue

      if (Array.isArray(c) && c.length) {
        const last = c[c.length - 1]
        if (typeof last === 'string') {
          const m = last.match(/name=([^,\]]+)/i)
          if (m?.[1]) return m[1]
          return last
        }
        const t = pickText(last)
        if (t) return t
      }

      if (typeof c === 'string') {
        const m = c.match(/name=([^,\]]+)/i)
        if (m?.[1]) return m[1]
        return c
      }

      const t = pickText(c)
      if (t) return t
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

  function classifyRelation(parentIssue, linkedIssue, relation) {
    if (!linkedIssue) return 'linked'

    const proj = getProjectKey(linkedIssue)
    const relText = lower(`${relation?.relationType || ''} ${relation?.relationLabel || ''}`)

    if (relation?.relationType === 'subtask') return 'child'

    // FEPMF child work items often point to FED issues or FEPMF sub-work
    if (proj === 'FED') return 'child'

    if (proj === 'FEPMF') {
      // FEPMF linked under FEPMF can still be child-ish if relation is strong
      if (
        relText.includes('child') ||
        relText.includes('parent') ||
        relText.includes('implements') ||
        relText.includes('relates') ||
        relText.includes('blocks') ||
        relText.includes('is blocked by')
      ) {
        return 'child'
      }
      return 'linked'
    }

    // MISQA usually linked/test/qa side
    if (proj === 'MISQA') return 'linked'

    return 'linked'
  }

  function inferBoardIdFromIssue(issue) {
    const key = issue?.key || ''

    // Best-effort fallback by key prefix
    // This is not perfect, but keeps squad mapping usable if board cannot be read directly.
    if (key.startsWith('FED-')) return ''
    return ''
  }

  function inferSquad(issue) {
    const text = JSON.stringify(issue?.fields || {}).toUpperCase()

    if (text.includes('KEPLER')) return 'KEPLER'
    if (text.includes('MIDAS')) return 'MIDAS'
    if (text.includes('NEBULA')) return 'NEBULA'

    const boardId = inferBoardIdFromIssue(issue)
    return BOARD_TO_SQUAD[boardId] || ''
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
      relatedKeys: uniq(extractLinkRecords(issue).map(x => x.key))
    }
  }

  function calcProgressFromChildren(children) {
    if (!children.length) return 0
    const done = children.filter(c => c.statusGroup === 'done').length
    return Math.round((done / children.length) * 100)
  }

  function quoteKeys(keys) {
    return keys.map(k => `"${k}"`).join(',')
  }

  // ---------- main ----------
  try {
    const parentFields = [
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
      'parent'
    ]

    const detailFields = [
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
      'customfield_10020',
      'customfield_10021',
      'customfield_10015',
      'customfield_10016'
    ]

    const parentsRaw = await fetchAllByJql(
      'project = FEPMF ORDER BY updated DESC',
      parentFields
    )

    // รอบแรก: เก็บ key ของ child/linked จาก parent
    const relationMapByParent = new Map()
    const level1KeySet = new Set()

    for (const p of parentsRaw) {
      const relations = extractLinkRecords(p)
      relationMapByParent.set(p.key, relations)

      for (const rel of relations) {
        level1KeySet.add(rel.key)
      }
    }

    // ดึง detail ของ level 1
    let level1IssuesRaw = []
    const level1Keys = [...level1KeySet]

    if (level1Keys.length) {
      level1IssuesRaw = await fetchAllByJql(
        `key IN (${quoteKeys(level1Keys)}) ORDER BY updated DESC`,
        detailFields
      )
    }

    const level1RawMap = new Map(level1IssuesRaw.map(i => [i.key, i]))

    // รอบสอง: ดึง subtasks/linked ของ child อีกชั้น สำหรับ dev breakdown
    const level2KeySet = new Set()

    for (const issue of level1IssuesRaw) {
      const relations = extractLinkRecords(issue)
      for (const rel of relations) {
        if (!level1RawMap.has(rel.key)) {
          level2KeySet.add(rel.key)
        }
      }
    }

    let level2IssuesRaw = []
    const level2Keys = [...level2KeySet]

    if (level2Keys.length) {
      level2IssuesRaw = await fetchAllByJql(
        `key IN (${quoteKeys(level2Keys)}) ORDER BY updated DESC`,
        detailFields
      )
    }

    const allRawMap = new Map()

    for (const p of parentsRaw) allRawMap.set(p.key, p)
    for (const i of level1IssuesRaw) allRawMap.set(i.key, i)
    for (const i of level2IssuesRaw) allRawMap.set(i.key, i)

    const normalizedMap = new Map()
    for (const raw of allRawMap.values()) {
      normalizedMap.set(raw.key, normalizeIssue(raw))
    }

    // สร้าง parent rows
    const parentRows = parentsRaw.map(parentRaw => {
      const parent = normalizedMap.get(parentRaw.key)
      const rels = relationMapByParent.get(parent.key) || []

      const level1Items = rels
        .map(rel => {
          const raw = allRawMap.get(rel.key)
          const item = normalizedMap.get(rel.key)
          if (!raw || !item) return null
          return {
            relation: rel,
            raw,
            item
          }
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
        const relLabel = lower(`${row.relation.relationType || ''} ${row.relation.relationLabel || ''}`)

        if (kind === 'child') {
          children.push(row.item)

          // dev breakdown ของ child
          const childRelations = extractLinkRecords(row.raw)
          for (const cr of childRelations) {
            const subRaw = allRawMap.get(cr.key)
            const subItem = normalizedMap.get(cr.key)
            if (!subRaw || !subItem) continue

            // subtasks หรือ FED children อีกชั้น
            if (cr.relationType === 'subtask' || subItem.parentKey === row.item.key) {
              childSubtasks.push({
                ...subItem,
                rootChildKey: row.item.key
              })
            }

            if (isPotentialTestCase(subRaw)) {
              tests.push(subItem)
            }
          }
        } else {
          linked.push(row.item)
        }

        if (relLabel.includes('blocks')) blockers.push(row.item)
        if (relLabel.includes('is blocked by')) blockedBy.push(row.item)
        if (isPotentialTestCase(row.raw)) tests.push(row.item)
      }

      const uniqByKey = arr => {
        const m = new Map()
        for (const x of arr) m.set(x.key, x)
        return [...m.values()]
      }

      const finalChildren = uniqByKey(children)
      const finalLinked = uniqByKey(linked)
      const finalBlockers = uniqByKey(blockers)
      const finalBlockedBy = uniqByKey(blockedBy)
      const finalTests = uniqByKey(tests)
      const finalChildSubtasks = uniqByKey(childSubtasks)

      // squad: นับจาก child FED เป็นหลัก
      const squadStats = { KEPLER: 0, MIDAS: 0, NEBULA: 0 }
      for (const c of finalChildren) {
        if (squadStats[c.squad] !== undefined) squadStats[c.squad] += 1
      }

      let dominantSquad = ''
      let maxCount = 0
      for (const [name, count] of Object.entries(squadStats)) {
        if (count > maxCount) {
          dominantSquad = name
          maxCount = count
        }
      }

      const riskFlags = []
      if (!finalChildren.length) riskFlags.push('no_child')
      if (finalTests.length === 0) riskFlags.push('no_test_case')
      if (finalBlockedBy.length > 0) riskFlags.push('blocked')
      if (finalChildren.some(c => (c.updatedDaysAgo ?? 0) >= 7 && c.statusGroup !== 'done')) {
        riskFlags.push('stale_child')
      }

      return {
        parent,
        progressPercent: calcProgressFromChildren(finalChildren),
        squad: dominantSquad,
        squads: uniq(finalChildren.map(c => c.squad)),
        childrenCount: finalChildren.length,
        linkedCount: finalLinked.length,
        blockerCount: finalBlockers.length,
        blockedByCount: finalBlockedBy.length,
        testCaseCount: finalTests.length,
        attachmentCount: parent.attachmentCount,
        childSubtaskCount: finalChildSubtasks.length,
        riskFlags,
        children: finalChildren,
        childSubtasks: finalChildSubtasks,
        linked: finalLinked,
        blockers: finalBlockers,
        blockedBy: finalBlockedBy,
        testCases: finalTests
      }
    })

    const allChildren = parentRows.flatMap(r => r.children)
    const allLinked = parentRows.flatMap(r => r.linked)
    const allChildSubtasks = parentRows.flatMap(r => r.childSubtasks)
    const allTests = parentRows.flatMap(r => r.testCases)

    const uniqIssueCount = arr => new Set(arr.map(x => x.key)).size

    const summary = {
      totalParents: parentRows.length,
      totalChildren: uniqIssueCount(allChildren),
      totalLinked: uniqIssueCount(allLinked),
      totalChildSubtasks: uniqIssueCount(allChildSubtasks),
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
      parentsBlocked: parentRows.filter(r => r.blockedByCount > 0).length,
      staleChildren: allChildren.filter(x => (x.updatedDaysAgo ?? 0) >= 7 && x.statusGroup !== 'done').length
    }

    const squadSummary = ['KEPLER', 'MIDAS', 'NEBULA'].map(name => {
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
        blocked: squadItems.filter(x => x.statusGroup === 'blocked').length
      }
    })

    const insights = {
      parentsWithoutChild: parentRows
        .filter(r => r.childrenCount === 0)
        .slice(0, 20)
        .map(r => ({
          key: r.parent.key,
          summary: r.parent.summary,
          status: r.parent.status
        })),

      parentsWithoutTestCase: parentRows
        .filter(r => r.testCaseCount === 0)
        .slice(0, 20)
        .map(r => ({
          key: r.parent.key,
          summary: r.parent.summary,
          status: r.parent.status
        })),

      blockedParents: parentRows
        .filter(r => r.blockedByCount > 0)
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

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      summary,
      squadSummary,
      insights,
      parents: parentRows
    })
  } catch (e) {
    return res.status(500).json({
      error: e.message || 'Unknown server error'
    })
  }
}
