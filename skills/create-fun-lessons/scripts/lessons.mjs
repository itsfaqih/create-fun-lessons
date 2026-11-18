// Build a create-fun-lessons page from a course folder (course.json,
// syllabus.md, lessons/*.md), check the folder, or create one.
// The lesson file format is in references/lessons.md.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, realpathSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CARD_TYPES, validateCourse, validateUnit, validateLesson, parseSyllabus, checkCovers, checkRepoCoverage, shownProblems, decode } from './schema.mjs'
import { loadPage, checkPage, trackedDirs, summary } from './check.mjs'
import { selfcheck, resumeMatches, SCREEN, NoBrowser } from './selfcheck.mjs'

const TEMPLATE = fileURLToPath(new URL('../template.html', import.meta.url))
const USAGE = `usage:
  node lessons.mjs init <dir> [--from <page.html>] [--repo <repo-dir>]
  node lessons.mjs check <dir> [<lesson-or-unit-id> ...] [--repo <repo-dir>]
  node lessons.mjs build <dir> [--repo <repo-dir>]
  node lessons.mjs selfcheck <dir>`

const LESSON_FIELDS = { id: { kind: 'plain' }, recap: { kind: 'html' }, covers: { kind: 'names' }, terms: { kind: 'terms' } }
const LESSON_ID = /^\w[\w.-]*$/
const REPO_RULE = 'the git repo the course teaches, relative to the course folder (such as "../ky"), or null for a library or topic course'


const FENCE_OPEN = /^([ \t]*)(`{3,})([^`\s]*)[ \t]*$/
const FENCE_CLOSE = /^[ \t]*(`{3,})[ \t]*$/
const FIELD = /^([a-z][A-Za-z]*):(?:[ \t]+(.*?))?[ \t]*$/
const CARD = /^## /
const TITLE = /^# /
const LIST = /^-( |$)/
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const unesc = s => s.replace(/&(amp|lt|gt);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>' }[e]))
// A «…» highlight that runs over line breaks becomes one span per line, with
// the line breaks and indentation between them left outside.
// A fence in one of these languages, or with no language, may show an entity on purpose.
const MARKUP = /^(html|xml|svg|xhtml|markup|vue|svelte|jsx|tsx|md|markdown|text|plaintext)?$/i
const mark = s => s.replace(/«([^«»]*)»/g, (_, h) => h.split(/(\s*\n\s*)/)
  .map((p, i, all) => i % 2 || (!p && all.length > 1) ? p : `<span class="hl">${p}</span>`).join(''))

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
// highlighted; a ```raw fence goes in as written; `x` outside tags, <pre> and
// <code> becomes <code>. What the learner would see wrongly is reported at
// its source line.
function renderHtml(blocks, err) {
  const out = [], from = [], state = { depth: 0 }
  let text = []
  const put = (html, lines) => html.split('\n').forEach((l, k) => { out.push(l); from.push(lines(k)) })
  const flush = () => {
    if (!text.length) return
    const t = text, src = t.map(b => b.text).join('\n'), lineAt = k => t[k]?.line ?? t.at(-1).line
    put(inlineCode(src, state, at => err(lineAt(src.slice(0, at).split('\n').length - 1), STRAY)), lineAt)
    text = []
  }
  for (const b of blocks) {
    if (!b.fence) { text.push(b); continue }
    flush()
    const body = b.content.join('\n')
    if (b.info !== 'raw' && !MARKUP.test(b.info)) b.content.forEach((l, k) => {
      const e = /&(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/i.exec(l)
      if (e) err(b.line + 1 + k, `the learner sees "${e[0]}" as written: a \`\`\` fence shows code exactly as typed, so write the character itself`)
    })
    put(b.indent + (b.info === 'raw' ? body : `<pre><code${b.info ? ` class="language-${b.info}"` : ''}>${mark(esc(body))}</code></pre>`), k => b.line + 1 + k)
  }
  flush()
  const html = out.join('\n')
  for (const p of shownProblems(html)) err(from[p.line], p.msg)
  return html
}
const codeTag = (m, state) => {
  const t = /^<(\/?)(?:pre|code)\b/i.exec(m)
  if (t) state.depth = Math.max(0, state.depth + (t[1] ? -1 : 1))
}
const STRAY = 'the learner sees a stray backtick: a `code` span ends at the next run of the same number of backticks on its line; for a literal backtick write &#96;'
// As in Markdown, a run of backticks opens a span that the next run of the same
// length closes (on its line), so ``x`y`` holds a backtick; a run nothing
// closes stays as written, and `stray` gets its offset. The span is code,
// escaped for you; an entity written in it, as in `a &lt; b`, stands for its
// character.
function inlineCode(text, state, stray) {
  const tokens = /<[^>]*>|`+/g
  let out = '', done = 0
  for (let m; (m = tokens.exec(text));) {
    if (m[0][0] === '<') { codeTag(m[0], state); continue }
    if (state.depth) continue
    const n = m[0].length, start = tokens.lastIndex, eol = text.indexOf('\n', start)
    const close = [...text.slice(start, eol < 0 ? undefined : eol).matchAll(/`+/g)].find(r => r[0].length === n)
    if (!close) { stray(m.index); continue }
    let code = text.slice(start, start + close.index)
    if (code[0] === ' ' && code.at(-1) === ' ' && code.trim()) code = code.slice(1, -1)
    out += `${text.slice(done, m.index)}<code>${esc(decode(code))}</code>`
    done = tokens.lastIndex = start + close.index + n
  }
  return out + text.slice(done)
}
const renderLine = (text, line, err) => renderHtml([{ text, line }], err)
// A plain field is shown as written; only the «…» markers can go wrong.
const checkPlain = (v, line, err) => { for (const p of shownProblems(v, 'plain')) err(line + p.line, p.msg) }

// A file holds one or more lessons, each starting at a "# <title>" line. A
// lesson's id is its "id:" line, or, in a file holding one lesson, the file
// name; never its place in the file, so inserting a lesson moves no id.
export function parseLessonFile(text, name) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n'), fence = []
  const blocks = toBlocks(lines, (line, msg) => fence.push({ line, msg }))
  const starts = blocks.flatMap((b, i) => !b.fence && TITLE.test(b.text) ? [i] : [])
  const cuts = [0, ...starts.slice(1), blocks.length]
  const lessons = cuts.slice(0, -1).map((a, k) => {
    const L = parseLesson(blocks.slice(a, cuts[k + 1]))
    L.end = cuts[k + 1] < blocks.length ? blocks[cuts[k + 1]].line - 1 : lines.length
    if (L.id === undefined && cuts.length === 2) L.id = name
    else if (L.id === undefined) L.problems.push({ line: L.lines.title, msg: `this file holds ${cuts.length - 1} lessons, so each needs an "id: <lesson id>" line under its # title` })
    else if (!LESSON_ID.test(L.id)) { L.problems.push({ line: L.lines.fields.id, msg: `id "${L.id}" is not a lesson id; use letters, digits, _, . and -, as in u2l1` }); L.id = undefined }
    L.lesson = { id: L.id, ...L.lesson }
    return L
  })
  // An unclosed fence runs to the end of the file, so it is in the last lesson.
  lessons.at(-1).problems.unshift(...fence)
  return lessons
}

function parseLesson(blocks) {
  const problems = []
  const err = (line, msg) => problems.push({ line, msg })
  const heads = blocks.flatMap((b, i) => !b.fence && CARD.test(b.text) ? [i] : [])
  const header = blocks.slice(0, heads[0] ?? blocks.length)
  const first = header.findIndex(b => !blank(b))
  const tm = first >= 0 && !header[first].fence && /^# +(.*?)[ \t]*$/.exec(header[first].text)
  if (!tm) err(header[first]?.line ?? 1, 'a lesson starts with "# <lesson title>"')
  const head = parseFields(header.slice(tm ? first + 1 : 0), LESSON_FIELDS, 'the lesson header', err)
  const lines = { title: header[first]?.line ?? 1, fields: head.lines, cards: [] }
  const cards = []
  heads.forEach((h, k) => {
    const parsed = parseCard(blocks[h], blocks.slice(h + 1, heads[k + 1] ?? blocks.length), cards.length + 1, err)
    if (!parsed) return
    cards.push(parsed.card)
    lines.cards.push(parsed.lines)
  })
  return {
    id: head.values.id, lesson: { title: tm ? tm[1] : undefined, recap: head.values.recap, cards },
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
    else card[type.heading] = renderLine(m[2], head.line, err)
    const own = trim(body)
    card[type.rest] = renderHtml(own, err)
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
      values[key] = listValue(key, f, list.map(x => ({ text: x.text.slice(2), line: x.line })), values, err, fileErr)
      continue
    }
    if (f.kind === 'names') { values[key] = rest.split(',').map(s => s.trim()).filter(Boolean); stray(own); continue }
    if (f.kind === 'plain') {
      if (rest !== '') { values[key] = rest; checkPlain(rest, b.line, fileErr); stray(own); continue }
      const k = own.findIndex(x => !blank(x))
      if (k < 0 || !own[k].fence) { err(b.line, `${key} is empty; ${hint(key, f)}`); stray(own); continue }
      values[key] = own[k].content.join('\n')
      checkPlain(values[key], own[k].line + 1, fileErr)
      if (own[k].info) langs.push({ lang: own[k].info, line: own[k].line, from: `the ${key} fence` })
      stray(own.slice(k + 1))
      continue
    }
    const cut = own.findIndex(listItem)
    const src = trim([...(rest !== '' ? [{ text: rest, line: b.line }] : []), ...(cut < 0 ? own : own.slice(0, cut))])
    values[key] = renderHtml(src, fileErr)
    if (cut >= 0) stray(own.slice(cut))
  }
  return { values, lines, langs, failed }
}

function hint(key, f) {
  if (f.kind === 'plain') return `${key} takes one line, or "${key}:" then a \`\`\` fence`
  if (f.list) return `${key} takes a list: "${key}:" then one "- " line per item`
  return `${key} continues until the next field line`
}

// `err` marks the field as reported; `shown` reports what the learner would
// see wrongly without hiding the schema's other problems with the field.
function listValue(key, f, items, values, err, shown) {
  if (f.kind === 'names') return items.map(x => x.text.trim()).filter(Boolean)
  if (f.kind === 'terms') return items.flatMap(x => {
    const at = x.text.indexOf(': ')
    if (at < 1) { err(x.line, 'a term is "- <term>: <meaning>"'); return [] }
    return [[renderLine(x.text.slice(0, at), x.line, shown), renderLine(x.text.slice(at + 2), x.line, shown)]]
  })
  const item = (s, line) => {
    if (f.kind === 'html') return renderLine(s, line, shown)
    checkPlain(s, line, shown)
    return s
  }
  if (f.list !== 'choices') return items.map(x => item(x.text, x.line))
  const right = []
  const out = items.map((x, i) => {
    const m = /^\[([ xX])\] ?(.*)$/.exec(x.text)
    if (!m) { err(x.line, `each ${key} item starts with [x] (the right one) or [ ]`); return item(x.text, x.line) }
    if (m[1] !== ' ') right.push(i)
    return item(m[2], x.line)
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
    if (state.depth || !code || esc(code) !== inner || decode(code) !== code) return m
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
  if (lesson.id !== undefined) emit('id', `id: ${lesson.id}`)
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
  const out = [['title', lesson.title], ['id', lesson.id], ['recap', lesson.recap], ['covers', covers]]
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
    const [back] = parseLessonFile(text)
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


const rel = p => { const r = relative(process.cwd(), p) || '.'; return r.startsWith('..') ? p : r }

function readCourse(dir) {
  const file = join(dir, 'course.json')
  const fatal = msg => ({ fatal: `${rel(file)}: ${msg}` })
  if (!existsSync(file)) return fatal(`missing; create the course with: node lessons.mjs init ${dir}`)
  let json
  try { json = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return fatal(`not valid JSON: ${e.message}`) }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return fatal('must be a JSON object')
  const { units, languages = [], repo, ...COURSE } = json
  const problems = []
  const at = msg => problems.push(`${rel(file)}: ${msg}`)
  if (!Array.isArray(units) || !units.length) return fatal('needs "units": [{ "id", "title", "blurb", "color", "dark", "lessons": [lesson ids] }]')
  if (!Array.isArray(languages) || !languages.every(l => typeof l === 'string' && /^[a-z0-9][\w-]*$/i.test(l))) at('"languages" must be a list of highlight.js language names, such as ["haskell"]')
  if (repo !== undefined && repo !== null && (typeof repo !== 'string' || !repo.trim())) at(`"repo" ${REPO_RULE}`)
  units.forEach((u, ui) => {
    if (!Array.isArray(u?.lessons) || !u.lessons.every(id => typeof id === 'string' && LESSON_ID.test(id)))
      at(`unit ${ui + 1} (${u?.id ?? '?'}): "lessons" must list lesson ids, such as "u1l1"`)
  })
  return { file, COURSE, repo, units: units.map(u => ({ ...u, lessons: Array.isArray(u?.lessons) ? u.lessons.filter(id => typeof id === 'string') : [] })), languages: Array.isArray(languages) ? languages.filter(l => typeof l === 'string') : [], problems }
}

// Every lesson in lessons/*.md, in file order, and the first lesson with each
// id. A lesson's `where` is its id line, or its file when the file names it.
function readLessons(dir) {
  const lessonDir = join(dir, 'lessons'), all = [], byId = new Map()
  const names = existsSync(lessonDir) ? readdirSync(lessonDir).filter(f => f.endsWith('.md')).sort() : []
  for (const name of names) {
    const file = join(lessonDir, name)
    for (const L of parseLessonFile(readFileSync(file, 'utf8'), name.slice(0, -3))) {
      L.file = file
      L.where = L.lines.fields.id ? `${rel(file)}:${L.lines.fields.id}` : rel(file)
      all.push(L)
      if (L.id === undefined) continue
      const first = byId.get(L.id)
      if (first) L.problems.push({ line: L.lines.fields.id ?? L.lines.title, msg: `id "${L.id}" is also the id of the lesson at ${first.where}; give each lesson its own id` })
      else byId.set(L.id, L)
    }
  }
  return { all, byId }
}

function locate(p, { course, lessons, unitsData, sylFile }) {
  if (p.syllabus) return `${rel(sylFile)}${p.syllabus.line ? `:${p.syllabus.line}` : ''}: ${p.msg}`
  if (p.lesson !== undefined && lessons.has(p.lesson)) {
    const L = lessons.get(p.lesson), f = rel(L.file)
    if (p.card === undefined) return `${f}:${L.lines.fields[p.field] ?? L.lines.title}: ${p.msg}`
    const cl = L.lines.cards[p.card]
    let line = cl.fields[p.field] ?? cl.line
    if (p.find) {
      const src = readFileSync(L.file, 'utf8').split('\n'), end = L.lines.cards[p.card + 1]?.line ?? L.end + 1
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
  const disk = readLessons(dir)
  let unitIdx = course.units.map((_, i) => i), lessonIds = listed
  if (only) {
    for (const id of only) if (!course.units.some(u => u.id === id) && !listed.includes(id) && !disk.byId.has(id)) problems.push(`${rel(course.file)}: no unit or lesson "${id}", and no lesson in lessons/ has that id`)
    unitIdx = unitIdx.filter(i => only.includes(course.units[i].id))
    lessonIds = [...new Set([...unitIdx.flatMap(i => course.units[i].lessons), ...only.filter(id => listed.includes(id) || disk.byId.has(id))])]
  }
  const lessons = new Map(lessonIds.filter(id => disk.byId.has(id)).map(id => [id, disk.byId.get(id)]))
  course.units.forEach((u, ui) => {
    for (const id of u.lessons) if ((!only || unitIdx.includes(ui) || only.includes(id)) && !lessons.has(id)) problems.push(`${rel(course.file)}: unit ${ui + 1} (${u.id}) lists "${id}", but no lesson in lessons/ has that id; write it under "# <title>" with the line "id: ${id}"`)
  })
  // A check of some lessons also reports a lesson with no id in their files,
  // since it may be the one a writer meant to give that id.
  const files = new Set(disk.all.filter(L => lessons.has(L.id)).map(L => L.file))
  for (const L of disk.all) {
    if (only && !(L.id === undefined ? files.has(L.file) : lessonIds.includes(L.id))) continue
    if (!only && L.id !== undefined && !listed.includes(L.id)) problems.push(`${L.where}: not listed in course.json; add "${L.id}" to a unit's lessons, or delete ${L.lines.fields.id ? 'the lesson' : 'the file'}`)
    for (const p of L.problems) problems.push(`${rel(L.file)}:${p.line}: ${p.msg}`)
  }

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

  // The repo whose tracked top-level directories the syllabus must name:
  // --repo, else course.json's "repo". A check of some lessons names none.
  let repoDir = !only && repo, repoSrc = `--repo ${repo}`
  if (!repo && !only) {
    if (course.repo === undefined) problems.push(`${rel(course.file)}: missing "repo"; set it to ${REPO_RULE}`)
    else if (typeof course.repo === 'string' && course.repo.trim()) { repoDir = resolve(dir, course.repo); repoSrc = `${rel(course.file)}: "repo" ${course.repo}` }
  }

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
    if (repoDir) {
      try { found.push(...checkRepoCoverage(rows, trackedDirs(repoDir), basename(resolve(repoDir)))) }
      catch (e) { problems.push(`${repoSrc}: cannot list tracked files in ${rel(resolve(repoDir))}: ${e.message.split('\n')[0]}`) }
    }
  }
  const reported = p => p.shown || (p.card !== undefined && lessons.get(p.lesson)?.lines.cards[p.card]?.failed?.has(p.field))
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
  try { page = checkPage(html, syllabus) }
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

// The git repos a new course may teach: the one holding the course folder or
// the working directory, else each repo directly inside the working directory.
function findRepos(dir) {
  const top = p => { try { return execFileSync('git', ['-C', p, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null } }
  let at = resolve(dir)
  while (!existsSync(at)) at = dirname(at)
  const found = top(at) ?? top('.')
  if (found) return [found]
  return readdirSync('.', { withFileTypes: true })
    .filter(e => e.isDirectory() && resolve(e.name) !== resolve(dir) && existsSync(join(e.name, '.git')))
    .map(e => resolve(e.name))
}

function init(dir, from, repo) {
  if (existsSync(join(dir, 'course.json'))) throw new Error(`${rel(join(dir, 'course.json'))} already exists; edit the course there, or init a new folder`)
  if (repo && !existsSync(repo)) throw new Error(`--repo ${repo}: no such folder`)
  const repos = repo ? [resolve(repo)] : findRepos(dir)
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
  const units = UNITS.map(({ lessons, ...u }) => ({ ...u, lessons: lessons.map(l => l.id) }))

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
  // One file per unit, named by the unit id, as SKILL.md has writers work.
  const files = new Map(), failed = []
  for (const u of UNITS) {
    if (!LESSON_ID.test(u.id ?? '') || files.has(u.id)) { failed.push(`unit "${u.id}": its id cannot name its own lesson file`); continue }
    const texts = []
    for (const l of u.lessons) {
      if (!LESSON_ID.test(l.id ?? '')) { failed.push(`lesson "${l.id}": not a lesson id; use letters, digits, _, . and -`); continue }
      const covers = rows.filter(r => !r.skip && r.lessons.split(/[\s,]+/).includes(l.id)).map(r => r.area)
      try { texts.push(serializeLesson(l, covers, terms.get(l.id))) }
      catch (e) { failed.push(`lesson ${l.id}: ${e.message}`) }
    }
    if (texts.length) files.set(u.id, texts.join('\n'))
  }
  if (failed.length) throw new Error(`${failed.length} lesson(s) cannot be imported:\n- ${failed.join('\n- ')}`)
  mkdirSync(join(dir, 'lessons'), { recursive: true })
  // Several candidate repos leave "repo" out, so build asks for it.
  if (repos.length < 2) course.repo = repos.length ? relative(realpathSync(dir), realpathSync(repos[0])).split(sep).join('/') || '.' : null
  writeFileSync(join(dir, 'course.json'), JSON.stringify({ ...course, units }, null, 2) + '\n')
  writeFileSync(join(dir, 'syllabus.md'), syllabus)
  for (const [id, text] of files) writeFileSync(join(dir, 'lessons', `${id}.md`), text)
  return { lessons: lessons.length, files: files.size, syllabus: !from || existsSync(sylPath), repo: course.repo, repos }
}


function main(argv) {
  const args = [...argv]
  const flag = name => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args.splice(i, 2)[1]; if (!v) usage(); return v }
  const usage = () => { console.error(USAGE); process.exit(2) }
  const cmd = args.shift()
  const repo = flag('--repo'), from = flag('--from')
  const [dir, ...ids] = args
  if (!dir || !['init', 'check', 'build', 'selfcheck'].includes(cmd) || (cmd !== 'check' && ids.length) || (from && cmd !== 'init')) usage()
  const fail = problems => { console.error(`${problems.length} problem(s):\n${problems.join('\n')}`); process.exit(1) }
  if (cmd === 'init') {
    try {
      const r = init(dir, from, repo)
      console.log(`OK: wrote ${rel(join(dir, 'course.json'))}, ${rel(join(dir, 'syllabus.md'))} and ${r.lessons} lesson(s) in ${r.files} unit file(s) in ${rel(join(dir, 'lessons'))}`)
      console.log(r.repo ? `course.json "repo": "${r.repo}". Build fails on each tracked top-level directory of that repo missing from the syllabus Sources. Set "repo" to null if the course does not teach that repo.`
        : r.repo === null ? 'course.json "repo": null, as no git repo is here. For a codebase course, set "repo" to the repo\'s folder, relative to the course folder.'
          : `course.json has no "repo" yet, as the working directory holds several git repos (${r.repos.map(rel).join(', ')}). Set "repo" to ${REPO_RULE}; build fails until it is set.`)
      if (!r.syllabus) console.log(`No syllabus.md beside ${from}: write its rows, add a covers: line to each lesson, then build.`)
    } catch (e) { console.error(e.message); process.exit(1) }
    return
  }
  if (cmd === 'selfcheck') {
    const page = join(dir, 'index.html')
    if (!existsSync(page)) { console.error(`${rel(page)} does not exist; run build first`); process.exit(1) }
    selfcheck(page).then(({ report, resume, tall, thrown }) => {
      const resumed = resumeMatches(report, resume)
      console.log(`${report.trim()}\n\nAfter a reload, the map's resume card reads: ${resume}`)
      console.log(resumed ? 'Resume OK.' : 'Resume FAIL: the resume card does not name the lesson and card the report names.')
      if (tall.length) console.log(`WARN: learn card taller than a ${SCREEN.width}x${SCREEN.height}px phone screen; split it in two: ${tall.map(c => `${c.lesson} card ${c.card} (${c.px}px)`).join('; ')}`)
      if (thrown.length) console.log(`FAIL: the page threw while it played:\n${thrown.join('\n')}`)
      process.exit(report.startsWith('Self-check PASS') && resumed && !thrown.length ? 0 : 1)
    }, e => {
      if (e instanceof NoBrowser) console.error(`selfcheck could not run: ${e.message}. Open ${rel(page)}#selfcheck in a browser 400px wide instead (SKILL.md, Build).`)
      else console.error(`Self-check FAIL: ${e.message}`)
      process.exit(e instanceof NoBrowser ? 3 : 1)
    })
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
