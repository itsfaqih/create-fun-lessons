# Course quality rubric (judges only)

Score each course 1–5 on each criterion. 3 is competent and usable, 5 is excellent, 1 is broken or misleading. Use the whole scale and the same scale for every course. Check facts against the source in `commander/` (the library the courses teach).

1. **Accuracy.** Every file path, function, option, default, and behaviour stated matches `commander/lib/`, `commander/typings/` and `commander/Readme.md`. Deduct for each wrong fact, more for one a learner would act on (a wrong method name, a wrong default for an option or argument).
2. **Coverage and arc.** The course spans foundations, a parse followed end to end (from `process.argv` to the action handler), the main areas (options, arguments, commands and subcommands, action handlers and life cycle hooks, help, errors and exit handling, stand-alone executable subcommands, TypeScript typings), and ends on a change the learner could plan. The syllabus maps Commander's real parts, and skips name a reason.
3. **Depth and recall.** Cards teach real names (the function, its arguments, who calls it), quiz each idea within a card or two, and mix recognition with recall (`type`, `write`). Wrong options are plausible neighbours. `why` explains in one or two sentences.
4. **Card craft.** Each quiz states its acceptance criteria up front; `type` accepts every real variant; `write` rubrics are yes-or-no and observable; hints go from gentle to specific; one idea per card; a learn card fits a phone screen. A code line marked `← N columns: scrolls sideways on a phone` is too wide for a phone screen, and each one counts against craft.
5. **Coherence.** 3–4 units as asked, lessons of 3–6 cards, each lesson builds on the last, terms defined before use, the glossary matches what lessons teach.

For an inserted lesson (revision section), score Accuracy, Depth and recall, Card craft, and **Fit**: it sits naturally between its neighbours and does not repeat them.

Give each score a one-line reason citing a lesson id and card. End with a ranking.
