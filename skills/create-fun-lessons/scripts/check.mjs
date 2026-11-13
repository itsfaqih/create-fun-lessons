// Validate a create-fun-lessons page and its syllabus: the script parses, the
// content block matches the schema, and syllabus.md beside the page maps every
// row to lessons. With --repo, every tracked top-level directory of that repo
// must appear in a syllabus Sources cell.
// Usage: node check.mjs <course.html> [--repo <dir>]   (exit 0 = green)
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const repoAt = args.indexOf('--repo')
const repo = repoAt >= 0 ? args.splice(repoAt, 2)[1] : null
const file = args[0]
if (!file || (repoAt >= 0 && !repo)) { console.error('usage: check.mjs <course.html> [--repo <dir>]'); process.exit(2) }
const html = readFileSync(file, 'utf8')
const errors = []
const err = (where, msg) => errors.push(`${where}: ${msg}`)

const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
if (!script) { console.error('no inline <script> found'); process.exit(1) }
try { new Function(script) } catch (e) { console.error(`script does not parse: ${e.message}`); process.exit(1) }

const block = script.match(/\/\* ===== COURSE CONTENT[\s\S]*?\*\/([\s\S]*?)\/\* ===== END COURSE CONTENT ===== \*\//)?.[1]
if (!block) { console.error('COURSE CONTENT markers missing'); process.exit(1) }
let COURSE, UNITS, GLOSSARY
try { ({ COURSE, UNITS, GLOSSARY } = new Function(`${block}; return { COURSE, UNITS, GLOSSARY }`)()) }
catch (e) { console.error(`content block throws: ${e.message}`); process.exit(1) }

for (const k of ['title', 'logoHtml', 'heading', 'subtitle', 'storageKey'])
  if (typeof COURSE?.[k] !== 'string' || !COURSE[k].trim()) err('COURSE', `missing ${k}`)
if (COURSE?.storageKey?.startsWith('create-fun-lessons-sample')) err('COURSE', 'storageKey still the template sample; give the course its own key')
if (!Array.isArray(UNITS) || !UNITS.length) err('UNITS', 'empty')
if (!Array.isArray(GLOSSARY)) err('GLOSSARY', 'must be an array of [term, meaning]')
else GLOSSARY.forEach((g, i) => { if (!Array.isArray(g) || g.length !== 2) err(`GLOSSARY[${i}]`, 'must be [term, meaning]') })

const ids = new Set()
const seen = (id, where) => { if (ids.has(id)) err(where, `duplicate id "${id}"`); ids.add(id) }
// Code is coloured by highlight.js. These languages ship in its main build;
// any other needs its languages/<name>.min.js script tag in the page.
const BUNDLED = 'bash c cpp csharp css diff go graphql ini java javascript json kotlin less lua makefile markdown objectivec perl php php-template plaintext python python-repl r ruby rust scss shell sql swift typescript vbnet wasm xml yaml js jsx ts tsx sh zsh html svg py rb rs kt yml golang console'.split(' ')
const loaded = name => BUNDLED.includes(name) || html.includes(`/languages/${name}.min.js`)
const checkLang = (where, l) => {
  if (l === undefined || ['text', 'code', 'shell'].includes(l)) return
  if (typeof l !== 'string' || !loaded(l)) err(where, `lang "${l}" is not a highlight.js language this page loads; use text, code, shell, a bundled name, or add its languages/<name>.min.js script tag`)
}
if (typeof COURSE?.lang !== 'string' || !COURSE.lang.trim()) err('COURSE', "missing lang: the highlight.js language for code (e.g. 'typescript'), or 'text' for a course without code")
else if (COURSE.lang !== 'text' && !loaded(COURSE.lang)) err('COURSE', `lang "${COURSE.lang}" is not a highlight.js language this page loads`)
const str = v => typeof v === 'string' && v.trim().length > 0
let lessonCount = 0, cardCount = 0
const lessonIds = new Set()

for (const [ui, u] of (UNITS ?? []).entries()) {
  const uw = `unit ${ui + 1}`
  if (!str(u.id)) err(uw, 'missing id'); else seen(u.id, uw)
  for (const k of ['title', 'blurb']) if (!str(u[k])) err(uw, `missing ${k}`)
  for (const k of ['color', 'dark']) if (!/^#[0-9a-f]{6}$/i.test(u[k] ?? '')) err(uw, `${k} must be #rrggbb`)
  if (!Array.isArray(u.lessons) || !u.lessons.length) { err(uw, 'no lessons'); continue }
  if (!u.lessons.some(l => l.cards?.some(c => c.t === 'write'))) err(uw, 'needs at least one write card, ideally closing the unit')
  for (const l of u.lessons) {
    lessonCount++
    const lw = `lesson ${l.id ?? '?'}`
    if (!str(l.id)) err(lw, 'missing id'); else { seen(l.id, lw); lessonIds.add(l.id) }
    for (const k of ['title', 'recap']) if (!str(l[k])) err(lw, `missing ${k}`)
    if (!Array.isArray(l.cards) || !l.cards.length) { err(lw, 'no cards'); continue }
    if (!l.cards.some(c => c.t !== 'learn')) err(lw, 'needs at least one quiz card (any type but learn)')
    l.cards.forEach((c, ci) => {
      cardCount++
      const cw = `${lw} card ${ci + 1} (${c.t})`
      if (c.t !== 'learn' && !str(c.why)) err(cw, 'missing why')
      if (c.hint !== undefined && !(str(c.hint) || (Array.isArray(c.hint) && c.hint.length && c.hint.every(str)))) err(cw, 'hint must be a string or an array of strings')
      // Every quiz card offers a hint; these have no automatic one to fall back on.
      if (!c.hint && (c.t === 'write' || ((c.t === 'mcq' || c.t === 'fill') && c.o?.length < 3))) err(cw, 'needs a hint (no automatic hint for this card)')
      switch (c.t) {
        case 'learn':
          if (!str(c.h) || !str(c.body)) err(cw, 'needs h and body')
          for (const m of (c.body ?? '').matchAll(/<pre><code(?: class="language-([^"]+)")?/g)) checkLang(cw, m[1])
          break
        case 'mcq': case 'fill':
          if (!str(c.q)) err(cw, 'missing q')
          if (!Array.isArray(c.o) || c.o.length < 2) err(cw, 'o needs 2+ options')
          else if (!Number.isInteger(c.a) || c.a < 0 || c.a >= c.o.length) err(cw, `a=${c.a} is not an index into o`)
          if (c.t === 'fill' && (c.code ?? '').split('____').length !== 2) err(cw, 'code must contain exactly one ____')
          if (c.t === 'fill') checkLang(cw, c.lang)
          break
        case 'order':
          if (!str(c.q)) err(cw, 'missing q')
          if (!Array.isArray(c.items) || c.items.length < 3) err(cw, 'items needs 3+ entries, in correct order')
          else if (new Set(c.items).size !== c.items.length) err(cw, 'items must be distinct')
          break
        case 'type':
          if (!str(c.q)) err(cw, 'missing q')
          if (c.expect !== undefined && !str(c.expect)) err(cw, 'expect must be a non-empty string')
          if (!Array.isArray(c.accept) || !c.accept.length || !c.accept.every(str)) { err(cw, 'accept needs 1+ answers'); break }
          if (/^\/.*\/[a-z]*$/s.test(c.accept[0])) err(cw, 'accept[0] must be a literal; it is shown as the answer')
          for (const a of c.accept) {
            const m = a.match(/^\/(.*)\/([a-z]*)$/s)
            if (m) try { new RegExp(m[1], m[2]) } catch (e) { err(cw, `bad regex ${a}: ${e.message}`) }
          }
          checkLang(cw, c.lang)
          break
        case 'write':
          if (!str(c.q)) err(cw, 'missing q')
          if (!str(c.model)) err(cw, 'missing model (the sample answer)')
          if (!Array.isArray(c.rubric) || c.rubric.length < 2 || c.rubric.length > 4 || !c.rubric.every(str)) err(cw, 'rubric needs 2–4 criteria')
          checkLang(cw, c.lang)
          if (c.starter !== undefined && typeof c.starter !== 'string') err(cw, 'starter must be a string')
          break
        default: err(cw, `unknown card type "${c.t}"`)
      }
    })
  }
}

// Syllabus: a markdown table | Area | Sources | Lessons |, one row per part of the subject.
const sylPath = join(dirname(file), 'syllabus.md')
const rows = []
if (!existsSync(sylPath)) err('syllabus.md', `missing beside the page (${sylPath})`)
else {
  const lines = readFileSync(sylPath, 'utf8').split('\n').filter(l => l.trim().startsWith('|'))
  lines.slice(1).filter(l => !/^\|[\s:|-]+\|$/.test(l.trim())).forEach((line, i) => {
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
    const rw = `syllabus row ${i + 1} (${cells[0] || '?'})`
    if (cells.length < 3 || !cells[0] || !cells[1]) { err(rw, 'needs Area, Sources and Lessons cells'); return }
    rows.push(cells)
    const lessons = cells[2]
    if (/^skip:/i.test(lessons)) { if (!lessons.slice(5).trim()) err(rw, 'skip needs a reason'); return }
    const listed = lessons.split(/[\s,]+/).filter(Boolean)
    if (!listed.length) err(rw, 'lists no lessons; add lesson ids or skip: <reason>')
    for (const id of listed) if (!lessonIds.has(id)) err(rw, `lesson "${id}" does not exist`)
  })
  if (!rows.length) err('syllabus.md', 'has no table rows')
  const taught = new Set(rows.flatMap(r => r[2].split(/[\s,]+/)))
  for (const id of lessonIds) if (!taught.has(id)) err('syllabus.md', `lesson "${id}" is in no row; map it to the area it teaches`)
}
if (repo) {
  let dirs = []
  try { dirs = [...new Set(execFileSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(f => f.includes('/')).map(f => f.split('/')[0]))] }
  catch (e) { err('--repo', `cannot list tracked files in ${repo}: ${e.message.split('\n')[0]}`) }
  const paths = rows.flatMap(r => r[1].split(/[\s,`'"()]+/)).map(p => p.replace(/^\.\//, '')).filter(Boolean)
  for (const d of dirs) if (!paths.some(p => p === d || p.startsWith(`${d}/`))) err('syllabus.md', `top-level directory "${d}/" appears in no Sources cell`)
}

if (errors.length) { console.error(`${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1) }
console.log(`OK: ${UNITS.length} units, ${lessonCount} lessons, ${cardCount} cards, ${rows.length} syllabus rows`)
