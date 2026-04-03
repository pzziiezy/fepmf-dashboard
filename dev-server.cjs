const http = require('http')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const port = Number(process.env.PORT || 3000)
const root = path.join(process.cwd(), 'public')

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    value = value.replace(/\\n/g, '\n')
    if (!(key in process.env)) process.env[key] = value
  }
}

async function readRequestBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  const contentType = String(req.headers['content-type'] || '').toLowerCase()
  if (!raw) return {}
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }
  return raw
}

function createApiResponse(res) {
  return {
    status(code) {
      res.statusCode = code
      return this
    },
    setHeader(name, value) {
      res.setHeader(name, value)
      return this
    },
    json(payload) {
      if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(payload))
      return this
    },
    end(payload = '') {
      res.end(payload)
      return this
    }
  }
}

async function handleApiRequest(req, res, urlPath) {
  const filePath = safeJoin(process.cwd(), `${urlPath.replace(/^\/+/, '')}.js`)
  if (!filePath || !fs.existsSync(filePath)) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'API route not found' }))
    return
  }

  const requestUrl = new URL(req.url || urlPath, `http://${req.headers.host || `localhost:${port}`}`)
  const body = await readRequestBody(req)
  const moduleUrl = `${pathToFileURL(filePath).href}?t=${fs.statSync(filePath).mtimeMs}`
  const mod = await import(moduleUrl)
  const handler = mod.default

  if (typeof handler !== 'function') {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'Invalid API handler export' }))
    return
  }

  const query = Object.fromEntries(requestUrl.searchParams.entries())
  const apiReq = {
    method: req.method,
    headers: req.headers,
    body,
    query,
    url: req.url
  }

  await handler(apiReq, createApiResponse(res))
}

function safeJoin(base, target) {
  const resolved = path.resolve(base, target)
  if (!resolved.startsWith(path.resolve(base))) return null
  return resolved
}

loadEnvFile(path.join(process.cwd(), '.env.local'))

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0]

  if (urlPath.startsWith('/api/')) {
    handleApiRequest(req, res, urlPath).catch((error) => {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: error.message || 'Local API error' }))
    })
    return
  }

  const requested = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
  let filePath = safeJoin(root, requested)
  if (!filePath) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html')
  }

  if (!fs.existsSync(filePath)) {
    res.statusCode = 404
    res.end('Not found')
    return
  }

  const ext = path.extname(filePath).toLowerCase()
  res.statusCode = 200
  res.setHeader('Content-Type', mime[ext] || 'application/octet-stream')
  if (ext === '.html' || ext === '.js' || ext === '.css') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    res.setHeader('Surrogate-Control', 'no-store')
  }
  fs.createReadStream(filePath).pipe(res)
})

server.listen(port, () => {
  console.log(`Local preview server running on http://localhost:${port}`)
})
