// Lists every string the app asks to translate (t('...') / tr('...')) and shows which languages are missing it.
//
//   node scripts/i18n-check.mjs               summary
//   node scripts/i18n-check.mjs --missing hi  print the keys missing from Hindi, as JSON
//   node scripts/i18n-check.mjs --strict      exit 1 if any language is missing anything (for CI)
//
// Also checks each translation keeps the same {placeholders} as its English text, since a missing one would show as {name}.
import ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const LANGS = ['hi', 'te', 'ta', 'mr']
// Haryanvi (bgc) lays its own wording over Hindi, so it is checked only for placeholders, not for missing strings.

const files = []
;(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !/[\\/]lib[\\/]i18n[\\/]/.test(p)) files.push(p) } })(SRC)

const used = new Map() // key -> first file
for (const file of files) {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ['t', 'tr'].includes(n.expression.text) && n.arguments[0] && (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]))) {
      const key = n.arguments[0].text
      if (!used.has(key)) used.set(key, relative(SRC, file))
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}

const dicts = {}
for (const l of LANGS) {
  const load = async (name) => (await import(pathToFileURL(fileURLToPath(new URL(`../src/lib/i18n/${name}.ts`, import.meta.url))).href)).default
  dicts[l] = { ...(await load(l)), ...(await load(`${l}-screens`).catch(() => ({}))) }
}
const holes = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')

const missing = Object.fromEntries(LANGS.map((l) => [l, [...used.keys()].filter((k) => !(k in dicts[l]))]))
const broken = []
const bgc = (await import(pathToFileURL(fileURLToPath(new URL('../src/lib/i18n/bgc.ts', import.meta.url))).href)).default
for (const [k, v] of Object.entries(bgc)) if (holes(k) !== holes(v)) broken.push(`bgc: "${k}" -> "${v}"`)
for (const l of LANGS) for (const [k, v] of Object.entries(dicts[l])) if (holes(k) !== holes(v)) broken.push(`${l}: "${k}" -> "${v}"`)

const arg = process.argv.indexOf('--missing')
if (arg > -1) { console.log(JSON.stringify(Object.fromEntries(missing[process.argv[arg + 1]].map((k) => [k, used.get(k)])), null, 1)); process.exit(0) }

console.log(`${used.size} strings are marked for translation.`)
for (const l of LANGS) console.log(`  ${l}: ${used.size - missing[l].length} translated, ${missing[l].length} missing`)
if (broken.length) { console.log(`\n${broken.length} translation(s) whose {placeholders} differ from the English:`); broken.forEach((b) => console.log('  ' + b)) }
if (process.argv.includes('--strict') && (broken.length || LANGS.some((l) => missing[l].length))) process.exit(1)
