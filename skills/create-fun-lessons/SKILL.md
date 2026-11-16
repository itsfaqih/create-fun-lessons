---
name: create-fun-lessons
description: Build a complete course of fun, bite-sized lessons as one HTML page, taking a learner from zero to full understanding, with quizzes, typed commands, and written code or essay exercises. Use when asked for game-like lessons, a quiz, or interactive exercises to learn a codebase, library, or topic.
---

# Create fun lessons

A course is one self-contained HTML page built from [`template.html`](template.html). The template holds the engine: lesson map, card player with hints and instant feedback, retry of missed cards, overall course progress, and saved progress. You write only the content block between `COURSE CONTENT` and `END COURSE CONTENT`. Everything outside it stays as shipped, apart from extra highlight.js language tags (see Syntax highlighting).

## Steps

The course takes the learner from zero to contributor: by the last unit they can explain why each part exists, find the code behind any feature, trace any request through the system, and plan a change. The syllabus (below) proves the coverage.

1. **Inventory.** Create the course folder (the one the user's or project's rules name for pages, else a new folder named after the course) and start `syllabus.md` in it. Add a row for every part of the subject:
   - a codebase: every app, package, and module directory; entry points (main, routes, CLI commands, workers, scheduled jobs); data model and storage (schemas, migrations, queries); API surface and contracts; configuration and environment variables; auth and permissions; external services; shared utilities; build, test, lint, CI, and deploy tooling; conventions (naming, errors, logging); docs and decision records
   - a library: every export group of the public API, configuration, errors, extension points, and version differences
   - a topic: every section of the authoritative curriculum or docs table of contents

   Done when every top-level directory, and every app or package inside one, sits in some row's Sources (or every section of the source's table of contents does).
2. **Research.** Study every row to the depth a contributor needs: what it is for; its key files and the main types, functions, and commands in them; how it connects to its neighbours (who calls it, what it calls, what data goes in and out); how it is configured and tested; its conventions and gotchas. Trace every fact to a path or URL. For a large subject, research rows in parallel with subagents where available, each returning notes for its rows. Done when every row has its sources and an answer to each of those questions.
3. **Outline.** Turn the syllabus into a journey, in this order:
   - foundations: what the subject is, how to install and run it, its vocabulary, and the prerequisites it assumes (language features, frameworks), each taught where first needed
   - the spine: one real request, job, or task followed end to end, naming every part it touches
   - every remaining row in depth, one unit per major area
   - cross-cutting concerns: configuration, errors, logging, testing, build, deploy
   - contributing, then a capstone that plans a real change

   Unit count follows the syllabus. A lesson holds 3–6 cards, so a bigger area gets more lessons rather than longer ones. Assume the learner knows nothing unless told otherwise. Plan what each lesson asks the learner to do: recognise (`mcq`, `fill`, `order`), recall an exact command or expression (`type`), or produce code or an explanation (`write`). Write each lesson id into its rows' Lessons column. Done when every row lists lesson ids or a skip reason, every lesson has a title, a one-line recap, its sources, and its quiz card types, and every unit has a `write` card.
4. **Write.** Copy `template.html` into the course folder. Fill `COURSE`, `UNITS`, and `GLOSSARY` using the schema below; the glossary holds every term the course introduces. Done when every outlined lesson is written.
5. **Check.** Run `node <skill-dir>/scripts/check.mjs <page>` until it prints `OK`; for a codebase add `--repo <repo-dir>`, which fails on any tracked top-level directory missing from the syllabus. Then open the page in a browser at 400px wide and play one lesson that has a `type` or `write` card: use a hint, answer one card wrong, and finish the lesson. Reload and confirm the "Continue where you left off" card. Done when the checker prints `OK`, code shows in colour, every card fits without horizontal scroll, and the click-through finishes.
6. **Deliver** the page path as a plain markdown link, so it stays clickable, and report the syllabus's skipped rows with their reasons. When the learner will use a phone, also serve the course folder: sandboxed viewers, such as an in-app phone preview, block browser storage. Run `python3 -m http.server <port> --bind 0.0.0.0 --directory <course-dir>` detached, put a URL the phone can reach (LAN or Tailscale IP) in `COURSE.homeUrl`, and give that URL. The page's storage warning then links to the served copy, where progress saves.

## Syllabus

`syllabus.md` sits beside the page and maps every part of the subject to the lessons that teach it. The checker reads its table: each row's Lessons cell lists existing lesson ids, or reads `skip: <reason>`. Skip only what the learner never needs to read, such as generated or vendored code, or what the user put out of scope; name where it comes from or what replaces it.

```md
| Area | Sources | Lessons |
|---|---|---|
| HTTP routing | `src/routes/`, `src/server.ts` | u3l1, u3l2 |
| Generated API client | `gen/client/` | skip: generated from `api.yaml`, taught in u4l2 |
```

## Content schema

```js
const COURSE = { title, logoHtml, heading, subtitle, storageKey, lang, homeUrl /* optional */ }
const UNITS = [{ id, title, blurb, color: '#rrggbb', dark: '#rrggbb', lessons: [
  { id, title, recap, cards: [ /* cards */ ] } ] }]
const GLOSSARY = [['Term', 'One-line meaning'], ...]
```

| Card | Fields | Notes |
|---|---|---|
| `learn` | `h`, `body` | `body` is HTML; helpers below |
| `mcq` | `q`, `o[]`, `a`, `why`, `hint?` | `a` is the index of the right option; `q`, `o`, `why` are HTML |
| `fill` | `q`, `code`, `o[]`, `a`, `why`, `lang?`, `hint?` | `code` is plain text with exactly one `____`; options are plain text |
| `order` | `q`, `items[]`, `why`, `hint?` | `items` in the correct order, as plain text; the page shuffles them |
| `type` | `q`, `accept[]`, `why`, `expect?`, `code?`, `lang?`, `hint?` | one-line answer, checked automatically |
| `write` | `q`, `model`, `rubric[]`, `why`, `hint`, `starter?`, `lang?` | open answer (code, a script, an essay), self-graded |

In HTML fields, write a literal `<` as `&lt;`.

**`learn` helpers:**
- `<div class="flow">` holding `.step` and `.arrow` divs, for a pipeline
- `<table class="tbl">`
- `<div class="where">📄 <code>path</code></div>`, for a source file
- `<div class="tip">`
- `<pre><code class="language-…">`, with `<span class="hl">` around the line that matters

**`type`.** The answer passes when, with whitespace trimmed and collapsed (and a leading `$` dropped for `shell`), it equals any literal in `accept` or matches any entry written as `/regex/flags`. `accept[0]` is a literal, shown as the answer on a miss. List every real variant: reordered flags, `--long` forms, optional quotes. Anchor regexes with `^…$`. `code` is optional plain-text context above the field. Above the field the page states the acceptance criteria: the expected form, then the matching rule ("One command. Spacing and a leading `$` are ignored; capitals count."). `expect` (HTML) replaces the expected form; name every variant `accept` allows ("One command, flags in any order.").

**`write`.** For work too open to match by text. The `rubric` is the acceptance criteria, listed under "Your answer should" before the learner writes. After Check the learner sees `model` (plain text, the sample answer) and ticks each criterion their answer meets: all ticked counts as right, anything less sends the card to the retry queue. Write 2–4 criteria (HTML), each a yes-or-no requirement observable in the answer ("Calls `await` on the fetch"). `starter` prefills the field, such as a function signature.

**Hints.** Every quiz card has a Hint button. Each tap reveals the next step: the card's own `hint` first (a string, or an array revealed one at a time), then automatic help: `mcq` and `fill` strike out wrong options until one remains, `order` places the next item, `type` reveals how the answer starts. A right answer after a hint passes without the first-try bonus. Order hints from gentle to specific, each narrowing the search: the concept, then the file, then the part to change. The checker names the cards that need an authored `hint`.

**Syntax highlighting.** highlight.js colours every code sample, command, and code answer field, live as the learner types. A `lang` is one of:
- `text`: prose, uncoloured (the default for `type` and `write`)
- `shell`: bash, with command names and flags coloured; a `type` field also gets a `$` prompt
- `code`: the course language, `COURSE.lang`
- any highlight.js name, such as `python`, `sql`, or `yaml`

Set `COURSE.lang` to the course's main language, or `'text'` for a course without code. A `<pre><code>` takes its language from `class="language-…"`, else `COURSE.lang`, so give every shell block `class="language-shell"` and every other-language block its own class. The checker rejects a language the page does not load; to add one, put its `languages/<name>.min.js` script tag after the highlight.js tag at the top of the page.

## Writing the cards

- **Bite.** One idea per card. A learn card fits on a phone screen without scrolling past the code sample.
- Quiz each new concept within one or two cards of teaching it.
- **Recall over recognition.** After an `mcq` introduces a command, ask for it again as a `type` card. Close each unit on a `write` card that produces something real: a function, a script, a config block, or a few sentences explaining a design choice.
- Make wrong options plausible: a real neighbouring file, a real but wrong function. `why` says why the right answer is right, in one or two sentences.
- **Depth.** Teach each area at the level of real names: the actual file, the function, its arguments and return value, who calls it, and what breaks when it changes. A lesson that only names an area has not taught it yet. Point to real paths, so the learner can open the code next.
- Give each unit its own `color`, readable under white text (it fills the unit dot, finished-lesson checks and the Start badge), and a darker `dark` for their borders.

## Saved progress

The engine saves after every card, keyed by `COURSE.storageKey` and lesson `id`s, and the home page offers a progress code to move it between browsers. To keep learners' progress when you revise a course:
- keep `storageKey` and existing lesson `id`s the same
- add new lessons with new ids
- change `storageKey` only for a deliberate reset
