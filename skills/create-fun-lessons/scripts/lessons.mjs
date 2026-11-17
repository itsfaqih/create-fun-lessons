// Build a create-fun-lessons page from a course folder (course.json,
// syllabus.md, lessons/<id>.md), check the folder, or create one.
// The lesson file format is in references/lessons.md.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CARD_TYPES, validateCourse, validateUnit, validateLesson, parseSyllabus, checkCovers, checkRepoCoverage } from './schema.mjs'
import { loadPage, checkPage, trackedDirs, summary } from './check.mjs'

const TEMPLATE = fileURLToPath(new URL('../template.html', import.meta.url))
const USAGE = `usage:
  node lessons.mjs init <dir> [--from <page.html>]
  node lessons.mjs check <dir> [<lesson-or-unit-id> ...] [--repo <repo-dir>]
  node lessons.mjs build <dir> [--repo <repo-dir>]`

const LESSON_FIELDS = { recap: { kind: 'html' }, covers: { kind: 'names' }, terms: { kind: 'terms' } }


const FENCE_OPEN = /^([ \t]*)(`{3,})([^`\s]*)[ \t]*$/
const FENCE_CLOSE = /^[ \t]*(`{3,})[ \t]*$/
const FIELD = /^([a-z][A-Za-z]*):(?:[ \t]+(.*?))?[ \t]*$/
const CARD = /^## /
const LIST = /^-( |$)/
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const unesc = s => s.replace(/&(amp|lt|gt);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>' }[e]))
const mark = s => s.replace(/«([^«»\n]*)»/g, '<span class="hl">$1</span>')

// Lines grouped so that a ``` fence is one block: nothing inside a fence is
// ever read as structure.
function toBlocks(lines, err) {
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_OPEN.exec(lines[i])
    if (!m) { blocks.push({ text: lines[i], line: i + 1 }); continue }
    const [, indent, ticks, info] = m, content = []
    let j = i + 1
    for (; j < lines.length; j++) {
      const c = FENCE_CLOSE.exec(lines[j])
      if (c && c[1].length >= ticks.length) break
      content.push(lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j])
    }
    if (j === lines.length) err(i + 1, `this ${ticks} fence is never closed`)
    blocks.push({ fence: true, indent, ticks, info, content, line: i + 1 })
    i = j
  }
  return blocks
}

const blank = b => !b.fence && !b.text.trim()
const fieldOf = b => !b.fence && FIELD.exec(b.text)
const listItem = b => !b.fence && LIST.test(b.text)
const trim = bs => { let a = 0, z = bs.length; while (a < z && blank(bs[a])) a++; while (z > a && blank(bs[z - 1])) z--; return bs.slice(a, z) }

// HTML source -> HTML: a ``` fence becomes <pre><code>, escaped, with «…»
// highlighted; a ```raw fence goes in as written; `x` (or ``x`y``, as in
// Markdown) outside tags, <pre> and <code> becomes <code>, escaped.
function renderHtml(blocks) {
  const out = [], state = { depth: 0 }
  let text = []
  const flush = () => { if (text.length) out.push(inlineCode(text.join('\n'), state)); text = [] }
  for (const b of blocks) {
    if (!b.fence) { text.push(b.text); continue }
    flush()
    const body = b.content.join('\n')
    out.push(b.indent + (b.info === 'raw' ? body : `<pre><code${b.info ? ` class="language-${b.info}"` : ''}>${mark(esc(body))}</code></pre>`))
  }
  flush()
  return out.join('\n')
}
const SPAN = /<[^>]*>|(?<!`)(`+)([^`\n](?:[^\n]*?[^`\n])?)\1(?!`)/g
const codeTag = (m, state) => {
  const t = /^<(\/?)(?:pre|code)\b/i.exec(m)
  if (t) state.depth = Math.max(0, state.depth + (t[1] ? -1 : 1))
}
function inlineCode(text, state) {
  return text.replace(SPAN, (m, ticks, code) => {
    if (ticks === undefined) { codeTag(m, state); return m }
    if (state.depth) return m
    if (code.length > 2 && code[0] === ' ' && code.at(-1) === ' ' && code.trim()) code = code.slice(1, -1)
    return `<code>${esc(code)}</code>`
  })
}
const renderLine = text => renderHtml([{ text }])

export function parseLesson(text) {
  const problems = []
  const err = (line, msg) => problems.push({ line, msg })
  const blocks = toBlocks(text.replace(/\r\n?/g, '\n').split('\n'), err)
  const heads = blocks.flatMap((b, i) => !b.fence && CARD.test(b.text) ? [i] : [])
  const header = blocks.slice(0, heads[0] ?? blocks.length)
  const first = header.findIndex(b => !blank(b))
  const tm = first >= 0 && !header[first].fence && /^# +(.*?)[ \t]*$/.exec(header[first].text)
  if (!tm) err(header[first]?.line ?? 1, 'a lesson file starts with "# <lesson title>"')
  const head = parseFields(header.slice(tm ? first + 1 : 0), LESSON_FIELDS, 'the lesson header', err)
  const lines = { title: tm ? header[first].line : 1, fields: head.lines, cards: [] }
  const cards = []
  heads.forEach((h, k) => {
    const parsed = parseCard(blocks[h], blocks.slice(h + 1, heads[k + 1] ?? blocks.length), cards.length + 1, err)
    if (!parsed) return
    cards.push(parsed.card)
    lines.cards.push(parsed.lines)
  })
  return {
    lesson: { title: tm ? tm[1] : undefined, recap: head.values.recap, cards },
    covers: head.values.covers ?? [], terms: head.values.terms ?? [], lines, problems,
  }
}

function parseCard(head, body, n, fileErr) {
  const m = /^## +([A-Za-z]+)[ \t]*(?::[ \t]*(.*?))?[ \t]*$/.exec(head.text)
  const t = m?.[1], type = CARD_TYPES[t]
  if (!type) {
    fileErr(head.line, `card ${n}: unknown card type "${t ?? head.text.slice(3)}"; a card starts with ## learn: <heading>, or ## ${Object.keys(CARD_TYPES).filter(k => k !== 'learn').join(', ## ')}`)
    return null
  }
  const err = (line, msg) => fileErr(line, `${t} card ${n}: ${msg}`)
  const card = { t }
  if (type.heading) {
    if (!m[2]) err(head.line, `needs a heading: ## ${t}: <heading>`)
    else card[type.heading] = renderLine(m[2])
    const own = trim(body)
    card[type.rest] = renderHtml(own)
    return { card, lines: { line: head.line, fields: { [type.heading]: head.line, [type.rest]: own[0]?.line ?? head.line } } }
  }
  if (m[2] !== undefined) err(head.line, `only a learn card takes a heading; write ## ${t}`)
  const { values, lines, langs, failed } = parseFields(body, type.fields, `a ${t} card`, err)
  for (const name of Object.keys(type.fields)) if (values[name] !== undefined) card[name] = values[name]
  const [lang, ...others] = langs
  for (const o of others) if (o.lang !== lang.lang) { failed.add('lang'); err(o.line, `${o.from} says lang ${o.lang}, but ${lang.from} says ${lang.lang}; give the card one language`) }
  if (lang) card.lang = lang.lang
  return { card, lines: { line: head.line, fields: lines, failed } }
}

// A field the parser already reported is left out of the schema's problems,
// so one mistake gives one message.
function parseFields(blocks, spec, what, fileErr) {
  const names = Object.keys(spec).filter(k => spec[k].kind !== 'index')
  const values = {}, lines = {}, langs = [], failed = new Set()
  let err = fileErr
  let i = 0
  const nextField = j => { while (j < blocks.length && !fieldOf(blocks[j])) j++; return j }
  while (i < blocks.length) {
    const b = blocks[i]
    if (blank(b)) { i++; continue }
    const m = fieldOf(b)
    if (!m) { fileErr(b.line, `expected a field line "<name>: <value>"; ${what} takes ${names.join(', ')}`); i = nextField(i + 1); continue }
    const [, key, rest = ''] = m, f = spec[key]
    err = (line, msg) => { failed.add(key); fileErr(line, msg) }
    const j = nextField(i + 1), own = blocks.slice(i + 1, j)
    i = j
    if (!f || f.kind === 'index') { fileErr(b.line, `unknown field "${key}" in ${what}; its fields are ${names.join(', ')}`); continue }
    if (key in lines) err(b.line, `${key} is given twice`)
    lines[key] = b.line
    const stray = bs => { const s = bs.find(x => !blank(x)); if (s) err(s.line, `unexpected line after ${key}; ${hint(key, f)}`) }
    const items = rest === '' && own.find(x => !blank(x)) && listItem(own.find(x => !blank(x)))
    if (f.kind === 'lang') { values.lang = rest || undefined; if (rest) langs.unshift({ lang: rest, line: b.line, from: 'lang:' }); else err(b.line, 'lang: needs a value'); stray(own); continue }
    if (items || f.list === 'list' || f.list === 'choices' || f.kind === 'terms' || (f.kind === 'names' && rest === '')) {
      if (rest !== '' && f.kind !== 'names') { err(b.line, `${key} takes a list: "${key}:" then one "- " line per item`); continue }
      let end = 0
      while (end < own.length && (listItem(own[end]) || blank(own[end]))) end++
      const list = own.slice(0, end).filter(listItem)
      stray(own.slice(end))
      values[key] = listValue(key, f, list.map(x => ({ text: x.text.slice(2), line: x.line })), values, err)
      continue
    }
    if (f.kind === 'names') { values[key] = rest.split(',').map(s => s.trim()).filter(Boolean); stray(own); continue }
    if (f.kind === 'plain') {
      if (rest !== '') { values[key] = rest; stray(own); continue }
      const k = own.findIndex(x => !blank(x))
      if (k < 0 || !own[k].fence) { err(b.line, `${key} is empty; ${hint(key, f)}`); stray(own); continue }
      values[key] = own[k].content.join('\n')
      if (own[k].info) langs.push({ lang: own[k].info, line: own[k].line, from: `the ${key} fence` })
      stray(own.slice(k + 1))
      continue
    }
    const cut = own.findIndex(listItem)
    const src = trim([...(rest !== '' ? [{ text: rest, line: b.line }] : []), ...(cut < 0 ? own : own.slice(0, cut))])
    values[key] = renderHtml(src)
    if (cut >= 0) stray(own.slice(cut))
  }
  return { values, lines, langs, failed }
}

function hint(key, f) {
  if (f.kind === 'plain') return `${key} takes one line, or "${key}:" then a \`\`\` fence`
  if (f.list) return `${key} takes a list: "${key}:" then one "- " line per item`
  return `${key} continues until the next field line`
}

function listValue(key, f, items, values, err) {
  if (f.kind === 'names') return items.map(x => x.text.trim()).filter(Boolean)
  if (f.kind === 'terms') return items.flatMap(x => {
    const at = x.text.indexOf(': ')
    if (at < 1) { err(x.line, 'a term is "- <term>: <meaning>"'); return [] }
    return [[renderLine(x.text.slice(0, at)), renderLine(x.text.slice(at + 2))]]
  })
  const item = s => f.kind === 'html' ? renderLine(s) : s
  if (f.list !== 'choices') return items.map(x => item(x.text))
  const right = []
  const out = items.map((x, i) => {
    const m = /^\[([ xX])\] ?(.*)$/.exec(x.text)
    if (!m) { err(x.line, `each ${key} item starts with [x] (the right one) or [ ]`); return item(x.text) }
    if (m[1] !== ' ') right.push(i)
    return item(m[2])
  })
  if (right.length === 1) values.a = right[0]
  else err(items[0]?.line, `mark exactly one ${key} item [x]; ${right.length} are marked`)
  return out
}


// Each value is written in the most readable form that parses back to it
// exactly: backticks and fences, then the HTML as it is, then a ```raw fence.
const fenceTicks = lines => '`'.repeat(Math.max(3, ...lines.map(l => (FENCE_CLOSE.exec(l)?.[1].length ?? 0) + 1)))
function prettyHtml(v) {
  const state = { depth: 0 }
  const s = v.replace(/<code>([^<\n]*)<\/code>|<[^>]*>/g, (m, inner) => {
    if (inner === undefined) { codeTag(m, state); return m }
    const code = unesc(inner)
    if (state.depth || !code || esc(code) !== inner) return m
    const ticks = '`'.repeat(Math.max(0, ...(code.match(/`+/g) ?? []).map(r => r.length)) + 1)
    const pad = /^`|`$/.test(code) || (/^ .* $/.test(code) && code.trim()) ? ' ' : ''
    return ticks + pad + code + pad + ticks
  })
  return s.replace(/(^|\n)([ \t]*)<pre><code(?: class="language-([^"\s`]+)")?>([\s\S]*?)<\/code><\/pre>(?=\n|$)/g, (m, nl, indent, info = '', body) => {
    if (info === 'raw' || /[«»]/.test(body)) return m
    const marked = body.replace(/<span class="hl">([^<«»\n]*)<\/span>/g, '«$1»')
    if (marked.includes('<') || mark(esc(unesc(marked))) !== body) return m
    const lines = unesc(marked).split('\n'), ticks = fenceTicks(lines)
    return [nl + indent + ticks + info, ...lines.map(l => l && indent + l), indent + ticks].join('\n')
  })
}
const rawFence = v => { const lines = v.split('\n'), t = fenceTicks(lines); return [`${t}raw`, ...lines, t] }
const where = path => path.split('.').map((x, i, all) => /^\d+$/.test(x) ? `${{ cards: 'card', terms: 'term' }[all[i - 1]] ?? 'item'} ${+x + 1}` : x)
  .filter(x => x !== 'cards' && x !== 'terms').join(' ')
const oneLine = v => typeof v === 'string' && v !== '' && !v.includes('\n') && v.trim() === v

function writeLesson(lesson, covers, terms, level) {
  const out = [], at = []
  const lv = path => level.get(path) ?? 0
  const emit = (path, ...lines) => { for (const l of lines) { out.push(l); at.push(path) } }
  const htmlSrc = (path, v) => (lv(path) === 0 ? prettyHtml(v) : v)
  const html = (key, v, path) => {
    if (lv(path) >= 2) return emit(path, `${key}:`, ...rawFence(v))
    const [head, ...more] = htmlSrc(path, v).split('\n')
    if (oneLine(head)) emit(path, `${key}: ${head}`, ...more)
    else emit(path, `${key}:`, head, ...more)
  }
  const line = (path, v) => {
    const s = htmlSrc(path, v)
    if (s.includes('\n')) throw new Error(`${where(path)} has a line break, which this place in the lesson format cannot hold`)
    return s
  }
  emit('title', `# ${lesson.title}`)
  if (lesson.recap !== undefined) html('recap', lesson.recap, 'recap')
  if (covers.length) emit('covers', covers.some(c => c.includes(',')) ? 'covers:' : `covers: ${covers.join(', ')}`, ...(covers.some(c => c.includes(',')) ? covers.map(c => `- ${c}`) : []))
  if (terms.length) emit('terms', 'terms:')
  terms.forEach(([k, m], i) => emit(`terms.${i}`, `- ${line(`terms.${i}`, k)}: ${line(`terms.${i}`, m)}`))
  lesson.cards.forEach((c, ci) => {
    const p = `cards.${ci}`, type = CARD_TYPES[c.t]
    if (!type) throw new Error(`card ${ci + 1} has unknown type "${c.t}"`)
    const extra = Object.keys(c).filter(k => k !== 't' && !(k in type.fields))
    if (extra.length) throw new Error(`card ${ci + 1} (${c.t}) has ${extra.join(', ')}, which a ${c.t} card does not take`)
    emit(p, '')
    if (type.heading) {
      emit(`${p}.${type.heading}`, `## ${c.t}: ${line(`${p}.${type.heading}`, c[type.heading])}`)
      const bp = `${p}.${type.rest}`
      emit(bp, ...(lv(bp) >= 2 ? rawFence(c[type.rest]) : htmlSrc(bp, c[type.rest]).split('\n')))
      return
    }
    emit(p, `## ${c.t}`)
    const fenced = name => { const f = type.fields[name]; return f.kind === 'plain' && !f.list && c[name] !== undefined && (lv(`${p}.${name}`) >= 1 || !oneLine(c[name])) }
    const langFromFence = c.lang !== undefined && Object.keys(type.fields).some(fenced)
    for (const [name, f] of Object.entries(type.fields)) {
      const v = c[name], fp = `${p}.${name}`
      if (v === undefined || f.kind === 'index') continue
      if (f.kind === 'lang') { if (!langFromFence) emit(fp, `lang: ${v}`); continue }
      if (f.kind === 'plain' && !f.list) {
        if (!fenced(name)) { emit(fp, `${name}: ${v}`); continue }
        const lines = v.split('\n'), t = fenceTicks(lines)
        emit(fp, `${name}:`, `${t}${c.lang ?? ''}`, ...lines, t)
        continue
      }
      if (f.list === 'maybe' && !Array.isArray(v)) { html(name, v, fp); continue }
      if (!f.list) { html(name, v, fp); continue }
      emit(fp, `${name}:`)
      v.forEach((item, k) => {
        const ip = `${fp}.${k}`, s = f.kind === 'html' ? line(ip, item) : item
        if (typeof s !== 'string' || s.includes('\n')) throw new Error(`${where(ip)} must be one line of text to fit a list item`)
        emit(ip, `- ${f.list === 'choices' ? (k === c.a ? '[x] ' : '[ ] ') : ''}${s}`)
      })
    }
  })
  return { text: out.join('\n') + '\n', at }
}

function valuesOf(lesson, covers, terms) {
  const out = [['title', lesson.title], ['recap', lesson.recap], ['covers', covers]]
  terms.forEach((t, i) => out.push([`terms.${i}`, t]))
  lesson.cards.forEach((c, ci) => {
    out.push([`cards.${ci}`, c.t])
    for (const k of Object.keys(CARD_TYPES[c.t]?.fields ?? {})) {
      if (Array.isArray(c[k])) c[k].forEach((x, i) => out.push([`cards.${ci}.${k}.${i}`, x]))
      out.push([`cards.${ci}.${k}`, c[k]])
    }
  })
  return out
}

export function serializeLesson(lesson, covers, terms) {
  const extra = Object.keys(lesson).filter(k => !['id', 'title', 'recap', 'cards'].includes(k))
  if (extra.length) throw new Error(`has ${extra.join(', ')}, which the lesson format does not hold`)
  if (!oneLine(lesson.title)) throw new Error('its title must be one line with no surrounding spaces')
  const level = new Map()
  const want = valuesOf(lesson, covers, terms)
  for (;;) {
    const { text, at } = writeLesson(lesson, covers, terms, level)
    const back = parseLesson(text)
    const got = new Map(valuesOf(back.lesson, back.covers, back.terms))
    const bad = want.find(([p, v]) => JSON.stringify(got.get(p)) !== JSON.stringify(v))?.[0]
      ?? at[(back.problems[0]?.line ?? 0) - 1]
      ?? (back.lesson.cards.length !== lesson.cards.length || back.terms.length !== terms.length ? 'cards' : null)
    if (!bad) return text
    const next = (level.get(bad) ?? 0) + 1
    if (next > 2) throw new Error(`cannot write ${where(bad)} in the lesson format: ${JSON.stringify(want.find(([p]) => p === bad)?.[1] ?? '').slice(0, 80)}`)
    level.set(bad, next)
  }
}


const rel = p => relative(process.cwd(), p) || '.'

function readCourse(dir) {
  const file = join(dir, 'course.json')
  const fatal = msg => ({ fatal: `${rel(file)}: ${msg}` })
  if (!existsSync(file)) return fatal(`missing; create the course with: node lessons.mjs init ${dir}`)
  let json
  try { json = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return fatal(`not valid JSON: ${e.message}`) }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return fatal('must be a JSON object')
  const { units, languages = [], ...COURSE } = json
  const problems = []
  const at = msg => problems.push(`${rel(file)}: ${msg}`)
  if (!Array.isArray(units) || !units.length) return fatal('needs "units": [{ "id", "title", "blurb", "color", "dark", "lessons": [lesson ids] }]')
  if (!Array.isArray(languages) || !languages.every(l => typeof l === 'string' && /^[a-z0-9][\w-]*$/i.test(l))) at('"languages" must be a list of highlight.js language names, such as ["haskell"]')
  units.forEach((u, ui) => {
    if (!Array.isArray(u?.lessons) || !u.lessons.every(id => typeof id === 'string' && /^\w[\w.-]*$/.test(id)))
      at(`unit ${ui + 1} (${u?.id ?? '?'}): "lessons" must list lesson ids, each the name of a file in lessons/ without .md`)
  })
  return { file, COURSE, units: units.map(u => ({ ...u, lessons: Array.isArray(u?.lessons) ? u.lessons.filter(id => typeof id === 'string') : [] })), languages: Array.isArray(languages) ? languages.filter(l => typeof l === 'string') : [], problems }
}

function readLessons(dir, ids) {
  const out = new Map()
  for (const id of ids) {
    const file = join(dir, 'lessons', `${id}.md`)
    if (!existsSync(file)) continue
    const parsed = parseLesson(readFileSync(file, 'utf8'))
    out.set(id, { ...parsed, file, lesson: { id, ...parsed.lesson } })
  }
  return out
}

function locate(p, { course, lessons, unitsData, sylFile }) {
  if (p.syllabus) return `${rel(sylFile)}${p.syllabus.line ? `:${p.syllabus.line}` : ''}: ${p.msg}`
  if (p.lesson !== undefined && lessons.has(p.lesson)) {
    const L = lessons.get(p.lesson), f = rel(L.file)
    if (p.card === undefined) return `${f}:${L.lines.fields[p.field] ?? L.lines.title}: ${p.msg}`
    const cl = L.lines.cards[p.card]
    let line = cl.fields[p.field] ?? cl.line
    if (p.find) {
      const src = readFileSync(L.file, 'utf8').split('\n'), end = L.lines.cards[p.card + 1]?.line ?? src.length + 1
      const k = src.slice(line - 1, end - 1).findIndex(s => s.replace(/[«»]/g, '').includes(p.find.trim()))
      if (k >= 0) line += k
    }
    return `${f}:${line}: ${p.t} card ${p.card + 1}: ${p.msg}`
  }
  if (p.unit !== undefined) return `${rel(course.file)}: unit ${p.unit + 1} (${unitsData[p.unit]?.id ?? '?'}): ${p.msg}`
  return `${rel(course.file)}: ${p.scope && p.scope !== 'COURSE' ? `${p.scope}: ` : ''}${p.msg}`
}

// Everything `check` and `build` validate. With `only`, just those lessons
// and units, and no course-wide rules.
function checkFolder(dir, { only, repo } = {}) {
  const course = readCourse(dir)
  if (course.fatal) return { problems: [course.fatal] }
  const problems = [...course.problems]
  const listed = course.units.flatMap(u => u.lessons)
  const lessonDir = join(dir, 'lessons')
  const files = existsSync(lessonDir) ? readdirSync(lessonDir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)) : []
  let unitIdx = course.units.map((_, i) => i), lessonIds = listed
  if (only) {
    for (const id of only) if (!course.units.some(u => u.id === id) && !listed.includes(id) && !files.includes(id)) problems.push(`${rel(course.file)}: no unit or lesson "${id}" (lessons/${id}.md does not exist either)`)
    unitIdx = unitIdx.filter(i => only.includes(course.units[i].id))
    lessonIds = [...new Set([...unitIdx.flatMap(i => course.units[i].lessons), ...only.filter(id => listed.includes(id) || files.includes(id))])]
  } else {
    for (const id of files) if (!listed.includes(id)) problems.push(`${rel(join(lessonDir, `${id}.md`))}: not listed in course.json; add "${id}" to a unit's lessons, or delete the file`)
  }
  const lessons = readLessons(dir, lessonIds)
  course.units.forEach((u, ui) => {
    for (const id of u.lessons) if ((!only || unitIdx.includes(ui) || only.includes(id)) && !lessons.has(id)) problems.push(`${rel(course.file)}: unit ${ui + 1} (${u.id}) lists "${id}", but ${rel(join(lessonDir, `${id}.md`))} does not exist`)
  })
  for (const L of lessons.values()) for (const p of L.problems) problems.push(`${rel(L.file)}:${p.line}: ${p.msg}`)

  const unitsData = course.units.map(u => ({ ...u, lessons: u.lessons.filter(id => lessons.has(id)).map(id => lessons.get(id).lesson) }))
  const glossary = new Map()
  for (const id of listed) for (const [k, m] of lessons.get(id)?.terms ?? []) if (!glossary.has(k.toLowerCase())) glossary.set(k.toLowerCase(), [k, m])
  const data = { COURSE: course.COURSE, UNITS: unitsData, GLOSSARY: [...glossary.values()] }
  const ctx = { course, lessons, unitsData, sylFile: join(dir, 'syllabus.md') }
  const opts = { languages: course.languages }
  const found = only
    ? [...unitIdx.flatMap(i => validateUnit(unitsData[i], i, opts)),
      ...lessonIds.filter(id => !unitIdx.some(i => course.units[i].lessons.includes(id))).flatMap(id => validateLesson(lessons.get(id)?.lesson, opts))]
    : validateCourse(data, opts)

  let syllabus = null, rows = [], ids = new Map()
  if (!existsSync(ctx.sylFile)) problems.push(`${rel(ctx.sylFile)}: missing; write the | Area | Sources | Lessons | table (see SKILL.md)`)
  else {
    syllabus = readFileSync(ctx.sylFile, 'utf8')
    const parsed = parseSyllabus(syllabus)
    rows = parsed.rows
    if (!only) found.push(...parsed.problems)
    const inOrder = (only ? lessonIds : listed).filter(id => lessons.has(id)).map(id => ({ id, covers: lessons.get(id).covers }))
    const covers = checkCovers(rows, inOrder, { full: !only })
    ids = covers.ids
    found.push(...covers.problems)
    if (repo) {
      try { found.push(...checkRepoCoverage(rows, trackedDirs(repo))) }
      catch (e) { problems.push(`--repo: cannot list tracked files in ${repo}: ${e.message.split('\n')[0]}`) }
    }
  }
  const reported = p => p.card !== undefined && lessons.get(p.lesson)?.lines.cards[p.card]?.failed?.has(p.field)
  problems.push(...found.filter(p => !reported(p)).map(p => locate(p, ctx)))
  const cards = [...lessons.values()].reduce((n, L) => n + L.lesson.cards.length, 0)
  return { problems, data, course, syllabus, rows, ids, counts: { units: unitsData.length, lessons: lessons.size, cards, rows: rows.length } }
}

const js = v => JSON.stringify(v, null, 1).replace(/<(\/script|!--)/gi, '\\u003c$1')
function buildPage(data, languages) {
  const template = readFileSync(TEMPLATE, 'utf8')
  const block = '/* ===== COURSE CONTENT: built by lessons.mjs from course.json and lessons/; edit those, then build again ===== */\n'
    + `const COURSE = ${js(data.COURSE)};\n\nconst UNITS = ${js(data.UNITS)};\n\nconst GLOSSARY = ${js(data.GLOSSARY)};\n`
  return template
    .replace(/\/\* ===== COURSE CONTENT[\s\S]*?(?=\/\* ===== END COURSE CONTENT ===== \*\/)/, () => block)
    .replace(/<script src="[^"]*\/highlight\.min\.js"[^>]*><\/script>/, tag => [tag, ...languages.map(n => `<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/languages/${n}.min.js"></script>`)].join('\n'))
}

function fillSyllabus(text, rows, ids) {
  const lines = text.split('\n')
  for (const r of rows) {
    if (r.skip) continue
    const cells = [...r.cells]
    cells[2] = ids.get(r).join(', ')
    lines[r.line - 1] = `${lines[r.line - 1].match(/^\s*/)[0]}| ${cells.join(' | ')} |`
  }
  return lines.join('\n')
}

function build(dir, { repo, write }) {
  const r = checkFolder(dir, { repo })
  if (r.problems.length) return r
  const html = buildPage(r.data, r.course.languages)
  const syllabus = fillSyllabus(r.syllabus, r.rows, r.ids)
  let page
  try { page = checkPage(html, syllabus, { repoDirs: repo ? trackedDirs(repo) : undefined }) }
  catch (e) { return { problems: [`${rel(join(dir, 'index.html'))} (built): ${e.message}`] } }
  if (page.problems.length) return { problems: page.problems.map(p => `${rel(join(dir, 'index.html'))} (built): ${p}`) }
  if (write) {
    const put = (f, s) => { if (!existsSync(f) || readFileSync(f, 'utf8') !== s) writeFileSync(f, s) }
    put(join(dir, 'index.html'), html)
    put(join(dir, 'syllabus.md'), syllabus)
  }
  return { problems: [], counts: page.counts }
}


const SAMPLE_SYLLABUS = `| Area | Sources | Lessons |
|---|---|---|
| Card types | \`template.html\` | u1l1 |
| Visual patterns | \`references/visuals.md\` | u1l2 |
| Generated pages | \`index.html\` | skip: built by lessons.mjs from the lesson files |
`

function init(dir, from) {
  if (existsSync(join(dir, 'course.json'))) throw new Error(`${rel(join(dir, 'course.json'))} already exists; edit the course there, or init a new folder`)
  const page = from ?? TEMPLATE
  const sylPath = join(dirname(page), 'syllabus.md')
  const syllabus = from ? (existsSync(sylPath) ? readFileSync(sylPath, 'utf8') : '| Area | Sources | Lessons |\n|---|---|---|\n') : SAMPLE_SYLLABUS
  const { data: { COURSE, UNITS, GLOSSARY }, languages } = loadPage(readFileSync(page, 'utf8'))
  const sampleKey = loadPage(readFileSync(TEMPLATE, 'utf8')).data.COURSE.storageKey
  const rows = parseSyllabus(syllabus).rows
  const lessons = UNITS.flatMap(u => u.lessons)
  const course = { ...COURSE }
  const name = basename(resolve(dir))
  if (course.storageKey === sampleKey) course.storageKey = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'course'}-v1`
  if (!from) {
    const words = name.split(/[-_\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1))
    course.title = words.join(' ') || 'Course'
    course.logoHtml = words.length > 1 ? `${words.slice(0, -1).join(' ')} <span>${words.at(-1)}</span>` : `<span>${course.title}</span>`
  }
  if (languages.length) course.languages = languages
  course.units = UNITS.map(({ lessons, ...u }) => ({ ...u, lessons: lessons.map(l => l.id) }))

  // Each glossary term goes to the first lesson that mentions it, never
  // earlier than the term before it, so the built glossary keeps its order.
  const terms = new Map(lessons.map(l => [l.id, []]))
  const text = lessons.map(l => JSON.stringify([l.title, l.recap, ...l.cards.flatMap(c => Object.values(c))]).toLowerCase())
  let floor = 0
  for (const [k, m] of GLOSSARY) {
    const i = text.findIndex((t, j) => j >= floor && t.includes(String(k).toLowerCase()))
    floor = i < 0 ? floor : i
    terms.get(lessons[floor].id).push([k, m])
  }
  const files = [], failed = []
  for (const l of lessons) {
    if (!/^\w[\w.-]*$/.test(l.id ?? '')) { failed.push(`lesson "${l.id}": its id cannot be a file name`); continue }
    const covers = rows.filter(r => !r.skip && r.lessons.split(/[\s,]+/).includes(l.id)).map(r => r.area)
    try { files.push([l.id, serializeLesson(l, covers, terms.get(l.id))]) }
    catch (e) { failed.push(`lesson ${l.id}: ${e.message}`) }
  }
  if (failed.length) throw new Error(`${failed.length} lesson(s) cannot be imported:\n- ${failed.join('\n- ')}`)
  mkdirSync(join(dir, 'lessons'), { recursive: true })
  writeFileSync(join(dir, 'course.json'), JSON.stringify(course, null, 2) + '\n')
  writeFileSync(join(dir, 'syllabus.md'), syllabus)
  for (const [id, text] of files) writeFileSync(join(dir, 'lessons', `${id}.md`), text)
  return { lessons: files.length, syllabus: !from || existsSync(sylPath) }
}


function main(argv) {
  const args = [...argv]
  const flag = name => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args.splice(i, 2)[1]; if (!v) usage(); return v }
  const usage = () => { console.error(USAGE); process.exit(2) }
  const cmd = args.shift()
  const repo = flag('--repo'), from = flag('--from')
  const [dir, ...ids] = args
  if (!dir || !['init', 'check', 'build'].includes(cmd) || (cmd !== 'check' && ids.length) || (from && cmd !== 'init') || (repo && cmd === 'init')) usage()
  const fail = problems => { console.error(`${problems.length} problem(s):\n${problems.join('\n')}`); process.exit(1) }
  if (cmd === 'init') {
    try {
      const r = init(dir, from)
      console.log(`OK: wrote ${rel(join(dir, 'course.json'))}, ${rel(join(dir, 'syllabus.md'))} and ${r.lessons} lesson file(s) in ${rel(join(dir, 'lessons'))}`)
      if (!r.syllabus) console.log(`No syllabus.md beside ${from}: write its rows, add a covers: line to each lesson, then build.`)
    } catch (e) { console.error(e.message); process.exit(1) }
    return
  }
  if (cmd === 'check' && ids.length) {
    const r = checkFolder(dir, { only: ids, repo })
    if (r.problems.length) fail(r.problems)
    console.log(`OK: ${r.counts.lessons} lessons, ${r.counts.cards} cards (${ids.join(', ')})`)
    return
  }
  const r = build(dir, { repo, write: cmd === 'build' })
  if (r.problems.length) fail(r.problems)
  console.log(`OK: ${summary(r.counts)}${cmd === 'build' ? `; wrote ${rel(join(dir, 'index.html'))}` : ''}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
