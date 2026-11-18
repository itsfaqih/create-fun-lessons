# Eval plan: does `lessons.mjs` make course building cheaper and more reliable?

Written 2026-11-18, before any candidate run. Results go to `~/artifacts/2026-11-18-lessons-cli-eval/`.

## Question

Merge 566c86e replaced the hand-written course flow with a course folder and `lessons.mjs init/check/build`. The claimed win: an agent building or revising a course spends fewer tokens and tool calls, fails the checker less often, and ends with a course at least as good. This eval measures each of those claims and reports the result either way.

## Arms

| Arm | Skill | Flow |
|---|---|---|
| `old` | `skills/create-fun-lessons` at c4f17c3 (`git archive`) | copy `template.html`, hand-write `COURSE`/`UNITS`/`GLOSSARY`, keep `syllabus.md` in sync by hand, `scripts/check.mjs` |
| `new` | `skills/create-fun-lessons` at 566c86e | `course.json`, `lessons/<id>.md`, `lessons.mjs init/check/build` |

The old arm's checker predates two rules the new one has: the code-width limit (6aa5f01) and the schema registry's stricter field checks (d6c690f). So "checker runs" and "failed checker runs" are counted against each arm's own checker, and "final checker result" is graded by one common checker, the current `scripts/check.mjs`, run on every arm's final page.

## Subject

`ky` (github.com/sindresorhus/ky) at 3541888878c4. About 4.9k lines in `source/`, plus `test/`, `test-d/`, `media/`, `.github/`. Small enough to finish in one session, big enough for 3–4 units and 10+ lessons, so the old flow's single growing JS block and hand-kept syllabus have room to drift.

Second subject (added 2026-11-19): Commander.js (github.com/tj/commander.js) at v15.1.0, a5a7dc084d4d. About 4.2k lines in `lib/` and `index.js`, 1.1k in `typings/index.d.ts`, 133 files in `tests/`, GitHub Actions CI. `harness.py setup <arm> build --subject commander` builds in `~/work-commander/<slug>/` from `prompts/build-commander.md`, and its judges read `rubric-commander.md`. Subjects are records in `harness.py` `SUBJECTS`; ky stays the default, and runs.tsv rows without a fourth column are ky. Each workspace clone sets `core.quotePath false`, because Commander tracks non-ASCII paths under `docs/zh-CN/`, and with quoted paths the checkers' `trackedDirs` reads a top-level directory named `"docs`.

## Workspaces

Each run gets `~/work-ky/<random slug>/` holding `ky/` (a clone at the pinned commit) and `skills/create-fun-lessons/` (the arm's skill). The slug, paths and prompt carry no arm name and none of the words the Eval playbook bans. Both arms put the skill at the same relative path, so the prompt is byte-identical across arms. The arm-to-slug map lives only in `<state>/runs.tsv (`$LESSONS_EVAL_STATE`, by default `~/.local/state/create-fun-lessons/lessons-cli-eval/`)`.

## Tasks

1. **Build** (`prompts/build.md`). Build a 3–4 unit course on ky from nothing, desktop only, no server, the user clicks through it themselves.
2. **Revise** (`prompts/revise.md`). Start from one fixed seed course and make three changes: insert a lesson between the first two lessons of unit 2, fix a quiz card the checker rejects, and rewrap a code line too wide for a phone.

   The seed is the first `new` build run, in launch order, whose final page passes the current checker and whose unit 2 has at least 2 lessons. The `new` arm gets its course folder. The `old` arm gets the page the old flow would have produced: c4f17c3's `template.html` with the seed's content block spliced in, plus the same `syllabus.md`. Two defects are planted in both, in each arm's native format, by `plant.mjs`:
   - a `fill` card whose `code` has two `____` (both checkers reject it)
   - a learn-card code line of about 60 columns (only the new checker rejects it; the prompt names the lesson by title)

   For the `new` arm, `index.html` stays the pre-defect build, as if someone edited the lesson files after the last build.

## Runs

- Claude subscription, model `claude-opus-5-5`, effort `high`.
- Headless `claude -p --model claude-opus-5-5 --effort high --permission-mode auto --disallowedTools Skill --strict-mcp-config --output-format stream-json --verbose`. User settings and hooks stay on (the classifier refused a run that dropped them), the same for both arms. `Skill` is disallowed so the user-level install of the current skill can't be invoked; reads outside the workspace are checked in the transcripts.
- **5 runs per arm per task, 20 candidate runs.** Why 5: with an exact two-sided Mann–Whitney test, 5 vs 5 reaches p = 0.008 when the arms separate completely, 4 vs 4 only 0.029, 3 vs 3 never below 0.1. Agent token use varies run to run by tens of percent, so 5 per arm can show a large effect (about 1.5× or more) and cannot show a small one. The report says which.
- Concurrency: 5 runs at a time (10 CPUs; load was 4.2 at planning), each wave interleaved old/new so time-of-day and API latency hit both arms alike. Wall limit 90 minutes per build run, 40 per revise run.
- Budget: the headless result reports API-list-price cost (`total_cost_usd`), which on a subscription is a size measure, not money. Cap 60 per run (`--max-budget-usd`). Planned total about 20 candidate runs plus 2 judge runs. If wave 1's builds average above 40 each, pause and ask before wave 2. A run that dies on a usage or rate limit is rerun after the reset and its cause named.

## Metrics (per run)

From the stream-json log, `metrics.py`:
- tokens: input, cache-creation, cache-read, output, summed over models (subagents included, via `modelUsage`)
- tool calls (main and subagent), assistant turns, subagents spawned
- wall time (`duration_ms`)
- checker runs: Bash commands that run `check.mjs` or `lessons.mjs check|build`; failed = output without an `OK:` line
- helper scripts the agent wrote for itself (files it created ending in `.mjs/.js/.py/.sh` outside the course output)

From the final files, `grade.mjs`:
- final checker result: current `check.mjs` on the final page, with `--repo ky`, problem count by kind
- shape: units, lessons, cards, card types, syllabus rows
- revise only: new lesson at unit 2 position 2 with 3–6 cards and a unique id; every seed lesson id and `storageKey` unchanged; the fill defect gone; no code line over 41 columns; the new lesson in some syllabus row; cards outside the three targets unchanged (collateral edits); for `new`, `index.html` equals a fresh build of the folder

## Quality grade

`rubric.md`, written now and shown only to judges. `dump.mjs` renders every final page into one plain-markdown form (no file-format tells; SVG becomes its `aria-label` plus element count), labelled by shuffled letters. Two blind judges, `claude-opus-5-5` and `claude-sonnet-5-5` at `high`, each score all 10 build courses in one pass on one scale, and all 10 inserted revision lessons in a second section. Judges can read `ky/` to check facts. Judge disagreement over 1 point on a criterion is reported.

## Prior evidence (not a result)

An earlier real 19-unit old-flow build on another codebase (30 minutes, 14 subagents, about 760 tool calls, 85M cache-read tokens) wrote its own assembler (`assemble.py`), a subagent schema brief, and a code-width measurer. Of its 34 checker runs, 4 failed, each a different kind: syllabus "in no row" (19 of 24 error lines, but one run, before any rows existed), a JS parse error from an unescaped backtick, a regex-looking `type` answer, and a fill with two blanks. The costliest work was rewrapping 266 wide code lines with 5 extra agents. So this eval classifies every checker failure by kind (syllabus, parse/escaping, field rule, width), counts helper scripts, and reports the final common-checker result twice: all rules, and all rules except code width, since the old arm's checker cannot see width at all.

## Reading the numbers

For each metric: median, min–max, and the exact Mann–Whitney p. A difference is called only when p < 0.05 and the medians differ by more than the within-arm spread suggests. Each number gets a note on what limits it (system-prompt floor, file reads of the skill docs, the course size the agent chose).
