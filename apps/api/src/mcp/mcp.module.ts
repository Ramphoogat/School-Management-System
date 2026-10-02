import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Module, NotFoundException, Param, Post, Req, Res, UseGuards } from '@nestjs/common'
import { IsString, MaxLength, MinLength } from 'class-validator'
import type { Request, Response } from 'express'
import { createHash, randomBytes } from 'node:crypto'
import { can } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { AuthGuard, CurrentUser, type AuthUser } from '../auth/guards'

const PREFIX = 'mcp_'
const MAX_CONNECTIONS = 20
const CALLS_PER_MINUTE = 120
const hash = (secret: string) => createHash('sha256').update(secret).digest('hex')

class ConnectionDto {
  @IsString() @MinLength(2) @MaxLength(60) name: string
}

interface Tool { name: string; description: string; inputSchema: object; run: (u: AuthUser, args: Record<string, unknown>) => Promise<unknown> }

/**
 * The school's MCP server. An outside application connects with a key made on the Settings page and can then read the school's
 * data as the person who made the key: it sees what that person sees and nothing more. Every tool only reads.
 */
@Controller('mcp')
export class McpController {
  private calls = new Map<string, { n: number; reset: number }>()
  private tools: Tool[]

  constructor(private prisma: PrismaService, private audit: AuditService, private guard: AuthGuard) {
    const staffOnly = (u: AuthUser) => { if (!can(u, 'users', 'manage', { schoolId: u.schoolId })) throw new ForbiddenException('This needs an admin or principal') }
    this.tools = [
      {
        name: 'school_overview',
        description: 'How many students, teachers, parents, classes and active staff the school has.',
        inputSchema: { type: 'object', properties: {} },
        run: async (u) => {
          staffOnly(u)
          const [users, classes] = await Promise.all([
            this.prisma.user.groupBy({ by: ['role'], where: { schoolId: u.schoolId, active: true }, _count: true }),
            this.prisma.class.count({ where: { schoolId: u.schoolId, deletedAt: null } }),
          ])
          return { classes, people: Object.fromEntries(users.map((g) => [g.role, g._count])) }
        },
      },
      {
        name: 'list_classes',
        description: 'Classes the connected person can see, with their member counts.',
        inputSchema: { type: 'object', properties: {} },
        run: async (u) => {
          const all = can(u, 'classes', 'write', { schoolId: u.schoolId })
          const rows = await this.prisma.class.findMany({ where: { schoolId: u.schoolId, deletedAt: null, ...(all ? {} : { id: { in: u.classIds ?? [] } }) }, orderBy: { name: 'asc' }, include: { _count: { select: { members: true } } } })
          return rows.map((c) => ({ id: c.id, name: c.name, members: c._count.members }))
        },
      },
      {
        name: 'list_people',
        description: 'People in the school (name, email, role, active). Admin and principal only. Optional role filter.',
        inputSchema: { type: 'object', properties: { role: { type: 'string', enum: ['student', 'parent', 'teacher', 'clerk', 'principal', 'admin'] }, limit: { type: 'number' } } },
        run: async (u, a) => {
          staffOnly(u)
          const take = Math.min(200, Math.max(1, Number(a.limit) || 50))
          return this.prisma.user.findMany({ where: { schoolId: u.schoolId, ...(typeof a.role === 'string' ? { role: a.role as never } : {}) }, select: { id: true, name: true, email: true, role: true, active: true }, orderBy: { name: 'asc' }, take })
        },
      },
      {
        name: 'list_announcements',
        description: 'Recent announcements the connected person can see.',
        inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
        run: async (u, a) => {
          const all = can(u, 'announcements', 'write', { schoolId: u.schoolId })
          const take = Math.min(100, Math.max(1, Number(a.limit) || 20))
          return this.prisma.announcement.findMany({ where: { schoolId: u.schoolId, ...(all ? {} : { OR: [{ classId: null }, { classId: { in: u.classIds ?? [] } }] }) }, orderBy: { createdAt: 'desc' }, take, select: { id: true, title: true, body: true, urgent: true, classId: true, createdAt: true } })
        },
      },
      {
        name: 'list_notifications',
        description: "The connected person's own notifications, read and unread.",
        inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
        run: async (u, a) => this.prisma.notification.findMany({ where: { userId: u.id, channel: 'in_app' }, orderBy: { createdAt: 'desc' }, take: Math.min(100, Math.max(1, Number(a.limit) || 20)), select: { id: true, subject: true, body: true, readAt: true, createdAt: true } }),
      },
    ]
  }

  private canConnect(u: AuthUser) {
    if (!can(u, 'users', 'manage', { schoolId: u.schoolId })) throw new ForbiddenException('Only an admin or principal can connect applications')
  }

  // ---- managing connections (signed in to the website)

  @Get('connections')
  @UseGuards(AuthGuard)
  async list(@CurrentUser() u: AuthUser) {
    this.canConnect(u)
    const rows = await this.prisma.mcpToken.findMany({ where: { userId: u.id, revokedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true } })
    return { connections: rows, tools: this.tools.map((t) => ({ name: t.name, description: t.description })) }
  }

  /** Makes a key. The secret is shown this once and cannot be seen again. */
  @Post('connections')
  @UseGuards(AuthGuard)
  async create(@CurrentUser() u: AuthUser, @Body() dto: ConnectionDto) {
    this.canConnect(u)
    if ((await this.prisma.mcpToken.count({ where: { userId: u.id, revokedAt: null } })) >= MAX_CONNECTIONS) throw new BadRequestException(`You can have up to ${MAX_CONNECTIONS} connections. Remove one first.`)
    const secret = PREFIX + randomBytes(32).toString('base64url')
    const row = await this.prisma.mcpToken.create({ data: { schoolId: u.schoolId, userId: u.id, name: dto.name.trim(), tokenHash: hash(secret), prefix: secret.slice(0, 10) }, select: { id: true, name: true, prefix: true, createdAt: true } })
    await this.audit.log(this.prisma, { schoolId: u.schoolId, actorId: u.id, action: 'mcp.connected', resource: 'mcp', resourceId: row.id, meta: { name: row.name } })
    return { ...row, secret }
  }

  @Delete('connections/:id')
  @UseGuards(AuthGuard)
  async revoke(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const r = await this.prisma.mcpToken.updateMany({ where: { id, userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } })
    if (!r.count) throw new NotFoundException()
    await this.audit.log(this.prisma, { schoolId: u.schoolId, actorId: u.id, action: 'mcp.disconnected', resource: 'mcp', resourceId: id })
    return { ok: true }
  }

  // ---- the MCP endpoint itself (an outside application, with a key)

  @Get()
  info(@Res() res: Response) { res.status(405).set('Allow', 'POST').json({ error: 'Send MCP requests with POST' }) }

  @Post()
  @HttpCode(200)
  async rpc(@Req() req: Request, @Body() body: unknown, @Res() res: Response) {
    const header = req.headers.authorization
    const secret = header?.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const row = secret.startsWith(PREFIX) ? await this.prisma.mcpToken.findUnique({ where: { tokenHash: hash(secret) } }) : null
    if (!row || row.revokedAt) return void res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'Invalid or removed key' })
    const now = Date.now()
    const c = this.calls.get(row.id)
    if (!c || c.reset < now) this.calls.set(row.id, { n: 1, reset: now + 60_000 })
    else if (++c.n > CALLS_PER_MINUTE) return void res.status(429).json({ error: 'Too many requests. Slow down.' })

    let user: AuthUser
    try { user = await this.guard.load(row.userId) } catch { return void res.status(401).json({ error: 'The person who made this key can no longer sign in' }) }
    void this.prisma.mcpToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined)

    const msg = body as { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
    if (!msg || Array.isArray(msg) || typeof msg.method !== 'string') return void res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } })
    if (msg.id === undefined) return void res.status(202).end() // a notification needs no reply
    const reply = (result: unknown) => res.json({ jsonrpc: '2.0', id: msg.id, result })
    const fail = (code: number, message: string) => res.json({ jsonrpc: '2.0', id: msg.id, error: { code, message } })

    switch (msg.method) {
      case 'initialize':
        return reply({ protocolVersion: (msg.params?.protocolVersion as string) ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'school-platform', version: '1.0.0' } })
      case 'ping': return reply({})
      case 'tools/list': return reply({ tools: this.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
      case 'tools/call': {
        const tool = this.tools.find((t) => t.name === msg.params?.name)
        if (!tool) return fail(-32602, 'Unknown tool')
        try {
          const out = await tool.run(user, (msg.params?.arguments as Record<string, unknown>) ?? {})
          return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] })
        } catch (e) {
          return reply({ isError: true, content: [{ type: 'text', text: (e as Error).message }] })
        }
      }
      default: return fail(-32601, 'Method not found')
    }
  }
}

@Module({ controllers: [McpController], providers: [AuthGuard] })
export class McpModule {}
