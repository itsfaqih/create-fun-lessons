# Visuals

Patterns for drawing a concept inside a card: diagrams, charts, and illustrations. Each is inline SVG coloured by the page's `.viz` classes, so it follows the light and dark themes, scales to the card, and needs nothing beyond the page itself. The template's sample lesson `u1l2` shows each kind running.

## Picking a pattern

| The concept is | Draw |
|---|---|
| a pipeline with no branches | the `.flow` HTML helper (see `SKILL.md`) |
| steps that branch or loop | [Flow](#flow) |
| messages between actors over time | [Sequence](#sequence) |
| parts of a system and what calls what | [Architecture](#architecture) |
| sizes to compare | [Bar chart](#bar-chart) |
| a value changing over time or input | [Line chart](#line-chart) |
| a shape: memory, an array, layers, a tree | [Illustration](#illustrations) |

A visual earns its card when the learner would otherwise hold the picture in their head. Put it in a `learn` card's `body`, or in a quiz `q` after the question text, so the learner reads the picture to answer. In a quiz, draw every part neutrally: a highlighted box gives the answer away.

## The frame

```html
<figure class="viz"><svg viewBox="0 0 320 H" role="img" aria-label="What the picture shows, as one or two sentences">
  …shapes…
</svg><figcaption>One line saying what to notice.</figcaption></figure>
```

- **Canvas.** Draw on a viewBox 320 units wide, the width of a 360px phone's card. The svg fills the card up to 400px wide; `style="--w:320px"` on the `figure` caps a small picture lower. Pick `H` to fit the shapes plus 4 units of margin.
- **Text alternative.** `aria-label` says what a reader would take from the picture, with the numbers for a chart. The checker requires `viewBox`, `role="img"`, and `aria-label` on every svg, and rejects a fixed `width`.
- **Labels.** Text renders at 12 units (11 for `sub` and `mono`), about 6.6 units per character, so a 112-wide box holds 15 characters. Centre text with `text-anchor="middle"` and `dy=".35em"` on the box's centre point. Write `<` in a label as `&lt;`.
- **Colour** comes from these classes, which read the theme's tokens; the accent is the unit's `color`.

| Class | On | Draws |
|---|---|---|
| `box` | `rect`, `path` | a node: card fill, border stroke; add `hi` for the one that matters, `soft` for a muted store or external service |
| `zone` | `rect` | a dashed boundary around a group, such as a service or a package |
| `edge` | `path` | an arrow; add `back` for a reply or return (dashed), `hi` for the path that matters |
| `life` | `path` | a sequence diagram lifeline |
| `axis`, `grid` | `path` | chart axes and gridlines |
| `fill` | `rect` | a bar in the accent; add `alt` for a muted comparison bar |
| `series`, `area`, `dot` | `path`, `circle` | a chart line, the tint under it, a marked point |
| `sub`, `mono`, `on` | `text` | muted text, code text, white text on a `fill` |

- **Arrows.** An `edge` gets its arrowhead from the page. End the path 2 units before the target's edge so the tip touches it. Route with `H` and `V` segments; right angles read as a diagram, diagonals as a sketch.

## Flow

Branching steps. The decision is a diamond `path`, each branch is labelled with `sub` text beside its edge, and a loop back is an `edge back`.

```html
<figure class="viz"><svg viewBox="0 0 320 248" role="img" aria-label="A request checks the cache. A hit returns the cached copy. A miss queries the database, saves the row to the cache, then returns it.">
  <rect class="box" x="100" y="4" width="120" height="36" rx="8"/><text x="160" y="22" dy=".35em" text-anchor="middle">Request in</text>
  <path class="edge" d="M160 40V62"/>
  <path class="box hi" d="M160 64 216 92 160 120 104 92z"/><text x="160" y="92" dy=".35em" text-anchor="middle">In cache?</text>
  <path class="edge" d="M104 92H60V140"/><text class="sub" x="80" y="84" text-anchor="middle">yes</text>
  <path class="edge" d="M216 92H260V140"/><text class="sub" x="240" y="84" text-anchor="middle">no</text>
  <rect class="box" x="4" y="142" width="112" height="36" rx="8"/><text x="60" y="160" dy=".35em" text-anchor="middle">Return cached</text>
  <rect class="box" x="204" y="142" width="112" height="36" rx="8"/><text x="260" y="160" dy=".35em" text-anchor="middle">Query database</text>
  <path class="edge" d="M260 178V204"/>
  <rect class="box" x="204" y="206" width="112" height="36" rx="8"/><text x="260" y="224" dy=".35em" text-anchor="middle">Save to cache</text>
  <path class="edge back" d="M204 224H60V180"/><text class="sub" x="132" y="216" text-anchor="middle">then return</text>
</svg><figcaption>A read-through cache: every miss fills it.</figcaption></figure>
```

Grow it downward: rows sit 64 units apart, two columns centre on x 60 and 260, one column on x 160.

## Sequence

Actors across the top, time running down. Three actors fit at x 50, 160, 270; a fourth fits at x 40, 120, 200, 280 with 72-wide headers. Messages sit 40 units apart, each label 8 units above its arrow in `mono`.

```html
<figure class="viz"><svg viewBox="0 0 320 206" role="img" aria-label="The browser sends GET /orders/42 to the server. The server queries the database, gets one row back, and replies 200 with JSON.">
  <rect class="box" x="8" y="4" width="84" height="28" rx="6"/><text x="50" y="18" dy=".35em" text-anchor="middle">Browser</text>
  <rect class="box hi" x="118" y="4" width="84" height="28" rx="6"/><text x="160" y="18" dy=".35em" text-anchor="middle">Server</text>
  <rect class="box" x="228" y="4" width="84" height="28" rx="6"/><text x="270" y="18" dy=".35em" text-anchor="middle">Database</text>
  <path class="life" d="M50 32V202M160 32V202M270 32V202"/>
  <path class="edge" d="M50 64H158"/><text class="mono" x="105" y="56" text-anchor="middle">GET /orders/42</text>
  <path class="edge" d="M160 104H268"/><text class="mono" x="215" y="96" text-anchor="middle">SELECT … 42</text>
  <path class="edge back" d="M270 144H162"/><text class="mono" x="215" y="136" text-anchor="middle">1 row</text>
  <path class="edge back" d="M160 184H52"/><text class="mono" x="105" y="176" text-anchor="middle">200 + JSON</text>
</svg><figcaption>One request, from click to response.</figcaption></figure>
```

A message label spans at most the gap between its two lifelines: 16 `mono` characters between neighbours.

## Architecture

Boxes for the parts, a `zone` for each deployable or package, `soft` boxes for stores and outside services. Stack the tiers top to bottom (caller, service, storage), two boxes per row, so the picture stays narrow. A second line in each box names its file in `sub mono`.

```html
<figure class="viz"><svg viewBox="0 0 320 226" role="img" aria-label="The browser calls the router inside the api service. The router passes requests to the handlers. The handlers connect to Postgres and to Redis.">
  <rect class="box" x="110" y="4" width="100" height="34" rx="8"/><text x="160" y="21" dy=".35em" text-anchor="middle">Browser</text>
  <rect class="zone" x="16" y="56" width="288" height="96" rx="12"/><text class="sub" x="28" y="72">api service</text>
  <path class="edge" d="M160 38V46H90V84"/>
  <rect class="box" x="40" y="86" width="100" height="44" rx="8"/><text x="90" y="101" dy=".35em" text-anchor="middle">Router</text><text class="sub mono" x="90" y="117" dy=".35em" text-anchor="middle">routes.ts</text>
  <path class="edge" d="M140 108H178"/>
  <rect class="box" x="180" y="86" width="100" height="44" rx="8"/><text x="230" y="101" dy=".35em" text-anchor="middle">Handlers</text><text class="sub mono" x="230" y="117" dy=".35em" text-anchor="middle">orders.ts</text>
  <path class="edge" d="M210 130V166H90V184"/><path class="edge" d="M250 130V184"/>
  <rect class="box soft" x="40" y="186" width="100" height="34" rx="8"/><text x="90" y="203" dy=".35em" text-anchor="middle">Postgres</text>
  <rect class="box soft" x="200" y="186" width="100" height="34" rx="8"/><text x="250" y="203" dy=".35em" text-anchor="middle">Redis</text>
</svg></figure>
```

## Bar chart

Horizontal bars, labels on the left, each value printed at its bar's end, so nothing depends on reading an axis. Bars start at x 76 and the longest is 190 wide: `width = value / max × 190`, value text at `x = 76 + width + 6`. Rows sit 34 units apart, bars 20 tall. Use `fill` for the bars the point is about and `fill alt` for the rest.

```html
<figure class="viz"><svg viewBox="0 0 320 140" role="img" aria-label="Bundle size by package: core 142 kB, ui 96 kB, cli 38 kB, docs 12 kB.">
  <path class="axis" d="M76 4V136"/>
  <text x="68" y="20" dy=".35em" text-anchor="end">core</text><rect class="fill" x="76" y="10" width="190" height="20" rx="3"/><text class="mono" x="272" y="20" dy=".35em">142 kB</text>
  <text x="68" y="54" dy=".35em" text-anchor="end">ui</text><rect class="fill" x="76" y="44" width="128.5" height="20" rx="3"/><text class="mono" x="210.5" y="54" dy=".35em">96 kB</text>
  <text x="68" y="88" dy=".35em" text-anchor="end">cli</text><rect class="fill alt" x="76" y="78" width="50.8" height="20" rx="3"/><text class="mono" x="132.8" y="88" dy=".35em">38 kB</text>
  <text x="68" y="122" dy=".35em" text-anchor="end">docs</text><rect class="fill alt" x="76" y="112" width="16.1" height="20" rx="3"/><text class="mono" x="98.1" y="122" dy=".35em">12 kB</text>
</svg><figcaption>Bundle size by package. The two that ship to users are in colour.</figcaption></figure>
```

Up to 8 rows fit; past that, show the top entries and say so in the caption.

## Line chart

The plot runs x 36 to 308 and y 12 (the axis maximum) to 140 (zero). For point `i` of `n` with value `v` on an axis topping at `max`: `x = 36 + i × 272 / (n − 1)`, `y = 140 − v / max × 128`. Round the axis maximum up to a round number and draw three gridlines at its quarters or thirds. One `series` path carries the line; the same points closed down to the axis make the `area`. Mark the point the lesson is about with a `dot` and a `sub` label.

```html
<figure class="viz"><svg viewBox="0 0 320 166" role="img" aria-label="p95 latency per release, in milliseconds: about 120 for v1 to v3, 240 at v4, 230 at v5, 130 at v6 and 115 at v7.">
  <path class="grid" d="M36 12H308M36 54.7H308M36 97.3H308"/><path class="axis" d="M36 140H308"/>
  <text class="sub" x="30" y="12" dy=".35em" text-anchor="end">300</text><text class="sub" x="30" y="54.7" dy=".35em" text-anchor="end">200</text><text class="sub" x="30" y="97.3" dy=".35em" text-anchor="end">100</text><text class="sub" x="30" y="140" dy=".35em" text-anchor="end">0</text>
  <path class="area" d="M36 88.8L81.3 89.7 126.7 86.7 172 37.6 217.3 41.9 262.7 84.5 308 90.9V140H36z"/>
  <path class="series" d="M36 88.8L81.3 89.7 126.7 86.7 172 37.6 217.3 41.9 262.7 84.5 308 90.9"/>
  <circle class="dot" cx="172" cy="37.6" r="4"/><text class="sub" x="172" y="24" text-anchor="middle">N+1 query</text>
  <text class="sub" x="36" y="156" text-anchor="middle">v1</text><text class="sub" x="81.3" y="156" text-anchor="middle">v2</text><text class="sub" x="126.7" y="156" text-anchor="middle">v3</text><text class="sub" x="172" y="156" text-anchor="middle">v4</text><text class="sub" x="217.3" y="156" text-anchor="middle">v5</text><text class="sub" x="262.7" y="156" text-anchor="middle">v6</text><text class="sub" x="308" y="156" text-anchor="middle">v7</text>
</svg><figcaption>p95 latency per release, ms</figcaption></figure>
```

Label at most 8 x positions; with more points, label every second or fourth.

## Illustrations

A picture of a concept's shape, built from the same parts: cells, stacked layers, a tree. Mark what the lesson is about with `hi` and point at it with an `edge hi`.

**Cells** for arrays, buffers, memory, and queues: 48-unit squares in a row, indexes in `sub` below, pointers as labelled `edge`s above. Five cells fit; for more, show the first few, a `…` cell, and the last.

```html
<figure class="viz"><svg viewBox="0 0 320 132" role="img" aria-label="An array of five letters, a to e, with indexes 0 to 4. slice(1, 3) starts at index 1 and stops before index 3, giving b and c.">
  <text class="mono" x="88" y="10" dy=".35em" text-anchor="middle">start = 1</text><path class="edge hi" d="M88 20V40"/>
  <text class="mono" x="184" y="10" dy=".35em" text-anchor="middle">end = 3</text><path class="edge" d="M184 20V40"/>
  <rect class="box" x="40" y="44" width="48" height="40"/><rect class="box hi" x="88" y="44" width="48" height="40"/><rect class="box hi" x="136" y="44" width="48" height="40"/><rect class="box" x="184" y="44" width="48" height="40"/><rect class="box" x="232" y="44" width="48" height="40"/>
  <text class="mono" x="64" y="64" dy=".35em" text-anchor="middle">'a'</text><text class="mono" x="112" y="64" dy=".35em" text-anchor="middle">'b'</text><text class="mono" x="160" y="64" dy=".35em" text-anchor="middle">'c'</text><text class="mono" x="208" y="64" dy=".35em" text-anchor="middle">'d'</text><text class="mono" x="256" y="64" dy=".35em" text-anchor="middle">'e'</text>
  <text class="sub" x="64" y="98" dy=".35em" text-anchor="middle">0</text><text class="sub" x="112" y="98" dy=".35em" text-anchor="middle">1</text><text class="sub" x="160" y="98" dy=".35em" text-anchor="middle">2</text><text class="sub" x="208" y="98" dy=".35em" text-anchor="middle">3</text><text class="sub" x="256" y="98" dy=".35em" text-anchor="middle">4</text>
  <text class="mono" x="136" y="122" dy=".35em" text-anchor="middle">→ ['b', 'c']</text>
</svg><figcaption><code>letters.slice(1, 3)</code></figcaption></figure>
```

**Layers** for stacks of abstraction (your code on a framework on a runtime) and middleware: full-width boxes 40 units apart, the layer in focus `hi`, a `sub` note on the right naming what each owns.

```html
<figure class="viz"><svg viewBox="0 0 320 164" role="img" aria-label="Four layers from top to bottom: your handlers, the Express framework, the Node.js runtime, and the operating system. Your handlers are highlighted.">
  <rect class="box hi" x="4" y="4" width="312" height="34" rx="8"/><text x="16" y="21" dy=".35em">Your handlers</text><text class="sub" x="304" y="21" dy=".35em" text-anchor="end">src/routes/</text>
  <rect class="box" x="4" y="44" width="312" height="34" rx="8"/><text x="16" y="61" dy=".35em">Express</text><text class="sub" x="304" y="61" dy=".35em" text-anchor="end">routing, middleware</text>
  <rect class="box" x="4" y="84" width="312" height="34" rx="8"/><text x="16" y="101" dy=".35em">Node.js</text><text class="sub" x="304" y="101" dy=".35em" text-anchor="end">event loop, sockets</text>
  <rect class="box soft" x="4" y="124" width="312" height="34" rx="8"/><text x="16" y="141" dy=".35em">Operating system</text><text class="sub" x="304" y="141" dy=".35em" text-anchor="end">files, network</text>
</svg></figure>
```

**Trees** for file layouts, DOM, and ASTs: a file layout reads best as a `<pre><code class="language-text">` tree; draw a DOM or AST as `box` nodes with `edge`s fanning down, at most three levels and four leaves across.
