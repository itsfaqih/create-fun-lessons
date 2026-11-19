---
name: create-fun-lessons
description: Build a complete course of fun, bite-sized lessons as one HTML page, taking a learner from zero to full understanding, with quizzes, typed commands, and written code or essay exercises. Use when asked for game-like lessons, a quiz, or interactive exercises to learn a codebase, library, or topic.
---

# Create fun lessons

A course is one self-contained HTML page. Its engine, [`template.html`](template.html), holds the lesson map, card player with hints and instant feedback, retry of missed cards, a Back button to the previous card, overall course progress, saved progress, and reset for one lesson, one unit, or the whole course. You write the content as plain files in a course folder, and [`scripts/lessons.mjs`](scripts/lessons.mjs) builds the page from them. [`references/lessons.md`](references/lessons.md) is the authoring contract: the folder, `course.json`, the lesson file format with an example of every card type, and how to write good cards. Run the CLI with `node` (18 or later); it needs no install.

## Steps

The course takes the learner from zero to contributor: by the last unit they can explain why each part exists, find the code behind any feature, trace any request through the system, and plan a change. The syllabus (below) proves the coverage.

1. **Inventory.** Pick the course folder (the one the user's or project's rules name for pages, else a new folder named after the course) and run `node <skill-dir>/scripts/lessons.mjs init <course-dir>`. It writes `course.json`, `syllabus.md` and a sample unit file, `lessons/u1.md`, whose two lessons show every card type. It also sets `repo` in `course.json` to the git repo it finds (the one holding the course folder or the working directory, else the one directly inside the working directory), and prints it. For a codebase course, check that it names the codebase, or set it with `init <course-dir> --repo <repo-dir>`. For a library or topic course, set `repo` to `null`. Replace the sample syllabus rows with a row for every part of the subject:
   - a codebase: every app, package, and module directory; entry points (main, routes, CLI commands, workers, scheduled jobs); data model and storage (schemas, migrations, queries); API surface and contracts; configuration and environment variables; auth and permissions; external services; shared utilities; build, test, lint, CI, and deploy tooling; conventions (naming, errors, logging); docs and decision records
   - a library: every export group of the public API, configuration, errors, extension points, and version differences
   - a topic: every section of the authoritative curriculum or docs table of contents

   Done when every top-level directory, and every app or package inside one, sits in some row's Sources (or every section of the source's table of contents does).
2. **Research.** Study every row to the depth a contributor needs: what it is for; its key files and the main types, functions, and commands in them; how it connects to its neighbours (who calls it, what it calls, what data goes in and out); how it is configured and tested; its conventions and gotchas. Trace every fact to a path or URL. Take behaviour from the code: when a doc or comment disagrees with it, teach what the code does. A rule file (AGENTS.md, CONTRIBUTING, a style guide) states what contributors must do, so teach it as a rule, never as a description of how the code behaves. For a large subject, research rows in parallel with subagents where available, each returning notes for its rows. Done when every row has its sources and an answer to each of those questions.
3. **Outline.** Turn the syllabus into a journey, in this order:
   - foundations: what the subject is, how to install and run it, its vocabulary, and the prerequisites it assumes (language features, frameworks), each taught where first needed
   - the spine: one real request, job, or task followed end to end, naming every part it touches
   - every remaining row in depth, one unit per major area
   - cross-cutting concerns: configuration, errors, logging, testing, build, deploy
   - contributing, then a capstone that plans a real change

   Write it into `course.json`: the course's title, `storageKey` and `lang`, then each unit with its lesson ids (see references/lessons.md). Unit count follows the syllabus. A lesson holds 3–6 cards, so a bigger area gets more lessons rather than longer ones. Assume the learner knows nothing unless told otherwise. For each lesson, plan its title, a one-line recap, the syllabus Areas it covers, its sources, and what it asks the learner to do: recognise (`mcq`, `fill`, `blanks`, `order`), recall an exact command or expression (`type`), or produce code or an explanation (`write`). Delete the sample unit file. Done when every syllabus row is covered by a planned lesson or reads `skip: <reason>`, and every unit plans a `write` card. For a codebase course, the last unit also plans a lesson on contributing (the repo's contributing guide, its tests and CI, and its public types if it has them), and the course ends on a capstone `write` card that plans one real change to the subject: the files to edit, the test to add, and how to check it.
4. **Write** each unit as one file, `lessons/<unit id>.md`, in the format of references/lessons.md: all its lessons in course order, each under its `# <title>` and `id: <lesson id>` lines. Write every code line to fit a phone as you go, well under 41 columns (36 in a `write` card's `starter`): one statement per line, comments on their own line, and one argument or key per line in a long call or object (references/lessons.md, Code width). Write the whole file at once, then run `node <skill-dir>/scripts/lessons.mjs check <course-dir> <unit id>` once and fix every problem it lists before checking again. Each lesson names its syllabus Areas in `covers:` and its new terms in `terms:`. Write the units yourself, one after another: you already hold the research and the format, and each writer subagent has to read them all again. Only for a course of more than 6 units, where writing every unit yourself would crowd your context, write units in parallel with subagents where available: give each writer references/lessons.md, its units' outline, and the research notes for their rows. Done when every unit file exists and checks `OK`.
5. **Build.** Run `node <skill-dir>/scripts/lessons.mjs build <course-dir>` until it prints `OK`. For a codebase course, build also fails on any tracked top-level directory of `course.json`'s `repo` missing from the syllabus Sources, and on a contributing guide (`CONTRIBUTING` at the repo root, in `docs/` or in `.github/`) that no covered row's Sources names; a skip row does not count for it. Each problem names its file and line; fix the lesson there and build again. Build writes `index.html` and fills the syllabus's Lessons column from each lesson's `covers`. Then let the page play itself: run `node <skill-dir>/scripts/lessons.mjs selfcheck <course-dir>`. It opens `index.html#selfcheck` in headless Chrome, Chromium or Edge at 400px (Node 22 or later; set `CHROME_PATH` if the browser is elsewhere), reloads, and prints the report and the map's resume card. The self-check plays every lesson through its buttons, answering each quiz card wrong and then, on its retry, with a hint and the right answer. After every step it checks that nothing is wider than the window and that code is coloured. Its report names each failing card, any error the page threw, and, as a `WARN` line, any learn card taller than the 400x860px screen; fix that lesson (split a tall learn card in two), build, and run selfcheck again. Exit 1 also covers a run that timed out or lost the browser; read the `Self-check FAIL` line, fix its cause, and run it again. Only if the command exits 3 (no browser it can drive), open `index.html#selfcheck` in a browser window 400px wide yourself, wait until the page title starts with `Self-check`, read the page's text, reload, and read the text again, chained into one browser command or script. Take a screenshot only of a card whose failure the text does not explain. Done when build prints `OK` and selfcheck prints `Self-check PASS` and `Resume OK.`
6. **Deliver** the course at its home: the one URL the learner opens on every visit, because progress belongs to that URL's origin (see Saved progress).
   - Desktop only: the home is the course folder's `index.html`. Give its path as a plain markdown link, so it stays clickable.
   - A phone, or a learner who wants a URL: serve the course folder detached, so it outlives your session, on a fixed port and a stable address the phone can reach: `python3 -m http.server <port> --bind 0.0.0.0 --directory <course-dir>`. A stable address is a VPN or mesh-network name or IP (such as Tailscale's), or the machine's `<hostname>.local` name; a DHCP LAN IP can change and strand the progress saved under it. Publishing to a static host gives the most stable home and reaches the phone anywhere, but it makes the course public, so do it only when the user asks.

   Set `homeUrl` in `course.json` to the served home and build again, so a viewer that blocks storage links there. Give the learner the home URL, the command that restarts the server on the same port and address after a reboot, and the habit that keeps progress: one browser on each device, in a normal (not private) window. Report the syllabus's skipped rows with their reasons. Done when the home URL, fetched from another device or from the machine's own network address, serves the page, and the page opened there says "Progress saves automatically on this device".

**Revising a course.** Edit the lesson files or `course.json`, then build. The served folder picks up the new `index.html` on the learner's next reload. To revise a page made before the course folder existed, import it first: `node <skill-dir>/scripts/lessons.mjs init <course-dir> --from <page.html>`, with its `syllabus.md` beside the page. Import keeps the page's `storageKey` and lesson ids, so learners keep their progress.

## Syllabus

`syllabus.md` sits in the course folder and maps every part of the subject to the lessons that teach it. Write the Area and Sources of each row. A codebase path in Sources starts at the repo root (`src/routes/`) or at its parent, under the repo folder's name (`orders-api/src/routes/`). Build fills the Lessons cell from the lessons whose `covers` name that Area, in course order. A row no lesson covers fails the build, unless its Lessons cell reads `skip: <reason>`. Skip only what the learner never needs to read, such as generated or vendored code, or what the user put out of scope; name where it comes from or what replaces it.

```md
| Area | Sources | Lessons |
|---|---|---|
| HTTP routing | `src/routes/`, `src/server.ts` | u3l1, u3l2 |
| Generated API client | `gen/client/` | skip: generated from `api.yaml`, taught in u4l2 |
```

## Saved progress

The engine saves after every card to `localStorage`, under `course.json`'s `storageKey`, with lesson `id`s inside. Browser storage belongs to an origin (scheme, host, and port), so the learner's progress lives in one browser at one origin, and a URL with any of those three changed opens an empty course. Several courses can share one origin, since each has its own `storageKey`. The engine also mirrors progress into the URL hash, which survives reloads of that tab, and the home page offers a progress code to move it between browsers or devices.

Progress persists when the learner opens:
- the same page file, from the same path, in a desktop browser
- the same served URL, with the same host and port, in the same browser

Progress is lost or stranded by:
- a server that picks a new port each run (a random or next-free port); restart on the home's port, freeing it first if something else holds it
- a different address for the same machine: `localhost`, the LAN IP, and a VPN name are three origins, and a LAN IP that changes is a new one
- a private window, which clears storage when it closes
- a sandboxed viewer, such as an in-app preview, which blocks storage; the page warns and links `homeUrl`
- another browser, or on iOS a home-screen web app versus the same URL in a Safari tab, which keep separate storage
- Safari, which can clear a site's storage after about a week without a visit; the progress code restores it
- opening the page as `index.html#selfcheck`, which plays every lesson and replaces that browser's progress for the course

To keep learners' progress when you revise a course:
- keep `storageKey`, existing lesson `id`s (each lesson's `id:` line), and the home URL the same; build never changes them
- add new lessons with new ids, wherever they go in a unit's file
- change `storageKey` only for a deliberate reset
