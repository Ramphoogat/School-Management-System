import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clients, createApp, prisma, resetDb, seedWorld } from './helpers'

let app: INestApplication
let c: Awaited<ReturnType<typeof clients>>

const rpc = (secret: string, method: string, params?: object, id: number | null = 1) =>
  request(app.getHttpServer()).post('/api/mcp').set('authorization', `Bearer ${secret}`).send({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params })
const make = (who: { token: string }, name = 'Claude') => request(app.getHttpServer()).post('/api/mcp/connections').set('authorization', `Bearer ${who.token}`).send({ name })

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  await seedWorld('A')
  c = await clients(app)
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

describe('MCP connections', () => {
  it('only admin and principal make connections, and the key is stored hashed', async () => {
    for (const r of ['student', 'parent', 'teacher', 'clerk'] as const) expect((await make(c[r])).status, r).toBe(403)
    const made = await make(c.admin)
    expect(made.status).toBe(201)
    expect(made.body.secret).toMatch(/^mcp_/)
    const row = await prisma.mcpToken.findFirstOrThrow({ where: { id: made.body.id } })
    expect(row.tokenHash).not.toContain(made.body.secret)
    const list = await request(app.getHttpServer()).get('/api/mcp/connections').set('authorization', `Bearer ${c.admin.token}`)
    expect(JSON.stringify(list.body)).not.toContain(made.body.secret)
  })

  it('rejects a missing, wrong or website-login key', async () => {
    expect((await rpc('nope', 'ping')).status).toBe(401)
    expect((await rpc(c.admin.token, 'ping')).status).toBe(401)
  })

  it('speaks MCP: initialize, list tools, call a tool as the person who made the key', async () => {
    const { secret } = (await make(c.principal, 'Assistant')).body
    expect((await rpc(secret, 'initialize', { protocolVersion: '2025-03-26' })).body.result.serverInfo.name).toBe('school-platform')
    expect((await rpc(secret, 'notifications/initialized', undefined, null)).status).toBe(202)
    const tools = (await rpc(secret, 'tools/list')).body.result.tools
    expect(tools.map((t: { name: string }) => t.name)).toContain('list_classes')
    const call = await rpc(secret, 'tools/call', { name: 'school_overview', arguments: {} })
    expect(call.body.result.isError).toBeUndefined()
    expect(JSON.parse(call.body.result.content[0].text).people.student).toBeGreaterThan(0)
  })

  it('a removed key stops working at once', async () => {
    const made = (await make(c.admin, 'Temp')).body
    expect((await rpc(made.secret, 'ping')).status).toBe(200)
    expect((await request(app.getHttpServer()).delete(`/api/mcp/connections/${made.id}`).set('authorization', `Bearer ${c.admin.token}`)).status).toBe(200)
    expect((await rpc(made.secret, 'ping')).status).toBe(401)
  })

  it('a deactivated person\'s key stops working', async () => {
    const made = (await make(c.admin, 'Gone')).body
    await prisma.user.updateMany({ where: { email: { contains: 'admin' }, schoolId: (await prisma.mcpToken.findFirstOrThrow({ where: { id: made.id } })).schoolId }, data: { active: false } })
    expect((await rpc(made.secret, 'ping')).status).toBe(401)
  })
})
