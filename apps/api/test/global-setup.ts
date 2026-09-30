import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { PrismaClient } from '@school/db'

/** Creates the school_test database if needed and applies every migration to it. Runs once per test run. */
export default async function setup() {
  const url = process.env.DATABASE_URL!
  if (!/_test(\?|$)/.test(url)) throw new Error(`Refusing to run tests against a non-test database: ${url}`)
  const admin = new PrismaClient({ datasourceUrl: url.replace(/\/[^/?]+(\?|$)/, '/postgres$1') })
  try {
    const name = url.match(/\/([^/?]+)(\?|$)/)![1]
    const exists = await admin.$queryRawUnsafe<{ n: number }[]>(`select count(*)::int as n from pg_database where datname = '${name}'`)
    if (!exists[0].n) await admin.$executeRawUnsafe(`create database "${name}"`)
  } finally {
    await admin.$disconnect()
  }
  execSync('pnpm --filter @school/db exec prisma migrate deploy', {
    cwd: resolve(__dirname, '../../..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
}
