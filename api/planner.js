import crypto from 'crypto'

const memoryStore = []
const tokenCache = {
  accessToken: '',
  expiresAt: 0
}

const SHEET_COLUMNS = ['id', 'key', 'title', 'sprint', 'start', 'end', 'owner', 'note', 'createdAt', 'updatedAt', 'isDeleted', 'deletedAt', 'entityType']

function nowIso() {
  return new Date().toISOString()
}

function normalizeItem(raw = {}, forUpdate = false) {
  const id = String(raw.id || '').trim() || `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const title = String(raw.title || '').trim()
  const key = String(raw.key || '').trim().toUpperCase()
  const sprint = String(raw.sprint || '').trim()
  const start = String(raw.start || '').trim()
  const end = String(raw.end || '').trim()
  const owner = String(raw.owner || '').trim()
  const note = String(raw.note || '').trim()
  const createdAt = String(raw.createdAt || '').trim() || nowIso()
  const updatedAt = nowIso()
  const isDeleted = String(raw.isDeleted || '').trim().toLowerCase() === 'true' ? 'true' : 'false'
  const deletedAt = String(raw.deletedAt || '').trim()
  const entityType = String(raw.entityType || 'manual').trim() || 'manual'

  if (!forUpdate && (!title || !start || !end)) throw new Error('title, start, end are required')
  if (forUpdate && !id) throw new Error('id is required for update')

  return {
    id,
    key,
    title,
    sprint,
    start,
    end,
    owner,
    note,
    createdAt,
    updatedAt,
    isDeleted,
    deletedAt,
    entityType,
    source: 'manual'
  }
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

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = getPrivateKey()
  if (!email || !privateKey) throw new Error('Missing Google service account credentials')

  const header = { alg: 'RS256', typ: 'JWT' }
  const claimSet = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }

  const encodedHeader = base64url(JSON.stringify(header))
  const encodedClaim = base64url(JSON.stringify(claimSet))
  const unsignedJwt = `${encodedHeader}.${encodedClaim}`

  const signer = crypto.createSign('RSA-SHA256')
  signer.update(unsignedJwt)
  signer.end()
  const signature = signer.sign(privateKey)
  const jwt = `${unsignedJwt}.${base64url(signature)}`

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  })

  const payload = await response.json()
  if (!response.ok) throw new Error(`Google token error: ${payload.error || response.statusText}`)

  tokenCache.accessToken = payload.access_token
  tokenCache.expiresAt = now + Number(payload.expires_in || 3600)
  return tokenCache.accessToken
}

async function googleRequest(path, options = {}) {
  const token = await getGoogleAccessToken()
  const spreadsheetId = parseSpreadsheetId()
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`

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
  if (!response.ok) {
    const message = data?.error?.message || response.statusText
    throw new Error(`Google Sheets API error: ${message}`)
  }
  return data
}

async function ensureSheetHeader(sheetName) {
  const range = `${sheetName}!A1:M1`
  const result = await googleRequest(`/values/${encodeURIComponent(range)}`)
  const current = result.values?.[0] || []
  const expected = SHEET_COLUMNS
  const isSame = expected.length === current.length && expected.every((v, i) => v === current[i])
  if (isSame) return

  await googleRequest(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [expected] })
  })
}

function toRowValues(item) {
  return [
    item.id,
    item.key,
    item.title,
    item.sprint,
    item.start,
    item.end,
    item.owner,
    item.note,
    item.createdAt,
    item.updatedAt,
    item.isDeleted || 'false',
    item.deletedAt || '',
    item.entityType || 'manual'
  ]
}

function rowToItem(row = [], rowNumber = 0) {
  return {
    id: String(row[0] || '').trim(),
    key: String(row[1] || '').trim(),
    title: String(row[2] || '').trim(),
    sprint: String(row[3] || '').trim(),
    start: String(row[4] || '').trim(),
    end: String(row[5] || '').trim(),
    owner: String(row[6] || '').trim(),
    note: String(row[7] || '').trim(),
    createdAt: String(row[8] || '').trim(),
    updatedAt: String(row[9] || '').trim(),
    isDeleted: String(row[10] || '').trim().toLowerCase() === 'true',
    deletedAt: String(row[11] || '').trim(),
    entityType: String(row[12] || 'manual').trim() || 'manual',
    source: 'manual',
    _rowNumber: rowNumber
  }
}

async function listGoogleSheetItems(sheetName, includeDeleted = false) {
  await ensureSheetHeader(sheetName)
  const range = `${sheetName}!A2:M`
  const result = await googleRequest(`/values/${encodeURIComponent(range)}`)
  const rows = result.values || []
  const all = rows.map((row, idx) => rowToItem(row, idx + 2)).filter((item) => item.id && item.title)
  return includeDeleted ? all : all.filter((x) => !x.isDeleted)
}

async function appendGoogleSheetItem(sheetName, item) {
  const range = `${sheetName}!A:M`
  await googleRequest(`/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [toRowValues(item)] })
  })
  return item
}

async function updateGoogleSheetItem(sheetName, id, patch) {
  const items = await listGoogleSheetItems(sheetName, true)
  const target = items.find((x) => x.id === id)
  if (!target) throw new Error('Item not found')

  const merged = normalizeItem({ ...target, ...patch, id, createdAt: target.createdAt || nowIso() }, true)
  if (!merged.title || !merged.start || !merged.end) throw new Error('title, start, end are required')

  const range = `${sheetName}!A${target._rowNumber}:M${target._rowNumber}`
  await googleRequest(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [toRowValues(merged)] })
  })
  return merged
}

async function softDeleteGoogleSheetItem(sheetName, id) {
  const items = await listGoogleSheetItems(sheetName, true)
  const target = items.find((x) => x.id === id)
  if (!target) throw new Error('Item not found')

  const deleted = normalizeItem({ ...target, isDeleted: 'true', deletedAt: nowIso() }, true)
  const range = `${sheetName}!A${target._rowNumber}:M${target._rowNumber}`
  await googleRequest(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [toRowValues(deleted)] })
  })
  return { ok: true, id, softDeleted: true }
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const sheetName = process.env.GOOGLE_SHEETS_TAB_NAME || 'Planner'

  try {
    if (isGoogleSheetsConfigured()) {
      if (req.method === 'GET') {
        const includeDeleted = String(req.query?.includeDeleted || '').toLowerCase() === 'true'
        const items = await listGoogleSheetItems(sheetName, includeDeleted)
        return res.status(200).json({ items, source: 'google_sheets' })
      }

      if (req.method === 'POST') {
        const item = normalizeItem(parseBody(req))
        const saved = await appendGoogleSheetItem(sheetName, item)
        return res.status(201).json({ ok: true, item: saved, source: 'google_sheets' })
      }

      if (req.method === 'PUT') {
        const body = parseBody(req)
        const id = String(body.id || '').trim()
        if (!id) return res.status(400).json({ error: 'id is required' })
        const updated = await updateGoogleSheetItem(sheetName, id, body)
        return res.status(200).json({ ok: true, item: updated, source: 'google_sheets' })
      }

      if (req.method === 'DELETE') {
        const body = parseBody(req)
        const id = String(body.id || req.query?.id || '').trim()
        if (!id) return res.status(400).json({ error: 'id is required' })
        const deleted = await softDeleteGoogleSheetItem(sheetName, id)
        return res.status(200).json({ ...deleted, source: 'google_sheets' })
      }

      return res.status(405).json({ error: 'Method not allowed' })
    }

    if (req.method === 'GET') {
      const includeDeleted = String(req.query?.includeDeleted || '').toLowerCase() === 'true'
      const items = includeDeleted ? memoryStore : memoryStore.filter((x) => String(x.isDeleted || 'false') !== 'true')
      return res.status(200).json({ items, source: 'memory', warning: 'Google Sheets not configured' })
    }

    if (req.method === 'POST') {
      const item = normalizeItem(parseBody(req))
      memoryStore.unshift(item)
      return res.status(201).json({ ok: true, item, source: 'memory', warning: 'Google Sheets not configured' })
    }

    if (req.method === 'PUT') {
      const body = parseBody(req)
      const id = String(body.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id is required' })
      const idx = memoryStore.findIndex((x) => x.id === id)
      if (idx < 0) return res.status(404).json({ error: 'Item not found' })

      const merged = normalizeItem({ ...memoryStore[idx], ...body, id }, true)
      if (!merged.title || !merged.start || !merged.end) return res.status(400).json({ error: 'title, start, end are required' })
      memoryStore[idx] = merged
      return res.status(200).json({ ok: true, item: merged, source: 'memory', warning: 'Google Sheets not configured' })
    }

    if (req.method === 'DELETE') {
      const body = parseBody(req)
      const id = String(body.id || req.query?.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id is required' })
      const idx = memoryStore.findIndex((x) => x.id === id)
      if (idx < 0) return res.status(404).json({ error: 'Item not found' })
      memoryStore[idx] = normalizeItem({ ...memoryStore[idx], isDeleted: 'true', deletedAt: nowIso(), id }, true)
      return res.status(200).json({ ok: true, id, softDeleted: true, source: 'memory', warning: 'Google Sheets not configured' })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unknown error' })
  }
}
