# Hill climb: make the `lessons.mjs` flow cheaper than the hand-written one

Written 2026-11-18, after the eval in PLAN.md and before any hill-climb run. The eval found the CLI flow (`new`, 566c86e) costs 1.83× the input tokens of the old flow on a fresh build (p 0.008), garbles one-character code spans, leaks `«»` markers, and scored lower on blind quality. The goal is a skill commit that beats the old flow on cost without those defects, or a plain statement that it can't be done.

## Metric

- **Primary.** Median `tokens_in_total` over 5 build runs (input plus cache reads plus cache writes, from `modelUsage`). Lower is better. Almost all of it is cache reads, so it tracks turns times context size.
- **Baseline.** `new`: 8.88M (range 6.93M to 12.62M).
- **Target.** At most 4.84M, the `old` arm's median. The old arm skipped the skill's browser click-through in some runs, so the target is generous to it.

## Guardrails (all must hold for the final arm)

- 0 garbled spans, 0 leaked markers, and 0 double-escaped entities on every run (`grade.mjs`).
- 5 of 5 final pages pass the grading checker, frozen at 2a69b9d in `<state>/grader/`.
- The click-through stays in the skill. Any cut to it is a separate decision for the user.
- At the end, one blind judge pass (the same two judges and rubric as the eval) on the final arm against the old arm's 5 builds. Final quality at least the old arm's 4.6, or the gap reported.
- The revise task does not get worse. Checked once on the final arm with 5 revise runs.

## Keep or revert

- An iteration is one candidate commit on `lessons-cli-hillclimb`, registered with `harness.py arm <name> <commit>` and measured with 5 build runs.
- Keep it when its median input tokens is below the current best and no guardrail regresses. A correctness fix (H1) is kept when its guardrail counts improve and its tokens are no worse than the current best at p ≤ 0.1.
- Revert otherwise with `git revert`, and log the row.

## Stop predicate

Stop when the primary metric reaches the target with every guardrail holding, after at least 4 iterations. Also stop after 8 iterations, or when two iterations in a row fail to beat the current best. Then report whether the target is reachable, and what blocks it.

## Hypotheses, in planned order

1. **H1, render defects.** Fix the three `lessons.mjs` rendering bugs and add a check rule for what remains. A guardrail fix; not expected to move tokens.
2. **H2, fewer writes.** Let one lesson file hold several lessons, so a unit is one write. New builds made 12 to 15 writes, old builds 2.
3. **H3, fewer checks.** Check once per unit, first time right. New builds ran 7 to 15 checks, old builds 1 to 4.
4. **H4, cheaper click-through.** One scripted browser recipe in the skill, so the click-through takes a few calls. New builds made 18 to 32 browser calls.
5. **H5, smaller context.** Shorten the skill docs every turn re-reads.

Each later hypothesis is chosen from the previous iteration's tool-call breakdown, not fixed in advance.

## Runs and budget

- Claude subscription, model `claude-opus-5-5`, effort `high`, the same headless command as PLAN.md. Code edits go to one subagent per iteration on the same model and effort.
- 5 build runs per iteration, run 5 at a time after checking `uptime`. About 22 list dollars and 12 minutes per iteration (measured on the eval's new arm).
- Budget about 8 iterations plus 5 revise runs and 2 judge runs, about 200 list dollars. List dollars are an API list-price size, not money spent. If one iteration's builds average above 40 each, pause and ask.

## Files

- `<state>` is `$LESSONS_EVAL_STATE`, by default `~/.local/state/create-fun-lessons/lessons-cli-eval/`.
- `<state>/arms.json` maps each hill-climb arm to its commit.
- `<state>/hillclimb/decision.tsv` is the decision log, kept out of the tree.
- `python3 stats.py <A> <B>` compares two arms.

## Results (2026-11-18)

Final arm of the first climb: **h6** (c5914ce). The later h10 arm replaces it (see the last section).

| Measure, median of 5 builds | old | h6 | h6 / old | p |
|---|---|---|---|---|
| Input tokens, cache included | 4.84M | 4.36M | 0.90× | 0.84 |
| List cost per build | 3.36 | 2.85 | 0.85× | 0.032 |
| Output tokens | 57k | 39k | 0.68× | 0.008 |
| Revise input tokens | 4.4M | 1.46M | 0.33× | 0.008 |

- The primary target (≤ 4.84M) holds from h3 on: baseline 8.88M to 4.36M, −51%.
- Guardrails hold except quality: 0 real defects, 5/5 frozen-checker pass, every run passes `#selfcheck`, revise 5/5 done.
- Quality gap: three blind passes put the old arm at 4.7 to 4.8 and the CLI arm at 4.1 to 4.5 (h6 4.4, p 0.15; h7 4.1, p 0.016; h8 4.5, p 0.23).
- H7 (card-writing rules in SKILL.md, 5–6 cards, each option its own card) grew courses to 99 cards and scored lower. H8 (only the "lesson ends on a learn card" rule) cost 1.28× h6's tokens with quality inside judge noise. Both reverted; two failures in a row met the stop predicate.
- The CLI writers write about 0.7× the old arm's output tokens. Guidance that adds cards raises cost faster than it raises the judges' scores, so parity on quality at the old arm's cost was not reached.

## Repomix (2026-11-18)

Question: does packing the repo with Repomix in one call, instead of reading files, make a build cheaper or a course better? Repomix 1.19.0 was vetted first (29k stars, MIT, no install scripts, network only for `--remote`), installed pinned with scripts off, and put on the runs' PATH.

| Arm | What the skill said | Runs that packed | Input tokens vs h6 | List cost vs h6 |
|---|---|---|---|---|
| h9 | Pack with Repomix, mid-paragraph in Research | 0/5 | 0.94×, p 0.22 | 0.92× |
| h9b | Pack as Research's first command block | 1/5 | 0.94×, p 0.84 | 1.10× |
| h9c | Run the installed `repomix` before `npx` | 4/5 | 0.96×, p 0.84 | 1.06× |

- h9 changed no behaviour, so its 0.94× is the noise floor between identical arms.
- In h9b, 4 of 5 agents reached for a download (`npx`/`vp dlx repomix`); the auto-mode classifier denied each one, so no unvetted code ran.
- Where Repomix ran, the pack was about 54k to 68k tokens, read in 3 to 10 parts. Tool calls stayed at 37 to 41 against h6's 38: the agents already batch many files per `cat`, so a pack saves no turns. Cache writes rose 1.17× (p 0.008).
- Quality, blind (Opus and Sonnet judges, h9c vs old): 4.5 vs 4.7, p 0.34. The four courses built from a pack scored 4.2 to 4.5, level with h6's 4.4; the one h9c run that was denied Repomix scored 5.0.
- Decision: revert all three. Repomix earns no place in the skill; the final arm stays h6.

## Self-check, model, research and review (2026-11-18)

Question: where do h6's tokens go, and which of four changes cuts them or closes the quality gap? Each arm ran 5 builds; quality is a blind Opus and Sonnet pass against 5 old courses in the same packet.

| Arm | Change | Input tokens | List cost | Quality, arm vs old | Decision |
|---|---|---|---|---|---|
| h10 | `lessons.mjs selfcheck`: headless Chrome over DevTools at 400px, report and resume check in one command | 3.27M, 0.75× h6, p 0.095 | 0.88× | 4.6 vs 4.9, p 0.048 | keep |
| h11 | h6 skill built on Sonnet 5.5 | 1.09× h6, p 0.69 | 0.55×, p 0.008 | 4.4 vs 4.8, p 0.016; two courses at 3.6 and 3.8 | revert (a model choice, not a skill change) |
| h12 | Research in subagents that return notes | 1.39× h6, p 0.032 | 1.54× | 4.6 vs 4.6, p 0.34 | revert |
| h13 | Fresh-reader card review after selfcheck | 1.46× h6, p 0.032 | 1.41× | 4.5 vs 4.6, p 0.33 | revert |
| h14 | h10 + h12 | 1.52× h10, p 0.008 | 1.59× h10 | 4.5 vs 4.8, p 0.19 | revert |

- h10: all 5 runs used the command and made 0 browser calls; tool calls fell to 0.89× (p 0.048). The quality gap (−0.3) is h6's gap within judge noise.
- h12's parity did not hold when h14 ran it again on top of h10. Old-course medians move 4.6 to 4.9 between packets, so a 0.0 gap from one packet is noise-level.
- h13 cost 1.68× h6's wall time for a gap inside noise.
- One h14 course (oak-65) fails the frozen checker only because its Sources start with `ky/`, a form SKILL.md allows and `build` accepts. That is a grader artifact.
- Decision: the final arm is **h10**. Building on Sonnet halves list cost with a weaker low tail; that is the user's model choice, not a skill default.

## Fair judging, checker rules and a second subject (2026-11-19)

Question: do the judges' complaints about h10 come from the courses or from the dump, and do checker rules for the defects they name close the gap? Each arm ran 5 ky builds on claude-opus-5-5 at high effort, and each packet is judged blind by Opus and Sonnet.

The dump now marks each code line too wide for a phone, the grader accepts Sources under `ky/`, and `harness.py cards` counts card defects. With those changes, h10's own 10 courses judged again (h10w) gave h10 4.64 and old 4.38, p 0.079. The first pass had given 4.6 vs 4.9, p 0.048. The dump and the judge invocation both changed, so the reversal is one pass, not a proof.

| Arm | Change | Quality, arm vs old | List cost, median | Expect leaks | Lessons outside 3–6 | Decision |
|---|---|---|---|---|---|---|
| h15 | `build` rejects an `expect` that shows an accepted answer and a lesson outside 3–6 cards; `selfcheck` warns on a learn card taller than 400x860, fails on page errors, and exits 1, not 3, on a timeout or a lost browser | 4.68 vs 3.88, p 0.008 | $2.67 (old $3.36, h10 $2.51) | 0 (h10 8) | 0 (h10 1) | keep |
| h16 | h15 + Research: take behaviour from the code, teach a rule file as rules | 4.76 vs 4.00, p 0.008 | $2.59 | 0 | 0 | keep, final arm |

- Every h15 and h16 course passes the frozen checker, and none has a wide line.
- h15 against h16 in one packet: 4.44 vs 4.44, p 1.0. Accuracy sits at 5 in 19 of 20 scores, so the Research sentence has no measurable effect on ky. It stays because it costs one sentence, and one h16 course teaches the code's behaviour for `searchParams: null` (sent as `'null'`), while one h15 course (fern-49) states, from ky's AGENTS.md, that `null` throws. The judges flagged neither.
- Old scores move between packets (3.88, 4.00, 4.38). Read each gap within its own packet only.
- `restore` replays a run's logged writes, edits and commands into a deleted workspace. A regrade of 100 restored runs matches the saved grades in 95. oak-65 now passes, as expected. teak-14 and larch-44 have no page after replay, and revise runs ivy-98 and birch-93 replay with different lessons. Their saved grades are kept and marked `restoreMismatch`.

Second subject, commander 15.1.0 (5 old and 5 h16 builds, interleaved, then one blind packet):

| Arm | Quality | List cost, median | Tool calls, median | Wall, median | Frozen checker |
|---|---|---|---|---|---|
| old | 4.26 | $3.87 | 54 | 798 s | 0/5 pass, 61 to 87 wide lines each |
| h16 | 4.62, p 0.024 | $2.94, 0.76× | 41 | 532 s | 5/5 pass, 0 wide lines |

- Both judges found accuracy level across all ten and named the wide-line marks as the main separator. The marks show a real phone defect, but this gap is mostly that one defect. Depth and coverage were close.
- The cost result carries over: h16 is 0.76× old's cost on a library it was never tuned on. The quality gap, here and on ky, rests mostly on wide lines, a defect only old courses carry, so the marks also reveal the arm to the judges. On everything else, h16 matches old rather than beating it.
- Decision: the final arm is **h16** (41bea1a).

Unmarked check (`judge --unmarked --labels-from`): the same 10 courses per subject, dumped without the wide-line marks and judged with a rubric that does not mention them.

| Subject | Marked | Unmarked |
|---|---|---|
| ky | h16 4.76 vs old 4.00, p 0.008 | h16 4.58 vs old 4.72, p 0.14 |
| commander | h16 4.62 vs old 4.26, p 0.024 | h16 4.40 vs old 4.72, p 0.040 |

- Without the marks, the h16 lead disappears on ky and reverses on commander. Every point of h16's lead came from the wide lines.
- Where h16 loses: coverage (Opus 4.4 vs 5.0 on both subjects), depth, and Sonnet's coherence on commander (3.8 vs 4.6). The judges name the misses. Courses skip contributing and typings or give them one line. They end on a test-writing card, not a planned change to the library. Type cards carry a single hint where the rubric wants hints that go from gentle to specific.
- Corrected conclusion: h16 is the final arm for cost (0.76× old) and phone fit (0 wide lines against 34 to 87). It does not beat the hand-written flow on content. The next hypothesis should target coverage of contributing and typings, the capstone, and two-step hints.
