// Wraps the visible English text in the web app with t('...') so it can be translated, and lists the strings to translate.
//
//   node scripts/i18n-codemod.mjs --dry        show what would change, write nothing (add --verbose to list what it skips)
//   node scripts/i18n-codemod.mjs              apply, and write scripts/i18n-keys.json
//
// It only touches text it can prove is safe:
//   - static JSX text, and text that alternates static words with simple values, which becomes one template:
//       <p>No {label} requests yet.</p>  ->  <p>{t('No {label} requests yet.', { label })}</p>
//   - a fixed set of attributes (placeholder, title, aria-label, alt)
//   - toast and window.confirm messages given as plain strings.
// In a component that already has a variable called t, the translate function is called tr instead.
// Text mixed with JSX elements or complex expressions, and code outside a component, is skipped and listed.
import ts from 'typescript'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const DRY = process.argv.includes('--dry')
const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt'])
const SKIP_ELEMENTS = new Set(['code', 'kbd', 'pre', 'style', 'script'])
const TOAST = new Set(['success', 'error', 'warning', 'info', 'message'])

const files = []
;(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) { if (!/[\\/](ui|i18n)$/.test(p)) walk(p) } else if (/\.tsx$/.test(f)) files.push(p)
  }
})(SRC)

const hasLetter = (s) => /\p{L}/u.test(s)
const decode = (s) => s.replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const TXT = ts.SyntaxKind.JsxText

const keys = new Map() // key -> { count, files }
const report = { mixed: [], conflicts: [], orphans: [], wrapped: 0, filesChanged: 0 }
const note = (key, file) => { const e = keys.get(key) ?? { count: 0, files: new Set() }; e.count++; e.files.add(relative(SRC, file)); keys.set(key, e) }

/** An expression that produces a value to show in the text, as opposed to JSX or a condition that decides what to show. */
function isValueExpr(e) {
  if (!e) return false
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind)) return false
  if (ts.isConditionalExpression(e) || ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return false
  if (ts.isParenthesizedExpression(e)) return isValueExpr(e.expression)
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && ['map', 'filter'].includes(e.expression.name.text)) return false
  return true
}

const isComponentFn = (n) => {
  if (ts.isFunctionDeclaration(n)) return !!n.name && /^[A-Z]/.test(n.name.text)
  if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
    let p = n.parent
    while (p && (ts.isParenthesizedExpression(p) || ts.isCallExpression(p) || ts.isAsExpression(p))) p = p.parent
    return !!p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && /^[A-Z]/.test(p.name.text)
  }
  return false
}

const isUseTCall = (e) => !!e && ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'useT'

/** Does this component declare its own variable or parameter called `name` (other than the useT hook binding)? */
function declares(fn, name, sf) {
  let found = false
  const visit = (n) => {
    if (found) return
    if ((ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n)) && n.name) {
      const hookBinding = (ts.isVariableDeclaration(n) && isUseTCall(n.initializer)) || (ts.isBindingElement(n) && n.parent.parent && ts.isVariableDeclaration(n.parent.parent) && isUseTCall(n.parent.parent.initializer))
      if (!hookBinding) {
        const names = []
        const collect = (b) => { if (ts.isIdentifier(b)) names.push(b.text); else if (ts.isObjectBindingPattern(b) || ts.isArrayBindingPattern(b)) b.elements.forEach((e) => { if (!ts.isOmittedExpression(e)) collect(e.name) }) }
        collect(n.name)
        if (names.includes(name)) found = true
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(fn)
  return found
}

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const rel = relative(SRC, file)
  const sites = [] // { start, end, build(name) -> text, key, node }
  const covered = new Set()

  const enclosingComponent = (n) => { for (let p = n.parent; p; p = p.parent) if (isComponentFn(p)) return p; return null }
  const inSkipped = (n) => { for (let p = n.parent; p; p = p.parent) if (ts.isJsxElement(p) && SKIP_ELEMENTS.has(p.openingElement.tagName.getText(sf))) return true; return false }

  function templateSite(el) {
    const kids = el.children
    if (!kids.length || inSkipped(kids[0])) return null
    const texts = kids.filter((k) => k.kind === TXT && !k.containsOnlyTriviaWhiteSpaces)
    const exprs = kids.filter((k) => ts.isJsxExpression(k))
    if (!texts.length || !exprs.length) return null
    const simple = (k) => k.kind === TXT || (ts.isJsxExpression(k) && k.expression && isValueExpr(k.expression) && !ts.isStringLiteral(k.expression) && !ts.isNoSubstitutionTemplateLiteral(k.expression) && !ts.isTemplateExpression(k.expression))
    if (!kids.every(simple)) return null
    if (!texts.some((k) => hasLetter(decode(k.getText(sf))))) return null
    const used = new Set(), vars = []
    let key = ''
    for (const k of kids) {
      if (k.kind === TXT) { key += decode(text.slice(k.pos, k.end)).replace(/\s+/g, ' '); continue } // the full text: getText() would drop a leading space
      const e = k.expression
      let name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : 'value'
      if (!/^[A-Za-z_]\w*$/.test(name)) name = 'value'
      let unique = name, i = 2
      while (used.has(unique)) unique = name + i++
      used.add(unique)
      vars.push(unique === e.getText(sf) ? unique : `${unique}: ${e.getText(sf)}`)
      key += `{${unique}}`
    }
    key = key.trim()
    if (!key || /[{}]/.test(key.replace(/\{\w+\}/g, ''))) return null
    kids.forEach((k) => covered.add(k))
    return { start: kids[0].getStart(sf), end: kids[kids.length - 1].getEnd(), build: (name) => `{${name}(${q(key)}, { ${vars.join(', ')} })}`, key, node: el }
  }

  const visit = (n) => {
    if ((ts.isJsxElement(n) || ts.isJsxFragment(n)) && !covered.has(n)) {
      const site = templateSite(n)
      if (site) sites.push(site)
    }
    if (covered.has(n)) return
    if (n.kind === TXT && !n.containsOnlyTriviaWhiteSpaces && !inSkipped(n)) {
      const raw = n.getText(sf)
      const key = decode(raw.split('\n').map((l) => l.trim()).filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim()
      if (key && hasLetter(key)) {
        const sibs = n.parent.children
        const i = sibs.indexOf(n)
        const nearest = (dir) => { for (let j = i + dir; j >= 0 && j < sibs.length; j += dir) { const s = sibs[j]; if (s.kind === TXT && s.containsOnlyTriviaWhiteSpaces) continue; return s } return null }
        const adj = [nearest(-1), nearest(1)].filter((s) => s && ts.isJsxExpression(s) && isValueExpr(s.expression))
        if (adj.length) report.mixed.push(`${rel}: "${key}"`)
        else {
          const lead = /^[ \t]+/.exec(raw)?.[0] ?? ''
          const trail = /[ \t]+$/.exec(raw)?.[0] ?? ''
          const startsWithNl = /^\s*\n/.test(raw), endsWithNl = /\n\s*$/.test(raw)
          sites.push({ start: n.getStart(sf), end: n.getEnd(), build: (name) => `${startsWithNl ? '' : lead}{${name}(${q(key)})}${endsWithNl ? '' : trail}`, key, node: n })
        }
      }
    } else if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer) && ATTRS.has(n.name.getText(sf))) {
      const key = n.initializer.text
      if (key && hasLetter(key) && !/^[a-z0-9_.:/-]+$/.test(key)) sites.push({ start: n.initializer.getStart(sf), end: n.initializer.getEnd(), build: (name) => `{${name}(${q(key)})}`, key, node: n })
    } else if (ts.isCallExpression(n) && n.arguments.length >= 1 && ts.isStringLiteral(n.arguments[0]) && ((ts.isPropertyAccessExpression(n.expression) && n.expression.expression.getText(sf) === 'toast' && TOAST.has(n.expression.name.text)) || n.expression.getText(sf) === 'window.confirm')) {
      const key = n.arguments[0].text
      if (hasLetter(key)) sites.push({ start: n.arguments[0].getStart(sf), end: n.arguments[0].getEnd(), build: (name) => `${name}(${q(key)})`, key, node: n })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  if (!sites.length) continue

  const byFn = new Map()
  for (const s of sites) {
    const fn = enclosingComponent(s.node)
    if (!fn) { report.orphans.push(`${rel}: "${s.key}"`); continue }
    if (!byFn.has(fn)) byFn.set(fn, [])
    byFn.get(fn).push(s)
  }

  const edits = []
  let any = false
  for (const [fn, list] of byFn) {
    const name = ts.isFunctionDeclaration(fn) ? fn.name.text : fn.parent?.name?.getText?.(sf) ?? '(anonymous)'
    if (!fn.body || !ts.isBlock(fn.body)) { report.conflicts.push(`${rel}: ${name} returns JSX directly (no body to add the hook to)`); continue }
    const fname = declares(fn, 't', sf) ? 'tr' : 't'
    if (fname === 'tr' && declares(fn, 'tr', sf)) { report.conflicts.push(`${rel}: ${name} uses both t and tr`); continue }

    const bodyText = fn.body.getText(sf)
    const hook = /const\s*\{([^}]*)\}\s*=\s*useT\(\)/.exec(bodyText)
    const hookAt = hook ? fn.body.getStart(sf) + hook.index + hook[0].indexOf('{') + 1 : -1
    const wanted = fname === 't' ? /(^|[\s,])t(\s*,|\s*$)/ : /\bt\s*:\s*tr\b/
    if (!hook) {
      const first = fn.body.statements[0]
      const indent = first ? /[ \t]*$/.exec(text.slice(0, first.getStart(sf)))[0] : '  '
      edits.push({ start: fn.body.getStart(sf) + 1, end: fn.body.getStart(sf) + 1, replacement: `\n${indent}const { ${fname === 't' ? 't' : 't: tr'} } = useT()` })
    } else if (!wanted.test(hook[1])) {
      edits.push({ start: hookAt, end: hookAt, replacement: fname === 't' ? ' t,' : ' t: tr,' })
    }
    for (const s of list) { edits.push({ start: s.start, end: s.end, replacement: s.build(fname) }); note(s.key, file); report.wrapped++ }
    any = true
  }
  if (!any) continue

  const importRe = /import\s*\{([^}]*)\}\s*from '@\/lib\/i18n'/
  const m = importRe.exec(text)
  if (!m) {
    const imports = sf.statements.filter(ts.isImportDeclaration)
    const last = imports[imports.length - 1]
    edits.push({ start: last.getEnd(), end: last.getEnd(), replacement: "\nimport { useT } from '@/lib/i18n'" })
  } else if (!/\buseT\b/.test(m[1])) {
    const at = m.index + m[0].indexOf('{') + 1
    edits.push({ start: at, end: at, replacement: ' useT,' })
  }

  edits.sort((a, b) => b.start - a.start || b.end - a.end)
  let out = text
  for (const e of edits) out = out.slice(0, e.start) + e.replacement + out.slice(e.end)
  report.filesChanged++
  if (!DRY) writeFileSync(file, out)
}

const sorted = [...keys.entries()].sort((a, b) => a[0].localeCompare(b[0]))
if (!DRY) writeFileSync(fileURLToPath(new URL('./i18n-keys.json', import.meta.url)), JSON.stringify(Object.fromEntries(sorted.map(([k, v]) => [k, { count: v.count, files: [...v.files].sort() }])), null, 2) + '\n')

console.log(`${DRY ? 'Would wrap' : 'Wrapped'} ${report.wrapped} strings (${keys.size} distinct) in ${report.filesChanged} files.`)
console.log(`Skipped: ${report.mixed.length} pieces of text mixed with elements or complex values, ${report.conflicts.length} components with a conflict, ${report.orphans.length} strings outside any component.`)
if (process.argv.includes('--verbose')) {
  console.log('\nMIXED\n' + report.mixed.join('\n'))
  console.log('\nCONFLICTS\n' + report.conflicts.join('\n'))
  console.log('\nORPHANS\n' + report.orphans.join('\n'))
}
