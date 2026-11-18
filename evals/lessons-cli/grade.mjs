// Grade one finished run's course with the current checker, and for a
// revise run, assert the three requested changes against the seed.
// Usage: node grade.mjs <workspace> <old|new> <build|revise> [<seed-page.html>]
// SUBJECT_FOLDER and SUBJECT_COURSE name the repo and course folders in the
// workspace (default ky and ky-course).
import { readFileSync, existsSync, readdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The grading checker is frozen at 2a69b9d (harness.py grade unpacks it), so a
// hill-climb change to the checker never moves the grade of a finished run.
const SKILL = process.env.GRADER_SKILL ?? fileURLToPath(new URL('../../skills/create-fun-lessons/', import.meta.url))
const { loadPage, checkPage, trackedDirs } = await import(join(SKILL, 'scripts/check.mjs'))
const [ws, arm, task, seedPage] = process.argv.slice(2)
const repoName = process.env.SUBJECT_FOLDER ?? 'ky'
const repo = join(ws, repoName)
const course = join(ws, process.env.SUBJECT_COURSE ?? 'ky-course')

// The frozen checker rejects Sources paths under the repo folder's name (ky/source/),
// which SKILL.md allows, so each gets its root-relative form as the current checker does.
function withRootRelativeSources(syllabus, name) {
  if (syllabus === null) return null
  const escaped = name.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')
  const prefixed = new RegExp(`^(\\./)?${escaped}/(.+)`)
  return syllabus.split('\n').map(line => {
    if (!line.trim().startsWith('|')) return line
    const cells = line.split('|')
    if (cells.length > 3) cells[2] = cells[2].replace(/[^\s,`'"()]+/g, t => t.replace(prefixed, (m, dot, rest) => `${m} ${rest}`))
    return cells.join('|')
  }).join('\n')
}

function findPage(dir) {
  if (!existsSync(dir)) return null
  const pages = readdirSync(dir).filter(f => f.endsWith('.html')).map(f => join(dir, f))
    .filter(p => readFileSync(p, 'utf8').includes('===== COURSE CONTENT'))
  return pages.find(p => p.endsWith('index.html')) ?? pages[0] ?? null
}

function run(cmd, args) {
  try { return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } }
  catch (e) { return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` } }
}

const isWidth = p => / columns; \d+ fit /.test(p)
const targets0 = seed => JSON.parse(readFileSync(join(dirname(seed), 'targets.json'), 'utf8'))
const page = findPage(course)
const g = { ws, arm, task, page: page && page.slice(ws.length + 1) }
if (!page) { console.log(JSON.stringify({ ...g, error: 'no course page' })); process.exit(0) }

const html = readFileSync(page, 'utf8')
const sylPath = join(dirname(page), 'syllabus.md')
const syllabus = existsSync(sylPath) ? readFileSync(sylPath, 'utf8') : null
let data
try {
  data = loadPage(html).data
  const { problems, counts } = checkPage(html, withRootRelativeSources(syllabus, repoName), { repoDirs: trackedDirs(repo) })
  g.common = { ok: problems.length === 0, problems: problems.length, width: problems.filter(isWidth).length,
    widthLines: problems.filter(isWidth), okIgnoringWidth: problems.filter(p => !isWidth(p)).length === 0, other: problems.filter(p => !isWidth(p)).slice(0, 20), counts }
} catch (e) { g.common = { ok: false, okIgnoringWidth: false, problems: 1, fatal: e.message } }

const ownChecker = join(ws, 'skills/create-fun-lessons/scripts/check.mjs')
const own = run('node', [ownChecker, page, '--repo', repo])
g.own = { ok: own.ok, tail: own.out.trim().split('\n').slice(0, 6) }

if (arm === 'new' && existsSync(join(course, 'course.json'))) {
  const tmp = mkdtempSync(join(tmpdir(), 'kyc-'))
  cpSync(course, tmp, { recursive: true })
  const b = run('node', [join(ws, 'skills/create-fun-lessons/scripts/lessons.mjs'), 'build', tmp, '--repo', repo])
  g.freshBuild = { ok: b.ok, matchesPage: b.ok && readFileSync(join(tmp, 'index.html'), 'utf8') === html,
    sourceFillBroken: /exactly one ____/.test(b.out),
    sourceWidth: seedPage ? b.out.split('\n').some(l => / columns; \d+ fit /.test(l) && l.includes(`${targets0(seedPage).wideLesson}.md`)) : / columns; \d+ fit /.test(b.out) }
  rmSync(tmp, { recursive: true, force: true })
}

if (data) {
  const lessons = data.UNITS.flatMap(u => u.lessons)
  const cards = lessons.flatMap(l => l.cards)
  const types = {}
  for (const c of cards) types[c.t] = (types[c.t] ?? 0) + 1
  const rows = (syllabus ?? '').split('\n').filter(l => /^\s*\|/.test(l) && !/^\s*\|\s*-/.test(l)).slice(1)
  g.shape = { units: data.UNITS.length, lessons: lessons.length, cards: cards.length, types,
    glossary: data.GLOSSARY.length, syllabusRows: rows.length, skipped: rows.filter(r => /skip:/i.test(r)).length,
    cardsPerLesson: lessons.map(l => l.cards.length) }
  const strings = v => typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []
  g.garbledSpans = strings(data).filter(s => [...s.replace(/<pre[\s\S]*?<\/pre>/g, '').matchAll(/<code[^>]*>([\s\S]*?)<\/code>/g)]
    .some(m => m[1].includes('`'))).length
  g.leakedMarkers = strings(data).filter(s => /[«»]/.test(s)).length
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  const shown = h => String(h ?? '').replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e.toLowerCase()] ?? m)
  const squash = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase()
  const literals = c => [].concat(c.accept ?? []).filter(a => !/^\/.*\/[a-z]*$/s.test(a)).map(squash).filter(a => a.length >= 3)
  const typeCards = cards.filter(c => c.t === 'type')
  const learnRun = l => l.cards.reduce(([run, max], c) => c.t === 'learn' ? [run + 1, Math.max(max, run + 1)] : [0, max], [0, 0])[1]
  const quiz = cards.filter(c => c.t !== 'learn')
  const hinted = quiz.filter(c => [].concat(c.hint ?? []).some(h => String(h).trim())).length
  g.cards = {
    typeCards: typeCards.length,
    expectLeaks: typeCards.filter(c => literals(c).some(a => squash(shown(c.expect)).includes(a))).length,
    lessonsOutside3to6: lessons.filter(l => l.cards.length < 3 || l.cards.length > 6).length,
    maxLearnRun: Math.max(0, ...lessons.map(learnRun)),
    lessonsEndingOnLearn: lessons.filter(l => l.cards.at(-1)?.t === 'learn').length,
    quizCards: quiz.length, hinted, hintRate: quiz.length ? Math.round(hinted / quiz.length * 100) / 100 : null,
    wideLines: g.common?.width ?? null,
  }
  g.doubleEscaped = strings(data).filter(s => /&amp;(lt|gt|amp|quot);/.test(s)).length
}

if (task === 'revise' && data && seedPage) {
  const seed = loadPage(readFileSync(seedPage, 'utf8')).data
  const ids = u => u.lessons.map(l => l.id)
  const seedIds = seed.UNITS.flatMap(ids)
  const nowIds = data.UNITS.flatMap(ids)
  const u2 = data.UNITS[1], s2 = seed.UNITS[1]
  const added = nowIds.filter(id => !seedIds.includes(id))
  const inserted = u2.lessons[1]
  const brokenFill = data.UNITS.flatMap(u => u.lessons).flatMap(l => l.cards).filter(c => c.t === 'fill' && (c.code ?? '').split('____').length !== 2)
  const widthLines = g.common?.widthLines ?? []
  const wide = widthLines.filter(p => p.includes(`lesson ${targets0(seedPage).wideLesson} `)).length
  const byId = Object.fromEntries(seed.UNITS.flatMap(u => u.lessons).map(l => [l.id, l]))
  const targets = JSON.parse(readFileSync(join(dirname(seedPage), 'targets.json'), 'utf8'))
  const changed = data.UNITS.flatMap(u => u.lessons).filter(l => byId[l.id] && ![targets.fillLesson, targets.wideLesson].includes(l.id)
    && JSON.stringify(l) !== JSON.stringify(byId[l.id])).map(l => l.id)
  g.revise = {
    oneLessonAdded: added.length === 1,
    insertedAtU2Pos2: added.length === 1 && inserted?.id === added[0] && u2.lessons[0].id === s2.lessons[0].id && u2.lessons[2]?.id === s2.lessons[1].id,
    insertedCards: inserted && added.includes(inserted.id) ? inserted.cards.length : 0,
    seedIdsKept: seedIds.every(id => nowIds.includes(id)),
    storageKeyKept: data.COURSE.storageKey === seed.COURSE.storageKey,
    fillFixed: brokenFill.length === 0 && !g.freshBuild?.sourceFillBroken,
    widthFixed: !wide && !g.freshBuild?.sourceWidth,
    newWideLines: widthLines.length - wide,
    newLessonInSyllabus: added.length === 1 && new RegExp(`\\b${added[0]}\\b`).test(syllabus ?? ''),
    collateralLessons: changed,
    addedId: added[0] ?? null,
  }
  g.revise.allDone = ['oneLessonAdded', 'insertedAtU2Pos2', 'seedIdsKept', 'storageKeyKept', 'fillFixed', 'widthFixed', 'newLessonInSyllabus']
    .every(k => g.revise[k]) && g.revise.insertedCards >= 3 && g.revise.insertedCards <= 6 && (arm === 'old' || g.freshBuild?.matchesPage)
}
console.log(JSON.stringify(g))
