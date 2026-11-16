<img src="assets/icon.svg" width="64" height="64" alt="">

# create-fun-lessons

An agent skill that turns a codebase, library or topic into a course on one HTML page. The course has a lesson map of short units, quick cards with instant feedback, and a syllabus that proves the whole subject is covered. It takes a learner from zero to contributor.

## What you get

Ask your agent for a course and it writes a single self-contained HTML file. Open it in any browser, on a laptop or a phone.

- **A lesson map.** Units run from the basics to a capstone that plans a real change. Each lesson holds three to six cards.
- **Quick cards.** Six card types, described in the table below.
- **Instant feedback.** Every quiz card states what counts as a right answer before you answer. As soon as you check, it shows an explanation, whether you were right or wrong.
- **Hints.** Every quiz card has a Hint button. The first press gives a nudge. Later presses rule out a wrong option, place a step, or show how the answer starts.
- **Retries.** A card you miss comes back at the end of the lesson, so each lesson ends with every card answered right.
- **Course progress.** The lesson map shows how many lessons are done, and the lesson-complete screen shows the bar moving forward.
- **Saved progress.** The page saves progress on the device after every card, even mid-lesson. A progress code moves it to another browser or device. The map can reset one lesson, one unit, or the whole course.
- **Going back.** The Back button in a lesson returns to the previous card, and answering it again leaves the score as it was. The browser's back button returns from a lesson to the map.
- **Syntax highlighting** for every code sample, command and code answer.

### Card types

| Card | What the learner does | How it is checked |
| --- | --- | --- |
| Learn | Reads one idea, a few sentences and the real code | Not graded |
| Multiple choice | Picks one option | Automatically |
| Fill the blank | Chooses the missing piece of a real line of code | Automatically |
| Order | Taps the steps of a flow into sequence | Automatically |
| Typed answer | Types a command or a one-liner | Automatically, against every accepted form; the card states the expected form and the matching rule |
| Written answer | Writes code, a script or a short essay | The learner compares it with a model answer and ticks the rubric they were shown before writing |

## Install

The skill is the [`skills/create-fun-lessons/`](skills/create-fun-lessons/SKILL.md) folder. Install it with the [`skills`](https://www.npmjs.com/package/skills) CLI:

```sh
npx skills add itsfaqih/create-fun-lessons
```

Or copy or link the folder into your agent's skills directory yourself, for example:

```sh
git clone https://github.com/itsfaqih/create-fun-lessons
cp -r create-fun-lessons/skills/create-fun-lessons ~/.claude/skills/
```

Use the skills directory your agent reads from.

## Use

Open your agent in the repo you want to learn and ask for a course:

> Make me a course on this repo, from zero to contributor.

It also works for a library ("Make me a course on the public API of this package") or a topic ("Teach me SQL window functions as fun lessons"). The skill triggers on requests for game-like lessons, a quiz, or interactive exercises.

The agent then:

1. **Maps the subject.** It lists every part of it in `syllabus.md`: each app, package and module, the entry points, data, config, tooling and conventions.
2. **Researches each part** to the depth a contributor needs, and traces each fact to a file or a URL.
3. **Outlines and writes** the units and lessons, filling the content block of `template.html`.
4. **Checks** the page with `scripts/check.mjs` until it prints `OK`, then plays one lesson in a browser.
5. **Delivers** the path to the page, and lists any skipped syllabus rows with their reasons.

When the learner will use a phone, the agent can also serve the course folder on a URL the phone can reach, so progress saves there too.

## Full coverage with `syllabus.md` and `check.mjs`

`syllabus.md` sits beside the course page and maps every part of the subject to the lessons that teach it:

```md
| Area | Sources | Lessons |
|---|---|---|
| HTTP routing | `src/routes/`, `src/server.ts` | u3l1, u3l2 |
| Generated API client | `gen/client/` | skip: generated from `api.yaml`, taught in u4l2 |
```

Each Lessons cell lists existing lesson ids, or reads `skip: <reason>`. Skips are only for code the learner never needs to read, such as generated or vendored code, or for what the user put out of scope.

`scripts/check.mjs` validates the course and the syllabus:

```sh
node skills/create-fun-lessons/scripts/check.mjs path/to/course.html
node skills/create-fun-lessons/scripts/check.mjs path/to/course.html --repo path/to/repo
```

It fails when:

- the page's script does not parse, or its content block throws
- a unit, lesson or card is missing a required field, such as a lesson's recap, a card's explanation (`why`), or a hint on a card type that has no automatic hints
- a unit has no written-answer card
- a code language is one the page does not load
- `syllabus.md` is missing, or has no table rows
- a syllabus row names a lesson that does not exist, or neither lists lessons nor gives a skip reason
- a lesson appears in no syllabus row
- with `--repo`: any tracked top-level directory of the repo appears in no Sources cell

On success it prints a summary such as `OK: 5 units, 18 lessons, 84 cards, 14 syllabus rows`. On failure it lists each problem and exits with a non-zero code.

## Repository layout

```text
skills/create-fun-lessons/
  SKILL.md           the skill: steps, syllabus rules, content schema, card-writing guide
  template.html      the course engine plus a sample lesson; agents fill its content block
  scripts/check.mjs  the course and syllabus checker
site/                the landing page (Astro)
assets/icon.svg      the project icon
AGENTS.md            notes for agents working on this repo
```

## Landing page

The landing page lives in `site/`. It uses Astro with plain `.astro` components, CSS, and a small vanilla TypeScript player for the demos. Install its packages with pnpm.

```sh
cd site
pnpm install
pnpm dev       # local server at http://localhost:4321
pnpm build     # type-checks, then writes the static site to site/dist/
pnpm preview   # serves the built site
```

The demos are miniature course screens built in HTML and CSS. Each plays once when it scrolls into view. With reduced motion turned on, each shows its finished state instead. `site/src/components/REHEARSAL.md` records how they were checked.

---

Created in [T3 Code](https://t3.codes).
