import crypto from 'crypto'

const memoryStore = []
const tokenCache = {
  accessToken: '',
  expiresAt: 0
}
const listCache = {
  key: '',
  items: null,
  expiresAt: 0
}

const SHEET_COLUMNS = ['id', 'plannerRefId', 'sourceType', 'key', 'title', 'owner', 'note', 'color', 'isDone', 'doneAt', 'createdAt', 'updatedAt', 'isDeleted', 'deletedAt', 'start', 'end', 'logsJson']
const DEFAULT_GOOGLE_SHEETS_URL = 'https://docs.google.com/spreadsheets/d/1FzgaU35q3dvDVAf3vAqirRcUFemd_OThXr1o7NdJrGI/edit?usp=sharing'
const DEFAULT_TASK_COLOR = '#2c6e91'

function firstEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim()
    if (value) return value
  }
  return ''
}

function nowIso() {
  return new Date().toISOString()
}

function cloneItems(items = []) {
  return items.map((item) => ({ ...item }))
}

function invalidateListCache() {
  listCache.key = ''
  listCache.items = null
  listCache.expiresAt = 0
}

function normalizeLogs(rawLogs = []) {
  const source = typeof rawLogs === 'string'
    ? (() => {
        try {
          const parsed = JSON.parse(rawLogs)
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      })()
    : Array.isArray(rawLogs)
      ? rawLogs
      : []

  return source
    .map((entry) => ({
      id: String(entry?.id || '').trim() || `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      message: String(entry?.message || '').trim(),
      createdAt: String(entry?.createdAt || '').trim() || nowIso()
    }))
    .filter((entry) => entry.message)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}

function normalizeTodo(raw = {}, forUpdate = false) {
  const id = String(raw.id || '').trim() || `todo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const plannerRefId = String(raw.plannerRefId || '').trim()
  const sourceType = String(raw.sourceType || 'todo').trim().toLowerCase() || 'todo'
  const key = String(raw.key || '').trim().toUpperCase()
  const title = String(raw.title || '').trim()
  const owner = String(raw.owner || '').trim()
  const note = String(raw.note || '').trim()
  const color = /^#[0-9a-fA-F]{6}$/.test(String(raw.color || '').trim()) ? String(raw.color || '').trim() : DEFAULT_TASK_COLOR
  const isDone = String(raw.isDone || '').trim().toLowerCase() === 'true'
    || raw.isDone === true
    ? 'true'
    : 'false'
  const doneAt = isDone === 'true'
    ? String(raw.doneAt || '').trim() || nowIso()
    : ''
  const createdAt = String(raw.createdAt || '').trim() || nowIso()
  const updatedAt = nowIso()
  const isDeleted = String(raw.isDeleted || '').trim().toLowerCase() === 'true' ? 'true' : 'false'
  const deletedAt = String(raw.deletedAt || '').trim()
  const start = String(raw.start || '').trim()
  const end = String(raw.end || '').trim()
  const logs = normalizeLogs(raw.logs || raw.logsJson)

  if (!forUpdate && !title) throw new Error('title is required')
  if (forUpdate && !id) throw new Error('id is required for update')
  if (sourceType === 'planner' && !plannerRefId) throw new Error('plannerRefId is required for planner items')
  if ((start && !end) || (!start && end)) throw new Error('start and end must be provided together')
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error('invalid start date format')
  if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('invalid end date format')
  if (start && end && end < start) throw new Error('end date must be on or after start date')

  return {
    id,
    plannerRefId,
    sourceType,
    key,
    title,
    owner,
    note,
    color,
    isDone,
    doneAt,
    createdAt,
    updatedAt,
    isDeleted,
    deletedAt,
    start,
    end,
    logs
  }
}

function parseSpreadsheetId() {
  const directId = firstEnv('GOOGLE_SHEETS_SPREADSHEET_ID', 'GOOGLE_SPREADSHEET_ID')
  if (directId) return directId
  const url = firstEnv('GOOGLE_SHEETS_URL', 'GOOGLE_SHEET_URL') || DEFAULT_GOOGLE_SHEETS_URL
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return match ? match[1] : ''
}

function getServiceAccountEmail() {
  if (firstEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL')) {
    return firstEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL')
  }
  const jsonRaw = firstEnv('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!jsonRaw) return ''
  try {
    return String(JSON.parse(jsonRaw).client_email || '').trim()
  } catch {
    return ''
  }
}

function getPrivateKey() {
  const directKey = firstEnv('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEETS_PRIVATE_KEY')
  if (directKey) return directKey.replace(/\\n/g, '\n').trim()
  const jsonRaw = firstEnv('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!jsonRaw) return ''
  try {
    return String(JSON.parse(jsonRaw).private_key || '').replace(/\\n/g, '\n').trim()
  } catch {
    return ''
  }
}

function isGoogleSheetsConfigured() {
  return Boolean(parseSpreadsheetId() && getServiceAccountEmail() && getPrivateKey())
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function getGoogleAccessToken() {
  const now = Math.floor(Date.now() / 1000)
  if (tokenCache.accessToken && tokenCache.expiresAt > now + 60) return tokenCache.accessToken

  const email = getServiceAccountEmail()
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

async function ensureSheetExists(sheetName) {
  const meta = await googleRequest('?fields=sheets.properties.title')
  const titles = (meta.sheets || []).map((sheet) => String(sheet?.properties?.title || '').trim())
  if (titles.includes(sheetName)) return
  await googleRequest(':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: sheetName } } }]
    })
  })
}

async function ensureSheetHeader(sheetName) {
  await ensureSheetExists(sheetName)
  const range = `${sheetName}!A1:Q1`
  const result = await googleRequest(`/values/${encodeURIComponent(range)}`)
  const current = result.values?.[0] || []
  const expected = SHEET_COLUMNS
  const isSame = expected.length === current.length && expected.every((value, index) => value === current[index])
  if (isSame) return

  await googleRequest(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [expected] })
  })
}

function toRowValues(item) {
  return [
    item.id,
    item.plannerRefId || '',
    item.sourceType || 'todo',
    item.key || '',
    item.title || '',
    item.owner || '',
    item.note || '',
    item.color || DEFAULT_TASK_COLOR,
    item.isDone || 'false',
    item.doneAt || '',
    item.createdAt || '',
    item.updatedAt || '',
    item.isDeleted || 'false',
    item.deletedAt || '',
    item.start || '',
    item.end || '',
    JSON.stringify(Array.isArray(item.logs) ? item.logs : [])
  ]
}

function rowToItem(row = [], rowNumber = 0) {
  return {
    id: String(row[0] || '').trim(),
    plannerRefId: String(row[1] || '').trim(),
    sourceType: String(row[2] || 'todo').trim().toLowerCase() || 'todo',
    key: String(row[3] || '').trim(),
    title: String(row[4] || '').trim(),
    owner: String(row[5] || '').trim(),
    note: String(row[6] || '').trim(),
    color: String(row[7] || '').trim() || DEFAULT_TASK_COLOR,
    isDone: String(row[8] || '').trim().toLowerCase() === 'true',
    doneAt: String(row[9] || '').trim(),
    createdAt: String(row[10] || '').trim(),
    updatedAt: String(row[11] || '').trim(),
    isDeleted: String(row[12] || '').trim().toLowerCase() === 'true',
    deletedAt: String(row[13] || '').trim(),
    start: String(row.length >= 17 ? row[14] || '' : '').trim(),
    end: String(row.length >= 17 ? row[15] || '' : '').trim(),
    logs: normalizeLogs(String(row.length >= 17 ? row[16] : row[14] || '').trim()),
    _rowNumber: rowNumber
  }
}

async function listGoogleSheetItems(sheetName, includeDeleted = false) {
  const cacheKey = `${sheetName}:${includeDeleted ? 'all' : 'active'}`
  if (listCache.key === cacheKey && listCache.items && listCache.expiresAt > Date.now()) {
    return cloneItems(listCache.items)
  }

  await ensureSheetHeader(sheetName)
  const range = `${sheetName}!A2:Q`
  const result = await googleRequest(`/values/${encodeURIComponent(range)}`)
  const rows = result.values || []
  const all = rows.map((row, idx) => rowToItem(row, idx + 2)).filter((item) => item.id && item.title)
  const items = includeDeleted ? all : all.filter((item) => !item.isDeleted)

  listCache.key = cacheKey
  listCache.items = cloneItems(items)
  listCache.expiresAt = Date.now() + 30_000

  return items
}

async function appendGoogleSheetItem(sheetName, item) {
  const range = `${sheetName}!A:Q`
  await googleRequest(`/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [toRowValues(item)] })
  })
  invalidateListCache()
  return item
}

async function updateGoogleSheetItem(sheetName, id, patch) {
  const items = await listGoogleSheetItems(sheetName, true)
  const target = items.find((item) => item.id === id)
  if (!target) throw new Error('Item not found')

  const merged = normalizeTodo({ ...target, ...patch, id, createdAt: target.createdAt || nowIso() }, true)
  const range = `${sheetName}!A${target._rowNumber}:Q${target._rowNumber}`
  await googleRequest(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [toRowValues(merged)] })
  })
  invalidateListCache()
  return merged
}

async function softDeleteGoogleSheetItem(sheetName, id) {
  const items = await listGoogleSheetItems(sheetName, true)
  const target = items.find((item) => item.id === id)
  if (!target) throw new Error('Item not found')

  const deleted = normalizeTodo({ ...target, isDeleted: 'true', deletedAt: nowIso() }, true)
  const range = `${sheetName}!A${target._rowNumber}:Q${target._rowNumber}`
  await googleRequest(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [toRowValues(deleted)] })
  })
  invalidateListCache()
  return { ok: true, id, softDeleted: true }
}

function itemMatchesQuery(item, queryText) {
  const q = String(queryText || '').trim().toLowerCase()
  if (!q) return true
  const blob = [
    item.id,
    item.plannerRefId,
    item.sourceType,
    item.key,
    item.title,
    item.owner,
    item.note,
    item.start,
    item.end,
    ...(Array.isArray(item.logs) ? item.logs.map((entry) => `${entry.message} ${entry.createdAt}`) : [])
  ].join(' ').toLowerCase()
  return blob.includes(q)
}

function filterItemsByQuery(items, query = {}) {
  const q = String(query.q || '').trim()
  const sourceType = String(query.sourceType || '').trim().toLowerCase()
  const isDone = String(query.isDone || '').trim().toLowerCase()
  const plannerRefId = String(query.plannerRefId || '').trim()
  const limit = Number(query.limit || 0)

  let filtered = items.filter((item) => itemMatchesQuery(item, q))

  if (sourceType) {
    filtered = filtered.filter((item) => String(item.sourceType || 'todo').trim().toLowerCase() === sourceType)
  }

  if (isDone === 'true' || isDone === 'false') {
    filtered = filtered.filter((item) => String(Boolean(item.isDone)) === isDone)
  }

  if (plannerRefId) {
    filtered = filtered.filter((item) => String(item.plannerRefId || '').trim() === plannerRefId)
  }

  filtered = filtered.sort((a, b) => {
    if (Boolean(a.isDone) !== Boolean(b.isDone)) return a.isDone ? 1 : -1
    const aUpdated = String(a.updatedAt || a.createdAt || '')
    const bUpdated = String(b.updatedAt || b.createdAt || '')
    if (aUpdated !== bUpdated) return bUpdated.localeCompare(aUpdated)
    return String(a.title || '').localeCompare(String(b.title || ''))
  })

  if (limit > 0) filtered = filtered.slice(0, limit)
  return filtered
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

  const sheetName = firstEnv('GOOGLE_TASK_SHEET_TAB_NAME', 'GOOGLE_TODO_SHEET_TAB_NAME') || 'PlannerTasks'

  try {
    if (isGoogleSheetsConfigured()) {
      if (req.method === 'GET') {
        const includeDeleted = String(req.query?.includeDeleted || '').toLowerCase() === 'true'
        const rawItems = await listGoogleSheetItems(sheetName, includeDeleted)
        const items = filterItemsByQuery(rawItems, req.query || {})
        return res.status(200).json({ items, source: 'google_sheets', sheetName })
      }

      if (req.method === 'POST') {
        const item = normalizeTodo(parseBody(req))
        const saved = await appendGoogleSheetItem(sheetName, item)
        return res.status(201).json({ ok: true, item: saved, source: 'google_sheets', sheetName })
      }

      if (req.method === 'PUT') {
        const body = parseBody(req)
        const id = String(body.id || '').trim()
        if (!id) return res.status(400).json({ error: 'id is required' })
        const updated = await updateGoogleSheetItem(sheetName, id, body)
        return res.status(200).json({ ok: true, item: updated, source: 'google_sheets', sheetName })
      }

      if (req.method === 'DELETE') {
        const body = parseBody(req)
        const id = String(body.id || req.query?.id || '').trim()
        if (!id) return res.status(400).json({ error: 'id is required' })
        const deleted = await softDeleteGoogleSheetItem(sheetName, id)
        return res.status(200).json({ ...deleted, source: 'google_sheets', sheetName })
      }

      return res.status(405).json({ error: 'Method not allowed' })
    }

    if (req.method === 'GET') {
      const includeDeleted = String(req.query?.includeDeleted || '').toLowerCase() === 'true'
      const rawItems = includeDeleted ? memoryStore : memoryStore.filter((item) => String(item.isDeleted || 'false') !== 'true')
      const items = filterItemsByQuery(rawItems, req.query || {})
      return res.status(200).json({ items, source: 'memory', warning: 'Google Sheets not configured', sheetName })
    }

    if (req.method === 'POST') {
      const item = normalizeTodo(parseBody(req))
      memoryStore.unshift(item)
      return res.status(201).json({ ok: true, item, source: 'memory', warning: 'Google Sheets not configured', sheetName })
    }

    if (req.method === 'PUT') {
      const body = parseBody(req)
      const id = String(body.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id is required' })
      const idx = memoryStore.findIndex((item) => item.id === id)
      if (idx < 0) return res.status(404).json({ error: 'Item not found' })

      const merged = normalizeTodo({ ...memoryStore[idx], ...body, id }, true)
      memoryStore[idx] = merged
      return res.status(200).json({ ok: true, item: merged, source: 'memory', warning: 'Google Sheets not configured', sheetName })
    }

    if (req.method === 'DELETE') {
      const body = parseBody(req)
      const id = String(body.id || req.query?.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id is required' })
      const idx = memoryStore.findIndex((item) => item.id === id)
      if (idx < 0) return res.status(404).json({ error: 'Item not found' })
      memoryStore[idx] = normalizeTodo({ ...memoryStore[idx], isDeleted: 'true', deletedAt: nowIso(), id }, true)
      return res.status(200).json({ ok: true, id, softDeleted: true, source: 'memory', warning: 'Google Sheets not configured', sheetName })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unknown error' })
  }
}
