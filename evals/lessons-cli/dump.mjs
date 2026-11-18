// Render a course page's content as plain markdown, the same for every
// authoring flow, so a judge cannot tell how the course was written.
// Usage: node dump.mjs <page.html> [<lesson-id>]   (one lesson only, with its neighbours named)
// GRADER_SKILL picks the page loader; WIDE_MARKS=off leaves wide lines unmarked.
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL = process.env.GRADER_SKILL ?? fileURLToPath(new URL('../../skills/create-fun-lessons/', import.meta.url))
const { loadPage } = await import(join(SKILL, 'scripts/check.mjs'))
const [page, only] = process.argv.slice(2)
const { COURSE, UNITS, GLOSSARY } = loadPage(readFileSync(page, 'utf8')).data

const COLUMNS = { pre: 41, editor: 36 }
const HL = '\u0001'
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e.toLowerCase()] ?? m)
const width = (line, blankCols) => {
  let shown = blankCols ? line.split('____').join('x'.repeat(blankCols)) : line
  shown = shown.replace(/[^\t]*\t/g, s => s.slice(0, -1).padEnd(Math.ceil(s.length / 8) * 8))
  return [...shown].length
}
const markWide = (code, surface, { blankCols = 0, measure = l => l } = {}) => surface && code ? code.split('\n').map(line => {
  const w = width(measure(line), blankCols)
  const out = line.replaceAll(HL, '')
  return w > COLUMNS[surface] && process.env.WIDE_MARKS !== 'off' ? `${out}  ← ${w} columns: scrolls sideways on a phone` : out
}).join('\n') : code
const isText = c => (c.lang || 'text') === 'text'
const blankColumns = c => Math.max(9, ...[].concat((c.t === 'fill' ? c.o : [...(c.answers ?? []), ...(c.extra ?? [])]) ?? []).map(x => String(x).length + 2))

const text = h => String(h ?? '')
  .replace(/<figure[^>]*>[\s\S]*?<\/figure>/g, f => {
    const label = f.match(/aria-label="([^"]*)"/)?.[1] ?? ''
    const cap = f.match(/<figcaption>([\s\S]*?)<\/figcaption>/)?.[1] ?? ''
    const shapes = (f.match(/<(rect|path|circle|line|text|polygon|ellipse)\b/g) ?? []).length
    return `\n[figure, ${shapes} SVG elements: ${label}${cap ? ` | caption: ${cap}` : ''}]\n`
  })
  .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g, (_, c) => `\n\`\`\`\n${markWide(c.replace(/<span class="hl">/g, HL).replace(/<[^>]+>/g, ''), 'pre', { measure: decode })}\n\`\`\`\n`)
  .replace(/<code>([\s\S]*?)<\/code>/g, '`$1`')
  .replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|div|li|tr|h\d)>/g, '\n').replace(/<(td|th)[^>]*>/g, ' | ')
  .replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\n{3,}/g, '\n\n').trim()
const list = (name, xs) => xs?.length ? `${name}:\n${xs.map(x => `  - ${text(x)}`).join('\n')}\n` : ''
const fence = (name, s) => s ? `${name}:\n\`\`\`\n${s}\n\`\`\`\n` : ''

function card(c, i) {
  const head = `#### Card ${i + 1}: ${c.t}${c.lang ? ` (lang ${c.lang})` : ''}\n`
  const why = c.why ? `why: ${text(c.why)}\n` : ''
  const hint = c.hint ? list('hint', [].concat(c.hint)) : ''
  switch (c.t) {
    case 'learn': return `${head}**${text(c.h)}**\n\n${text(c.body)}\n`
    case 'mcq': return `${head}q: ${text(c.q)}\n${c.o.map((o, j) => `  ${j === c.a ? '[x]' : '[ ]'} ${text(o)}`).join('\n')}\n${hint}${why}`
    case 'fill': return `${head}q: ${text(c.q)}\n${fence('code', markWide(c.code, 'pre', { blankCols: blankColumns(c) }))}${c.o.map((o, j) => `  ${j === c.a ? '[x]' : '[ ]'} ${o}`).join('\n')}\n${hint}${why}`
    case 'blanks': return `${head}q: ${text(c.q)}\n${fence('code', markWide(c.code, c.lang === 'text' ? null : 'pre', { blankCols: blankColumns(c) }))}answers: ${c.answers.join(' | ')}\nextra: ${(c.extra ?? []).join(' | ')}\n${hint}${why}`
    case 'order': return `${head}q: ${text(c.q)}\nitems (correct order):\n${c.items.map(x => `  - ${x}`).join('\n')}\n${hint}${why}`
    case 'type': return `${head}q: ${text(c.q)}\n${fence('code', c.code && markWide(c.code, 'pre'))}${c.expect ? `expect: ${text(c.expect)}\n` : ''}accept: ${c.accept.join(' || ')}\n${hint}${why}`
    case 'write': return `${head}q: ${text(c.q)}\n${fence('starter', c.starter && markWide(c.starter, isText(c) ? null : 'editor'))}${fence('model', markWide(c.model, isText(c) ? null : 'pre'))}${list('rubric', c.rubric)}${hint}${why}`
    default: return `${head}${JSON.stringify(c)}\n`
  }
}
const lesson = l => `### Lesson ${l.id}: ${text(l.title)}\nrecap: ${text(l.recap)}\n\n${l.cards.map(card).join('\n')}`

const out = []
if (only) {
  for (const u of UNITS) {
    const i = u.lessons.findIndex(l => l.id === only)
    if (i < 0) continue
    out.push(`Unit: ${text(u.title)}. Before it: ${u.lessons[i - 1] ? text(u.lessons[i - 1].title) : '(none)'}. After it: ${u.lessons[i + 1] ? text(u.lessons[i + 1].title) : '(none)'}.\n`)
    out.push(lesson(u.lessons[i]))
  }
} else {
  out.push(`# ${text(COURSE.title)}\n${text(COURSE.heading)}. ${text(COURSE.subtitle)}\n`)
  for (const u of UNITS) out.push(`## Unit ${u.id}: ${text(u.title)}\n${text(u.blurb)}\n\n${u.lessons.map(lesson).join('\n')}`)
  out.push(`## Glossary\n${GLOSSARY.map(([t, m]) => `- ${text(t)}: ${text(m)}`).join('\n')}`)
  const syl = join(dirname(page), 'syllabus.md')
  if (existsSync(syl)) out.push(`## Syllabus\n${readFileSync(syl, 'utf8').split('\n').filter(l => l.trim().startsWith('|')).join('\n')}`)
}
console.log(out.join('\n\n'))
