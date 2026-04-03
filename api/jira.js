export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  const EMAIL = process.env.JIRA_EMAIL
  const TOKEN = process.env.JIRA_API_TOKEN

  // สำคัญมาก: ใช้ Jira site URL ตรง ๆ
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

  async function fetchJira(path) {
    const url = `${BASE}${path}`
    const r = await fetch(url, { method: 'GET', headers })

    if (!r.ok) {
      const text = await r.text()
      throw new Error(`Jira ${r.status}: ${r.statusText} | ${text}`)
    }

    return r.json()
  }

  async function fetchAll(jql, fields = []) {
  let start = 0
  let all = []

  while (true) {
    const p = new URLSearchParams({
      jql,
      startAt: String(start),
      maxResults: '100'
    })

    if (fields.length) {
      p.set('fields', fields.join(','))
    }

    const d = await fetchJira(`/search/jql?${p.toString()}`)
    const issues = d.issues || []

    all = [...all, ...issues]

    if (!issues.length || all.length >= (d.total || 0)) break

    start += 100
    if (start > 2000) break
  }

  return all
}

  try {
    const { action = 'fepmf', keys = '', key = '', email = '' } = req.query

    // 1) ดึง FEPMF ทั้งหมด
    if (action === 'fepmf') {
      const issues = await fetchAll(
        'project = FEPMF ORDER BY updated DESC',
        [
          'summary',
          'status',
          'assignee',
          'priority',
          'issuelinks',
          'issuetype',
          'created',
          'updated',
          'attachment',
          'subtasks',
          'project',
          'labels',
          'components',
          'description'
        ]
      )

      return res.status(200).json({ issues })
    }

    // 2) ดึง child / linked items หลาย key พร้อมกัน
    if (action === 'children' && keys) {
      const cleanKeys = keys
        .split(',')
        .map(k => k.trim())
        .filter(Boolean)

      if (!cleanKeys.length) {
        return res.status(400).json({ error: 'No valid keys provided' })
      }

      const jql = `key IN (${cleanKeys.map(k => `"${k}"`).join(',')}) ORDER BY updated DESC`

      const issues = await fetchAll(
        jql,
        [
          'summary',
          'status',
          'assignee',
          'priority',
          'issuetype',
          'parent',
          'created',
          'updated',
          'attachment',
          'subtasks',
          'project',
          'labels',
          'components',
          'description',
          'issuelinks'
        ]
      )

      return res.status(200).json({ issues })
    }

    // 3) ดึง issue รายตัวแบบละเอียด
    if (action === 'issue' && key) {
      const data = await fetchJira(
        `/issue/${encodeURIComponent(key)}?fields=` +
          [
            'summary',
            'status',
            'assignee',
            'priority',
            'issuelinks',
            'issuetype',
            'description',
            'created',
            'updated',
            'attachment',
            'subtasks',
            'project',
            'labels',
            'components',
            'parent'
          ].join(',')
      )

      return res.status(200).json(data)
    }

    // 4) health check ไว้ test ว่า function ยังทำงานไหม
    if (action === 'health') {
      return res.status(200).json({
        ok: true,
        hasEmail: !!EMAIL,
        hasToken: !!TOKEN,
        base: BASE
      })
    }

    if (action === 'validate_email') {
      const normalizedEmail = String(email || '').trim().toLowerCase()
      if (!normalizedEmail) return res.status(400).json({ valid: false, error: 'email is required' })

      const users = await fetchJira(`/user/search?query=${encodeURIComponent(normalizedEmail)}&maxResults=50`)
      const list = Array.isArray(users) ? users : []
      const exact = list.find((user) => String(user?.emailAddress || '').trim().toLowerCase() === normalizedEmail)

      if (!exact) {
        return res.status(200).json({
          valid: false,
          reason: 'Email not found in Jira (or hidden by Jira privacy policy)'
        })
      }

      return res.status(200).json({
        valid: true,
        user: {
          email: String(exact.emailAddress || '').trim(),
          displayName: String(exact.displayName || '').trim(),
          accountId: String(exact.accountId || '').trim(),
          active: Boolean(exact.active)
        }
      })
    }

    return res.status(400).json({ error: 'unknown action' })
  } catch (e) {
    return res.status(500).json({
      error: e.message || 'Unknown server error'
    })
  }
}
