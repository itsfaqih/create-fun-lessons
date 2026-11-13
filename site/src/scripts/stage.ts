// A small player for the page's demos. Each demo is a `.ss-stage` element
// whose scene state lives in data attributes; CSS draws every state and its
// transitions. A script sets attributes over time, presses targets and moves
// a touch or arrow pointer. A demo plays once when it scrolls into view,
// resets while fully off screen, and under reduced motion shows its poster
// (the finished state) without playing.

type Value = string | number | boolean | null | undefined
export type Attrs = Record<string, Value>

class Aborted extends Error {}

const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)')
const slow = () => (window as unknown as { __stageshow?: { slow?: number } }).__stageshow?.slow ?? 1

function apply(root: HTMLElement, attrs: Attrs) {
  for (const [key, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) delete root.dataset[key]
    else root.dataset[key] = v === true ? '' : String(v)
  }
}

export class Act {
  constructor(readonly root: HTMLElement, private signal: AbortSignal, private render: () => void) {}

  wait(ms: number) {
    return new Promise<void>((resolve, reject) => {
      if (this.signal.aborted) return reject(new Aborted())
      const t = setTimeout(resolve, ms * slow())
      this.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Aborted()) }, { once: true })
    })
  }

  set(attrs: Attrs) { apply(this.root, attrs); this.render() }

  /** Names a beat so a film run can start at it (`--at <name>`). */
  mark(name: string) { this.root.dataset.mark = name }

  target(name: string) {
    const el = this.root.querySelector<HTMLElement>(`[data-target="${name}"]`)
    if (!el) throw new Error(`no [data-target="${name}"] in stage`)
    return el
  }

  /** A point inside a target, in stage coordinates. */
  point(name: string, fx = 0.5, fy = 0.5) {
    const r = this.target(name).getBoundingClientRect()
    const s = this.root.getBoundingClientRect()
    return { x: r.left - s.left + r.width * fx, y: r.top - s.top + r.height * fy }
  }

  /** A finger tap: the touch mark lands on the target, presses, lifts. */
  async tap(name: string, fx = 0.7, fy = 0.6) {
    const touch = this.root.querySelector<HTMLElement>('.touch')
    const target = this.target(name)
    if (touch) {
      const { x, y } = this.point(name, fx, fy)
      touch.style.setProperty('--x', `${x}px`)
      touch.style.setProperty('--y', `${y}px`)
      touch.dataset.down = ''
    }
    target.dataset.pressed = ''
    await this.wait(170)
    delete target.dataset.pressed
    if (touch) delete touch.dataset.down
    await this.wait(80)
  }

  /** Types text into [data-type=name] one character at a time. */
  async type(name: string, text: string, msPerChar = 45) {
    const el = this.root.querySelector<HTMLElement>(`[data-type="${name}"]`)
    if (!el) throw new Error(`no [data-type="${name}"] in stage`)
    for (let i = 1; i <= text.length; i++) {
      el.style.setProperty('--n', String(i))
      await this.wait(msPerChar + (text[i - 1] === ' ' ? 40 : 0))
    }
  }
}

type Options = {
  initial: Attrs
  poster: Attrs
  script: (a: Act) => Promise<void>
  /** Draws the scene from its data attributes; runs after every change. */
  render?: (root: HTMLElement, data: DOMStringMap) => void
}

export function stage(root: HTMLElement, opts: Options) {
  let state: 'idle' | 'playing' | 'done' = 'idle'
  let ctl: AbortController | null = null
  const keys = new Set([...Object.keys(opts.initial), ...Object.keys(opts.poster)])
  const clear = () => { for (const k of keys) delete root.dataset[k]; delete root.dataset.mark }

  const render = () => opts.render?.(root, root.dataset)
  const reset = (attrs: Attrs) => {
    clear()
    apply(root, attrs)
    root.querySelectorAll<HTMLElement>('[data-type]').forEach((el) => el.style.removeProperty('--n'))
    // Jump to the state without transitions: it happens off screen or as the poster.
    root.dataset.snap = ''
    render()
    void root.offsetWidth
    requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.snap))
  }
  const toInitial = () => { reset(opts.initial); state = 'idle' }
  const toPoster = () => { reset(opts.poster); root.dataset.mark = 'end'; state = 'done' }

  async function play() {
    if (reducedQuery.matches) return toPoster()
    state = 'playing'
    ctl = new AbortController()
    try {
      await opts.script(new Act(root, ctl.signal, render))
      root.dataset.mark = 'end'
      state = 'done'
    } catch (e) {
      if (!(e instanceof Aborted)) throw e
    }
  }

  const stop = () => { ctl?.abort(); ctl = null }

  if (reducedQuery.matches) toPoster()
  else toInitial()
  // Measured layout (label widths) is redrawn once the web fonts are in.
  void document.fonts.ready.then(render)

  reducedQuery.addEventListener('change', () => {
    stop()
    if (reducedQuery.matches) toPoster()
    else toInitial()
  })

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.intersectionRatio >= 0.55 && state === 'idle') {
        // Hold the opening frame for a moment so it reads before it changes.
        state = 'playing'
        void document.fonts.ready.then(play)
      } else if (!e.isIntersecting && state !== 'idle' && !reducedQuery.matches) {
        stop()
        toInitial()
      }
    }
  }, { threshold: [0, 0.55] })
  io.observe(root)
}
