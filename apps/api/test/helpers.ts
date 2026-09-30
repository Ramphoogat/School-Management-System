import 'reflect-metadata'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import bcrypt from 'bcryptjs'
import request from 'supertest'
import { PrismaClient, type Role } from '@school/db'
import { AppModule } from '@dist/app.module'

export const PASSWORD = 'password123'
export const prisma = new PrismaClient()

export async function createApp(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  const app = mod.createNestApplication({ rawBody: true }) // as in main.ts: the webhook signature covers the exact bytes
  app.setGlobalPrefix('api')
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  await app.init()
  return app
}

/** Empties every table (migration history stays) so each test file starts clean. */
export async function resetDb() {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(`select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations'`)
  await prisma.$executeRawUnsafe(`truncate table ${rows.map((r) => `"${r.tablename}"`).join(', ')} restart identity cascade`)
}

let hash: string | undefined
export async function makeUser(schoolId: string, email: string, role: Role, extra: Record<string, unknown> = {}) {
  hash ??= await bcrypt.hash(PASSWORD, 4) // low cost is fine for tests
  return prisma.user.create({ data: { schoolId, email, name: email.split('@')[0], role, passwordHash: hash, ...extra } })
}

export interface World {
  schoolId: string
  classA: string
  classB: string
  u: Record<'student' | 'student2' | 'parent' | 'teacher' | 'teacher2' | 'clerk' | 'principal' | 'admin', string>
}

/**
 * One school with all six roles. teacher owns Class A (student, student2 enrolled); teacher2 owns Class B (empty).
 * parent has an approved link to student only.
 */
export async function seedWorld(name = 'A'): Promise<World> {
  const school = await prisma.school.create({ data: { name: `School ${name}` } })
  const s = school.id
  const mk = async (key: string, role: Role) => (await makeUser(s, `${key}@${name.toLowerCase()}.test`, role)).id
  const u = {
    student: await mk('student', 'student'),
    student2: await mk('student2', 'student'),
    parent: await mk('parent', 'parent'),
    teacher: await mk('teacher', 'teacher'),
    teacher2: await mk('teacher2', 'teacher'),
    clerk: await mk('clerk', 'clerk'),
    principal: await mk('principal', 'principal'),
    admin: await mk('admin', 'admin'),
  }
  const classA = (await prisma.class.create({ data: { schoolId: s, name: 'Grade 8-A' } })).id
  const classB = (await prisma.class.create({ data: { schoolId: s, name: 'Grade 9-B' } })).id
  await prisma.classMember.createMany({
    data: [
      { classId: classA, userId: u.student, roleInClass: 'student' },
      { classId: classA, userId: u.student2, roleInClass: 'student' },
      { classId: classA, userId: u.teacher, roleInClass: 'teacher' },
      { classId: classB, userId: u.teacher2, roleInClass: 'teacher' },
    ],
  })
  await prisma.parentStudentLink.create({ data: { schoolId: s, parentId: u.parent, studentId: u.student, relationship: 'mother', status: 'approved' } })
  return { schoolId: s, classA, classB, u }
}

export async function login(app: INestApplication, email: string, password = PASSWORD) {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password })
  if (res.status !== 201) throw new Error(`login failed for ${email}: ${res.status}`)
  return res.body.accessToken as string
}

/** Logs in every role of a world and returns a small client per role. */
export async function clients(app: INestApplication, name = 'a') {
  const roles = ['student', 'student2', 'parent', 'teacher', 'teacher2', 'clerk', 'principal', 'admin'] as const
  const out = {} as Record<(typeof roles)[number], Client>
  for (const r of roles) out[r] = client(app, await login(app, `${r}@${name}.test`))
  return out
}

export interface Client {
  token: string
  get: (url: string) => request.Test
  post: (url: string, body?: object) => request.Test
  put: (url: string, body?: object) => request.Test
  patch: (url: string, body?: object) => request.Test
  delete: (url: string) => request.Test
}
export function client(app: INestApplication, token: string): Client {
  const h = () => app.getHttpServer()
  const auth = (t: request.Test) => t.set('authorization', `Bearer ${token}`)
  return {
    token,
    get: (url) => auth(request(h()).get(`/api${url}`)),
    post: (url, body = {}) => auth(request(h()).post(`/api${url}`).send(body)),
    put: (url, body = {}) => auth(request(h()).put(`/api${url}`).send(body)),
    patch: (url, body = {}) => auth(request(h()).patch(`/api${url}`).send(body)),
    delete: (url) => auth(request(h()).delete(`/api${url}`)),
  }
}

export const today = () => new Date().toISOString().slice(0, 10)
export const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
