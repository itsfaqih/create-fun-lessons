# Writing lessons

A course is a folder of plain files that `scripts/lessons.mjs` builds into one page. You write the lesson files; the CLI writes the page and the syllabus's Lessons column. This file is the whole authoring contract: hand it to anyone who writes lessons.

## The course folder

```text
course.json        the course settings and the units, in order
syllabus.md        every part of the subject (see SKILL.md, Syllabus)
lessons/u1.md      one file per unit, holding its lessons in order
index.html         the page; build writes it, so never edit it
```

```sh
node <skill-dir>/scripts/lessons.mjs init <course-dir>                   # start from the sample course
node <skill-dir>/scripts/lessons.mjs init <course-dir> --from <page.html> # import a page built from template.html
node <skill-dir>/scripts/lessons.mjs check <course-dir> u2                # check only these units (or lesson ids)
node <skill-dir>/scripts/lessons.mjs build <course-dir>
```

`check` with unit or lesson ids checks those lessons and nothing course-wide, so writers working in parallel can each check their own units. It writes nothing. `build` checks the whole course, then writes `index.html` and fills each syllabus row's Lessons cell from the lessons' `covers`. It prints `OK: 5 units, 18 lessons, 84 cards, 14 syllabus rows`. On any problem it writes nothing, lists each problem as `lessons/u2.md:14: mcq card 2: <what is wrong>`, and exits non-zero. Building twice gives the same bytes. `check` and `build` with no ids also fail on any tracked top-level directory of the `repo` in `course.json` missing from the syllabus Sources. `--repo <repo-dir>` on any command names a different repo for that run, and `init --repo` writes it into `course.json`.

## course.json

```json
{
  "title": "Orders API",
  "logoHtml": "Orders <span>API</span>",
  "heading": "Learn the orders service, one bite at a time",
  "subtitle": "About 3 minutes each. No prior knowledge needed.",
  "storageKey": "orders-api-v1",
  "homeUrl": "",
  "lang": "typescript",
  "languages": ["haskell"],
  "repo": "../orders-api",
  "units": [
    { "id": "u1", "title": "Getting started", "blurb": "Install, run, and find your way around.",
      "color": "#1f9d6b", "dark": "#157a52", "lessons": ["u1l1", "u1l2"] }
  ]
}
```

- `title` is the browser tab title, two to four words. `logoHtml` is the top bar; its `<span>` takes the brand colour.
- `storageKey` names the saved progress. Keep it for the life of the course; changing it resets every learner (see SKILL.md, Saved progress).
- `homeUrl` is the served home (optional; see SKILL.md, Steps).
- `lang` is the course's main code language, or `text` for a course without code.
- `languages` (optional) adds highlight.js languages the page does not bundle. Build loads each from the highlight.js CDN.
- `repo` is the git repo a codebase course teaches, relative to the course folder, or `null` for a library or topic course. Build fails while it is missing. `init` writes it: the repo holding the course folder or the working directory, else the one repo directly inside the working directory, else `null`. When the working directory holds several repos, init leaves it out for you to set. A Sources path may start at the repo root (`src/routes/`) or at its parent, under the repo folder's name (`orders-api/src/routes/`). The page never contains it.
- Each unit has its own `color`, readable under white text (it fills the unit dot, finished-lesson checks and the Start badge), and a darker `dark` for their borders. `lessons` lists the unit's lesson ids in order; each is the `id:` of a lesson in `lessons/`.

Every unit needs a `write` card, ideally closing the unit.

## Lesson files

A lesson file holds a unit's lessons, in course order, and is named by the unit id, such as `lessons/u1.md`:

````md
# Routing a request
id: u1l1
recap: The router matches the path and hands the request to one handler.
covers: HTTP routing, Request lifecycle
terms:
- Route: A path pattern and the handler that serves it.
- Handler: The function that turns one request into a response.

## learn: Where routes live
<p>Every route is declared in `src/routes.ts`.</p>
```ts
router.get('/orders/:id', «getOrder»)
```

## mcq
q: Which file declares the routes?
o:
- [ ] `src/server.ts`
- [x] `src/routes.ts`
- [ ] `src/db.ts`
why: `src/routes.ts` maps each path to its handler; the server only starts listening.

## fill
q: Fill the blank so the route serves `GET` requests.
code: router.____(path, getOrder)
o:
- [x] get
- [ ] post
- [ ] delete
why: `router.get` matches `GET`; `post` and `delete` match other methods.

# Handlers
id: u1l2
recap: A handler turns one request into one response.
covers: Request lifecycle

## learn: One handler per route
<p>`getOrder` reads the order and sends it back as JSON.</p>

## mcq
q: What does `getOrder` send back?
o:
- [ ] The database row as it is stored
- [x] The order as JSON
- [ ] A redirect to the order page
why: `getOrder` reads the order and sends it back as JSON.

## type
q: Name the handler that serves `GET /orders/:id`.
accept:
- getOrder
hint:
- Handlers are named after what they do to an order.
- Open `src/routes.ts` and find the `/orders/:id` line.
why: `src/routes.ts` maps that path to `getOrder`.
````

- A lesson starts at a `# <lesson title>` line outside a fence and runs to the next one, so a `# ` line inside a learn body starts a new lesson; put a heading there as HTML.
- `id:` under the title is the lesson's id, the one `course.json` lists. Saved progress is kept by id, so an id never changes and is never reused, and a new lesson takes a new id wherever it goes in the file. Two lessons with one id, a listed id that no lesson has, and a lesson no unit lists are errors. A file that holds one lesson may leave out `id:`; its file name is then the id, so `lessons/u1l1.md` is lesson `u1l1`.
- The header under the title takes:
  - `recap:` one line shown when the lesson is done.
  - `covers:` the syllabus Areas this lesson teaches, comma-separated, matched without regard to case. Build lists the lesson in those rows. An Area whose name holds a comma still matches on one line; the list form (`covers:` then one `- ` line per Area) also works.
  - `terms:` one `- Term: meaning` line per term the lesson introduces (split at the first `: `). The glossary is every lesson's terms, in course order; a term defined twice keeps its first meaning.
- `## learn: <heading>` starts a learn card. Its body is everything up to the next `## ` line.
- `## mcq`, `## fill`, `## blanks`, `## order`, `## type` and `## write` start quiz cards made of fields.
- A field is `name: value` at the start of a line. A field the card type does not take is an error that lists the fields it does take.
- A list field is `name:` followed by one `- ` line per item. In `mcq` and `fill` options, mark the right one `- [x]` and every other `- [ ]`.
- `hint:` is one hint, or a list of hints revealed one at a time.
- Inside a ``` fence nothing is structure: `## `, `name:` and `- ` lines there are content.

### HTML fields

`recap`, terms, learn headings and bodies, `q`, `why`, `expect`, `hint`, `mcq` options and `rubric` items are HTML. A value continues onto the following lines until the next field line, `- ` line, or `## ` line. Inside them:

- `` `x` `` becomes `<code>x</code>`, escaped for you, so `` `a<b` `` is safe. As in Markdown, a span ends at the next run of the same number of backticks on its line: `` `/` or `?` `` is two spans, and ``` ``x`y`` ``` is code that holds a backtick. An entity in a span stands for its character, so `` `a &lt; b` `` and `` `a < b` `` both show `a < b`. Backticks inside tags, `<pre>` and `<code>` stay as written. A backtick that no run closes is an error; write a literal one as `&#96;`.
- A ``` fence becomes a code box, `<pre><code class="language-ts">` for ```` ```ts ````, escaped for you. It shows its text exactly, entities included, so write `<` itself; build rejects an entity in a fence named for a language that is not markup (such as ```` ```ts ````). Wrap the part that matters in `«…»` to highlight it. A highlight may run over line breaks, so a highlighted line stays highlighted when you break it to fit the code width. A `«` or `»` without its partner is an error. A fence with no language uses `lang` from course.json.
- A ```` ```raw ```` fence goes into the page exactly as written, for HTML the rules above would change.
- Everywhere else write HTML: a literal `<` is `&lt;` and `&` is `&amp;`. An entity escaped twice, such as `&amp;lt;`, is an error, because the learner would see `&lt;`. To show that text on purpose, write `&#38;lt;`. For a guillemet in text, write `&laquo;` or `&raquo;`.
- A continuation line that starts with a lowercase `word:` starts a new field. Begin it with a tag, or put the value in a ```` ```raw ```` fence.

### Plain fields

`code`, `model`, `starter`, and the items of `accept`, `items`, `answers`, `extra` and `fill` options are plain text, shown exactly as written, so `«…»` does not highlight there and is an error. Give a one-line value on the field line, or write `name:` and a fence on the next line:

````md
code:
```shell
docker run \
  --rm "$IMAGE"
```
````

The fence's language sets the card's `lang`. Alternatively give `lang: shell` as a field; a card's `lang` line and fences must agree. Use a longer fence (```` ```` ````) when the code holds a ``` line.

### Code width

A phone fits 41 columns of code in a code box, and 36 in the `write` answer editor (`starter`). A longer line scrolls sideways, so build rejects it. A line judged by eye is usually a few columns longer than it looks, so write each line well under the limit and shape the code as you write it:

- Put one statement on a line, and an `if` body on the line below its `if`.
- Put a comment on its own line above the code, never after it.
- Break a call or object literal that holds more than a short item or two: one argument or key per line, indented two spaces.
- Break a chain before each `.method()`.
- Break a long string or template literal into a variable on the line above.
- A line with no space, such as a long URL or call chain, counts too: break it after a `(` or before a `.`, or shorten it. A URL can go in the text instead, which wraps.
- In `fill` and `blanks`, a `____` counts as wide as the longest chip, wrong options and spare chips included. Keep chips short, or give the blank a line of its own.

`const data = await api.post(url, {json: body}).json()` is 53 columns, so write it as:

````md
code:
```ts
const data = await api
  .post(url, {json: body})
  .json()
```
````

A `code:` value broken over lines goes in a fence, as above.

## Card types

### learn

````md
## learn: A read-through cache
<p>Every read checks the cache first.</p>
<div class="flow"><div class="step">Request<small>GET /orders/42</small></div><div class="arrow">↓</div><div class="step">Cache</div></div>
<div class="where">📄 `src/cache.ts`</div>
<div class="tip">A miss fills the cache, so the next read is fast.</div>
```ts
const hit = await «cache.get(key)»
```
````

Helpers for the body:
- `<div class="flow">` holding `.step` and `.arrow` divs, for a pipeline
- `<table class="tbl">`
- ``<div class="where">📄 `path`</div>``, for a source file
- `<div class="tip">`
- a ``` fence, with `«…»` around the part that matters
- `<figure class="viz">`, an inline SVG diagram, chart, or illustration, in a ```` ```raw ```` fence or as HTML; see [`visuals.md`](visuals.md)

### mcq

```md
## mcq
q: Which status code means the order was not found?
o:
- [ ] `400`
- [x] `404`
- [ ] `500`
why: `404` says the resource does not exist; `400` blames the request and `500` the server.
```

`q`, the options and `why` are HTML. With only two options, also give a `hint`.

### fill

```md
## fill
q: Fill the blank to read one order.
code: const order = await db.____(id)
o:
- [x] findOrder
- [ ] saveOrder
- [ ] deleteOrder
why: `findOrder` reads; the other two change data.
```

`code` holds exactly one `____`. Options are plain text. With only two options, also give a `hint`.

### blanks

```md
## blanks
q: Keep only the even numbers.
code: nums.____(n => n % 2 ____ 0)
answers:
- filter
- ===
extra:
- map
- =
why: `filter` keeps the items its test passes; `===` compares, where `=` would assign.
```

A line of code or a sentence with 2 or more blanks; tapping a chip from the bank puts it in the next empty blank, and tapping a filled blank sends its chip back. `answers` lists the chip for each `____` in order, and `extra` adds spare chips, as plausible as the wrong options of an `mcq`. A blank passes when its chip's text equals its answer, so repeated chip texts are interchangeable. `lang: text` sets a sentence in prose. Above the bank the page states how many blanks there are and how many chips are spare. Feedback marks each blank right or wrong and, on a miss, shows the correct fill.

### order

```md
## order
q: Put the request's steps in order.
items:
- Router matches the path
- Handler validates the body
- Handler writes the row
- Server sends the response
why: Routing comes first; the response goes out only after the write succeeds.
```

Write `items` in the correct order, as plain text; the page shuffles them. Items must be distinct, at least 3.

### type

```md
## type
q: List every file, hidden ones included, in long format.
lang: shell
accept:
- ls -la
- ls -al
- /^ls -l -a$|^ls -a -l$/
expect: One command, flags in any order.
hint:
- The command that lists files is `ls`.
- Combine two flags: one for long format, one for all files.
why: `-l` is long format and `-a` includes dotfiles; flags combine in any order.
```

A one-line answer, checked automatically. It passes when, with whitespace trimmed and collapsed (and a leading `$` dropped for `shell`), it equals any literal in `accept` or matches any entry written as `/regex/flags`. The first `accept` entry is a literal, shown as the answer on a miss. List every real variant: reordered flags, `--long` forms, optional quotes. Anchor regexes with `^…$`. Give at least two hints. `code` is optional plain-text context above the field. Above the field the page states the expected form, then the matching rule ("One command. Spacing and a leading `$` are ignored; capitals count."). `expect` (HTML) replaces the expected form. It describes the answer's form and what the match ignores beyond spacing, such as "One command, flags in any order." or "A method name, without the parentheses.", and never the answer itself. Build rejects an `expect` that contains an answer `accept` takes.

### write

````md
## write
q: Write `double(n)`, which returns twice its argument.
starter:
```code
function double(n) {
  
}
```
model:
```code
function double(n) {
  return n * 2
}
```
rubric:
- Returns a value with `return`
- Multiplies `n` by 2 (or adds it to itself)
hint:
- A function hands back its result with one keyword.
- `return n * 2` is one way; there are others.
why: A function hands its result back with `return`; without it the call yields `undefined`.
````

For work too open to match by text: code, a script, a config block, or an essay. The `rubric` is the acceptance criteria, listed under "Your answer should" before the learner writes. After Check the learner sees `model`, the sample answer, and ticks each criterion their answer meets: all ticked counts as right, anything less sends the card to the retry queue. Write 2–4 criteria, each a yes-or-no requirement observable in the answer ("Calls `await` on the fetch"). `starter` prefills the field, such as a function signature. A `write` card needs at least two hints. For an essay, leave out `lang` (or give `lang: text`) and write `model` on one line or in a plain fence; for code, give the fence its language.

## Hints

Every quiz card has a Hint button. Each tap reveals the next step: the card's own `hint` first, then automatic help: `mcq` and `fill` strike out wrong options until one remains, `order` places the next item, `blanks` fills the next blank with its right chip, `type` reveals how the answer starts. A right answer after a hint passes without the first-try bonus. Order hints from gentle to specific, each narrowing the search: the concept, then the file, then the part to change. Build names the cards that need an authored `hint`, and rejects a `type` or `write` card with fewer than two hints, because their automatic help adds no idea.

## Syntax highlighting

highlight.js colours every code sample, command, and code answer field, live as the learner types. A `lang` is one of:
- `text`: prose, uncoloured (the default for `type` and `write`)
- `shell`: bash, with command names and flags coloured; a `type` field also gets a `$` prompt
- `code`: the course language, course.json's `lang`
- any highlight.js name, such as `python`, `sql`, or `yaml`

Give every shell fence the language `shell`, and every fence in another language than the course's its own. A language the page does not bundle goes in course.json's `languages`.

## Writing the cards

- **Bite.** One idea per card. A learn card fits on a phone screen without scrolling past the code sample; `lessons.mjs selfcheck` warns about any learn card taller than a 400x860px screen.
- **Picture** every concept that is spatial, a flow, or numeric: a diagram, chart, or illustration in a `learn` card, or in a quiz `q` that asks the learner to read it. Draw it from the patterns in [`visuals.md`](visuals.md).
- Quiz each new concept within one or two cards of teaching it.
- **Recall over recognition.** After an `mcq` introduces a command, ask for it again as a `type` card. Close each unit on a `write` card that produces something real: a function, a script, a config block, or a few sentences explaining a design choice.
- Make wrong options plausible: a real neighbouring file, a real but wrong function. `why` says why the right answer is right, in one or two sentences.
- **Depth.** Teach each area at the level of real names: the actual file, the function, its arguments and return value, who calls it, and what breaks when it changes. A lesson that only names an area has not taught it yet. Point to real paths, so the learner can open the code next.
- A lesson holds 3–6 cards, so a bigger area gets more lessons rather than longer ones. Build rejects a lesson with fewer or more.
