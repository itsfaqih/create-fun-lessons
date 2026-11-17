import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
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
const STRAY = '# Stray\nrecap: Not in any unit.\ncovers: Card types\n\n## learn: Hi\n<p>Hi.</p>\n'
// The unit file init writes, cut into one file per lesson named by its id,
// with no id lines: the shape of a course folder made before unit files.
const splitUnit = dir => {
  const unit = read(dir, 'lessons/u1.md'), at = unit.indexOf('\n# Visuals\n') + 1
  writeFileSync(join(dir, 'lessons/u1l1.md'), unit.slice(0, at - 1).replace('\nid: u1l1\n', '\n'))
  writeFileSync(join(dir, 'lessons/u1l2.md'), unit.slice(at).replace('\nid: u1l2\n', '\n'))
  rmSync(join(dir, 'lessons/u1.md'))
}

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
    const f = join(dir, 'lessons/u1.md')
    edit(f, '- [x] `mcq`', '- [ ] `mcq`')
    return [f, lineOf(f, '- [ ] `learn`'), /mcq card 2: mark exactly one o item \[x\]; 0 are marked/]
  }],
  ['an unknown field', dir => {
    const f = join(dir, 'lessons/u1.md')
    edit(f, 'items:\n', 'answer: First\nitems:\n')
    return [f, lineOf(f, 'answer: First'), /order card 5: unknown field "answer" in a order card; its fields are q, items, hint, why/]
  }],
  ['covers naming no Area', dir => {
    const f = join(dir, 'lessons/u1.md')
    edit(f, 'covers: Visual patterns', 'covers: Visual pattern')
    return [f, lineOf(f, 'covers: Visual pattern'), /covers "Visual pattern" matches no syllabus Area; the closest is "Visual patterns"/]
  }],
  ['a lesson that ends on a learn card', dir => {
    const f = join(dir, 'lessons/u1.md')
    edit(f, '\n# Visuals\n', '\n## learn: Never quizzed\n<p>Nothing asks about this.</p>\n\n# Visuals\n')
    return [f, lineOf(f, '## learn: Never quizzed'), /learn card 8: ends the lesson, so the learner is never quizzed on it/]
  }],
  ['a lesson file no unit lists', dir => {
    const f = join(dir, 'lessons/u1l3.md')
    writeFileSync(f, STRAY)
    return [f, null, /not listed in course\.json; add "u1l3" to a unit's lessons/]
  }],
  ['a code line too wide for a phone', dir => {
    const f = join(dir, 'lessons/u1.md')
    edit(f, "const x = «highlighted»('text', 42)", "const x = «highlighted»('text', 42)\nconst total = items.reduce((sum, item) => sum + item.price, 0)")
    return [f, lineOf(f, 'const total'), /learn card 1: code line "const total = items\.reduce\(\(…" is 62 columns; 41 fit a code box/]
  }],
  ['a code line with no space that is too wide for a phone', dir => {
    const f = join(dir, 'lessons/u1.md')
    edit(f, "const x = «highlighted»('text', 42)", "const x = «highlighted»('text', 42)\n  validateAndMerge(cloneDeep(defaultOptions))")
    return [f, lineOf(f, 'validateAndMerge'), /learn card 1: code line "validateAndMerge\(cloneDeep\(d…" is 45 columns; 41 fit a code box on a phone without sideways scrolling, and it has no space/]
  }],
  ['a fill line that a long option makes too wide', dir => {
    const f = join(dir, 'lessons/u1.md')
    edit(f, '- [ ] "forty-two"', '- [ ] "forty-two, spelled out in full words"')
    return [f, lineOf(f, 'code: const answer = ____'), /fill card 3: code line "const answer = ____" is 55 columns, counting each ____ as 40, the width of its longest chip; 41 fit a code box on a phone without sideways scrolling, so shorten the longest chip/]
  }],
  ['an entity written in a TypeScript fence', dir => {
    const f = join(dir, 'lessons/u1.md')
    edit(f, '## mcq', '## learn: Generics\n```ts\nconst a = ky(u).json&lt;User&gt;()\n```\n\n## mcq')
    return [f, lineOf(f, 'json&lt;User'), /learner sees "&lt;" as written: a ``` fence shows code exactly as typed/]
  }],
  ['a «…» highlight that never closes', dir => {
    const f = join(dir, 'lessons/u1.md')
    edit(f, "const x = «highlighted»('text', 42)", "const x = «highlighted('text', 42)")
    return [f, lineOf(f, 'const x ='), /learn card 1: the learner sees raw «…» markers: they highlight code only inside a ``` fence/]
  }],
  ['a backtick span that never closes', dir => {
    const f = join(dir, 'lessons/u1.md')
    edit(f, 'Use `code`, lists', 'Use `code, lists')
    return [f, lineOf(f, 'Use `code, lists'), /learn card 1: the learner sees a stray backtick: a `code` span ends at the next run of the same number of backticks on its line/]
  }],
  ['an entity escaped twice', dir => {
    const f = join(dir, 'lessons/u1.md')
    edit(f, 'why: `mcq` shows options', 'why: `Array&amp;lt;T&amp;gt;` shows options')
    return [f, lineOf(f, 'Array&amp;lt;'), /mcq card 2: the learner sees the text "&lt;", an entity escaped twice/]
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

test('check reports what the learner would see wrongly, as build does', () => {
  const { root, dir } = freshCourse()
  const f = join(dir, 'lessons/u1.md')
  writeFileSync(f, read(f).replace(/^(id: u1l2\nrecap: ).*$/m, '$1Draw «what» is spatial.'))
  const checked = lessons(root, 'check', 'course'), one = lessons(root, 'check', 'course', 'u1l2')
  assert.equal(checked.code, 1)
  assert.match(checked.out, new RegExp(`^1 problem\\(s\\):\ncourse/lessons/u1\\.md:${lineOf(f, 'recap: Draw')}: the learner sees raw «…» markers`))
  assert.equal(one.out, checked.out)
})

test('backtick spans and «…» highlights render as the author meant', () => {
  const { root, dir } = freshCourse()
  writeFileSync(join(dir, 'lessons/u1l3.md'), [
    '# Spans', 'recap: `?` starts a query.', 'covers: Card types', 'terms:', '- `/`: the root path', '',
    '## learn: Paths and `?`',
    '<p>`/` is the root and `?` starts the query.</p>',
    '<p>Call `.json&lt;User&gt;()` once, or ``a`b`` for a backtick.</p>',
    '```ts', 'const total = «items.reduce(', '  (sum, x) => sum + x, 0)»', '```', '',
    '## mcq', 'q: Which one starts the query?', 'o:', '- [ ] `/`', '- [x] `?`', '- [ ] `#`', 'why: `?` starts it; `/` is the root.', '',
  ].join('\n'))
  edit(join(dir, 'course.json'), '"u1l2"', '"u1l2", "u1l3"')
  const r = lessons(root, 'build', 'course')
  assert.equal(r.code, 0, r.out)
  const { UNITS, GLOSSARY } = pageData(join(dir, 'index.html'))
  const lesson = UNITS[0].lessons[2], [learn, mcq] = lesson.cards
  assert.equal(lesson.recap, '<code>?</code> starts a query.')
  assert.deepEqual(GLOSSARY.at(-1), ['<code>/</code>', 'the root path'])
  assert.equal(learn.h, 'Paths and <code>?</code>')
  assert.equal(learn.body, [
    '<p><code>/</code> is the root and <code>?</code> starts the query.</p>',
    '<p>Call <code>.json&lt;User&gt;()</code> once, or <code>a`b</code> for a backtick.</p>',
    '<pre><code class="language-ts">const total = <span class="hl">items.reduce(</span>',
    '  <span class="hl">(sum, x) =&gt; sum + x, 0)</span></code></pre>',
  ].join('\n'))
  assert.deepEqual(mcq.o, ['<code>/</code>', '<code>?</code>', '<code>#</code>'])
  assert.equal(mcq.why, '<code>?</code> starts it; <code>/</code> is the root.')
  assert.equal(run(root, CHECK, 'course/index.html').code, 0)

  copyFileSync(join(dir, 'index.html'), join(root, 'page.html'))
  copyFileSync(join(dir, 'syllabus.md'), join(root, 'syllabus.md'))
  assert.equal(lessons(root, 'init', 'again', '--from', 'page.html').code, 0)
  assert.equal(lessons(root, 'build', 'again').code, 0)
  assert.deepEqual(pageData(join(root, 'again/index.html')).UNITS, UNITS)
})

test('check.mjs reports raw «…» markers and entities escaped twice in a page written by hand', () => {
  const root = tmp()
  const page = read(TEMPLATE).replace("storageKey: 'create-fun-lessons-sample-v1'", "storageKey: 'test-copy-v1'")
  writeFileSync(join(root, 'syllabus.md'), TWO_ROWS)
  writeFileSync(join(root, 'quoted.html'), page.replace('shows options;', 'shows options, as in “the `a` option”;'))
  assert.equal(run(root, CHECK, 'quoted.html').code, 0)
  writeFileSync(join(root, 'broken.html'), page
    .replace('<span class="hl">highlighted</span>', '«highlighted»')
    .replace('shows options;', 'shows options for <code>Array&amp;lt;T&amp;gt;</code>;'))
  const r = run(root, CHECK, 'broken.html')
  assert.equal(r.code, 1)
  assert.match(r.out, /- lesson u1l1 card 1 \(learn\): the learner sees raw «…» markers/)
  assert.match(r.out, /- lesson u1l1 card 2 \(mcq\): the learner sees the text "&lt;", an entity escaped twice/)
})

test('check with ids validates only those lessons and units', () => {
  const { root, dir } = freshCourse()
  edit(join(dir, 'lessons/u1.md'), '- [x] v4', '- [ ] v4')
  writeFileSync(join(dir, 'lessons/stray.md'), STRAY)
  const one = lessons(root, 'check', 'course', 'u1l1')
  assert.equal(one.code, 0, one.out)
  assert.match(one.out, /^OK: 1 lessons, 7 cards \(u1l1\)/)
  const other = lessons(root, 'check', 'course', 'u1l2')
  assert.equal(other.code, 1)
  assert.match(other.out, new RegExp(`^1 problem\\(s\\):\ncourse/lessons/u1\\.md:${lineOf(join(dir, 'lessons/u1.md'), '- [ ] v3')}: mcq card 5: mark exactly one o item`))
  const unit = lessons(root, 'check', 'course', 'u1')
  assert.equal(unit.code, 1)
  assert.match(unit.out, /u1\.md/)
  assert.doesNotMatch(unit.out, /stray/)
  assert.equal(existsSync(join(dir, 'index.html')), false)
})

test('covers on one line matches an Area whose name holds a comma', () => {
  const { root, dir } = freshCourse()
  edit(join(dir, 'syllabus.md'), '| Card types |', '| Card types, hints |')
  edit(join(dir, 'lessons/u1.md'), 'covers: Card types', 'covers: Card types, hints')
  const r = lessons(root, 'build', 'course')
  assert.equal(r.code, 0, r.out)
  assert.match(read(dir, 'syllabus.md'), /\| Card types, hints \|[^\n]*\| u1l1/)
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
  edit(join(dir, 'lessons/u1.md'), 'covers: Card types', 'covers: Card types, hints')
  edit(join(dir, 'lessons/u1.md'), 'covers: Visual patterns', 'covers: Visual patterns, Card types')
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
  const course = JSON.parse(blocks.find(b => b.info === 'json').text)
  gitRepo(join(dir, course.repo), ['src/server.ts'])
  course.units[0].lessons.push('u1l3')
  writeFileSync(join(dir, 'course.json'), JSON.stringify(course))
  writeFileSync(join(dir, 'syllabus.md'), '| Area | Sources | Lessons |\n|---|---|---|\n| HTTP routing | `src/` | |\n| Request lifecycle | `src/` | |\n| Caching | `src/` | |\n')
  writeFileSync(join(dir, 'lessons/u1.md'), md.find(t => t.startsWith('# ')))
  writeFileSync(join(dir, 'lessons/u1l3.md'), ['# Every card', 'recap: One of each.', 'covers: Caching', '', ...md.filter(t => t.startsWith('## '))].join('\n'))
  const r = lessons(root, 'build', 'docs')
  assert.equal(r.code, 0, r.out)
  const { UNITS } = pageData(join(dir, 'index.html'))
  assert.deepEqual(UNITS[0].lessons.map(l => l.id), ['u1l1', 'u1l2', 'u1l3'])
  const cards = UNITS[0].lessons[2].cards.map(c => c.t)
  assert.deepEqual([...new Set(cards)].sort(), ['blanks', 'fill', 'learn', 'mcq', 'order', 'type', 'write'])
})

test('a unit file of several lessons builds the same page as one file per lesson', () => {
  const { root, dir } = freshCourse()
  assert.deepEqual(readdirSync(join(dir, 'lessons')), ['u1.md'])
  assert.equal(lessons(root, 'check', 'course', 'u1').code, 0)
  assert.equal(lessons(root, 'build', 'course').code, 0)
  const page = read(dir, 'index.html')
  splitUnit(dir)
  const r = lessons(root, 'build', 'course')
  assert.equal(r.code, 0, r.out)
  assert.equal(read(dir, 'index.html'), page)
})

test('a folder of one file per lesson, named by id, builds the lessons it always did', () => {
  const { root, dir } = freshCourse()
  splitUnit(dir)
  assert.doesNotMatch(read(dir, 'lessons/u1l1.md') + read(dir, 'lessons/u1l2.md'), /^id:/m)
  const one = lessons(root, 'check', 'course', 'u1l2')
  assert.match(one.out, /^OK: 1 lessons, 7 cards \(u1l2\)/)
  assert.equal(lessons(root, 'build', 'course').code, 0)
  assert.deepEqual(pageData(join(dir, 'index.html')).UNITS, pageData(TEMPLATE).UNITS)
})

test('a lesson inserted mid-unit leaves every other id and its progress key alone', () => {
  const { root, dir } = freshCourse()
  assert.equal(lessons(root, 'build', 'course').code, 0)
  const before = pageData(join(dir, 'index.html')).UNITS[0].lessons
  edit(join(dir, 'lessons/u1.md'), '\n# Visuals\n', '\n# Between\nid: u1n\nrecap: Inserted.\ncovers: Card types\n\n## learn: New\n<p>New.</p>\n\n## mcq\nq: New?\no:\n- [x] Yes\n- [ ] No\nhint: Yes.\nwhy: It is new.\n\n# Visuals\n')
  edit(join(dir, 'course.json'), '"u1l1",', '"u1l1", "u1n",')
  const r = lessons(root, 'build', 'course')
  assert.equal(r.code, 0, r.out)
  const after = pageData(join(dir, 'index.html')).UNITS[0].lessons
  assert.deepEqual(after.map(l => l.id), ['u1l1', 'u1n', 'u1l2'])
  assert.deepEqual([after[0], after[2]], before)
})

test('two lessons with one id are reported at both places, and nothing is written', () => {
  const { root, dir } = freshCourse()
  const unit = join(dir, 'lessons/u1.md')
  writeFileSync(join(dir, 'lessons/u2.md'), '# Again\nid: u1l2\nrecap: A copy.\ncovers: Card types\n\n## learn: Hi\n<p>Hi.</p>\n')
  writeFileSync(join(dir, 'lessons/u1l1.md'), STRAY)
  const r = lessons(root, 'build', 'course')
  assert.equal(r.code, 1)
  assert.ok(r.out.includes(`course/lessons/u2.md:2: id "u1l2" is also the id of the lesson at course/lessons/u1.md:${lineOf(unit, 'id: u1l2')}; give each lesson its own id`), r.out)
  assert.ok(r.out.includes(`course/lessons/u1l1.md:1: id "u1l1" is also the id of the lesson at course/lessons/u1.md:${lineOf(unit, 'id: u1l1')}`), r.out)
  const one = lessons(root, 'check', 'course', 'u1l2')
  assert.equal(one.code, 1)
  assert.match(one.out, /^1 problem\(s\):\ncourse\/lessons\/u2\.md:2: id "u1l2" is also/)
  assert.equal(existsSync(join(dir, 'index.html')), false)
})

test('a lesson with no id in a unit file, and a listed id no lesson has, are reported', () => {
  const { root, dir } = freshCourse()
  const unit = join(dir, 'lessons/u1.md')
  edit(unit, '\nid: u1l2\n', '\n')
  edit(join(dir, 'course.json'), '"u1l2"', '"u1l2", "u1l3"')
  const r = lessons(root, 'build', 'course')
  assert.equal(r.code, 1)
  assert.ok(r.out.includes(`course/lessons/u1.md:${lineOf(unit, '# Visuals')}: this file holds 2 lessons, so each needs an "id: <lesson id>" line under its # title`), r.out)
  assert.match(r.out, /course\/course\.json: unit 1 \(u1\) lists "u1l2", but no lesson in lessons\/ has that id/)
  assert.match(r.out, /course\/course\.json: unit 1 \(u1\) lists "u1l3", but no lesson in lessons\/ has that id/)
  const one = lessons(root, 'check', 'course', 'u1l1')
  assert.equal(one.code, 1)
  assert.match(one.out, /^1 problem\(s\):\ncourse\/lessons\/u1\.md:\d+: this file holds 2 lessons/)
})

// A git repo with each file added, as `git ls-files` lists them.
const gitRepo = (dir, files) => {
  for (const f of files) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), '') }
  for (const args of [['init', '-q'], ['add', '.']]) assert.equal(spawnSync('git', args, { cwd: dir }).status, 0)
}
const courseJson = dir => JSON.parse(read(dir, 'course.json'))
const setRepo = (dir, repo) => {
  const { repo: _, ...json } = courseJson(dir)
  writeFileSync(join(dir, 'course.json'), JSON.stringify(repo === undefined ? json : { ...json, repo }))
}

test('init beside one git repo names it in course.json, and build then needs its top-level directories in Sources', () => {
  const root = tmp()
  gitRepo(join(root, 'ky'), ['source/index.ts', 'test/main.ts', 'readme.md'])
  const init = lessons(root, 'init', 'ky-course')
  assert.equal(init.code, 0, init.out)
  assert.match(init.out, /course\.json "repo": "\.\.\/ky"/)
  assert.equal(courseJson(join(root, 'ky-course')).repo, '../ky')
  const dir = join(root, 'ky-course')
  for (const cmd of ['check', 'build']) {
    const r = lessons(root, cmd, 'ky-course')
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /course\/syllabus\.md: top-level directory "source\/" of the repo "ky" appears in no Sources cell/)
    assert.match(r.out, /"test\/" of the repo "ky"/)
  }
  assert.equal(existsSync(join(dir, 'index.html')), false)
  edit(join(dir, 'syllabus.md'), '`template.html` | u1l1', '`source/index.ts`, `ky/test/` | u1l1')
  const built = lessons(root, 'build', 'ky-course')
  assert.equal(built.code, 0, built.out)
  assert.equal(pageData(join(dir, 'index.html')).COURSE.repo, undefined)
  gitRepo(join(root, 'other'), ['lib/a.ts'])
  const flagged = lessons(root, 'build', 'ky-course', '--repo', 'other')
  assert.equal(flagged.code, 1)
  assert.match(flagged.out, /"lib\/" of the repo "other"/)
})

test('init in a folder inside a git repo names that repo', () => {
  const root = tmp()
  gitRepo(root, ['src/a.ts'])
  mkdirSync(join(root, 'docs'))
  const r = lessons(join(root, 'docs'), 'init', 'course')
  assert.equal(r.code, 0, r.out)
  assert.equal(courseJson(join(root, 'docs/course')).repo, '../..')
})

test('init with no git repo near sets repo to null, and the course builds as a topic course', () => {
  const { root, dir } = freshCourse()
  assert.equal(courseJson(dir).repo, null)
  assert.equal(lessons(root, 'build', 'course').code, 0)
})

test('a course.json with no repo fails check and build, but not a check of some units, and init --repo picks one', () => {
  const root = tmp()
  gitRepo(join(root, 'a'), ['x/1'])
  gitRepo(join(root, 'b'), ['y/1'])
  const init = lessons(root, 'init', 'course')
  assert.equal(init.code, 0, init.out)
  assert.match(init.out, /no "repo" yet, as the working directory holds several git repos \(a, b\)/)
  const dir = join(root, 'course')
  assert.equal('repo' in courseJson(dir), false)
  for (const cmd of ['check', 'build']) {
    const r = lessons(root, cmd, 'course')
    assert.equal(r.code, 1)
    assert.match(r.out, /course\/course\.json: missing "repo"; set it to the git repo the course teaches, relative to the course folder \(such as "\.\.\/ky"\), or null for a library or topic course/)
  }
  assert.equal(lessons(root, 'check', 'course', 'u1').code, 0)
  setRepo(dir, 'nowhere')
  assert.match(lessons(root, 'build', 'course').out, /course\/course\.json: "repo" nowhere: cannot list tracked files in course\/nowhere/)
  setRepo(dir, null)
  assert.equal(lessons(root, 'build', 'course').code, 0)
  assert.equal(lessons(root, 'init', 'picked', '--repo', 'b').code, 0)
  assert.equal(courseJson(join(root, 'picked')).repo, '../b')
})

const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => p && existsSync(p))

// Headless Chrome driven over its DevTools protocol, with a 400px wide window
// (the command line cannot make a headless window narrower than 500px).
async function phone(fn) {
  const profile = tmp()
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
  try {
    let port
    for (let i = 0; i < 100 && !port; i++) { await sleep(100); if (existsSync(join(profile, 'DevToolsActivePort'))) port = read(profile, 'DevToolsActivePort').split('\n')[0] }
    const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page')
    const ws = new WebSocket(page.webSocketDebuggerUrl), waiting = new Map()
    await new Promise(r => { ws.onopen = r })
    ws.onmessage = e => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m.result); waiting.delete(m.id) }
    let id = 0
    const send = (method, params = {}) => new Promise(r => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })) })
    await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 860, deviceScaleFactor: 1, mobile: false })
    const until = async expr => {
      for (let i = 0; i < 300; i++) {
        const v = (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value
        if (v) return v
        await sleep(100)
      }
      throw new Error(`timed out waiting for ${expr}`)
    }
    const selfcheck = async file => {
      await send('Page.navigate', { url: `${pathToFileURL(file)}#selfcheck` })
      return until("document.title.startsWith('Self-check') && document.getElementById('selfcheck')?.textContent")
    }
    const reload = async () => { await send('Page.reload'); return until("document.getElementById('resume')?.innerText") }
    return await fn({ selfcheck, reload })
  } finally { chrome.kill() }
}

test('index.html#selfcheck plays every card at 400px, names a card that sticks out, and leaves a lesson to resume', { skip: !CHROME && 'no Chrome found; set CHROME_PATH' }, async t => {
  const { root, dir } = freshCourse()
  assert.equal(lessons(root, 'build', 'course').code, 0)
  const wide = join(root, 'wide')
  mkdirSync(join(wide, 'lessons'), { recursive: true })
  for (const f of ['course.json', 'syllabus.md']) copyFileSync(join(dir, f), join(wide, f))
  writeFileSync(join(wide, 'lessons/u1.md'), read(dir, 'lessons/u1.md').replace('<div class="tip">A highlighted tip.</div>', '<div class="tip">A highlighted tip.</div><div style="width:600px">Too wide.</div>'))
  assert.equal(lessons(root, 'build', 'wide').code, 0)
  await phone(async ({ selfcheck, reload }) => {
    const report = await selfcheck(join(dir, 'index.html'))
    if (report.includes('highlight.js did not load')) return t.skip('highlight.js could not load from its CDN')
    assert.match(report, /^Self-check PASS\nPlayed 14 cards in 2 lessons in a 400px window: 9 quiz cards answered wrong, then retried with 9 hints and answered right; 9 code blocks checked for colour\./, report)
    assert.match(await reload(), /Continue where you left off\s+Card types\s+Card 2 of 7/)
    const bad = await selfcheck(join(wide, 'index.html'))
    assert.match(bad, /^Self-check FAIL: 2 problem\(s\)\n/, bad)
    assert.match(bad, /\nthe page is wider than the window \(616px in 400px\): u1l1 card 1 \(learn\)\n/, bad)
    assert.match(bad, /\ndiv "Too wide\." sticks out past the window \(16 to 616px of 400px\): u1l1 card 1 \(learn\)\n/, bad)
  })
})
