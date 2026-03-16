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
    return res.status(500).json({ error: 'Missing env vars: JIRA_EMAIL or JIRA_API_TOKEN' })
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

  function pickText(v) {
    if (!v) return ''
    if (typeof v === 'string') return v
    if (typeof v === 'object') {
      if (v.displayName) return v.displayName
      if (v.name) return v.name
      if (v.value) return v.value
      if (v.key) return v.key
    }
    return ''
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

  function getRelatedKeysFromIssue(issue) {
    const keys = new Set()

    for (const st of issue?.fields?.subtasks || []) {
      if (st?.key) keys.add(st.key)
    }

    for (const link of issue?.fields?.issuelinks || []) {
      if (link?.outwardIssue?.key) keys.add(link.outwardIssue.key)
      if (link?.inwardIssue?.key) keys.add(link.inwardIssue.key)
    }

    return [...keys]
  }

  function groupStatus(status) {
    const s = (status || '').toLowerCase()

    if (s.includes('done') || s.includes('closed') || s.includes('complete') || s.includes('resolved') || s.includes('deliver')) {
      return 'done'
    }
    if (s.includes('uat')) return 'uat'
    if (s.includes('progress') || s.includes('develop') || s.includes('implement') || s.includes('coding')) {
      return 'in_progress'
    }
    if (s.includes('block')) return 'blocked'
    if (s.includes('open') || s.includes('todo') || s.includes('to do') || s.includes('ready')) {
      return 'open'
    }
    return 'other'
  }

  function inferSquad(issue) {
    const fields = issue?.fields || {}

    const directCandidates = [
      fields.customfield_10001,
      fields.customfield_10002,
      fields.customfield_10003,
      fields.customfield_10004,
      fields.customfield_10005
    ]
      .map(pickText)
      .filter(Boolean)

    for (const c of directCandidates) {
      const up = c.toUpperCase()
      if (up.includes('KEPLER')) return 'KEPLER'
      if (up.includes('MIDAS')) return 'MIDAS'
      if (up.includes('NEBULA')) return 'NEBULA'
    }

    const labels = fields.labels || []
    for (const lb of labels) {
      const up = String(lb).toUpperCase()
      if (up.includes('KEPLER')) return 'KEPLER'
      if (up.includes('MIDAS')) return 'MIDAS'
      if (up.includes('NEBULA')) return 'NEBULA'
    }

    return ''
  }

  function inferBoardId(issue) {
    const text = JSON.stringify(issue?.fields || {})
    if (text.includes('563')) return '563'
    if (text.includes('564')) return '564'
    if (text.includes('565')) return '565'
    return ''
  }

  function normalizeIssue(issue) {
    const boardId = inferBoardId(issue)
    const squadFromBoard = boardId ? BOARD_TO_SQUAD[boardId] : ''
    const squad = inferSquad(issue) || squadFromBoard || ''

    return {
      id: issue.id,
      key: issue.key,
      self: issue.self,
      summary: issue?.fields?.summary || '',
      status: getStatusName(issue),
      statusGroup: groupStatus(getStatusName(issue)),
      issueType: getIssueTypeName(issue),
      assignee: getAssigneeName(issue),
      projectKey: getProjectKey(issue),
      priority: issue?.fields?.priority?.name || '',
      created: issue?.fields?.created || '',
      updated: issue?.fields?.updated || '',
      squad,
      boardId,
      labels: issue?.fields?.labels || [],
      components: (issue?.fields?.components || []).map(c => c.name),
      attachments: getAttachments(issue),
      relatedKeys: getRelatedKeysFromIssue(issue)
    }
  }

  function calcParentProgress(children) {
    if (!children.length) return 0
    const done = children.filter(c => c.statusGroup === 'done').length
    return Math.round((done / children.length) * 100)
  }

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
      'components'
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
      'description'
    ]

    const parentsRaw = await fetchAllByJql(
      'project = FEPMF ORDER BY updated DESC',
      parentFields
    )

    const parents = parentsRaw.map(normalizeIssue)

    const relatedKeySet = new Set()

    for (const p of parentsRaw) {
      for (const k of getRelatedKeysFromIssue(p)) {
        relatedKeySet.add(k)
      }
    }

    const relatedKeys = [...relatedKeySet]

    let relatedIssuesRaw = []
    if (relatedKeys.length) {
      const quotedKeys = relatedKeys.map(k => `"${k}"`).join(',')
      relatedIssuesRaw = await fetchAllByJql(
        `key IN (${quotedKeys}) ORDER BY updated DESC`,
        detailFields
      )
    }

    const relatedMap = new Map()
    for (const issue of relatedIssuesRaw) {
      relatedMap.set(issue.key, normalizeIssue(issue))
    }

    const parentRows = parents.map(parent => {
      const relationKeys = parent.relatedKeys || []
      const allRelated = relationKeys
        .map(k => relatedMap.get(k))
        .filter(Boolean)

      const children = allRelated.filter(i => i.projectKey === 'FED' || i.projectKey === 'FEPMF')
      const linked = allRelated.filter(i => !(i.projectKey === 'FED' || i.projectKey === 'FEPMF'))

      const squadSet = new Set(children.map(c => c.squad).filter(Boolean))
      const squads = [...squadSet]

      const testCaseCount = allRelated.filter(i => {
        const t = (i.issueType || '').toLowerCase()
        return t.includes('test')
      }).length

      return {
        parent,
        progressPercent: calcParentProgress(children),
        childrenCount: children.length,
        linkedCount: linked.length,
        attachmentCount: parent.attachments.length,
        testCaseCount,
        squads,
        children,
        linked
      }
    })

    const allChildren = parentRows.flatMap(r => r.children)
    const allLinked = parentRows.flatMap(r => r.linked)

    const summary = {
      totalParents: parentRows.length,
      totalChildren: allChildren.length,
      totalLinked: allLinked.length,
      totalAttachments: parentRows.reduce((sum, r) => sum + r.attachmentCount, 0),
      openChildren: allChildren.filter(x => x.statusGroup === 'open').length,
      inProgressChildren: allChildren.filter(x => x.statusGroup === 'in_progress').length,
      uatChildren: allChildren.filter(x => x.statusGroup === 'uat').length,
      doneChildren: allChildren.filter(x => x.statusGroup === 'done').length,
      blockedChildren: allChildren.filter(x => x.statusGroup === 'blocked').length
    }

    const squadSummary = ['KEPLER', 'MIDAS', 'NEBULA'].map(name => {
      const squadItems = allChildren.filter(c => c.squad === name)
      return {
        squad: name,
        total: squadItems.length,
        open: squadItems.filter(x => x.statusGroup === 'open').length,
        inProgress: squadItems.filter(x => x.statusGroup === 'in_progress').length,
        uat: squadItems.filter(x => x.statusGroup === 'uat').length,
        done: squadItems.filter(x => x.statusGroup === 'done').length,
        blocked: squadItems.filter(x => x.statusGroup === 'blocked').length
      }
    })

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      summary,
      squadSummary,
      parents: parentRows
    })
  } catch (e) {
    return res.status(500).json({
      error: e.message || 'Unknown server error'
    })
  }
}
