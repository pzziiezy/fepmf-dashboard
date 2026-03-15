import { NextRequest, NextResponse } from 'next/server'

const JIRA_BASE = 'https://api.atlassian.com/ex/jira/a7d03eec-4d39-4f31-b491-3abab9fe9f51/rest/api/3'
const JIRA_EMAIL = process.env.JIRA_EMAIL!
const JIRA_TOKEN = process.env.JIRA_API_TOKEN!

function authHeader() {
  const cred = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64')
  return { Authorization: `Basic ${cred}`, 'Content-Type': 'application/json' }
}

async function fetchJira(path: string) {
  const res = await fetch(`${JIRA_BASE}${path}`, { headers: authHeader(), next: { revalidate: 60 } })
  if (!res.ok) throw new Error(`Jira ${res.status}: ${res.statusText}`)
  return res.json()
}

async function fetchAllIssues(jql: string, fields: string[]) {
  let start = 0, all: any[] = []
  while (true) {
    const params = new URLSearchParams({
      jql, startAt: String(start), maxResults: '100',
      fields: fields.join(',')
    })
    const data = await fetchJira(`/search?${params}`)
    all = [...all, ...(data.issues || [])]
    if (all.length >= data.total || !data.issues?.length) break
    start += 100
    if (start > 600) break
  }
  return all
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action') || 'fepmf'

    if (action === 'fepmf') {
      const issues = await fetchAllIssues(
        'project = FEPMF ORDER BY updated DESC',
        ['summary', 'status', 'assignee', 'priority', 'issuelinks', 'issuetype', 'created', 'updated']
      )
      return NextResponse.json({ issues })
    }

    if (action === 'children') {
      const keys = searchParams.get('keys') || ''
      if (!keys) return NextResponse.json({ issues: [] })
      const jql = `key IN (${keys}) ORDER BY updated DESC`
      const issues = await fetchAllIssues(jql, ['summary', 'status', 'assignee', 'priority', 'issuetype', 'parent'])
      return NextResponse.json({ issues })
    }

    if (action === 'issue') {
      const key = searchParams.get('key') || ''
      const data = await fetchJira(`/issue/${key}?fields=summary,status,assignee,priority,issuelinks,issuetype,description,created,updated,comment`)
      return NextResponse.json(data)
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e: any) {
    console.error('Jira API error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
