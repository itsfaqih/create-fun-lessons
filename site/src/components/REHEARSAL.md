# Rehearsal notes for the landing-page demos

The demos follow the stageshow skill's rules for framing, restraint and motion. They are rebuilt in Astro and vanilla TypeScript (`src/scripts/stage.ts`), with no React kit. Each animated demo plays once when 55% of it is in view, resets while it is off screen, and shows its poster under reduced motion.

| Demo | Component | Gold it follows | Story | Poster |
| --- | --- | --- | --- | --- |
| Hero | `HeroDemo.astro` | `phone-touch`, `ai-cards` | Hint, Hint again (strikes an option), pick, Check | Footer green: "Right, with a hint" |
| Lesson map | `MapDemo.astro` (still) | `fade-crop`, `static-card` | The course home after a few lessons | Same |
| Card types | `CardTypes.astro` (stills) | `bento`, `stacked-cards` | One card of each type, cropped to what sets it apart | Same |
| Lesson complete | `DoneDemo.astro` | `payout-flow` | Trophy, tiles, the course count rolling with its bar, recap and Next lesson | The finished screen |
| Coverage | `CoverageDemo.astro` | `hero-demo` (terminal satellite) | The checker fails on `scripts/`, a row is added, the checker prints OK | The new row and the green run |

## What was checked

- Filmed with `film.mjs` at 1440 and 390: contact sheets, beat stills (`--at`), and reduced-motion posters for every animated demo. Full-page screenshots at 1440 and 390, in light and dark.
- Fixed from the frames:
  - the hint button's width jump: the label width is measured and transitioned
  - hard edges on rolling digits and collapses
  - text landing on a transform: lasting layers added
  - real words cut by the crop on the map and the syllabus
  - the terminal covering the new syllabus row: the terminal is shorter and the table smaller
  - the syllabus table at 390: a two-column compact layout
  - the written-answer tile at 390: the code is hidden, so the rubric shows
  - horizontal overflow at 390 from the install command
- The strings match the engine in `skills/create-fun-lessons/template.html`: the kickers, "Right, with a hint", "Not quite", "You will see this one again at the end.", "Lesson complete", the done-screen tiles, "Remember", "Next lesson", and the Course tile (7 / 12 after this lesson, at 75% first try). The checker strings come from `scripts/check.mjs`.

## Known and accepted

- `film.mjs` reports each whole stage appearing and vanishing at 0.0s. These are the film's own start and reset frames. No visible pop was found in the contact sheets.
- The hero's code sits inline next to the blank; the "touching" flag there is intentional.
- Typing in the coverage terminal advances one character per frame by design.

## Not checked

- Real phone hardware; the 390 checks used a desktop browser at phone width.
- Very old browsers without `lh` units or `color-mix()`.
