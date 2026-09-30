// Runs the API tests in isolation: every run gets its own database and its own compiled copy of the app,
// so several runs (or a dev server rebuilding dist/) can never interfere with each other.
//   pnpm test                      everything
//   pnpm test test/messages.test.ts   one file
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const id = process.env.TEST_RUN_ID ?? randomBytes(3).toString('hex')
const dist = `dist-test-${id}`
const db = `school_${id}_test`
const base = process.env.TEST_DB_SERVER ?? 'postgresql://school:school@localhost:5432'
const env = { ...process.env, TEST_DIST_DIR: dist, TEST_DATABASE_URL: `${base}/${db}` }
const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', env, shell: true }).status ?? 1

let status = run('npx', ['tsc', '-p', 'tsconfig.json', '--outDir', dist, '--incremental', 'false'])
if (status === 0) status = run('npx', ['vitest', 'run', ...process.argv.slice(2)])

// Clean up the private build and database.
rmSync(dist, { recursive: true, force: true })
spawnSync('node', ['-e', `
  const { PrismaClient } = require('@school/db');
  const p = new PrismaClient({ datasourceUrl: '${base}/postgres' });
  p.$executeRawUnsafe('drop database if exists "${db}" with (force)').catch(() => {}).finally(() => p.$disconnect());
`], { stdio: 'ignore', env })
process.exit(status)
