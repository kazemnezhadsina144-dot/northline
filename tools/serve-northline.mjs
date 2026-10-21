import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const root = join(process.cwd(), 'build/cowswap')
const port = Number(process.env.PORT || 3410)
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

function send(response, status, body, type) {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  response.end(body)
}

function fileFor(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  const candidate = join(root, clean)
  if (!candidate.startsWith(root)) return null
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return null
}

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  if (url.pathname === '/api/health') {
    send(response, 200, JSON.stringify({
      ok: true,
      product: 'northline',
      chainId: 8453,
      protocol: 'cow-protocol',
      custody: false,
      trading: 'user-signed',
    }), 'application/json; charset=utf-8')
    return
  }
  const asset = fileFor(url.pathname === '/' ? '/index.html' : url.pathname)
  const file = asset || join(root, 'index.html')
  if (!existsSync(file)) {
    send(response, 503, JSON.stringify({ ok: false, error: 'BUILD_MISSING' }), 'application/json; charset=utf-8')
    return
  }
  response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' })
  createReadStream(file).pipe(response)
})

server.listen(port, '0.0.0.0')
