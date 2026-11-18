// Play a built course's #selfcheck in headless Chrome at 400px, then reload
// and read the map's resume card. Driven over the DevTools protocol, because
// the command line cannot make a headless window narrower than 500px.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/snap/bin/chromium', '/usr/bin/microsoft-edge',
  ...pf.flatMap(p => [join(p, 'Google/Chrome/Application/chrome.exe'), join(p, 'Microsoft/Edge/Application/msedge.exe')]),
]

export const findChrome = () => CANDIDATES.find(p => p && existsSync(p))

export class NoBrowser extends Error {}

export const SCREEN = { width: 400, height: 860 }

const LEARN_HEIGHTS = `(async () => {
  await document.fonts.ready
  const out = [], range = document.createRange()
  for (const lesson of ALL) {
    S.cur = null; startLesson(lesson.id)
    lesson.cards.forEach((c, i) => {
      if (c.t !== 'learn') return
      L.pos = i; renderCard(); range.selectNodeContents(document.querySelector('.panel'))
      out.push({ lesson: lesson.id, card: i + 1, px: Math.round(range.getBoundingClientRect().height) })
    })
  }
  return out
})()`

export async function selfcheck(file, { chrome = findChrome(), timeoutMs = 180_000 } = {}) {
  if (!chrome) throw new NoBrowser('no Chrome, Chromium or Edge found; set CHROME_PATH')
  if (typeof WebSocket !== 'function') throw new NoBrowser(`Node ${process.versions.node} has no WebSocket; Node 22 or later runs the self-check`)
  const profile = mkdtempSync(join(tmpdir(), 'selfcheck-'))
  const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  const gone = new Promise(r => { proc.on('exit', r); proc.on('error', r) })
  const waiting = new Map(), thrown = new Set()
  let ws, id = 0, step = 'the browser to start', dropped
  const drop = e => { dropped ??= e; for (const [, no] of waiting.values()) no(dropped); waiting.clear() }
  proc.on('exit', (code, signal) => drop(new Error(`the browser quit (${signal ?? `exit code ${code}`}) while waiting for ${step}`)))
  const timer = setTimeout(() => drop(new Error(`timed out after ${timeoutMs / 1000}s waiting for ${step}`)), timeoutMs)
  const send = (method, params = {}) => new Promise((ok, no) => {
    if (dropped) return no(dropped)
    waiting.set(++id, [ok, no])
    ws.send(JSON.stringify({ id, method, params }))
  })
  const until = async (expr, what) => {
    step = what
    for (;; await sleep(100)) {
      const v = (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value
      if (v) return v
    }
  }
  try {
    let port
    for (let i = 0; i < 200 && !port && !dropped; i++) {
      await sleep(100)
      const f = join(profile, 'DevToolsActivePort')
      if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]
    }
    if (!port) throw new NoBrowser(`${chrome} did not start its DevTools port`)
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(10_000) }).then(r => r.json(), e => { throw new NoBrowser(`no DevTools websocket (${e.message})`) })
    const page = targets.find(t => t.type === 'page')
    if (!page) throw new Error('the browser opened no page to drive')
    ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new NoBrowser(`no DevTools websocket at ${page.webSocketDebuggerUrl}`)) })
    ws.onclose = () => drop(new Error(`the browser closed its DevTools connection while waiting for ${step}`))
    ws.onmessage = e => {
      const m = JSON.parse(e.data)
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails
        thrown.add(`${(d.exception?.description ?? d.text).split('\n')[0]} (line ${d.lineNumber + 1})`)
      }
      const [ok, no] = waiting.get(m.id) ?? []
      waiting.delete(m.id)
      if (m.error) no?.(new Error(`${m.error.message} while waiting for ${step}`))
      else ok?.(m.result)
    }
    step = 'the page to open'
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', { ...SCREEN, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: `${pathToFileURL(file)}#selfcheck` })
    const report = await until("document.title.startsWith('Self-check') && (document.getElementById('selfcheck') || document.getElementById('app')).textContent", 'the self-check report')
    await send('Page.reload')
    const resume = await until("document.getElementById('resume')?.innerText", 'the map\'s resume card after the reload')
    step = 'the learn cards\' heights'
    const measured = await send('Runtime.evaluate', { expression: LEARN_HEIGHTS, awaitPromise: true, returnByValue: true })
    if (measured.exceptionDetails) throw new Error(`measuring learn cards stopped with ${measured.exceptionDetails.exception?.description ?? measured.exceptionDetails.text}`)
    return { report, resume: resume.replace(/\s+/g, ' ').trim(), tall: measured.result.value.filter(c => c.px > SCREEN.height), thrown: [...thrown] }
  } catch (e) {
    if (thrown.size) e.message += `\nThe page threw:\n${[...thrown].join('\n')}`
    throw e
  } finally {
    clearTimeout(timer)
    ws?.close()
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      if (proc.exitCode !== null || proc.signalCode !== null) break
      proc.kill(signal)
      await Promise.race([gone, sleep(5000)])
    }
    // Under load rmSync hit ENOTEMPTY after Chrome exited, so it retries and never fails the run.
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
  }
}

// The report names the lesson and card the reload should resume at.
export function resumeMatches(report, resume) {
  const m = report.match(/"Continue where you left off" for "([^"]+)", card (\d+) of (\d+)/)
  return !!m && resume.includes('Continue where you left off') && resume.includes(m[1]) && resume.includes(`Card ${m[2]} of ${m[3]}`)
}
