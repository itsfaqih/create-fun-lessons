// The course schema, shared by check.mjs (a built page) and lessons.mjs (a
// course folder). CARD_TYPES is the one statement of each card type's fields:
// the validator checks cards against it and the lesson-file parser reads field
// names and kinds from it, so the two cannot disagree.
//
// Problems are plain objects; each boundary formats them for its own source:
//   { scope, msg }                       COURSE, UNITS, GLOSSARY[i]
//   { unit, msg }                        unit index, 0-based
//   { lesson, card?, field?, find?, msg } lesson id, card index 0-based, field name,
//                                        find = the offending code line's text
//   { syllabus: { line?, n?, area? }, msg }
// A problem from shownProblems also has shown: true; lessons.mjs reports those
// from the lesson source, where it knows the line.

// highlight.js languages in its main build; any other needs its
// languages/<name>.min.js script tag in the page.
export const BUNDLED = 'bash c cpp csharp css diff go graphql ini java javascript json kotlin less lua makefile markdown objectivec perl php php-template plaintext python python-repl r ruby rust scss shell sql swift typescript vbnet wasm xml yaml js jsx ts tsx sh zsh html svg py rb rs kt yml golang console'.split(' ')

// Characters of Geist Mono that fit one code line at a 400px viewport, measured
// in a browser: a <pre> (13.5px, 8.1px a character) fits 41 (36 at 360px); the
// write card's answer editor (16px) fits 36 (32 at 360px).
export const CODE_COLUMNS = { pre: 41, editor: 36 }

// Field kinds: html (the engine inserts it as markup), plain (the engine
// escapes it), lang, index (set by the [x] option). `list`: 'list' is an array,
// 'choices' an array whose [x] item sets `a`, 'maybe' a string or an array.
// `shows(c)` names the code surface a plain field appears in ('pre' or
// 'editor'), or null where the engine wraps it.
const html = o => ({ kind: 'html', ...o })
const plain = o => ({ kind: 'plain', ...o })
const q = html({ required: true })
const why = html({ required: true })
const hint = html({ list: 'maybe' })
const lang = { kind: 'lang' }
const a = { kind: 'index' }
const isText = c => (c.lang || 'text') === 'text'
const fewOptions = c => Array.isArray(c.o) && c.o.length < 3
const str = v => typeof v === 'string' && v.trim().length > 0

export const CARD_TYPES = {
  learn: {
    heading: 'h', rest: 'body',
    fields: { h: html({ required: true }), body: html({ required: true }) },
  },
  mcq: {
    fields: { q, o: html({ list: 'choices', min: 2, about: 'options' }), a, hint, why },
    needsHint: fewOptions,
  },
  fill: {
    fields: { q, lang, code: plain({ required: true, about: 'with exactly one ____', shows: () => 'pre' }), o: plain({ list: 'choices', min: 2, about: 'options' }), a, hint, why },
    needsHint: fewOptions,
    check(c, err) { if (str(c.code) && c.code.split('____').length !== 2) err('code must contain exactly one ____', 'code') },
  },
  blanks: {
    fields: { q, lang, code: plain({ required: true, about: 'the line or sentence, with ____ for each blank', shows: c => c.lang === 'text' ? null : 'pre' }), answers: plain({ list: 'list', required: true, about: 'chip texts, one per blank in order' }), extra: plain({ list: 'list', about: 'spare chip texts' }), hint, why },
    check(c, err) {
      if (!str(c.code) || !Array.isArray(c.answers)) return
      const blanks = c.code.split('____').length - 1
      if (blanks < 2) err(`code has ${blanks} blank(s); a blanks card needs 2+ (use fill for one)`, 'code')
      if (c.answers.length !== blanks) err(`code has ${blanks} blank(s) but answers has ${c.answers.length}; give one answer per ____, in order`, 'answers')
    },
  },
  order: {
    fields: { q, items: plain({ list: 'list', required: true, min: 3, about: 'entries, in correct order' }), hint, why },
    check(c, err) { if (Array.isArray(c.items) && new Set(c.items).size !== c.items.length) err('items must be distinct', 'items') },
  },
  type: {
    fields: { q, lang, code: plain({ shows: () => 'pre' }), accept: plain({ list: 'list', required: true, min: 1, about: 'answers' }), expect: html(), hint, why },
    check(c, err) {
      if (!Array.isArray(c.accept) || !c.accept.length) return
      if (/^\/.*\/[a-z]*$/s.test(c.accept[0])) err('accept[0] must be a literal; it is shown as the answer', 'accept')
      for (const x of c.accept) {
        const m = typeof x === 'string' && x.match(/^\/(.*)\/([a-z]*)$/s)
        if (m) try { new RegExp(m[1], m[2]) } catch (e) { err(`bad regex ${x}: ${e.message}`, 'accept') }
      }
    },
  },
  write: {
    fields: { q, lang, starter: plain({ shows: c => isText(c) ? null : 'editor' }), model: plain({ required: true, about: 'the sample answer', shows: c => isText(c) ? null : 'pre' }), rubric: html({ list: 'list', required: true, min: 2, max: 4, about: 'criteria' }), hint, why },
    needsHint: () => true,
  },
}

export function validateCourse({ COURSE, UNITS, GLOSSARY }, { languages = [] } = {}) {
  const problems = []
  const scope = (s, msg) => problems.push({ scope: s, msg })
  for (const k of ['title', 'logoHtml', 'heading', 'subtitle', 'storageKey'])
    if (!str(COURSE?.[k])) scope('COURSE', `missing ${k}`)
  if (COURSE?.storageKey?.startsWith?.('create-fun-lessons-sample')) scope('COURSE', 'storageKey still the template sample; give the course its own key')
  if (!str(COURSE?.lang)) scope('COURSE', "missing lang: the highlight.js language for code (e.g. 'typescript'), or 'text' for a course without code")
  else if (COURSE.lang !== 'text' && !loaded(COURSE.lang, languages)) scope('COURSE', `lang "${COURSE.lang}" is not a highlight.js language this page loads`)
  if (!Array.isArray(UNITS) || !UNITS.length) scope('UNITS', 'empty')
  if (!Array.isArray(GLOSSARY)) scope('GLOSSARY', 'must be an array of [term, meaning]')
  else GLOSSARY.forEach((g, i) => {
    if (!Array.isArray(g) || g.length !== 2) return scope(`GLOSSARY[${i}]`, 'must be [term, meaning]')
    for (const s of g) if (typeof s === 'string') for (const p of shownProblems(s)) problems.push({ scope: `GLOSSARY[${i}]`, msg: p.msg, shown: true })
  })

  const ids = new Set()
  for (const [ui, u] of (Array.isArray(UNITS) ? UNITS : []).entries()) {
    const seen = (id, p) => { if (str(id)) { if (ids.has(id)) problems.push({ ...p, msg: `duplicate id "${id}"` }); ids.add(id) } }
    seen(u?.id, { unit: ui })
    for (const l of Array.isArray(u?.lessons) ? u.lessons : []) seen(l?.id, { lesson: l?.id ?? '?' })
    problems.push(...validateUnit(u, ui, { languages }))
  }
  return problems
}

export function validateUnit(u, ui, { languages = [] } = {}) {
  const problems = []
  const err = msg => problems.push({ unit: ui, msg })
  if (!str(u?.id)) err('missing id')
  for (const k of ['title', 'blurb']) if (!str(u?.[k])) err(`missing ${k}`)
  for (const k of ['color', 'dark']) if (!/^#[0-9a-f]{6}$/i.test(u?.[k] ?? '')) err(`${k} must be #rrggbb`)
  if (!Array.isArray(u?.lessons) || !u.lessons.length) { err('no lessons'); return problems }
  if (!u.lessons.some(l => l?.cards?.some?.(c => c?.t === 'write'))) err('needs at least one write card, ideally closing the unit')
  for (const l of u.lessons) problems.push(...validateLesson(l, { languages }))
  return problems
}

export function validateLesson(l, { languages = [] } = {}) {
  const problems = []
  const lesson = l?.id ?? '?'
  const err = msg => problems.push({ lesson, msg })
  if (!str(l?.id)) err('missing id')
  for (const k of ['title', 'recap']) if (!str(l?.[k])) err(`missing ${k}`)
  if (typeof l?.recap === 'string') for (const p of shownProblems(l.recap)) problems.push({ lesson, field: 'recap', msg: p.msg, shown: true })
  if (!Array.isArray(l?.cards) || !l.cards.length) { err('no cards'); return problems }
  if (l.cards.at(-1)?.t === 'learn') problems.push({ lesson, card: l.cards.length - 1, t: 'learn', msg: 'ends the lesson, so the learner is never quizzed on it; follow it with a quiz card on its idea' })
  l.cards.forEach((c, card) => validateCard(c ?? {}, (msg, field, find, shown) => problems.push({ lesson, card, t: c?.t, field, find, msg, ...(shown && { shown }) }), languages))
  return problems
}

function validateCard(c, err, languages) {
  const type = CARD_TYPES[c.t]
  if (!type) return err(`unknown card type "${c.t}"; use one of ${Object.keys(CARD_TYPES).join(', ')}`)
  const checkLang = (l, field) => {
    if (l === undefined || ['text', 'code', 'shell'].includes(l)) return
    if (typeof l !== 'string' || !loaded(l, languages)) err(`lang "${l}" is not a highlight.js language this page loads; use text, code, shell, a bundled name, or add it to course.json's languages`, field)
  }
  for (const [name, f] of Object.entries(type.fields)) {
    const v = c[name]
    if (f.kind === 'lang') checkLang(v, name)
    if (f.kind !== 'html' && f.kind !== 'plain') continue
    const count = f.max ? `${f.min}–${f.max}` : `${f.min}+`
    if (f.list === 'list' || f.list === 'choices') {
      if (v === undefined) { if (f.required || f.min) err(f.min ? `${name} needs ${count} ${f.about}` : `missing ${name} (${f.about})`, name); continue }
      if (!Array.isArray(v) || !v.every(str)) { err(`${name} must be a list of ${f.about}`, name); continue }
      if (v.length < (f.min ?? 0) || v.length > (f.max ?? Infinity)) { err(`${name} needs ${count} ${f.about}`, name); continue }
      if (f.list === 'choices' && (!Number.isInteger(c.a) || c.a < 0 || c.a >= v.length)) err(`a=${c.a} is not an index into ${name}`, name)
    } else if (f.list === 'maybe') {
      if (v !== undefined && !(str(v) || (Array.isArray(v) && v.length && v.every(str)))) { err(`${name} must be a string or an array of strings`, name); continue }
    } else if (v === undefined) {
      if (f.required) err(`missing ${name}${f.about ? ` (${f.about})` : ''}`, name)
      continue
    } else if (typeof v !== 'string' || (f.kind === 'html' && !str(v)) || (f.required && !str(v))) {
      err(f.required ? `missing ${name}${f.about ? ` (${f.about})` : ''}` : `${name} must be a ${f.kind === 'html' ? 'non-empty ' : ''}string`, name); continue
    }
    for (const item of [].concat(v ?? [])) {
      if (typeof item !== 'string') continue
      for (const p of shownProblems(item, f.kind)) err(p.msg, name, undefined, true)
      if (f.kind === 'html') {
        checkSvg(item, msg => err(msg, name))
        for (const m of item.matchAll(/<pre><code(?: class="language-([^"]+)")?/g)) checkLang(m[1], name)
        for (const m of item.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g))
          checkWidth(decode(m[1].replace(/<span class="hl">/g, HL).replace(/<[^>]*>/g, '')), 'pre', 0, (msg, find) => err(msg, name, find))
      } else if (f.shows?.(c)) {
        checkWidth(item, f.shows(c), blankColumns(c, name), (msg, find) => err(msg, name, find))
      }
    }
  }
  if (!c.hint && type.needsHint?.(c)) err('needs a hint (no automatic hint for this card)', 'hint')
  type.check?.(c, err)
}

const loaded = (name, languages) => BUNDLED.includes(name) || languages.includes(name)

// Visuals are inline SVG that scale to a phone and carry a text alternative.
function checkSvg(html, err) {
  for (const [tag] of html.matchAll(/<svg\b[^>]*>/g)) {
    if (!/\sviewBox="\s*-?[\d.]+(?:[\s,]+-?[\d.]+){3}\s*"/.test(tag)) err('an <svg> needs a viewBox so it scales to the card (see references/visuals.md)')
    if (!/\srole="img"/.test(tag) || !/\saria-label="[^"]+"/.test(tag)) err('an <svg> needs role="img" and an aria-label describing what it shows')
    if (/\swidth="\d/.test(tag)) err('an <svg> takes its width from the card; drop the width attribute')
  }
}

// A highlighted span's padding takes about one more column.
const HL = '\u0001'
// A fill or blanks slot is at least 9 columns wide (measured 8.6 and 6.9),
// and grows to the chip placed in it.
function blankColumns(c, field) {
  if (field !== 'code' || (c.t !== 'fill' && c.t !== 'blanks')) return 0
  const chips = c.t === 'fill' ? c.o : [...(c.answers ?? []), ...(c.extra ?? [])]
  return Math.max(9, ...[].concat(chips ?? []).map(x => String(x).length + 2))
}
function checkWidth(text, surface, blankCols, err) {
  const cols = CODE_COLUMNS[surface]
  for (const line of text.split('\n')) {
    let shown = line
    if (blankCols) shown = shown.split('____').join('x'.repeat(blankCols))
    shown = shown.replace(/[^\t]*\t/g, s => s.slice(0, -1).padEnd(Math.ceil(s.length / 8) * 8))
    const width = [...shown].length
    if (width <= cols) continue
    const plain = line.replaceAll(HL, ''), trimmed = plain.trim()
    const start = trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed
    const blank = blankCols && line.includes('____') ? `, counting each ____ as ${blankCols}, the width of its longest chip` : ''
    const fix = blank ? 'so shorten the longest chip or break the line'
      : /\s/.test(trimmed) ? 'so break it over lines'
      : 'and it has no space, so break it after a "(" or before a ".", or shorten it; a long URL reads fine in the text, which wraps'
    err(`code line "${start}" is ${width} columns${blank}; ${cols} fit ${surface === 'editor' ? 'the answer editor' : 'a code box'} on a phone without sideways scrolling, ${fix}`, plain)
  }
}
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e.toLowerCase()] ?? m)
}

// What the learner would see that no author means, on the 0-based line of
// the value it is on: a raw «…» marker, or an entity escaped twice outside a
// code box (HTML code in a box shows entities on purpose). A plain field
// (kind 'plain') is shown as written, so only the markers apply.
export function shownProblems(value, kind = 'html') {
  const out = []
  const add = (line, msg) => { if (!out.some(p => p.line === line && p.msg === msg)) out.push({ line, msg }) }
  const re = kind === 'html' ? /<pre\b|<\/pre>|[«»]|&amp;(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi : /[«»]/g
  let pre = 0, line = 0, last = 0
  for (const m of value.matchAll(re)) {
    for (let i = last; i < m.index; i++) if (value[i] === '\n') line++
    last = m.index
    const s = m[0]
    if (s[0] === '<') pre = Math.max(0, pre + (s[1] === '/' ? -1 : 1))
    else if (s === '«' || s === '»') add(line, kind === 'html'
      ? 'the learner sees raw «…» markers: they highlight code only inside a ``` fence (in a page\'s HTML, <span class="hl">…</span>), and a highlight needs both « and », which may be lines apart; for a guillemet write &laquo; or &raquo;'
      : 'the learner sees raw «…» markers: this field is shown exactly as written, so they highlight nothing here')
    else if (!pre) add(line, `the learner sees the text "&${m[1]};", an entity escaped twice: inside backticks write the character or its entity, and in HTML the entity once; to show the entity's text on purpose write &#38;${m[1]};`)
  }
  return out
}

// syllabus.md: a markdown table | Area | Sources | Lessons |, one row per part
// of the subject. The first table line is the header.
export function parseSyllabus(text) {
  const rows = [], problems = []
  let header = false, n = 0
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    if (!line.startsWith('|')) return
    if (!header) { header = true; return }
    if (/^\|[\s:|-]+\|$/.test(line)) return
    const cells = line.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
    const at = { line: i + 1, n: ++n, area: cells[0] || '?' }
    if (cells.length < 3 || !cells[0] || !cells[1]) return problems.push({ syllabus: at, msg: 'needs Area, Sources and Lessons cells' })
    const skip = /^skip:/i.test(cells[2])
    rows.push({ ...at, cells, sources: cells[1], lessons: cells[2], skip })
    if (skip && !cells[2].slice(5).trim()) problems.push({ syllabus: at, msg: 'skip needs a reason' })
  })
  if (!rows.length) problems.push({ syllabus: {}, msg: 'has no table rows' })
  return { rows, problems }
}

// A built page's syllabus: each row's Lessons cell lists existing lesson ids or
// reads skip: <reason>, and every lesson sits in some row.
export function checkSyllabus(text, lessonIds) {
  const { rows, problems } = parseSyllabus(text)
  const ids = new Set(lessonIds)
  for (const r of rows) {
    if (r.skip) continue
    const listed = r.lessons.split(/[\s,]+/).filter(Boolean)
    if (!listed.length) problems.push({ syllabus: r, msg: 'lists no lessons; add lesson ids or skip: <reason>' })
    for (const id of listed) if (!ids.has(id)) problems.push({ syllabus: r, msg: `lesson "${id}" does not exist` })
  }
  const taught = new Set(rows.flatMap(r => r.lessons.split(/[\s,]+/)))
  for (const id of ids) if (!taught.has(id)) problems.push({ syllabus: {}, msg: `lesson "${id}" is in no row; map it to the area it teaches` })
  return { rows, problems }
}

// A course folder's syllabus: each lesson's `covers` names syllabus Areas
// (case-insensitive), and with `full`, every row that is not skip: has a lesson.
// Returns the lesson ids for each row, in the order the lessons are given.
export function checkCovers(rows, lessons, { full = true } = {}) {
  const problems = []
  const key = s => s.trim().toLowerCase().replace(/\s*,\s*/g, ', ')
  const byArea = new Map()
  for (const r of rows) {
    if (byArea.has(key(r.area))) problems.push({ syllabus: r, msg: `Area "${r.area}" is also row ${byArea.get(key(r.area)).n}; give each row its own Area name` })
    else byArea.set(key(r.area), r)
  }
  const ids = new Map(rows.map(r => [r, []]))
  for (const l of lessons) {
    if (!l.covers?.length) problems.push({ lesson: l.id, field: 'covers', msg: 'covers names no syllabus Area; add covers: <Area>, <Area>' })
    const names = l.covers ?? []
    for (let i = 0; i < names.length; i++) {
      let name = names[i]
      // `covers: Build, lint and CI` splits at its comma; rejoin pieces that name one Area.
      for (let j = i + 1; !byArea.has(key(name)) && j < names.length; j++) {
        const joined = names.slice(i, j + 1).join(', ')
        if (byArea.has(key(joined))) { name = joined; i = j }
      }
      const r = byArea.get(key(name))
      if (!r) problems.push({ lesson: l.id, field: 'covers', msg: `covers "${name}" matches no syllabus Area; the closest is "${closest(name, rows.map(r => r.area))}"` })
      else if (r.skip) problems.push({ lesson: l.id, field: 'covers', msg: `covers "${name}", a skip row of syllabus.md (${r.lessons}); teach it, or drop it from covers` })
      else if (!ids.get(r).includes(l.id)) ids.get(r).push(l.id)
    }
  }
  if (full) for (const r of rows) if (!r.skip && !ids.get(r).length) problems.push({ syllabus: r, msg: `no lesson covers "${r.area}"; name it in a lesson's covers, or set its Lessons cell to skip: <reason>` })
  return { problems, ids }
}

// A Sources path starts at the repo root (`source/core/Ky.ts`) or at its
// parent, under the repo folder's name (`ky/source/core/Ky.ts`).
export function checkRepoCoverage(rows, dirs, name) {
  const paths = rows.flatMap(r => r.sources.split(/[\s,`'"()]+/)).map(p => p.replace(/^\.\//, '')).filter(Boolean)
    .flatMap(p => name && p.startsWith(`${name}/`) ? [p, p.slice(name.length + 1)] : [p])
  return dirs.filter(d => !paths.some(p => p === d || p.startsWith(`${d}/`)))
    .map(d => ({ syllabus: {}, msg: `top-level directory "${d}/" of the repo "${name}" appears in no Sources cell; name it in a row's Sources (a skip row counts)` }))
}

function closest(word, options) {
  const dist = (s, t) => {
    let prev = Array.from({ length: t.length + 1 }, (_, j) => j)
    for (let i = 1; i <= s.length; i++) {
      const cur = [i]
      for (let j = 1; j <= t.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1))
      prev = cur
    }
    return prev[t.length]
  }
  const w = word.toLowerCase()
  return options.reduce((best, o) => dist(w, o.toLowerCase()) < dist(w, best.toLowerCase()) ? o : best, options[0] ?? '')
}
