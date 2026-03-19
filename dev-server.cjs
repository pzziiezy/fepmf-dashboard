const http = require('http')
const fs = require('fs')
const path = require('path')

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

function safeJoin(base, target) {
  const resolved = path.resolve(base, target)
  if (!resolved.startsWith(path.resolve(base))) return null
  return resolved
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0]

  if (urlPath.startsWith('/api/')) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'API route should be handled by Vercel dev runtime.' }))
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
  fs.createReadStream(filePath).pipe(res)
})

server.listen(port, () => {
  console.log(`Local preview server running on http://localhost:${port}`)
})
