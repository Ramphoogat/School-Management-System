// Storage helpers. Run from the project folder:
//   pnpm --filter @school/api storage:check                 try the bucket set in .env (save, read, delete)
//   pnpm --filter @school/api storage:migrate -- --dry-run  list what would be copied from UPLOAD_DIR
//   pnpm --filter @school/api storage:migrate               copy UPLOAD_DIR into the bucket (originals stay where they are)
// Build first (pnpm --filter @school/api build): these use the compiled app.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
require('../dist/env') // loads .env the same way the API does
const { s3Config } = require('../dist/storage/s3')
const { checkBucket, copyFolderToBucket } = require('../dist/storage/tools')

const cmd = process.argv[2]
const flags = new Set(process.argv.slice(3))
const cfg = s3Config()

if (!cfg) {
  console.error('No bucket is configured. Set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (and S3_ENDPOINT for R2) in .env. See SERVICES.md section 4b.')
  process.exit(2)
}
if (!cfg.accessKeyId || !cfg.secretAccessKey) { console.error('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are both needed.'); process.exit(2) }
console.log(`Bucket "${cfg.bucket}"${cfg.endpoint ? ` at ${cfg.endpoint}` : ' on Amazon S3'}, region ${cfg.region}${cfg.prefix ? `, folder ${cfg.prefix}` : ''}`)

if (cmd === 'check') {
  const steps = await checkBucket(cfg)
  for (const s of steps) console.log(`${s.ok ? 'OK    ' : 'FAILED'} ${s.step} (${s.ms} ms)${s.error ? `: ${s.error}` : ''}`)
  const bad = steps.filter((s) => !s.ok)
  if (bad.length) {
    console.error('\nThe bucket is NOT ready. Common causes: a wrong endpoint or bucket name (404), a key without write access to this bucket (403), or a clock that is far off (403).')
    process.exit(1)
  }
  console.log('\nThe bucket works. Switch the app over by keeping these settings in .env and restarting the API.')
} else if (cmd === 'migrate') {
  const dir = resolve(process.env.UPLOAD_DIR ?? './uploads')
  console.log(`${flags.has('--dry-run') ? 'Dry run: ' : ''}copying files from ${dir}`)
  const r = await copyFolderToBucket(dir, cfg, { dryRun: flags.has('--dry-run'), verify: !flags.has('--no-verify'), onFile: (n, i, t) => { if (i % 25 === 0 || i === t) console.log(`  ${i} of ${t}`) } })
  console.log(`\nFound ${r.found} file(s).${r.dryRun ? ' Nothing was copied (dry run).' : ` Copied ${r.copied} (${(r.bytes / 1048576).toFixed(1)} MB), ${r.failed.length} failed.`}`)
  for (const f of r.failed) console.error(`  FAILED ${f.name}: ${f.error}`)
  if (r.failed.length) process.exit(1)
  if (!r.dryRun) console.log('The originals were left in place. Keep them until the app has run from the bucket for a while and a backup exists.')
} else {
  console.error('Usage: storage.mjs check | migrate [--dry-run] [--no-verify]')
  process.exit(2)
}
