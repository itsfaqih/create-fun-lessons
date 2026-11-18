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

- Provider `claudeAgent_claude_faqih` (Claude subscription), model `claude-opus-5-5`, effort `high`, the same headless command as PLAN.md. Code edits go to one `pstack:poteto-agent` per iteration on the same model and effort (`hillclimb: opus-high` in model routing).
- 5 build runs per iteration, run 5 at a time after checking `uptime`. About 22 list dollars and 12 minutes per iteration (measured on the eval's new arm).
- Budget about 8 iterations plus 5 revise runs and 2 judge runs, about 200 list dollars. List dollars are an API list-price size, not money spent. If one iteration's builds average above 40 each, pause and ask.

## Files

- `<state>` is `~/.agents/state/pstack/create-fun-lessons/lessons-cli-eval/`.
- `<state>/arms.json` maps each hill-climb arm to its commit.
- `<state>/hillclimb/decision.tsv` is the decision log, kept out of the tree.
- `python3 stats.py <A> <B>` compares two arms.

## Results (2026-11-18)

Final arm: **h6** (c5914ce). The branch head after the two reverts has the same skill tree.

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
