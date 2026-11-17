// Validate a create-fun-lessons page and its syllabus: the script parses, the
// content block matches the schema, and syllabus.md beside the page maps every
// row to lessons. With --repo, every tracked top-level directory of that repo
// must appear in a syllabus Sources cell.
// Usage: node check.mjs <course.html> [--repo <dir>]   (exit 0 = green)
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateCourse, checkSyllabus, checkRepoCoverage } from './schema.mjs'

const BLOCK = /\/\* ===== COURSE CONTENT[\s\S]*?\*\/([\s\S]*?)\/\* ===== END COURSE CONTENT ===== \*\//

// The page's content block as data, and the extra highlight.js languages its
// script tags load. Throws an Error whose message says what is wrong.
export function loadPage(html) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  if (!script) throw new Error('no inline <script> found')
  try { new Function(script) } catch (e) { throw new Error(`script does not parse: ${e.message}`) }
  const block = script.match(BLOCK)?.[1]
  if (!block) throw new Error('COURSE CONTENT markers missing')
  let data
  try { data = new Function(`${block}; return { COURSE, UNITS, GLOSSARY }`)() }
  catch (e) { throw new Error(`content block throws: ${e.message}`) }
  const languages = [...html.matchAll(/\/languages\/([\w.+#-]+)\.min\.js/g)].map(m => m[1])
  return { data, languages }
}

export function trackedDirs(repo) {
  return [...new Set(execFileSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(f => f.includes('/')).map(f => f.split('/')[0]))]
}

// Every page-level problem, as the lines check.mjs prints, plus the summary
// counts. `syllabus` is the text of syllabus.md, or null when it is missing.
export function checkPage(html, syllabus, { repoDirs, syllabusPath = 'syllabus.md' } = {}) {
  const { data, languages } = loadPage(html)
  const { UNITS } = data
  const problems = validateCourse(data, { languages })
  const lessonIds = (Array.isArray(UNITS) ? UNITS : []).flatMap(u => Array.isArray(u?.lessons) ? u.lessons.map(l => l?.id).filter(Boolean) : [])
  let rows = []
  if (syllabus === null) problems.push({ syllabus: {}, msg: `missing beside the page (${syllabusPath})` })
  else {
    const s = checkSyllabus(syllabus, lessonIds)
    rows = s.rows
    problems.push(...s.problems)
    if (repoDirs) problems.push(...checkRepoCoverage(rows, repoDirs))
  }
  const lessons = (UNITS ?? []).flatMap(u => u?.lessons ?? [])
  const counts = { units: UNITS?.length ?? 0, lessons: lessons.length, cards: lessons.reduce((n, l) => n + (l?.cards?.length ?? 0), 0), rows: rows.length }
  return { problems: problems.map(formatProblem), counts }
}

function formatProblem(p) {
  const where =
    p.scope ?? (p.syllabus ? (p.syllabus.n ? `syllabus row ${p.syllabus.n} (${p.syllabus.area})` : 'syllabus.md')
      : p.lesson !== undefined ? `lesson ${p.lesson}${p.card !== undefined ? ` card ${p.card + 1} (${p.t})` : ''}`
        : `unit ${p.unit + 1}`)
  return `${where}: ${p.msg}`
}

export const summary = c => `${c.units} units, ${c.lessons} lessons, ${c.cards} cards, ${c.rows} syllabus rows`

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const repoAt = args.indexOf('--repo')
  const repo = repoAt >= 0 ? args.splice(repoAt, 2)[1] : null
  const file = args[0]
  if (!file || (repoAt >= 0 && !repo)) { console.error('usage: node check.mjs <course.html> [--repo <dir>]'); process.exit(2) }
  const sylPath = join(dirname(file), 'syllabus.md')
  let repoDirs, result
  const repoProblems = []
  if (repo) try { repoDirs = trackedDirs(repo) } catch (e) { repoProblems.push(`--repo: cannot list tracked files in ${repo}: ${e.message.split('\n')[0]}`) }
  try { result = checkPage(readFileSync(file, 'utf8'), existsSync(sylPath) ? readFileSync(sylPath, 'utf8') : null, { repoDirs, syllabusPath: sylPath }) }
  catch (e) { console.error(e.message); process.exit(1) }
  const { counts } = result, problems = [...result.problems, ...repoProblems]
  if (problems.length) { console.error(`${problems.length} problem(s):\n- ${problems.join('\n- ')}`); process.exit(1) }
  console.log(`OK: ${summary(counts)}`)
}
