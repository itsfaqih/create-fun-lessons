import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPage } from '../skills/create-fun-lessons/scripts/check.mjs'

const SKILL = fileURLToPath(new URL('../skills/create-fun-lessons/', import.meta.url))
const LESSONS = join(SKILL, 'scripts/lessons.mjs')
const CHECK = join(SKILL, 'scripts/check.mjs')
const TEMPLATE = join(SKILL, 'template.html')
const TWO_ROWS = '| Area | Sources | Lessons |\n|---|---|---|\n| Card types | `template.html` | u1l1 |\n| Visual patterns | `references/visuals.md` | u1l2 |\n'

const tmp = () => mkdtempSync(join(tmpdir(), 'lessons-test-'))
const run = (cwd, script, ...args) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}
const lessons = (cwd, ...args) => run(cwd, LESSONS, ...args)
const read = (...p) => readFileSync(join(...p), 'utf8')
const edit = (file, from, to) => {
  const s = readFileSync(file, 'utf8')
  assert.ok(s.includes(from), `${file} contains ${from}`)
  writeFileSync(file, s.replace(from, to))
}
const lineOf = (file, text) => readFileSync(file, 'utf8').split('\n').findIndex(l => l.includes(text)) + 1
const freshCourse = () => {
  const root = tmp()
  assert.equal(lessons(root, 'init', 'course').code, 0)
  return { root, dir: join(root, 'course') }
}
const pageData = file => loadPage(readFileSync(file, 'utf8')).data

test('init then build gives a page that check.mjs passes', () => {
  const root = tmp()
  const init = lessons(root, 'init', 'my-course')
  assert.equal(init.code, 0, init.out)
  const built = lessons(root, 'build', 'my-course')
  assert.equal(built.code, 0, built.out)
  assert.match(built.out, /^OK: 1 units, 2 lessons, 14 cards, \d+ syllabus rows/)
  const checked = run(root, CHECK, 'my-course/index.html')
  assert.equal(checked.code, 0, checked.out)
  assert.match(checked.out, /^OK: /)
  const { COURSE } = pageData(join(root, 'my-course/index.html'))
  assert.equal(COURSE.storageKey, 'my-course-v1')
  assert.equal(COURSE.title, 'My Course')
})

test('init refuses a folder that already has course.json', () => {
  const { root } = freshCourse()
  const again = lessons(root, 'init', 'course')
  assert.equal(again.code, 1)
  assert.match(again.out, /course\.json already exists/)
})

test('importing the template and building gives back the same content', () => {
  const root = tmp()
  copyFileSync(TEMPLATE, join(root, 'page.html'))
  writeFileSync(join(root, 'syllabus.md'), TWO_ROWS)
  const init = lessons(root, 'init', 'imported', '--from', 'page.html')
  assert.equal(init.code, 0, init.out)
  const built = lessons(root, 'build', 'imported')
  assert.equal(built.code, 0, built.out)
  const want = pageData(TEMPLATE), got = pageData(join(root, 'imported/index.html'))
  const course = ({ storageKey, title, ...rest }) => rest
  assert.deepEqual(course(got.COURSE), course(want.COURSE))
  assert.deepEqual(got.UNITS, want.UNITS)
  assert.deepEqual(got.GLOSSARY, want.GLOSSARY)
})

test('a second build changes no byte', () => {
  const { root, dir } = freshCourse()
  assert.equal(lessons(root, 'build', 'course').code, 0)
  const page = read(dir, 'index.html'), syllabus = read(dir, 'syllabus.md')
  assert.equal(lessons(root, 'build', 'course').code, 0)
  assert.equal(read(dir, 'index.html'), page)
  assert.equal(read(dir, 'syllabus.md'), syllabus)
})

const broken = [
  ['an mcq with no [x]', dir => {
    const f = join(dir, 'lessons/u1l1.md')
    edit(f, '- [x] `mcq`', '- [ ] `mcq`')
    return [f, lineOf(f, '- [ ] `learn`'), /mcq card 2: mark exactly one o item \[x\]; 0 are marked/]
  }],
  ['an unknown field', dir => {
    const f = join(dir, 'lessons/u1l1.md')
    edit(f, 'items:\n', 'answer: First\nitems:\n')
    return [f, lineOf(f, 'answer: First'), /order card 5: unknown field "answer" in a order card; its fields are q, items, hint, why/]
  }],
  ['covers naming no Area', dir => {
    const f = join(dir, 'lessons/u1l2.md')
    edit(f, 'covers: Visual patterns', 'covers: Visual pattern')
    return [f, lineOf(f, 'covers:'), /covers "Visual pattern" matches no syllabus Area; the closest is "Visual patterns"/]
  }],
  ['a lesson file no unit lists', dir => {
    const f = join(dir, 'lessons/u1l3.md')
    copyFileSync(join(dir, 'lessons/u1l2.md'), f)
    return [f, null, /not listed in course\.json; add "u1l3" to a unit's lessons/]
  }],
  ['a code line too wide for a phone', dir => {
    const f = join(dir, 'lessons/u1l1.md')
    edit(f, "const x = «highlighted»('text', 42)", "const x = «highlighted»('text', 42)\nconst total = items.reduce((sum, item) => sum + item.price, 0)")
    return [f, lineOf(f, 'const total'), /learn card 1: code line "const total = items\.reduce\(\(…" is 62 columns; 41 fit a code box/]
  }],
]
for (const [name, breakIt] of broken) {
  test(`build reports ${name} at its file and line, and writes nothing`, () => {
    const { root, dir } = freshCourse()
    const syllabus = read(dir, 'syllabus.md')
    const [file, line, msg] = breakIt(dir)
    const r = lessons(root, 'build', 'course')
    assert.equal(r.code, 1)
    assert.match(r.out, /^\d+ problem\(s\):\n/)
    const where = `course/lessons/${file.split('/lessons/')[1]}${line ? `:${line}` : ''}: `
    assert.ok(r.out.includes(where), `${r.out} names ${where}`)
    assert.match(r.out, msg)
    assert.equal(existsSync(join(dir, 'index.html')), false)
    assert.equal(read(dir, 'syllabus.md'), syllabus)
  })
}

test('check with ids validates only those lessons and units', () => {
  const { root, dir } = freshCourse()
  edit(join(dir, 'lessons/u1l2.md'), '- [x] v4', '- [ ] v4')
  copyFileSync(join(dir, 'lessons/u1l1.md'), join(dir, 'lessons/stray.md'))
  const one = lessons(root, 'check', 'course', 'u1l1')
  assert.equal(one.code, 0, one.out)
  assert.match(one.out, /^OK: 1 lessons, 7 cards \(u1l1\)/)
  const other = lessons(root, 'check', 'course', 'u1l2')
  assert.equal(other.code, 1)
  assert.match(other.out, /^1 problem\(s\):\ncourse\/lessons\/u1l2\.md:\d+: mcq card 5: mark exactly one o item/)
  const unit = lessons(root, 'check', 'course', 'u1')
  assert.equal(unit.code, 1)
  assert.match(unit.out, /u1l2\.md/)
  assert.doesNotMatch(unit.out, /stray/)
  assert.equal(existsSync(join(dir, 'index.html')), false)
})

test('build writes each Lessons cell from covers and keeps skip rows', () => {
  const { root, dir } = freshCourse()
  writeFileSync(join(dir, 'syllabus.md'), [
    '# What the course covers', '',
    '| Area | Sources | Lessons |', '|---|---|---|',
    '| Card types | `template.html` | old-id |',
    '| Visual patterns | `references/visuals.md` |  |',
    '| Hints | `template.html` | |',
    '| Build output | `index.html` | skip: generated from the lesson files |', '',
  ].join('\n'))
  edit(join(dir, 'lessons/u1l1.md'), 'covers: Card types', 'covers: Card types, hints')
  edit(join(dir, 'lessons/u1l2.md'), 'covers: Visual patterns', 'covers: Visual patterns, Card types')
  const r = lessons(root, 'build', 'course')
  assert.equal(r.code, 0, r.out)
  assert.equal(read(dir, 'syllabus.md'), [
    '# What the course covers', '',
    '| Area | Sources | Lessons |', '|---|---|---|',
    '| Card types | `template.html` | u1l1, u1l2 |',
    '| Visual patterns | `references/visuals.md` | u1l2 |',
    '| Hints | `template.html` | u1l1 |',
    '| Build output | `index.html` | skip: generated from the lesson files |', '',
  ].join('\n'))
  assert.equal(run(root, CHECK, 'course/index.html').code, 0)
})

test('code with backticks, ${, <T> and a shell line continuation comes through verbatim', () => {
  const { root, dir } = freshCourse()
  const ts = 'const s = `${a}-${b}`\nfunction id<T>(x: T): T {\n  return x\n}'
  const sh = 'docker run \\\n  --rm "$IMAGE"'
  writeFileSync(join(dir, 'lessons/u1l3.md'), [
    '# Tricky code', 'recap: Code survives the lesson format.', 'covers: Card types', '',
    '## learn: Generics', '<p>`id<T>` keeps the type.</p>', '```ts', ts, '```', '',
    '## type', 'q: Run the image once.', 'code:', '```shell', sh, '```',
    'accept:', '- docker run --rm "$IMAGE"', 'expect: One command.', 'why: `--rm` removes it after.', '',
    '## write', 'q: Write `id`.', 'starter:', '````ts', 'const s = `${a}`', '````', 'model:', '````ts', ts, '````',
    'rubric:', '- Takes `<T>`', '- Returns ``x`${y}`` or `x`', 'hint: It returns its argument.', 'why: Done.', '',
  ].join('\n'))
  edit(join(dir, 'course.json'), '"u1l2"', '"u1l2", "u1l3"')
  const r = lessons(root, 'build', 'course')
  assert.equal(r.code, 0, r.out)
  const lesson = pageData(join(dir, 'index.html')).UNITS[0].lessons[2]
  const [learn, type, write] = lesson.cards
  assert.equal(learn.body, '<p><code>id&lt;T&gt;</code> keeps the type.</p>\n<pre><code class="language-ts">const s = `${a}-${b}`\nfunction id&lt;T&gt;(x: T): T {\n  return x\n}</code></pre>')
  assert.equal(type.code, sh)
  assert.equal(type.lang, 'shell')
  assert.deepEqual(type.accept, ['docker run --rm "$IMAGE"'])
  assert.equal(write.model, ts)
  assert.equal(write.starter, 'const s = `${a}`')
  assert.deepEqual(write.rubric, ['Takes <code>&lt;T&gt;</code>', 'Returns <code>x`${y}</code> or <code>x</code>'])

  const again = join(root, 'again')
  copyFileSync(join(dir, 'index.html'), join(root, 'page.html'))
  copyFileSync(join(dir, 'syllabus.md'), join(root, 'syllabus.md'))
  assert.equal(lessons(root, 'init', 'again', '--from', 'page.html').code, 0)
  assert.equal(lessons(root, 'build', 'again').code, 0)
  assert.deepEqual(pageData(join(again, 'index.html')).UNITS, pageData(join(dir, 'index.html')).UNITS)
})

test('a copy of the template with its own storageKey passes check.mjs', () => {
  const root = tmp()
  writeFileSync(join(root, 'index.html'), read(TEMPLATE).replace("storageKey: 'create-fun-lessons-sample-v1'", "storageKey: 'test-copy-v1'"))
  writeFileSync(join(root, 'syllabus.md'), TWO_ROWS)
  const r = run(root, CHECK, 'index.html')
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /^OK: 1 units, 2 lessons, 14 cards, 2 syllabus rows/)
})

test('every example in references/lessons.md builds', () => {
  const doc = read(SKILL, 'references/lessons.md').split('\n'), blocks = []
  for (let i = 0; i < doc.length; i++) {
    const m = /^(`{3,})(\w*)$/.exec(doc[i])
    if (!m) continue
    const end = doc.indexOf(m[1], i + 1)
    blocks.push({ info: m[2], text: doc.slice(i + 1, end).join('\n') })
    i = end
  }
  const md = blocks.filter(b => b.info === 'md').map(b => b.text)
  const root = tmp(), dir = join(root, 'docs')
  mkdirSync(join(dir, 'lessons'), { recursive: true })
  writeFileSync(join(dir, 'course.json'), blocks.find(b => b.info === 'json').text)
  writeFileSync(join(dir, 'syllabus.md'), '| Area | Sources | Lessons |\n|---|---|---|\n| HTTP routing | `src/` | |\n| Request lifecycle | `src/` | |\n| Caching | `src/` | |\n')
  writeFileSync(join(dir, 'lessons/u1l1.md'), md.find(t => t.startsWith('# ')))
  writeFileSync(join(dir, 'lessons/u1l2.md'), ['# Every card', 'recap: One of each.', 'covers: Caching', '', ...md.filter(t => t.startsWith('## '))].join('\n'))
  const r = lessons(root, 'build', 'docs')
  assert.equal(r.code, 0, r.out)
  const cards = pageData(join(dir, 'index.html')).UNITS[0].lessons[1].cards.map(c => c.t)
  assert.deepEqual([...new Set(cards)].sort(), ['blanks', 'fill', 'learn', 'mcq', 'order', 'type', 'write'])
})
