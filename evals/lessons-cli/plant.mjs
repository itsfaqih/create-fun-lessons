// Make the two revise seeds from one finished new-arm build (see PLAN.md, Tasks):
// the course folder for `new`, the equivalent c4f17c3 page for `old`, both with
// the same two planted defects, plus clean.html and targets.json for grade.mjs.
// Usage: node plant.mjs <build-workspace> <seed-dir>
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const { loadPage } = await import(join(REPO, 'skills/create-fun-lessons/scripts/check.mjs'))
const [ws, seedDir] = process.argv.slice(2)
const src = join(ws, 'ky-course')
const cleanHtml = readFileSync(join(src, 'index.html'), 'utf8')
const { data, languages } = loadPage(cleanHtml)
const units = data.UNITS
const unesc = s => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

const fillAt = [units.length - 1, ...units.keys()].filter(i => i !== 1).flatMap(ui => units[ui].lessons
  .flatMap(l => l.cards.map((c, ci) => ({ l, c, ci })).filter(x => x.c.t === 'fill')))[0]
if (!fillAt) throw new Error('no fill card outside unit 2')

let wideAt
for (const ui of [0, units.length - 1, 2]) for (const l of units[ui]?.lessons ?? []) for (const [ci, c] of l.cards.entries()) {
  if (wideAt || l.id === fillAt.l.id || c.t !== 'learn') continue
  for (const m of c.body.matchAll(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g)) {
    const lines = m[1].split('\n')
    for (let i = 0; i + 1 < lines.length && !wideAt; i++) {
      const a = unesc(lines[i]).trimEnd(), b = unesc(lines[i + 1]).trim()
      const joined = `${a} ${b}`
      if (a.trim() && b && joined.length >= 50 && joined.length <= 70 && !a.trim().startsWith('//'))
        wideAt = { l, ci, htmlA: lines[i], htmlB: lines[i + 1], a, b, joined }
    }
  }
}
if (!wideAt) throw new Error('no learn code pair to join into a wide line')

const fillTitle = fillAt.l.title, wideTitle = wideAt.l.title
const card = fillAt.l.cards[fillAt.ci]
card.code = card.code.replace('____', '____ ____')
const wc = wideAt.l.cards[wideAt.ci]
wc.body = wc.body.replace(`${wideAt.htmlA}\n${wideAt.htmlB}`, `${wideAt.htmlA.trimEnd()} ${wideAt.htmlB.trimStart()}`)

rmSync(seedDir, { recursive: true, force: true })
const newDir = join(seedDir, 'new/ky-course'), oldDir = join(seedDir, 'old/ky-course')
mkdirSync(newDir, { recursive: true }); mkdirSync(oldDir, { recursive: true })
for (const f of ['course.json', 'syllabus.md', 'lessons', 'index.html']) cpSync(join(src, f), join(newDir, f), { recursive: true })

const fillFile = join(newDir, 'lessons', `${fillAt.l.id}.md`)
const fillMd = readFileSync(fillFile, 'utf8').split('\n')
const nthFill = fillAt.l.cards.slice(0, fillAt.ci + 1).filter(c => c.t === 'fill').length
let seen = 0, done = false
for (let i = 0; i < fillMd.length && !done; i++) {
  if (/^## fill\b/.test(fillMd[i])) seen++
  if (seen === nthFill && fillMd[i].includes('____')) { fillMd[i] = fillMd[i].replace('____', '____ ____'); done = true }
}
if (!done) throw new Error(`could not plant the fill defect in ${fillFile}`)
writeFileSync(fillFile, fillMd.join('\n'))

const wideFile = join(newDir, 'lessons', `${wideAt.l.id}.md`)
const wideMd = readFileSync(wideFile, 'utf8').split('\n')
const plain = s => s.replace(/[«»]/g, '')
const at = wideMd.findIndex((x, i) => plain(x).trimEnd() === wideAt.a && plain(wideMd[i + 1] ?? '').trim() === wideAt.b)
if (at < 0) throw new Error(`could not find the code pair in ${wideFile}`)
wideMd.splice(at, 2, `${wideMd[at].trimEnd()} ${wideMd[at + 1].trimStart()}`)
writeFileSync(wideFile, wideMd.join('\n'))

const oldTemplate = execFileSync('git', ['-C', REPO, 'show', 'c4f17c3:skills/create-fun-lessons/template.html'], { encoding: 'utf8' })
const js = v => JSON.stringify(v, null, 1).replace(/<(\/script|!--)/gi, '\\u003c$1')
const oldPage = oldTemplate
  .replace(/(\/\* ===== COURSE CONTENT[^\n]*\*\/\n)[\s\S]*?(?=\/\* ===== END COURSE CONTENT ===== \*\/)/, (_, head) =>
    `${head}const COURSE = ${js(data.COURSE)};\n\nconst UNITS = ${js(units)};\n\nconst GLOSSARY = ${js(data.GLOSSARY)};\n`)
  .replace(/<script src="[^"]*\/highlight\.min\.js"[^>]*><\/script>/, tag => [tag, ...languages.map(n => `<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/languages/${n}.min.js"></script>`)].join('\n'))
writeFileSync(join(oldDir, 'index.html'), oldPage)
cpSync(join(src, 'syllabus.md'), join(oldDir, 'syllabus.md'))
writeFileSync(join(seedDir, 'clean.html'), cleanHtml)
const targets = { fillLesson: fillAt.l.id, fillTitle, fillCard: fillAt.ci + 1, wideLesson: wideAt.l.id, wideTitle, wideLine: wideAt.joined,
  unit2: units[1].lessons.slice(0, 2).map(l => [l.id, l.title]) }
writeFileSync(join(seedDir, 'targets.json'), JSON.stringify(targets, null, 1))
console.log(JSON.stringify(targets, null, 1))
