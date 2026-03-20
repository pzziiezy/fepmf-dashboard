import crypto from 'crypto'

const memoryStore = []
const tokenCache = { accessToken: '', expiresAt: 0 }
const QA_COLUMNS = ['id', 'projectKey', 'projectTitle', 'qaName', 'status', 'assignedAt', 'updatedAt', 'isDeleted', 'deletedAt', 'note']

function nowIso() {
  return new Date().toISOString()
}

function parseSpreadsheetId() {
  if (process.env.GOOGLE_SHEETS_SPREADSHEET_ID) return process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  const url = String(process.env.GOOGLE_SHEETS_URL || '').trim()
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return match ? match[1] : ''
}

function isGoogleSheetsConfigured() {
  return Boolean(parseSpreadsheetId() && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)
}

function getPrivateKey() {
  return String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim()
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function getGoogleAccessToken() {
  const now = Math.floor(Date.now() / 1000)
  if (tokenCache.accessToken && tokenCache.expiresAt > now + 60) return tokenCache.accessToken

  const header = { alg: 'RS256', typ: 'JWT' }
  const claimSet = {
    iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }

  const unsignedJwt = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(unsignedJwt)
  signer.end()
  const signature = signer.sign(getPrivateKey())
  const jwt = `${unsignedJwt}.${base64url(signature)}`

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`Google token error: ${payload.error || response.statusText}`)

  tokenCache.accessToken = payload.access_token
  tokenCache.expiresAt = now + Number(payload.expires_in || 3600)
  return tokenCache.accessToken
}

async function googleRequest(path, options = {}) {
  const token = await getGoogleAccessToken()
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${parseSpreadsheetId()}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(`Google Sheets API error: ${data?.error?.message || response.statusText}`)
  return data
}

async function ensureHeader(sheetName) {
  const range = `${sheetName}!A1:J1`
  const result = await googleRequest(`/values/${encodeURIComponent(range)}`)
  const current = result.values?.[0] || []
  const same = QA_COLUMNS.length === current.length && QA_COLUMNS.every((v, i) => v === current[i])
  if (same) return
  await googleRequest(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [QA_COLUMNS] })
  })
}

function toRow(item) {
  return [item.id, item.projectKey, item.projectTitle, item.qaName, item.status, item.assignedAt, item.updatedAt, item.isDeleted, item.deletedAt, item.note]
}

function fromRow(row = [], rowNumber = 0) {
  return {
    id: String(row[0] || ''),
    projectKey: String(row[1] || ''),
    projectTitle: String(row[2] || ''),
    qaName: String(row[3] || ''),
    status: String(row[4] || ''),
    assignedAt: String(row[5] || ''),
    updatedAt: String(row[6] || ''),
    isDeleted: String(row[7] || '').toLowerCase() === 'true',
    deletedAt: String(row[8] || ''),
    note: String(row[9] || ''),
    _rowNumber: rowNumber
  }
}

function parseBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }
  return req.body
}

async function listItems(sheetName, includeDeleted = false) {
  await ensureHeader(sheetName)
  const result = await googleRequest(`/values/${encodeURIComponent(`${sheetName}!A2:J`)}`)
  const rows = (result.values || []).map((row, idx) => fromRow(row, idx + 2)).filter((x) => x.id)
  return includeDeleted ? rows : rows.filter((x) => !x.isDeleted)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const sheetName = process.env.GOOGLE_QA_SHEET_TAB_NAME || 'QA_Plan_Log'

  try {
    if (!isGoogleSheetsConfigured()) {
      if (req.method === 'GET') return res.status(200).json({ items: memoryStore.filter((x) => !x.isDeleted), source: 'memory', warning: 'Google Sheets not configured' })
      if (req.method === 'POST') {
        const body = parseBody(req)
        const qaName = String(body.qaName || '').trim()
        const projects = Array.isArray(body.projects) ? body.projects : []
        if (!qaName || !projects.length) return res.status(400).json({ error: 'qaName and projects are required' })
        const added = projects.map((p) => ({
          id: `qa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          projectKey: String(p.projectKey || '').trim().toUpperCase(),
          projectTitle: String(p.projectTitle || '').trim(),
          qaName,
          status: String(p.status || '').trim(),
          assignedAt: nowIso(),
          updatedAt: nowIso(),
          isDeleted: false,
          deletedAt: '',
          note: String(body.note || '').trim()
        }))
        memoryStore.unshift(...added)
        return res.status(201).json({ ok: true, items: added, source: 'memory', warning: 'Google Sheets not configured' })
      }
      if (req.method === 'PUT') {
        const body = parseBody(req)
        const id = String(body.id || '').trim()
        const qaName = String(body.qaName || '').trim()
        const idx = memoryStore.findIndex((x) => x.id === id)
        if (!id || !qaName || idx < 0) return res.status(400).json({ error: 'id and qaName are required' })
        memoryStore[idx] = { ...memoryStore[idx], qaName, updatedAt: nowIso() }
        return res.status(200).json({ ok: true, item: memoryStore[idx], source: 'memory', warning: 'Google Sheets not configured' })
      }
      if (req.method === 'DELETE') {
        const body = parseBody(req)
        const id = String(body.id || req.query?.id || '').trim()
        const idx = memoryStore.findIndex((x) => x.id === id)
        if (!id || idx < 0) return res.status(400).json({ error: 'id is required' })
        memoryStore[idx] = { ...memoryStore[idx], isDeleted: true, deletedAt: nowIso(), updatedAt: nowIso() }
        return res.status(200).json({ ok: true, id, softDeleted: true, source: 'memory', warning: 'Google Sheets not configured' })
      }
      return res.status(405).json({ error: 'Method not allowed' })
    }

    if (req.method === 'GET') {
      const includeDeleted = String(req.query?.includeDeleted || '').toLowerCase() === 'true'
      const items = await listItems(sheetName, includeDeleted)
      return res.status(200).json({ items, source: 'google_sheets' })
    }

    if (req.method === 'POST') {
      const body = parseBody(req)
      const qaName = String(body.qaName || '').trim()
      const projects = Array.isArray(body.projects) ? body.projects : []
      if (!qaName || !projects.length) return res.status(400).json({ error: 'qaName and projects are required' })

      await ensureHeader(sheetName)
      const created = projects.map((p) => ({
        id: `qa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        projectKey: String(p.projectKey || '').trim().toUpperCase(),
        projectTitle: String(p.projectTitle || '').trim(),
        qaName,
        status: String(p.status || '').trim(),
        assignedAt: nowIso(),
        updatedAt: nowIso(),
        isDeleted: 'false',
        deletedAt: '',
        note: String(body.note || '').trim()
      }))

      await googleRequest(`/values/${encodeURIComponent(`${sheetName}!A:J`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        body: JSON.stringify({ values: created.map(toRow) })
      })
      return res.status(201).json({ ok: true, items: created, source: 'google_sheets' })
    }

    if (req.method === 'PUT') {
      const body = parseBody(req)
      const id = String(body.id || '').trim()
      const qaName = String(body.qaName || '').trim()
      if (!id || !qaName) return res.status(400).json({ error: 'id and qaName are required' })

      const items = await listItems(sheetName, true)
      const target = items.find((x) => x.id === id)
      if (!target) return res.status(404).json({ error: 'Item not found' })

      const updated = { ...target, qaName, updatedAt: nowIso() }
      const range = `${sheetName}!A${target._rowNumber}:J${target._rowNumber}`
      await googleRequest(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: [toRow(updated)] })
      })
      return res.status(200).json({ ok: true, item: updated, source: 'google_sheets' })
    }

    if (req.method === 'DELETE') {
      const body = parseBody(req)
      const id = String(body.id || req.query?.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id is required' })

      const items = await listItems(sheetName, true)
      const target = items.find((x) => x.id === id)
      if (!target) return res.status(404).json({ error: 'Item not found' })

      const deleted = { ...target, isDeleted: 'true', deletedAt: nowIso(), updatedAt: nowIso() }
      const range = `${sheetName}!A${target._rowNumber}:J${target._rowNumber}`
      await googleRequest(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: [toRow(deleted)] })
      })
      return res.status(200).json({ ok: true, id, softDeleted: true, source: 'google_sheets' })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unknown error' })
  }
}
