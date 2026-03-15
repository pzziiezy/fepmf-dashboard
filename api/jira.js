export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  const EMAIL = process.env.JIRA_EMAIL
  const TOKEN = process.env.JIRA_API_TOKEN
  const BASE = 'https://dgtbigc.atlassian.net/rest/api/3'

  if (!EMAIL || !TOKEN) {
    return res.status(500).json({ error: 'Missing env vars' })
  }

  const auth = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')
  const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }

  async function fetchJira(path) {
    const r = await fetch(`${BASE}${path}`, { headers })
    if (!r.ok) throw new Error(`Jira ${r.status}: ${r.statusText}`)
    return r.json()
  }

  async function fetchAll(jql, fields) {
    let start = 0, all = []
    while (true) {
      const p = new URLSearchParams({ jql, startAt: String(start), maxResults: '100', fields: fields.join(',') })
      const d = await fetchJira(`/search?${p}`)
      all = [...all, ...(d.issues || [])]
      if (all.length >= d.total || !d.issues?.length) break
      start += 100
      if (start > 600) break
    }
    return all
  }

  try {
    const { action = 'fepmf', keys = '', key = '' } = req.query

    if (action === 'fepmf') {
      const issues = await fetchAll('project = FEPMF ORDER BY updated DESC',
        ['summary', 'status', 'assignee', 'priority', 'issuelinks', 'issuetype', 'created', 'updated'])
      return res.json({ issues })
    }

    if (action === 'children' && keys) {
      const issues = await fetchAll(`key IN (${keys}) ORDER BY updated DESC`,
        ['summary', 'status', 'assignee', 'priority', 'issuetype', 'parent'])
      return res.json({ issues })
    }

    if (action === 'issue' && key) {
      const data = await fetchJira(`/issue/${key}?fields=summary,status,assignee,priority,issuelinks,issuetype,description,created,updated`)
      return res.json(data)
    }

    return res.status(400).json({ error: 'unknown action' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
