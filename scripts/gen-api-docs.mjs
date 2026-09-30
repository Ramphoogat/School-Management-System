// Builds docs/API.md from the controllers in apps/api/src, so the reference cannot drift from the code.
// Run from the repo root:  node scripts/gen-api-docs.mjs
import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = 'apps/api/src'
const files = []
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && files.push(p) } }
walk(SRC)

const HTTP = /^\s*@(Get|Post|Put|Patch|Delete)\((.*)\)\s*$/
const str = (s) => (s.match(/'([^']*)'|"([^"]*)"/) ?? []).slice(1).find((x) => x !== undefined) ?? ''
const cleanDoc = (lines) => lines.map((l) => l.replace(/^\s*\/?\*+\/?\s?/, '').replace(/\*\/\s*$/, '').trim()).filter(Boolean).join(' ')

const controllers = []
const gateways = []

for (const file of files.sort()) {
  const lines = readFileSync(file, 'utf8').split('\n')
  let cls = null
  let pendingDoc = []
  let pending = []      // decorators collected above the next member
  let inDoc = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()

    if (inDoc || t.startsWith('/**')) {
      inDoc = !t.includes('*/') || (t.startsWith('/**') && !t.includes('*/'))
      if (t.startsWith('/**')) pendingDoc = []
      pendingDoc.push(t)
      if (t.includes('*/')) inDoc = false
      continue
    }

    if (t.startsWith('@')) {
      pending.push(t)
      // a decorator that spans lines
      let j = i
      while ((pending[pending.length - 1].split('(').length) > (pending[pending.length - 1].split(')').length) && j + 1 < lines.length) { j++; pending[pending.length - 1] += ' ' + lines[j].trim() }
      i = j
      continue
    }

    const c = t.match(/^export class (\w+)/)
    if (c) {
      const ctl = pending.find((p) => p.startsWith('@Controller'))
      const gw = pending.find((p) => p.startsWith('@WebSocketGateway'))
      cls = null
      if (ctl) {
        const guards = pending.filter((p) => p.startsWith('@UseGuards')).join(' ')
        const perm = pending.find((p) => p.startsWith('@RequirePermission'))
        cls = { name: c[1], base: str(ctl), auth: /AuthGuard/.test(guards), perm: perm ? perm.match(/\('([^']+)',\s*'([^']+)'\)/)?.slice(1, 3).join(':') : null, file: relative('.', file).replace(/\\/g, '/'), routes: [] }
        controllers.push(cls)
      } else if (gw) {
        cls = { name: c[1], file: relative('.', file).replace(/\\/g, '/'), events: [], gateway: true }
        gateways.push(cls)
      }
      pending = []; pendingDoc = []
      continue
    }

    if (cls && pending.length && /^(async\s+)?\w+\(|^(async\s+)?\w+\s*=|^private|^public/.test(t)) {
      const http = pending.map((p) => p.match(HTTP)).find(Boolean)
      const msg = pending.find((p) => p.startsWith('@SubscribeMessage'))
      const doc = cleanDoc(pendingDoc)
      if (http && !cls.gateway) {
        const perm = pending.find((p) => p.startsWith('@RequirePermission'))
        const guards = pending.filter((p) => p.startsWith('@UseGuards')).join(' ')
        const body = (t.match(/@Body\(\)\s*\w+:\s*(\w+)/) ?? [])[1] ?? (lines.slice(i, i + 3).join(' ').match(/@Body\(\)\s*\w+:\s*(\w+)/) ?? [])[1]
        const queries = [...lines.slice(i, i + 4).join(' ').matchAll(/@Query\('(\w+)'\)/g)].map((m) => m[1])
        let k = i + 1
        while (k < lines.length && !/^  @(Get|Post|Put|Patch|Delete|SubscribeMessage)/.test(lines[k]) && !/^}/.test(lines[k])) k++
        const inCode = /(can|roleCan|canManage|canJoin|canRead|canSee)\(|ForbiddenException|UnauthorizedException/.test(lines.slice(i, k).join(' '))
        cls.routes.push({ inCode,
          method: http[1].toUpperCase(), sub: str(http[2]),
          perm: perm ? perm.match(/\('([^']+)',\s*'([^']+)'\)/)?.slice(1, 3).join(':') : null,
          auth: cls.auth || /AuthGuard/.test(guards), doc, body, queries,
        })
      } else if (msg && cls.gateway) {
        cls.events.push({ name: str(msg), doc })
      }
      pending = []; pendingDoc = []
      continue
    }
    if (t && !t.startsWith('//')) { pending = []; if (!t.startsWith('*')) pendingDoc = [] }
  }
}

const join2 = (a, b) => ('/api/' + [a, b].filter(Boolean).join('/')).replace(/\/+/g, '/')
const out = []
out.push('# API reference', '')
out.push('_Generated from the controllers by `node scripts/gen-api-docs.mjs`. Do not edit by hand; change the code or the script and run it again._', '')
out.push('## How the API works', '')
out.push(
  '- **Base address:** `http://localhost:4000/api` in development. Every path below starts with `/api`.',
  '- **Format:** JSON in and out. File uploads use `multipart/form-data`. Errors look like `{ "statusCode": 400, "message": "…" }`, where `message` may be a list for validation errors.',
  '- **Signing in:** `POST /api/auth/login` returns `accessToken` and `refreshToken`. Send `Authorization: Bearer <accessToken>` on every other call. When a call returns 401, `POST /api/auth/refresh` with the refresh token gives a new pair.',
  '- **Who may call what:** the **Permission** column is a `resource:action` pair from `packages/permissions`. It is checked by the server on every call, together with scope (own class, own children, whole school). Routes marked _checked in code_ decide inside the handler, for example "the class teacher only". A dash means the route has no permission of its own: any signed-in person may call it, and the service narrows what they get (their own class, children or school). **Public** routes need no sign-in.',
  '- **Schools:** every signed-in call is limited to the caller\'s own school. The Super Admin only reaches `/api/platform`.',
  '- **Lists:** the audit log takes `page` and `pageSize`. Students, admissions, invoices, certificates and leave are cut off at the school\'s list size (School branding → Long lists); students, admissions and invoices send the real total in the `X-Total-Count` header.',
  '- **Bulk actions** take a list of ids and return `{ succeeded, total, failed: [{ id, error }] }`. One bad row never blocks the others.',
  '- **Live events:** Socket.IO on the same address and port, authenticated with `auth: { token }`. See the last section.',
  '',
)

const modules = new Map()
for (const c of controllers) {
  const key = c.file.split('/')[3]
  if (!modules.has(key)) modules.set(key, [])
  modules.get(key).push(c)
}
for (const [mod, cs] of [...modules].sort((a, b) => a[0].localeCompare(b[0]))) {
  const rows = cs.flatMap((c) => c.routes.map((r) => ({ ...r, path: join2(c.base, r.sub), classPerm: c.perm })))
  if (!rows.length) continue
  out.push(`## ${mod}`, '', '| Method | Path | Permission | Notes |', '|---|---|---|---|')
  for (const r of rows) {
    const perm = !r.auth ? '**Public**' : (r.perm ?? r.classPerm) ? `\`${r.perm ?? r.classPerm}\`` : r.inCode ? '_checked in code_' : '—'
    const notes = [r.doc, r.body ? `Body: \`${r.body}\`` : '', r.queries.length ? `Query: ${r.queries.map((q) => `\`${q}\``).join(', ')}` : ''].filter(Boolean).join(' ').replace(/\|/g, '\\|')
    out.push(`| ${r.method} | \`${r.path.replace(/\/$/, '')}\` | ${perm} | ${notes} |`)
  }
  out.push('')
}

out.push('## Live events (Socket.IO)', '', 'Connect to the API address with `io(url, { auth: { token: accessToken } })`. A bad token is disconnected at once. Each event below is sent by the client; the server answers with an acknowledgement `{ ok, … }` where it says so.', '')
for (const g of gateways.filter((g) => g.events.length)) {
  out.push(`### ${g.name}`, `_Source: \`${g.file}\`_`, '', '| Event | Notes |', '|---|---|')
  for (const e of g.events) out.push(`| \`${e.name}\` | ${e.doc.replace(/\|/g, '\\|')} |`)
  out.push('')
}
out.push('Events the server sends include `voice:peer-joined`, `voice:peer-left`, `voice:peer-state`, `voice:signal`, `voice:muted`, `voice:removed`, `voice:closed` (voice calls), plus chat, direct-message, presence and "screen changed" notices. See the gateway source files for the exact payloads.', '')

mkdirSync('docs', { recursive: true })
writeFileSync('docs/API.md', out.join('\n'))
console.log(`docs/API.md: ${controllers.reduce((n, c) => n + c.routes.length, 0)} routes, ${gateways.reduce((n, g) => n + g.events.length, 0)} socket events`)
